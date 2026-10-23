/**
 * A pasted file travels with its take, through the command line as the
 * binary runs it, against a real in-process HTTP server that keeps what it
 * is sent: `vos push` sends every file the take's script pastes (a picture
 * through the upload door, a text file inside the document) and lists them
 * on the document; `vos fetch --media` writes each one back beside
 * `actions.json` under the name the script pastes it by, so the fetched
 * take's script finds every file it names; a paste file the take does not
 * hold is said, and one that resolves outside the take is refused before
 * anything is sent.
 */
import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { projectFromArtifact } from '@vosjs/studio-core'
import { loadScriptFiles } from '@vosjs/render-core/record'
import { actionsDirFiles } from '../recorder'
import { readSyncState } from '../platform'
import { run } from '../run'
import type { Server } from 'node:http'
import type { ProjectDoc } from '@vosjs/studio-core'

let server: Server | undefined
afterEach(async () => {
  const s = server
  server = undefined
  if (!s) return
  s.closeAllConnections?.()
  await new Promise<void>((done) => s.close(() => done()))
})

const META = {
  dpr: 1,
  zoom: 1,
  t0: 0,
  durationMs: 2000,
  width: 1280,
  height: 720,
  fps: 30,
}
// Not a real picture: the test platform stores bytes, it does not read them.
const LOGO = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4, 5, 6, 7])
const NOTES = '<p>Shipped <b>today</b></p>'

interface Seen {
  method: string
  url: string
  body: Record<string, unknown> | null
}

/**
 * The platform, small: the upload door (keeping each file's bytes), the
 * create, the vos's head, its config and its doc, and the file door.
 */
function serve(seen: Seen[]) {
  const declared = new Map<string, Record<string, unknown>>()
  const parts = new Map<string, Buffer>()
  const files = new Map<string, Buffer>()
  let doc: ProjectDoc | null = null
  let n = 0
  server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      const raw = Buffer.concat(chunks)
      const url = req.url ?? ''
      const method = req.method ?? ''
      let body: Record<string, unknown> | null = null
      try {
        body = raw.length
          ? (JSON.parse(raw.toString('utf8')) as Record<string, unknown>)
          : null
      } catch {
        // a raw part is not JSON
      }
      seen.push({ method, url, body })
      const send = (status: number, payload: unknown) => {
        res.writeHead(status, { 'content-type': 'application/json' })
        res.end(JSON.stringify(payload))
      }
      if (url === '/api/engine') return send(404, {})
      if (url === '/api/assets/uploads' && method === 'POST') {
        const id = `up${++n}`
        declared.set(id, body ?? {})
        return send(201, {
          uploadId: id,
          partBytes: 16 * 1024 * 1024,
          partCount: 1,
        })
      }
      const part = /^\/api\/assets\/uploads\/([^/]+)\/parts\/1$/.exec(url)
      if (part && method === 'PUT') {
        parts.set(part[1], raw)
        return send(200, { partNumber: 1, etag: 'e1' })
      }
      const done = /^\/api\/assets\/uploads\/([^/]+)\/complete$/.exec(url)
      if (done && method === 'POST') {
        const id = `a-${done[1]}`
        files.set(id, parts.get(done[1]) ?? Buffer.alloc(0))
        return send(201, {
          asset: {
            id,
            fileUrl: `/api/assets/${id}/file`,
            filename: declared.get(done[1])?.filename,
            kind: 'image',
            size: files.get(id)!.length,
          },
          notes: [],
        })
      }
      const file = /^\/api\/assets\/([^/]+)\/file$/.exec(url)
      if (file && files.has(file[1])) {
        res.writeHead(200, { 'content-type': 'application/octet-stream' })
        return res.end(files.get(file[1]))
      }
      if (url === '/api/claim' && method === 'POST')
        return send(201, {
          claimUrl: 'https://vos.so/claim/t',
          expiresAt: '2026-10-26T00:00:00Z',
          vos: { id: 'v-claim' },
        })
      if (url === '/api/vos' && method === 'POST') {
        doc = (body?.doc as ProjectDoc | undefined) ?? null
        return send(201, { vos: { id: 'v-1' } })
      }
      if (url === '/api/vos/v-1')
        return send(200, {
          vos: {
            id: 'v-1',
            slug: 'board',
            title: 'Board',
            currentVersionId: 'ver-1',
          },
        })
      if (url === '/api/vos/v-1/config')
        return send(200, { config: { version: 2, duration: 2 } })
      if (url === '/api/vos/v-1/versions/ver-1/doc' && doc)
        return send(200, doc)
      send(404, { error: 'not found' })
    })
  })
  return new Promise<{ origin: string; setDoc: (d: ProjectDoc) => void }>(
    (resolve) => {
      server?.listen(0, '127.0.0.1', () => {
        const addr = server?.address()
        resolve({
          origin:
            typeof addr === 'object' && addr
              ? `http://127.0.0.1:${addr.port}`
              : '',
          setDoc: (d) => {
            doc = d
          },
        })
      })
    },
  )
}

