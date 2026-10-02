/**
 * A program's declared files (`config.assets`) crossing to and from vos.so,
 * against a real in-process HTTP server. The contract under test: a push
 * uploads the local files and names them `asset:<id>` in what it sends,
 * while the file on disk keeps its paths; `vos fetch --media` brings them
 * home and names them by path again.
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  hostedLiteralWarnings,
  localManifestRefs,
  pullManifest,
  uploadManifest,
} from '../assetManifest'
import { cmdPushProgram } from '../program'
import type { Server } from 'node:http'
import { uploadDoor } from './uploadDoor'

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const HOSTED = '7d1e2f3a-0b9c-4d5e-8f6a-1b2c3d4e5f60'
// The smallest thing the type sniffer reads as a PNG.
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0])

let server: Server | undefined
afterEach(() => {
  server?.close()
  server = undefined
})

interface Seen {
  method: string
  url: string
  body: Record<string, unknown> | null
  hash?: string
}

function serve(seen: Seen[]): Promise<string> {
  const ids = [A, B]
  const door = uploadDoor((declared) => ({
    id: ids.shift() ?? A,
    kind: 'image',
    filename: declared.filename,
    size: declared.size,
  }))
  server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      const raw = Buffer.concat(chunks)
      let body: Record<string, unknown> | null = null
      try {
        body = raw.length
          ? (JSON.parse(raw.toString('utf8')) as Record<string, unknown>)
          : null
      } catch {
        // a raw media body is not JSON
      }
      const url = req.url ?? ''
      seen.push({
        method: req.method ?? '',
        url,
        body,
        hash: body?.sha256 as string | undefined,
      })
      const send = (status: number, payload: Record<string, unknown>) => {
        res.writeHead(status, { 'content-type': 'application/json' })
        res.end(JSON.stringify(payload))
      }
      const upload = door(req.method ?? '', url, body)
      if (upload) return send(upload.status, upload.payload)
      if (url.startsWith('/api/assets/') && url.endsWith('/file')) {
        res.writeHead(200, { 'content-type': 'image/png' })
        return res.end(PNG)
      }
      if (url === '/api/vos' && req.method === 'POST')
        return send(201, {
          vos: { id: 'v-1', slug: 'reel', currentVersionId: 'ver-1' },
        })
      if (url === '/api/claim')
        return send(201, {
          claimUrl: 'https://vos.so/claim/t',
          expiresAt: '2026-10-02T00:00:00Z',
          vos: { id: 'v-2' },
        })
      send(404, { error: 'not found' })
    })
  })
  return new Promise((resolve) => {
    server?.listen(0, '127.0.0.1', () => {
      const addr = server?.address()
      resolve(
        typeof addr === 'object' && addr ? `http://127.0.0.1:${addr.port}` : '',
      )
    })
  })
}

const CONFIG = {
  version: 2,
  duration: 4,
  camera: { preset: 'fullscreen' },
  assets: {
    logo: { ref: './logo.png', kind: 'image' },
    shots: { ref: ['shots/1.png', `/api/assets/${HOSTED}/file`] },
    hdr: { ref: 'https://assets.vos.so/hdr/studio.hdr', kind: 'hdr' },
  },
  elements: [{ id: 'mark', type: 'image', src: '$assets.logo' }],
  createContent:
    '(ctx) => { const m = new ctx.THREE.Mesh(new ctx.THREE.PlaneGeometry(2,2)); ctx.scene.add(m); return { objects: [m], refs: {}, n: ctx.assets.shots.length, dispose: () => {} } }',
  createTimeline:
    '(ctx, content, duration) => { const tl = ctx.gsap.timeline({ paused: true }); return tl }',
}

function programDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'vos-manifest-'))
  writeFileSync(join(dir, 'config.json'), JSON.stringify(CONFIG))
  writeFileSync(join(dir, 'logo.png'), PNG)
  mkdirSync(join(dir, 'shots'))
  writeFileSync(
    join(dir, 'shots/1.png'),
    Buffer.concat([PNG, Buffer.from('x')]),
  )
  return dir
}

describe('uploadManifest', () => {
  it('uploads each local file and names every hosted one asset:<id>', async () => {
    const seen: Seen[] = []
    const origin = await serve(seen)
    const dir = programDir()
    const config = JSON.parse(JSON.stringify(CONFIG)) as Record<string, unknown>
    const before = config.assets
    const log: string[] = []
    const got = await uploadManifest(
      config,
      dir,
      { origin, key: 'vos_k' },
      (l) => log.push(l),
    )
    expect(got.uploaded).toBe(2)
    const uploads = seen.filter((s) => s.url === '/api/assets/uploads')
    expect(uploads).toHaveLength(2)
    // Content-addressed: each upload says its own hash, so a re-push is free.
    expect(new Set(uploads.map((u) => u.hash)).size).toBe(2)
    expect(config.assets).toEqual({
      logo: { ref: `asset:${A}`, kind: 'image' },
      // A hosted file spelled as a URL takes the one spelling too.
      shots: { ref: [`asset:${B}`, `asset:${HOSTED}`] },
      // A URL elsewhere is the author's, and stays.
      hdr: { ref: 'https://assets.vos.so/hdr/studio.hdr', kind: 'hdr' },
    })
    // The caller's own manifest object was replaced, never edited in place.
    expect(before).toEqual(CONFIG.assets)
    expect(log.join('\n')).toContain(`assets.logo: logo.png → asset ${A}`)
  })

  it('does nothing, and sends nothing, for a program with no manifest', async () => {
    const seen: Seen[] = []
    const origin = await serve(seen)
    const config: Record<string, unknown> = { version: 2 }
    expect(
      await uploadManifest(config, '.', { origin, key: 'k' }, () => {}),
    ).toEqual({ uploaded: 0 })
    expect(seen).toEqual([])
    expect('assets' in config).toBe(false)
  })

  it('refuses a path that names no file, before anything is sent', async () => {
    const seen: Seen[] = []
    const origin = await serve(seen)
    const config: Record<string, unknown> = {
      assets: { gone: { ref: './gone.png' } },
    }
    await expect(
      uploadManifest(
        config,
        mkdtempSync(join(tmpdir(), 'vos-manifest-')),
        { origin, key: 'k' },
        () => {},
      ),
    ).rejects.toThrow(/assets\.gone names \.\/gone\.png, which is not a file/)
    expect(seen).toEqual([])
    expect(config.assets).toEqual({ gone: { ref: './gone.png' } })
  })

  it('uploads a font or an HDR like any other file the manifest names', async () => {
    const seen: Seen[] = []
    const origin = await serve(seen)
    const dir = mkdtempSync(join(tmpdir(), 'vos-manifest-'))
    writeFileSync(join(dir, 'studio.hdr'), '#?RADIANCE\n')
    const config: Record<string, unknown> = {
      assets: { env: { ref: './studio.hdr', kind: 'hdr' } },
    }
    const got = await uploadManifest(
      config,
      dir,
      { origin, key: 'k' },
      () => {},
    )
    expect(got.uploaded).toBe(1)
    expect(config.assets).toEqual({ env: { ref: `asset:${A}`, kind: 'hdr' } })
    // What it is, is the platform's answer: nothing here guesses a type.
    const begin = seen.find((s) => s.url === '/api/assets/uploads')
    expect(begin?.body?.filename).toBe('studio.hdr')
  })

  it('leaves the same path on another host a URL', async () => {
    const origin = await serve([])
    const other = `https://other.example/api/assets/${HOSTED}/file`
    const config: Record<string, unknown> = {
      assets: {
        theirs: { ref: other },
        ours: { ref: `https://vos.so/api/assets/${HOSTED}/file` },
      },
    }
    await uploadManifest(config, '.', { origin, key: 'k' }, () => {})
    expect(config.assets).toEqual({
      theirs: { ref: other },
      ours: { ref: `asset:${HOSTED}` },
    })
  })

  it('never uploads a file outside the program’s directory', async () => {
    // A config from somewhere else must not be able to name a file two
    // directories up and have a push carry it into a library.
    const seen: Seen[] = []
    const origin = await serve(seen)
    const root = mkdtempSync(join(tmpdir(), 'vos-manifest-'))
    writeFileSync(join(root, 'secret.png'), PNG)
    const dir = join(root, 'program')
    mkdirSync(dir)
    for (const ref of ['../secret.png', join(root, 'secret.png')]) {
      await expect(
        uploadManifest(
          { assets: { leak: { ref } } },
          dir,
          { origin, key: 'k' },
          () => {},
        ),
      ).rejects.toThrow(/outside the program's directory/)
    }
    expect(seen).toEqual([])
  })
})

describe('vos push of a program that declares files', () => {
  it('sends the hosted refs and leaves config.json on disk alone', async () => {
    const seen: Seen[] = []
    const origin = await serve(seen)
    const dir = programDir()
    const onDisk = readFileSync(join(dir, 'config.json'), 'utf8')
    const code = await cmdPushProgram([
      join(dir, 'config.json'),
      '--origin',
      origin,
      '--key',
      'vos_sk_test',
      '--json',
    ])
    expect(code).toBe(0)
    const create = seen.find((s) => s.url === '/api/vos')
    const sent = create?.body?.config as { assets: Record<string, unknown> }
    expect(sent.assets.logo).toEqual({ ref: `asset:${A}`, kind: 'image' })
    expect(sent.assets.shots).toEqual({
      ref: [`asset:${B}`, `asset:${HOSTED}`],
    })
    expect(readFileSync(join(dir, 'config.json'), 'utf8')).toBe(onDisk)
  })

  it('a program document carries the same hosted refs as the stored config', async () => {
    const seen: Seen[] = []
    const origin = await serve(seen)
    const dir = programDir()
    writeFileSync(
      join(dir, 'doc.json'),
      JSON.stringify({ program: {}, audio: [] }),
    )
    await cmdPushProgram([
      join(dir, 'config.json'),
      '--origin',
      origin,
      '--key',
      'vos_sk_test',
      '--json',
    ])
    const body = seen.find((s) => s.url === '/api/vos')?.body
    const stored = body?.config as { assets: Record<string, { ref: unknown }> }
    const own = (body?.doc as { program: { config: typeof stored } }).program
      .config
    expect(stored.assets.logo.ref).toBe(`asset:${A}`)
    expect(own.assets.logo.ref).toBe(`asset:${A}`)
  })

  it('a claimable push is refused, in words, when the program declares local files', async () => {
    const seen: Seen[] = []
    const origin = await serve(seen)
    const dir = programDir()
    await expect(
      cmdPushProgram([
        join(dir, 'config.json'),
        '--origin',
        origin,
        '--claimable',
      ]),
    ).rejects.toThrow(
      /declares 2 local files \(assets\.logo, assets\.shots\[0\]\)\. Push with a key/,
    )
    // Nothing was created and nothing was uploaded.
    expect(seen).toEqual([])
  })

  it('a claimable push of hosted and URL files goes through', async () => {
    const seen: Seen[] = []
    const origin = await serve(seen)
    const dir = mkdtempSync(join(tmpdir(), 'vos-manifest-'))
    writeFileSync(
      join(dir, 'config.json'),
      JSON.stringify({
        ...CONFIG,
        assets: { hdr: CONFIG.assets.hdr },
        elements: [],
        createContent: CONFIG.createContent.replace(
          'ctx.assets.shots.length',
          'ctx.assets.hdr.length',
        ),
      }),
    )
    const code = await cmdPushProgram([
      join(dir, 'config.json'),
      '--origin',
      origin,
      '--claimable',
    ])
    expect(code).toBe(0)
    expect(seen.map((s) => s.url)).toEqual(['/api/claim'])
  })
})

describe('pullManifest', () => {
  it('brings each hosted file home under its name and re-points the entry', async () => {
    const seen: Seen[] = []
    const origin = await serve(seen)
    const dir = mkdtempSync(join(tmpdir(), 'vos-pull-'))
    const config = {
      assets: {
        logo: { ref: `asset:${A}`, kind: 'image' },
        shots: { ref: [`asset:${B}`, './local.png'] },
        hdr: { ref: 'https://assets.vos.so/hdr/studio.hdr' },
      },
    }
    const got = await pullManifest({ origin, key: 'k' }, dir, config, () => {})
    expect(got!.files).toEqual(['assets/logo.png', 'assets/shots-0.png'])
    expect(got!.assets).toEqual({
      logo: { ref: './assets/logo.png', kind: 'image' },
      shots: { ref: ['./assets/shots-0.png', './local.png'] },
      hdr: { ref: 'https://assets.vos.so/hdr/studio.hdr' },
    })
    expect(existsSync(join(dir, 'assets/logo.png'))).toBe(true)

    // A second pull keeps what is there and fetches nothing.
    const fetched = seen.length
    const again = await pullManifest(
      { origin, key: 'k' },
      dir,
      config,
      () => {},
    )
    expect(again!.files).toEqual(['assets/logo.png', 'assets/shots-0.png'])
    expect(seen.length).toBe(fetched)
  })

  it('fetches again when the name now means a different hosted file', async () => {
    // Kept by name alone, the old picture stayed under the new manifest
    // and the next push stored the old one again without a word.
    const seen: Seen[] = []
    const origin = await serve(seen)
    const dir = mkdtempSync(join(tmpdir(), 'vos-pull-'))
    await pullManifest(
      { origin, key: 'k' },
      dir,
      { assets: { logo: { ref: `asset:${A}` } } },
      () => {},
    )
    const before = seen.length
    const got = await pullManifest(
      { origin, key: 'k' },
      dir,
      { assets: { logo: { ref: `asset:${B}` } } },
      () => {},
    )
    expect(seen.length).toBe(before + 1)
    expect(seen.at(-1)?.url).toBe(`/api/assets/${B}/file`)
    expect(got!.files).toEqual(['assets/logo.png'])
    const index = JSON.parse(
      readFileSync(join(dir, 'assets/.hosted.json'), 'utf8'),
    ) as Record<string, string>
    expect(index).toEqual({ 'logo.png': B })
  })

  it('a file put there by hand under a manifest name is not taken for the hosted one', async () => {
    const seen: Seen[] = []
    const origin = await serve(seen)
    const dir = mkdtempSync(join(tmpdir(), 'vos-pull-'))
    mkdirSync(join(dir, 'assets'))
    writeFileSync(join(dir, 'assets/logo.png'), 'mine')
    await pullManifest(
      { origin, key: 'k' },
      dir,
      { assets: { logo: { ref: `asset:${A}` } } },
      () => {},
    )
    expect(seen.map((s) => s.url)).toEqual([`/api/assets/${A}/file`])
    expect(readFileSync(join(dir, 'assets/logo.png')).equals(PNG)).toBe(true)
  })

  it('a name that would climb out of assets/ brings nothing home', async () => {
    const seen: Seen[] = []
    const origin = await serve(seen)
    const root = mkdtempSync(join(tmpdir(), 'vos-pull-'))
    const dir = join(root, 'out')
    mkdirSync(dir)
    const got = await pullManifest(
      { origin, key: 'k' },
      dir,
      { assets: { '../../planted': { ref: `asset:${A}` } } },
      () => {},
    )
    expect(got).toBeNull()
    expect(seen).toEqual([])
    expect(existsSync(join(root, 'planted.png'))).toBe(false)
  })

  it('is null when nothing in the manifest is hosted', async () => {
    expect(
      await pullManifest(
        { origin: 'http://x', key: null },
        '.',
        { assets: { a: { ref: './a.png' } } },
        () => {},
      ),
    ).toBeNull()
  })
})

describe('what a check says about a manifest', () => {
  it('lists the entries that are still files here', () => {
    expect(localManifestRefs(CONFIG)).toEqual([
      'assets.logo',
      'assets.shots[0]',
    ])
  })

  it('warns once per function about a hosted file named in code', () => {
    const warnings = hostedLiteralWarnings({
      setup: `async (ctx) => { await load('/api/assets/${HOSTED}/file'); await load('https://vos.so/api/assets/${HOSTED}/file') }`,
      createContent: `(ctx) => ctx.assets.logo`,
      stack: [{ id: 'layers', onFrame: `(ctx) => 'asset:${A}'` }],
    })
    expect(warnings).toHaveLength(2)
    expect(warnings[0]).toContain(`setup names hosted file ${HOSTED} in code`)
    expect(warnings[0]).toContain(`"ref": "asset:${HOSTED}"`)
    expect(warnings[1]).toContain('stack.layers.onFrame')
  })

  it('is quiet about a file the manifest names', () => {
    expect(hostedLiteralWarnings(CONFIG)).toEqual([])
  })
})
