import { mkdtemp, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { digestTake, parseTranscript } from '../digestTake'
import { planTake } from '../plan'
import { ensureTakeDir, writeJson } from '../take'
import type { CursorEvent } from '@vosjs/studio-core'

function track(): CursorEvent[] {
  const events: CursorEvent[] = []
  for (let t = 0; t <= 2000; t += 50)
    events.push({ t, x: 200 + t / 10, y: 200, type: 'move' })
  const rect = { x: 380, y: 180, w: 120, h: 40 }
  events.push({ t: 2100, x: 400, y: 200, type: 'down', button: 0, rect })
  events.push({ t: 2200, x: 400, y: 200, type: 'up', button: 0, rect })
  events.push({ t: 2600, x: 400, y: 200, type: 'down', button: 0, rect })
  events.push({ t: 2700, x: 400, y: 200, type: 'up', button: 0, rect })
  for (let t = 2800; t <= 6000; t += 50)
    events.push({ t, x: 400 + (t - 2800) / 8, y: 300, type: 'move' })
  return events
}

async function makeTake(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'vos-digest-'))
  const paths = await ensureTakeDir(dir)
  await writeJson(paths.cursor, track())
  await writeJson(paths.meta, {
    dpr: 1,
    zoom: 1,
    t0: 0,
    durationMs: 16000,
    width: 1280,
    height: 720,
    fps: 30,
    captureWidth: 1280,
    captureHeight: 720,
    producer: 'cli',
    pageUrl: 'https://example.test/app',
  })
  await planTake(dir)
  return dir
}

describe('digestTake --no-frames', () => {
  it('writes digest.json with moments in doc units and the planner proposals', async () => {
    const dir = await makeTake()
    const res = await digestTake(null, dir, {
      frames: false,
      transcript: [{ start: 2, end: 3, text: 'press Export' }],
    })
    expect(existsSync(res.file)).toBe(true)
    const d = JSON.parse(await readFile(res.file, 'utf8'))
    expect(d.digestVersion).toBe(1)
    expect(d.take.sourceDuration).toBe(16)
    expect(d.take.hasCursor).toBe(true)
    expect(d.take.pageUrl).toBe('https://example.test/app')
    expect(d.activity).toBeNull()
    expect(d.images).toEqual({
      full: 0,
      crop: 0,
      sheet: null,
      tokensEstimate: 0,
      tokensEstimateClaude: 0,
    })
    const kinds = d.moments.map((m: { kind: string }) => m.kind)
    expect(kinds[0]).toBe('head')
    expect(kinds).toContain('click')
    expect(kinds).toContain('idle')
    expect(kinds[kinds.length - 1]).toBe('tail')
    const click = d.moments.find((m: { kind: string }) => m.kind === 'click')
    expect(click.clicks).toBe(2)
    expect(click.focus.cx).toBeCloseTo(440 / 1280, 3)
    expect(click.rect.w).toBeCloseTo(120 / 1280, 3)
    expect(click.proposed.zoom).toBe('z0')
    expect(click.said).toBe('press Export')
    expect(click.full).toBeNull()
    expect(click.box).toBeNull()
    expect(d.plan.zoom[0].id).toBe('z0')
    expect(d.plan.zoom[0].source).toBe('auto')
    expect(d.doc.manual).toEqual({ zoom: 0, speed: 0, tilt: 0, overlays: 0 })
  })
})

describe('parseTranscript', () => {
  it("accepts Whisper's {segments} and a bare array; drops malformed rows", () => {
    const rows = [
      { start: 0, end: 1, text: 'a' },
      { start: 'x', end: 2, text: 'b' },
    ]
    expect(parseTranscript({ segments: rows })).toEqual([
      { start: 0, end: 1, text: 'a' },
    ])
    expect(parseTranscript(rows)).toEqual([{ start: 0, end: 1, text: 'a' }])
    expect(() => parseTranscript({ nope: 1 })).toThrow(/transcript/)
  })
})