/** A recorded take whose script pastes a picture and some HTML, and draws a path inline. */
function take(extra: Record<string, unknown>[] = []): string {
  const dir = mkdtempSync(join(tmpdir(), 'vos-paste-take-'))
  writeFileSync(join(dir, 'recording.webm'), Buffer.from('footage bytes'))
  writeFileSync(join(dir, 'meta.json'), JSON.stringify(META))
  writeFileSync(join(dir, 'cursor.json'), '[]')
  const { doc } = projectFromArtifact(
    { videoKey: 'recording.webm', cursor: [], meta: META },
    'recording.webm',
  )
  writeFileSync(join(dir, 'doc.json'), JSON.stringify(doc))
  writeFileSync(join(dir, 'paste-logo.png'), LOGO)
  writeFileSync(join(dir, 'paste-notes.html'), NOTES)
  writeFileSync(
    join(dir, 'actions.json'),
    JSON.stringify({
      url: 'https://app.example.test/board',
      steps: [
        {
          do: 'drag',
          path: [
            [10, 10, 0],
            [40, 30, 60],
          ],
        },
        { do: 'paste', file: 'paste-logo.png' },
        { do: 'paste', file: 'paste-notes.html' },
        // The same file twice is one file.
        { do: 'paste', file: 'paste-logo.png' },
        ...extra,
      ],
    }),
  )
  return dir
}

/** `vos <argv>` through the dispatcher, as the binary runs it. */
async function vos(argv: string[]) {
  const out: string[] = []
  const err: string[] = []
  const stdout = vi
    .spyOn(process.stdout, 'write')
    .mockImplementation((s: string | Uint8Array) => {
      out.push(String(s))
      return true
    })
  const stderr = vi
    .spyOn(process.stderr, 'write')
    .mockImplementation((s: string | Uint8Array) => {
      err.push(String(s))
      return true
    })
  try {
    return { code: await run(argv), out: out.join(''), err: err.join('') }
  } finally {
    stdout.mockRestore()
    stderr.mockRestore()
  }
}

const created = (seen: Seen[]) =>
  seen.find((s) => s.url === '/api/vos' && s.method === 'POST')?.body as
    | { doc: ProjectDoc }
    | undefined

describe('vos push sends what the script pastes', () => {
  it('uploads a pasted picture, carries a pasted text file, and lists both on the document', async () => {
    const seen: Seen[] = []
    const { origin } = await serve(seen)
    const dir = take()
    const r = await vos([
      'push',
      dir,
      '--yes',
      '--origin',
      origin,
      '--key',
      'vos_sk_test',
      '--json',
    ])
    expect(r.err).toBe('')
    expect(r.code).toBe(0)
    // The picture went through the upload door under the script's name,
    // once, with its own bytes.
    const begins = seen.filter(
      (s) => s.url === '/api/assets/uploads' && s.method === 'POST',
    )
    const logo = begins.find((b) => b.body?.filename === 'paste-logo.png')
    expect(logo?.body).toMatchObject({
      size: LOGO.length,
      sha256: createHash('sha256').update(LOGO).digest('hex'),
    })
    expect(
      begins.filter((b) => b.body?.filename === 'paste-logo.png'),
    ).toHaveLength(1)
    expect(begins.some((b) => b.body?.filename === 'paste-notes.html')).toBe(
      false,
    )
    const sent = created(seen)!.doc
    expect(sent.source.scriptFiles).toEqual({
      'paste-logo.png': expect.stringMatching(
        /^\/api\/assets\/a-up\d+\/file$/,
      ) as unknown as string,
      'paste-notes.html': `data:text/html;base64,${Buffer.from(NOTES).toString('base64')}`,
    })
    // The script rides the document with its path inline.
    const script = sent.source.script as {
      steps: { do: string; path?: unknown; file?: string }[]
    }
    expect(script.steps[0].path).toEqual([
      [10, 10, 0],
      [40, 30, 60],
    ])
    expect(script.steps[1].file).toBe('paste-logo.png')
  })

  it('says a paste file the take does not hold, and pushes without it', async () => {
    const seen: Seen[] = []
    const { origin } = await serve(seen)
    const dir = take([{ do: 'paste', file: 'paste-gone.png' }])
    const r = await vos([
      'push',
      dir,
      '--yes',
      '--origin',
      origin,
      '--key',
      'vos_sk_test',
    ])
    expect(r.code).toBe(0)
    expect(r.out + r.err).toContain(
      'actions.json pastes paste-gone.png, which is not in the take, so it does not travel with the push',
    )
    expect(created(seen)!.doc.source.scriptFiles).not.toHaveProperty(
      'paste-gone.png',
    )
  })

  it('refuses a paste file that resolves outside the take, before anything is sent', async () => {
    const seen: Seen[] = []
    const { origin } = await serve(seen)
    const elsewhere = mkdtempSync(join(tmpdir(), 'vos-paste-elsewhere-'))
    writeFileSync(join(elsewhere, 'secret.png'), LOGO)
    const dir = take([{ do: 'paste', file: 'paste-out.png' }])
    symlinkSync(join(elsewhere, 'secret.png'), join(dir, 'paste-out.png'))
    const r = await vos([
      'push',
      dir,
      '--yes',
      '--origin',
      origin,
      '--key',
      'vos_sk_test',
    ])
    expect(r.code).toBe(2)
    expect(r.err).toContain(
      'actions.json pastes paste-out.png, which resolves outside the take directory',
    )
    expect(seen).toEqual([])
  })
})

