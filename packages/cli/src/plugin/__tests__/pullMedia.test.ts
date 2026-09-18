/**
 * `vos pull --media` names a take's footage after what it IS.
 *
 * A hosted recording keeps whatever filename it was uploaded under, and the
 * in-page recorder's takes are mp4 under the name `recording.webm`. Bringing
 * one home as `recording.webm` hands the next push a file to re-upload as
 * `video/webm`, and every render of that version dies in the video element.
 * Pinned against a local server, so the assertion is about what lands on disk.
 */
import { createServer } from 'node:http'
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { pullTake } from '../sync'
import type { Server } from 'node:http'
import type { Reporter } from '../output'

let server: Server | null = null
afterEach(() => {
  server?.close()
  server = null
})

const HEAD = 'ver_head0000'
const BASE = 'ver_base0000'
const ASSET = 'asset_footage'

/** An ISO base media file (`ftyp isom`) — mp4 bytes, whatever it is called. */
const MP4_BYTES = Buffer.from([
  0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 0x02, 0,
])

/** `declared` is what the asset route claims its bytes are. */
function serve(declared: string): Promise<string> {
  return new Promise((resolveUrl) => {
    server = createServer((req, res) => {
      const send = (status: number, out: unknown) => {
        res.writeHead(status, { 'content-type': 'application/json' })
        res.end(JSON.stringify(out))
      }
      const url = new URL(req.url ?? '/', 'http://x')
      if (url.pathname === '/api/vos/vos_1') {
        return send(200, { vos: { id: 'vos_1', currentVersionId: HEAD } })
      }
      if (url.pathname === '/api/vos/vos_1/changes') {
        return send(200, {
          head: { id: HEAD },
          changes: [{ versionNumber: 2, origin: 'studio', summary: 'trim' }],
          protected: [],
        })
      }
      if (url.pathname === `/api/vos/vos_1/versions/${HEAD}/doc`) {
        return send(200, {
          docSchemaVersion: 2,
          source: {
            videoKey: `/api/assets/${ASSET}/file`,
            cursor: [],
            meta: { durationMs: 1000, width: 1280, height: 720 },
          },
          frame: {},
          segments: [{ in: 0, out: 1 }],
          zoom: [],
        })
      }
      if (url.pathname === '/api/vos/vos_1/versions') {
        return send(200, { versions: [{ id: HEAD, versionNumber: 2 }] })
      }
      if (url.pathname === `/api/assets/${ASSET}/file`) {
        res.writeHead(200, { 'content-type': declared })
        return res.end(MP4_BYTES)
      }
      send(404, { error: `unexpected ${url.pathname}` })
    })
    server.listen(0, '127.0.0.1', () => {
      const addr = server?.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      resolveUrl(`http://127.0.0.1:${port}`)
    })
  })
}

function quiet(): Reporter {
  return {
    log: () => {},
    event: () => {},
    done: () => {},
  } as unknown as Reporter
}

async function linkedTake(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'vos-pull-media-'))
  await writeFile(
    join(dir, 'vos.json'),
    JSON.stringify({ vosId: 'vos_1', versionId: BASE, pushedAt: 'x' }),
  )
  return dir
}

async function docOf(dir: string): Promise<{ source: { videoKey: string } }> {
  return JSON.parse(await readFile(join(dir, 'doc.json'), 'utf8')) as {
    source: { videoKey: string }
  }
}

describe('pull --media names the footage by its container', () => {
  it('brings an mp4 recording home as recording.mp4 and re-anchors the doc', async () => {
    const origin = await serve('video/mp4')
    const dir = await linkedTake()
    const result = await pullTake(
      dir,
      { origin, key: 'k', media: true },
      quiet(),
    )

    expect(existsSync(join(dir, 'recording.mp4'))).toBe(true)
    expect(existsSync(join(dir, 'recording.webm'))).toBe(false)
    expect((await docOf(dir)).source.videoKey).toBe('recording.mp4')
    expect(result.media?.downloaded).toEqual([
      { file: 'recording.mp4', assetId: ASSET, bytes: MP4_BYTES.length },
    ])
    // Nothing half-written survives a finished transfer.
    expect(await readdir(dir)).not.toContain('recording.part')
  })

  it('believes the bytes over a Content-Type that says otherwise', async () => {
    // The exact shape that broke: mp4 bytes served as webm, because the hosted
    // filename ended in .webm and nothing ever looked inside.
    const origin = await serve('video/webm')
    const dir = await linkedTake()
    await pullTake(dir, { origin, key: 'k', media: true }, quiet())

    expect(existsSync(join(dir, 'recording.mp4'))).toBe(true)
    expect(existsSync(join(dir, 'recording.webm'))).toBe(false)
    expect((await docOf(dir)).source.videoKey).toBe('recording.mp4')
  })

  it('keeps footage already on disk, whatever container it wears', async () => {
    const origin = await serve('video/mp4')
    const dir = await linkedTake()
    await pullTake(dir, { origin, key: 'k', media: true }, quiet())
    // Pull again from the same base, as a human does when more versions land:
    // the head doc still names the asset, and the footage is already home.
    await writeFile(
      join(dir, 'vos.json'),
      JSON.stringify({ vosId: 'vos_1', versionId: BASE, pushedAt: 'x' }),
    )
    const result = await pullTake(
      dir,
      { origin, key: 'k', media: true },
      quiet(),
    )

    expect(result.media?.downloaded).toEqual([])
    expect((await docOf(dir)).source.videoKey).toBe('recording.mp4')
    // One footage file, never one per container the doc has worn.
    expect(
      (await readdir(dir)).filter((f) => f.startsWith('recording.')),
    ).toEqual(['recording.mp4'])
  })
})
