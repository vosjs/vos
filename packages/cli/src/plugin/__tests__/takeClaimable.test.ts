/**
 * `vos push <take> --claimable`: a remix of a public take pushed with no
 * account. The claim never takes footage, so the push names the files the
 * fetch brought home by the addresses they came from, and refuses a file
 * that is new or changed, before anything is sent.
 */
import { createHash } from 'node:crypto'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { projectFromArtifact } from '@vosjs/studio-core'
import { pushTakeClaimable } from '../sync'
import { run } from '../run'
import { recordHostedMedia } from '../media'
import { readSyncState } from '../platform'
import { createReporter } from '../output'
import type { Server } from 'node:http'

let server: Server | undefined
afterEach(() => {
  server?.close()
  server = undefined
})

const REF = '/api/assets/0f8fad5b-d9cb-469f-a165-70867728950e/file'
const META = {
  dpr: 1,
  zoom: 1,
  t0: 0,
  durationMs: 2000,
  width: 1280,
  height: 720,
  fps: 30,
}

function serve(seen: { url: string; body: Record<string, unknown> }[]) {
  server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      // The push asks which studio-core the platform renders with first;
      // this platform cannot say, which never blocks a push.
      if (req.url === '/api/engine') {
        res.writeHead(404, { 'content-type': 'application/json' })
        return res.end('{}')
      }
      seen.push({
        url: req.url ?? '',
        body: JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'),
      })
      res.writeHead(201, { 'content-type': 'application/json' })
      res.end(
        JSON.stringify({
          claimUrl: 'https://vos.so/claim/t',
          expiresAt: '2026-10-11T00:00:00Z',
          vos: { id: 'v-new' },
        }),
      )
    })
  })
  return new Promise<string>((resolve) => {
    server?.listen(0, '127.0.0.1', () => {
      const addr = server?.address()
      resolve(
        typeof addr === 'object' && addr ? `http://127.0.0.1:${addr.port}` : '',
      )
    })
  })
}

/** A take as `vos fetch <url> --media` leaves it: footage home, origin kept. */
function fetchedTake(opts: { record?: boolean } = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'vos-claim-take-'))
  const footage = Buffer.from('fetched footage bytes')
  writeFileSync(join(dir, 'recording.webm'), footage)
  writeFileSync(join(dir, 'meta.json'), JSON.stringify(META))
  writeFileSync(join(dir, 'cursor.json'), '[]')
  const { doc } = projectFromArtifact(
    { videoKey: 'recording.webm', cursor: [], meta: META },
    'recording.webm',
  )
  writeFileSync(join(dir, 'doc.json'), JSON.stringify(doc))
  writeFileSync(
    join(dir, 'vos.json'),
    JSON.stringify({
      vosId: 'src-take',
      versionId: 'ver-1',
      title: 'Grafana tour',
      ...(opts.record === false
        ? {}
        : {
            hostedMedia: {
              'recording.webm': {
                ref: REF,
                sha256: createHash('sha256').update(footage).digest('hex'),
              },
            },
          }),
    }),
  )
  return dir
}

describe('vos push <take> --claimable', () => {
  it('names the fetched footage by its address, credits the source, uploads nothing', async () => {
    const seen: { url: string; body: Record<string, unknown> }[] = []
    const origin = await serve(seen)
    const claim = await pushTakeClaimable(
      fetchedTake(),
      { origin, share: true },
      createReporter(true),
    )
    expect(seen.map((s) => s.url)).toEqual(['/api/claim'])
    const body = seen[0].body
    expect((body.doc as { source: { videoKey: string } }).source.videoKey).toBe(
      REF,
    )
    expect(body.remixOfId).toBe('src-take')
    expect(body.share).toBe(true)
    expect(body.title).toBe('Grafana tour remix')
    expect(JSON.stringify(body.config)).toContain(REF)
    expect(claim.claimUrl).toBe('https://vos.so/claim/t')
    // No --desc, no description field.
    expect('description' in body).toBe(false)
  })

  it('carries --desc as the description the watch page shows', async () => {
    const seen: { url: string; body: Record<string, unknown> }[] = []
    const origin = await serve(seen)
    await pushTakeClaimable(
      fetchedTake(),
      { origin, description: 'Create a key, copy it once, revoke it.' },
      createReporter(true),
    )
    expect(seen[0].body.description).toBe(
      'Create a key, copy it once, revoke it.',
    )
  })

  it('refuses footage that changed since the fetch, before sending anything', async () => {
    const seen: { url: string; body: Record<string, unknown> }[] = []
    const origin = await serve(seen)
    const dir = fetchedTake()
    writeFileSync(join(dir, 'recording.webm'), 'a new recording')
    await expect(
      pushTakeClaimable(dir, { origin }, createReporter(true)),
    ).rejects.toThrow(/changed since it was fetched/)
    expect(seen).toEqual([])
  })

  it('refuses footage the take never fetched', async () => {
    const seen: { url: string; body: Record<string, unknown> }[] = []
    const origin = await serve(seen)
    await expect(
      pushTakeClaimable(
        fetchedTake({ record: false }),
        { origin },
        createReporter(true),
      ),
    ).rejects.toThrow(/never uploads footage/)
    expect(seen).toEqual([])
  })
})

