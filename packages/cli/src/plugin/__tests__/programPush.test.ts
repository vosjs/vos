/**
 * `vos push` of a PROGRAM directory whose document adds sound, against a
 * real in-process HTTP server. The contract under test: a score that is
 * still a local file is uploaded through the recording door and the pushed
 * document and composed config key the hosted asset; a claimable push, which
 * carries no files, leaves the local sound out and composes the rest.
 */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { STUDIO_ENTRY_ID } from '@vosjs/studio-core'
import { cmdPushProgram } from '../program'
import type { Server } from 'node:http'
import { uploadDoor } from './uploadDoor'

let server: Server | undefined

interface Seen {
  method: string
  url: string
  body: Record<string, unknown> | null
}

function serve(seen: Seen[]): Promise<string> {
  const door = uploadDoor(() => ({ id: 'snd', kind: 'audio', size: 18 }))
  server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      let body: Record<string, unknown> | null = null
      try {
        body = raw ? (JSON.parse(raw) as Record<string, unknown>) : null
      } catch {
        // a raw media body is not JSON
      }
      const url = req.url ?? ''
      seen.push({ method: req.method ?? '', url, body })
      const send = (status: number, payload: Record<string, unknown>) => {
        res.writeHead(status, { 'content-type': 'application/json' })
        res.end(JSON.stringify(payload))
      }
      const upload = door(req.method ?? '', url, body)
      if (upload) return send(upload.status, upload.payload)
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

afterEach(() => {
  server?.close()
  server = undefined
})

const CONFIG = {
  version: 2,
  duration: 4,
  camera: { preset: 'fullscreen' },
  createContent:
    '(ctx) => { const m = new ctx.THREE.Mesh(new ctx.THREE.PlaneGeometry(2,2)); ctx.scene.add(m); return { objects: [m], refs: {}, dispose: () => {} } }',
  createTimeline:
    '(ctx, content, duration) => { const tl = ctx.gsap.timeline({ paused: true }); return tl }',
}

function programDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'vos-program-'))
  writeFileSync(join(dir, 'config.json'), JSON.stringify(CONFIG))
  writeFileSync(
    join(dir, 'doc.json'),
    JSON.stringify({
      program: {},
      audio: [
        {
          id: 'score',
          key: 'score.ogg',
          name: 'Score',
          start: 0,
          in: 0,
          out: 4,
          duration: 4,
          gain: 1,
        },
      ],
    }),
  )
  writeFileSync(
    join(dir, 'score.ogg'),
    Buffer.from('OggS\0\u0002\0\0\0\0\0\0\0\0\0\0'),
  )
  return dir
}

function studioAudio(config: unknown): { key: string }[] {
  const stack = (config as { stack?: { id: string; data: unknown }[] }).stack
  const entry = stack?.find((e) => e.id === STUDIO_ENTRY_ID)
  return ((entry?.data as { audio?: { key: string }[] } | undefined)?.audio ??
    []) as { key: string }[]
}

describe('vos push of a program document with its own sound', () => {
  it('uploads the local score and keys the hosted asset in the doc and the stored config', async () => {
    const seen: Seen[] = []
    const origin = await serve(seen)
    const dir = programDir()
    const code = await cmdPushProgram([
      join(dir, 'config.json'),
      '--origin',
      origin,
      '--key',
      'vos_sk_test',
      '--json',
      '--yes',
    ])
    expect(code).toBe(0)
    expect(seen.some((s) => s.url === '/api/assets/uploads')).toBe(true)
    const create = seen.find((s) => s.url === '/api/vos')
    const doc = create?.body?.doc as { audio: { key: string }[] }
    expect(doc.audio[0].key).toBe('/api/assets/snd/file')
    expect(studioAudio(create?.body?.config).map((a) => a.key)).toEqual([
      '/api/assets/snd/file',
    ])
  })

  it('--still writes the cover into doc.json and the push carries it', async () => {
    const seen: Seen[] = []
    const origin = await serve(seen)
    const dir = mkdtempSync(join(tmpdir(), 'vos-program-'))
    writeFileSync(join(dir, 'config.json'), JSON.stringify(CONFIG))
    const code = await cmdPushProgram([
      join(dir, 'config.json'),
      '--still',
      '2.5',
      '--origin',
      origin,
      '--key',
      'vos_sk_test',
      '--json',
    ])
    expect(code).toBe(0)
    const onDisk = JSON.parse(readFileSync(join(dir, 'doc.json'), 'utf8'))
    expect(onDisk.still).toBe(2.5)
    const create = seen.find((s) => s.url === '/api/vos')
    expect((create?.body?.doc as { still?: number }).still).toBe(2.5)
  })

  it('a claimable push composes the document but leaves a local sound out', async () => {
    const seen: Seen[] = []
    const origin = await serve(seen)
    const dir = programDir()
    const code = await cmdPushProgram([
      join(dir, 'config.json'),
      '--claimable',
      '--origin',
      origin,
      '--json',
    ])
    expect(code).toBe(0)
    expect(seen.some((s) => s.url === '/api/assets/uploads')).toBe(false)
    const claim = seen.find((s) => s.url === '/api/claim')
    const stack = (claim?.body?.config as { stack?: { id: string }[] }).stack
    expect(stack?.some((e) => e.id === STUDIO_ENTRY_ID)).toBe(true)
    expect(studioAudio(claim?.body?.config)).toEqual([])
  })
})
