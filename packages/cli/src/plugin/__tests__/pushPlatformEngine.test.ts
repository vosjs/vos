/**
 * `vos push <take>` reads which studio-core the platform renders with
 * before anything is sent, against a real in-process HTTP server: a take
 * that uses a field newer than it is refused in words (nothing uploads),
 * `--bake` sends a copy with the field resolved and leaves doc.json alone,
 * a current platform takes the take as it is, and a platform that cannot
 * say is warned of and pushed to.
 */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
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
import { PlatformBehindError } from '../platformEngine'
import { uploadDoor } from './uploadDoor'
import type { Server } from 'node:http'
import type { ProjectDoc, TextOverlayClip } from '@vosjs/studio-core'
import type { Reporter } from '../output'

let server: Server | undefined
/** Close the server now: Node 18 waits on a kept-alive connection otherwise. */
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

/** The platform: an engine answer (or none), the upload door, the create. */
function serve(
  seen: Seen[],
  engine: { status: number; body: unknown } | 'hang',
): Promise<string> {
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
      seen.push({ method: req.method ?? '', url, body })
      const send = (status: number, payload: unknown) => {
        res.writeHead(status, { 'content-type': 'application/json' })
        res.end(JSON.stringify(payload))
      }
      if (url === '/api/engine') {
        if (engine === 'hang') return
        return send(engine.status, engine.body)
      }
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

const caption = (over: Partial<TextOverlayClip>): TextOverlayClip => ({
  id: 'c1',
  kind: 'text',
  text: 'Saved {elapsed} later',
  preset: 'caption',
  start: 0.5,
  duration: 1.5,
  transform: { x: 0.5, y: 0.85, scale: 1, rotation: 0 },
  ...over,
})

/** A take of 8 s, the first 2 s trimmed; step `save` at 5 s plays at 3 s. */
function take(): { dir: string; doc: ProjectDoc } {
  const dir = mkdtempSync(join(tmpdir(), 'vos-push-engine-'))
  const meta = {
    dpr: 1,
    zoom: 1,
    t0: 0,
    durationMs: 8000,
    width: 1280,
    height: 720,
    fps: 30,
    steps: [
      {
        step: 0,
        id: 'save',
        do: 'click' as const,
        tStart: 5,
        tEnd: 5.4,
        offCameraMs: 180_000,
      },
    ],
  }
  const doc: ProjectDoc = {
    source: { videoKey: 'recording.webm', cursor: [], meta },
    segments: [{ in: 2, out: 8 }],
    zoom: [],
    audio: [],
    overlays: [caption({ anchor: { step: 'save' } })],
    cursor: DEFAULT_CURSOR_STYLE,
    cam: DEFAULT_CAM_STYLE,
    frame: DEFAULT_FRAME_STYLE,
    export: { resolution: '720p', fps: 30, format: 'mp4' },
  }
  writeFileSync(join(dir, 'recording.webm'), Buffer.from('footage bytes'))
  writeFileSync(join(dir, 'meta.json'), JSON.stringify(meta))
  writeFileSync(join(dir, 'doc.json'), JSON.stringify(doc))
  return { dir, doc }
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

const created = (seen: Seen[]) =>
  seen.find((s) => s.url === '/api/vos' && s.method === 'POST')?.body as
    | { doc: ProjectDoc }
    | undefined

describe('vos push reads the platform’s studio-core first', () => {
  it('refuses a take that uses a field the platform cannot play, before any upload', async () => {
    const seen: Seen[] = []
    const origin = await serve(seen, {
      status: 200,
      body: { studioCore: '0.42.4', core: '0.31.0' },
    })
    const { dir } = take()
    const { r } = reporter()
    const err = await pushTake(
      dir,
      { origin, key: 'vos_sk_test', yes: true },
      r,
    ).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(PlatformBehindError)
    const message = (err as Error).message
    expect(message).toContain('caption anchors (studio-core 0.43.0)')
    expect(message).toContain('renders with 0.42.4')
    expect(message).toContain('fallback start')
    expect(message).toContain('every version saved there')
    expect(message).toContain('vos push --bake')
    expect(seen.map((s) => s.url)).toEqual(['/api/engine'])
  })

  it('--bake sends the caption at the start it plays at, its words filled, doc.json untouched', async () => {
    const seen: Seen[] = []
    const origin = await serve(seen, {
      status: 200,
      body: { studioCore: '0.42.4' },
    })
    const { dir } = take()
    const before = readFileSync(join(dir, 'doc.json'), 'utf8')
    const { r, lines } = reporter()
    await pushTake(
      dir,
      { origin, key: 'vos_sk_test', yes: true, bake: true },
      r,
    )
    const body = created(seen)
    expect(body).toBeDefined()
    const sent = body!.doc.overlays![0] as TextOverlayClip
    expect(sent).not.toHaveProperty('anchor')
    expect(sent.start).toBe(3)
    expect(sent.text).toBe('Saved 3 minutes later')
    expect(readFileSync(join(dir, 'doc.json'), 'utf8')).toBe(before)
    expect(lines.some((l) => /^baked caption anchors/.test(l))).toBe(true)
  })

  it('a platform that reads the field takes the take as it is', async () => {
    const seen: Seen[] = []
    const origin = await serve(seen, {
      status: 200,
      body: { studioCore: '0.43.0' },
    })
    const { dir } = take()
    const { r, lines } = reporter()
    await pushTake(dir, { origin, key: 'vos_sk_test', yes: true }, r)
    const sent = created(seen)!.doc.overlays![0] as TextOverlayClip
    expect(sent.anchor).toEqual({ step: 'save' })
    expect(sent.start).toBe(0.5)
    expect(lines.filter((l) => /studio-core/.test(l))).toEqual([])
  })

  it('warns and pushes when the platform cannot say', async () => {
    for (const engine of [
      { status: 404, body: { error: 'not found' } },
      { status: 200, body: { hello: 'world' } },
    ]) {
      const seen: Seen[] = []
      const origin = await serve(seen, engine)
      const { dir } = take()
      const { r, lines } = reporter()
      await pushTake(dir, { origin, key: 'vos_sk_test', yes: true }, r)
      expect(created(seen)).toBeDefined()
      expect(
        lines.some((l) =>
          /could not read which studio-core .* renders with/.test(l),
        ),
      ).toBe(true)
      await stop()
    }
  })

  it('a hosted score keeps its measurement under its new key', async () => {
    const seen: Seen[] = []
    const origin = await serve(seen, {
      status: 200,
      body: { studioCore: '0.44.0' },
    })
    const { dir, doc } = take()
    writeFileSync(join(dir, 'score.wav'), Buffer.from('RIFF....WAVEfmt '))
    doc.audio = [
      {
        id: 'score',
        key: 'score.wav',
        name: 'score',
        start: 0,
        in: 0,
        out: 4,
        duration: 4,
        gain: 0.5,
        fadeIn: 0,
        fadeOut: 0,
        normalize: -16,
        loudness: {
          lufs: -20,
          peakDb: -3,
          at: '2026-10-22T00:00:00.000Z',
          src: 'score.wav',
        },
      },
    ]
    writeFileSync(join(dir, 'doc.json'), JSON.stringify(doc))
    const { r } = reporter()
    await pushTake(dir, { origin, key: 'vos_sk_test', yes: true }, r)
    const clip = created(seen)!.doc.audio[0]
    expect(clip.key).toMatch(/^\/api\/assets\/a\d+\/file$/)
    expect(clip.loudness?.src).toBe(clip.key)
  })
})