/** `vos <argv>` through the dispatcher, as the binary runs it: its exit and what it wrote. */
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

describe('vos push <take> --claimable, through the command line', () => {
  it('pushes a fetched public take as a claimable remix, naming the originals', async () => {
    const seen: { url: string; body: Record<string, unknown> }[] = []
    const origin = await serve(seen)
    const dir = fetchedTake()
    const r = await vos([
      'push',
      dir,
      '--claimable',
      '--share',
      '--title',
      'Grafana tour, shorter',
      '--origin',
      origin,
      '--json',
    ])
    expect(r.err).toBe('')
    expect(r.code).toBe(0)
    expect(seen.map((s) => s.url)).toEqual(['/api/claim'])
    const body = seen[0].body
    expect((body.doc as { source: { videoKey: string } }).source.videoKey).toBe(
      REF,
    )
    expect(body.remixOfId).toBe('src-take')
    expect(body.share).toBe(true)
    expect(body.title).toBe('Grafana tour, shorter')
    expect(r.out).toContain('https://vos.so/claim/t')
  })

  it('refuses footage that changed since the fetch as a refusal, exit 2', async () => {
    const seen: { url: string; body: Record<string, unknown> }[] = []
    const origin = await serve(seen)
    const dir = fetchedTake()
    writeFileSync(join(dir, 'recording.webm'), 'a new recording')
    const r = await vos(['push', dir, '--claimable', '--origin', origin])
    expect(r.code).toBe(2)
    expect(r.err).toMatch(
      /^the recording \(recording\.webm\) changed since it was fetched/,
    )
    expect(seen).toEqual([])
  })

  it('refuses a take that was never fetched, saying why and what to do', async () => {
    const seen: { url: string; body: Record<string, unknown> }[] = []
    const origin = await serve(seen)
    const dir = fetchedTake({ record: false })
    const r = await vos(['push', dir, '--claimable', '--origin', origin])
    expect(r.code).toBe(2)
    expect(r.err).toBe(
      `${dir} was not fetched from a public take with its media (its vos.json records no hosted files), and a claimable push never uploads footage. Push it with an account (vos login, then vos push ${dir}), or remix a public take: vos fetch <url> --media, edit, then vos push <dir> --claimable\n`,
    )
    expect(seen).toEqual([])
  })
})

describe('vos fetch --media remembers where its files came from', () => {
  it('writes each file, its origin and its sha256 into vos.json', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vos-fetch-media-'))
    writeFileSync(join(dir, 'recording.webm'), 'footage')
    writeFileSync(
      join(dir, 'vos.json'),
      JSON.stringify({ vosId: 'src', versionId: 'v1' }),
    )
    await recordHostedMedia(dir, 'src', {
      downloaded: [],
      kept: [],
      hosted: [{ file: 'recording.webm', url: REF }],
    })
    const state = readSyncState(dir)
    expect(state?.versionId).toBe('v1')
    expect(state?.hostedMedia?.['recording.webm']).toEqual({
      ref: REF,
      sha256: createHash('sha256').update('footage').digest('hex'),
    })
  })
})
