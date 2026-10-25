/**
 * `vos push <take> --desc`: a recording carries the sentence its watch page
 * shows. The first push creates the vos with it; a later push replaces it
 * on the vos (with the prompt, in one PATCH), never on a version, against a
 * real in-process HTTP server.
 */
import { mkdtempSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_CAM_STYLE,
  DEFAULT_CURSOR_STYLE,
  DEFAULT_FRAME_STYLE,
} from '@vosjs/studio-core'
import { pushTake } from '../sync'
import { uploadDoor } from './uploadDoor'
import type { Server } from 'node:http'
import type { ProjectDoc } from '@vosjs/studio-core'
import type { Reporter } from '../output'

let server: Server | undefined
async function stop(): Promise<void> {
  const s = server
  server = undefined
  if (!s) return
  s.closeAllConnections?.()
  await new Promise<void>((done) => s.close(() => done()))
}
afterEach(stop)

interface Seen {
  method: string
  url: string
  body: Record<string, unknown> | null
}

function serve(seen: Seen[]): Promise<string> {
  let n = 0
  const door = uploadDoor(() => ({ id: `a${++n}`, kind: 'video', size: 9 }))
  server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      let body: Record<string, unknown> | null = null
      try {
        body = raw ? (JSON.parse(raw) as Record<string, unknown>) : null
      } catch {
        // a raw media part is not JSON
      }
      const url = req.url ?? ''
      const method = req.method ?? ''
      seen.push({ method, url, body })
      const send = (status: number, payload: unknown) => {
        res.writeHead(status, { 'content-type': 'application/json' })
        res.end(JSON.stringify(payload))
      }
      if (url === '/api/engine') return send(200, { studioCore: '99.0.0' })
      const upload = door(method, url, body)
      if (upload) return send(upload.status, upload.payload)
      if (url === '/api/vos' && method === 'POST')
        return send(201, { vos: { id: 'v-1' } })
      if (url === '/api/vos/v-1/versions' && method === 'POST')
        return send(201, { version: { id: 'ver-2', versionNumber: 2 } })
      if (url === '/api/vos/v-1' && method === 'PATCH')
        return send(200, { vos: { id: 'v-1' } })
      if (url === '/api/vos/v-1')
        return send(200, { vos: { id: 'v-1', currentVersionId: 'ver-1' } })
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

function take(tracked: boolean): string {
  const dir = mkdtempSync(join(tmpdir(), 'vos-push-words-'))
  const meta = {
    dpr: 1,
    zoom: 1,
    t0: 0,
    durationMs: 4000,
    width: 1280,
    height: 720,
    fps: 30,
  }
  const doc: ProjectDoc = {
    source: { videoKey: 'recording.webm', cursor: [], meta },
    segments: [{ in: 0, out: 4 }],
    zoom: [],
    audio: [],
    overlays: [],
    cursor: DEFAULT_CURSOR_STYLE,
    cam: DEFAULT_CAM_STYLE,
    frame: DEFAULT_FRAME_STYLE,
    export: { resolution: '720p', fps: 30, format: 'mp4' },
  }
  writeFileSync(join(dir, 'recording.webm'), Buffer.from('footage bytes'))
  writeFileSync(join(dir, 'meta.json'), JSON.stringify(meta))
  writeFileSync(join(dir, 'doc.json'), JSON.stringify(doc))
  if (tracked)
    writeFileSync(
      join(dir, 'vos.json'),
      JSON.stringify({ vosId: 'v-1', versionId: 'ver-1' }),
    )
  return dir
}

const quiet: Reporter = {
  json: true,
  log: () => {},
  warn: () => {},
  event: () => {},
  done: () => {},
}

const DESC = 'Create a key, copy it once, revoke it.'

describe('vos push <take> --desc', () => {
  it('creates the vos with its description', async () => {
    const seen: Seen[] = []
    const origin = await serve(seen)
    await pushTake(
      take(false),
      { origin, key: 'vos_sk_test', yes: true, description: DESC },
      quiet,
    )
    const create = seen.find((s) => s.url === '/api/vos' && s.method === 'POST')
    expect(create?.body?.description).toBe(DESC)
    expect(seen.some((s) => s.method === 'PATCH')).toBe(false)
  })

  it('replaces it on the vos with the prompt, in one PATCH, after a later version', async () => {
    const seen: Seen[] = []
    const origin = await serve(seen)
    await pushTake(
      take(true),
      {
        origin,
        key: 'vos_sk_test',
        description: DESC,
        prompt: 'Record the API key how-to',
      },
      quiet,
    )
    const version = seen.find(
      (s) => s.url === '/api/vos/v-1/versions' && s.method === 'POST',
    )
    expect(version).toBeDefined()
    expect(version?.body && 'description' in version.body).toBe(false)
    const patches = seen.filter((s) => s.method === 'PATCH')
    expect(patches.map((p) => p.body)).toEqual([
      { prompt: 'Record the API key how-to', description: DESC },
    ])
  })

  it('leaves the description alone on a later push that names none', async () => {
    const seen: Seen[] = []
    const origin = await serve(seen)
    await pushTake(take(true), { origin, key: 'vos_sk_test' }, quiet)
    expect(seen.some((s) => s.method === 'PATCH')).toBe(false)
  })
})
