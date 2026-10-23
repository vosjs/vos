/**
 * `vos push <take>` says it is uploading the recording only when it sends
 * it: a re-push of a fetched take, whose bytes the platform already holds,
 * says only that it reused them. Against a real in-process HTTP server.
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

/** The platform: holding the recording already (`held`), or not. */
function serve(held: boolean): Promise<string> {
  const door = uploadDoor(() => ({ id: 'a1', kind: 'video', size: 13 }))
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
      const send = (status: number, payload: unknown) => {
        res.writeHead(status, { 'content-type': 'application/json' })
        res.end(JSON.stringify(payload))
      }
      if (url === '/api/engine') return send(404, { error: 'not found' })
      if (held && url === '/api/assets/uploads' && req.method === 'POST')
        return send(200, {
          asset: {
            id: 'held',
            kind: 'video',
            size: 13,
            fileUrl: '/api/assets/held/file',
          },
          reused: true,
        })
      const upload = door(req.method ?? '', url, body)
      if (upload) return send(upload.status, upload.payload)
      if (url === '/api/vos' && req.method === 'POST')
        return send(201, { vos: { id: 'v-1' } })
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

function take(): string {
  const dir = mkdtempSync(join(tmpdir(), 'vos-push-reuse-'))
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
    segments: [],
    zoom: [],
    audio: [],
    cursor: DEFAULT_CURSOR_STYLE,
    cam: DEFAULT_CAM_STYLE,
    frame: DEFAULT_FRAME_STYLE,
    export: { resolution: '720p', fps: 30, format: 'mp4' },
  }
  writeFileSync(join(dir, 'recording.webm'), Buffer.from('footage bytes'))
  writeFileSync(join(dir, 'meta.json'), JSON.stringify(meta))
  writeFileSync(join(dir, 'doc.json'), JSON.stringify(doc))
  return dir
}

function reporter(): { r: Reporter; lines: string[] } {
  const lines: string[] = []
  return {
    lines,
    r: {
      json: true,
      log: (m) => lines.push(m),
      warn: (m) => lines.push(`warning ${m}`),
      event: () => {},
      done: () => {},
    },
  }
}

describe('vos push says what it did with the recording', () => {
  it('says only that it reused bytes the platform already holds', async () => {
    const origin = await serve(true)
    const { r, lines } = reporter()
    await pushTake(take(), { origin, key: 'vos_sk_test', yes: true }, r)
    expect(lines.some((l) => /uploading recording/.test(l))).toBe(false)
    expect(lines).toContain('  recording already hosted — reused')
  })

  it('says it is uploading when it sends the bytes', async () => {
    const origin = await serve(false)
    const { r, lines } = reporter()
    await pushTake(take(), { origin, key: 'vos_sk_test', yes: true }, r)
    expect(lines).toContain('uploading recording (0 kB)…')
    expect(lines.some((l) => /already hosted/.test(l))).toBe(false)
  })
})