describe('vos fetch --media brings the pasted files home', () => {
  it('writes each beside actions.json under the script’s name, so the script finds every file it names', async () => {
    const seen: Seen[] = []
    const { origin, setDoc } = await serve(seen)
    const pushed = await vos([
      'push',
      take(),
      '--yes',
      '--origin',
      origin,
      '--key',
      'vos_sk_test',
    ])
    expect(pushed.code).toBe(0)
    // A document may list more than its script pastes: only what the
    // script pastes is written, and never under a name that is not plain.
    const doc = structuredClone(created(seen)!.doc)
    doc.source.scriptFiles = {
      ...doc.source.scriptFiles,
      'other.png': doc.source.scriptFiles!['paste-logo.png'],
      '../escape.png': doc.source.scriptFiles!['paste-logo.png'],
    }
    setDoc(doc)

    const out = join(mkdtempSync(join(tmpdir(), 'vos-paste-fetch-')), 'board')
    const r = await vos([
      'fetch',
      'v-1',
      '--media',
      '--out',
      out,
      '--origin',
      origin,
      '--key',
      'vos_sk_test',
    ])
    expect(r.code).toBe(0)
    expect(r.err).toContain('paste-logo.png ← the pasted file')
    expect(r.err).toContain('skipped "../escape.png"')
    expect(existsSync(join(out, 'actions.json'))).toBe(true)
    expect(new Uint8Array(readFileSync(join(out, 'paste-logo.png')))).toEqual(
      LOGO,
    )
    expect(readFileSync(join(out, 'paste-notes.html'), 'utf8')).toBe(NOTES)
    expect(existsSync(join(out, 'other.png'))).toBe(false)
    expect(existsSync(join(out, '..', 'escape.png'))).toBe(false)
    // The fetch remembers where the picture came from, like the footage.
    expect(readSyncState(out)?.hostedMedia?.['paste-logo.png']).toEqual({
      ref: doc.source.scriptFiles!['paste-logo.png'],
      sha256: createHash('sha256').update(LOGO).digest('hex'),
    })
    // The fetched script reads every file it names from where it sits:
    // what a re-record from this directory reads before it captures.
    const script = JSON.parse(
      readFileSync(join(out, 'actions.json'), 'utf8'),
    ) as { steps: never[] }
    const loaded = await loadScriptFiles(script, actionsDirFiles(out))
    expect('problem' in loaded ? loaded.problem : null).toBeNull()

    // A second fetch keeps what is on disk: the person's files.
    writeFileSync(join(out, 'paste-notes.html'), 'edited')
    const pulled = await vos([
      'pull',
      out,
      '--media',
      '--origin',
      origin,
      '--key',
      'vos_sk_test',
    ])
    expect(pulled.code).toBe(0)
    expect(readFileSync(join(out, 'paste-notes.html'), 'utf8')).toBe('edited')
  })
})

describe('vos push --claimable carries what it may name', () => {
  it('names a pasted picture the take fetched by its address, carries text, and says what it leaves out', async () => {
    const seen: Seen[] = []
    const { origin } = await serve(seen)
    const dir = take([{ do: 'paste', file: 'paste-new.png' }])
    writeFileSync(join(dir, 'paste-new.png'), LOGO.slice(1))
    const ref = (id: string) => `/api/assets/${id}/file`
    const sha = (b: Uint8Array | string) =>
      createHash('sha256').update(b).digest('hex')
    writeFileSync(
      join(dir, 'vos.json'),
      JSON.stringify({
        vosId: 'src-take',
        versionId: 'ver-1',
        hostedMedia: {
          'recording.webm': { ref: ref('rec'), sha256: sha('footage bytes') },
          'paste-logo.png': { ref: ref('logo'), sha256: sha(LOGO) },
        },
      }),
    )
    const r = await vos(['push', dir, '--claimable', '--origin', origin])
    expect(r.code).toBe(0)
    expect(r.err).toContain(
      'the pasted file paste-new.png is not one this take fetched',
    )
    const claim = seen.find((s) => s.url === '/api/claim')
    const sent = (claim!.body as { doc: ProjectDoc }).doc
    expect(sent.source.scriptFiles).toEqual({
      'paste-logo.png': ref('logo'),
      'paste-notes.html': `data:text/html;base64,${Buffer.from(NOTES).toString('base64')}`,
    })
    expect(seen.some((s) => s.url.startsWith('/api/assets/uploads'))).toBe(
      false,
    )
  })
})
