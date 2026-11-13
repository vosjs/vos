import { mkdtemp, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  digestTake,
  joinedInputs,
  mediaView,
  outputBefore,
  parseTranscript,
} from '../digestTake'
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

describe('digestTake on a joined take', () => {
  it('digests every input after the first beside it, in the film’s time', async () => {
    const a = await makeTake()
    const b = await makeTake()
    const alone = await digestTake(null, a, { frames: false })
    const first = alone.digest.take.outputDuration
    expect(alone.inputs).toEqual([])

    // The second take as the first one's media m1, as `vos join` leaves it.
    const docA = JSON.parse(await readFile(join(a, 'doc.json'), 'utf8'))
    const docB = JSON.parse(await readFile(join(b, 'doc.json'), 'utf8'))
    const tagged = (list: { id: string }[]) =>
      list.map((x) => ({ ...x, id: `m1-${x.id}`, media: 'm1' }))
    const joined = {
      ...docA,
      segments: [...docA.segments, { in: 0, out: 16, media: 'm1' }],
      zoom: [...docA.zoom, ...tagged(docB.zoom)],
      speed: [...docA.speed, ...tagged(docB.speed)],
      media: [{ ...docB.source, id: 'm1' }],
      // A layer that outlasts the footage is the film's length, not where m1 begins.
      overlays: [
        {
          id: 'end',
          kind: 'text',
          text: 'The end',
          start: 100,
          duration: 3,
          transform: { x: 0.5, y: 0.5 },
        },
      ],
    }
    await writeJson(join(a, 'doc.json'), joined)

    expect(joinedInputs(joined)).toEqual(['m1'])
    expect(outputBefore(joined, 'm1')).toBeCloseTo(first, 3)
    const view = mediaView(joined, 'm1')
    expect(view.media).toBeUndefined()
    expect(view.segments).toEqual([{ in: 0, out: 16 }])
    expect(view.zoom.map((z) => z.id)).toEqual(
      docB.zoom.map((z: { id: string }) => `m1-${z.id}`),
    )
    expect(view.overlays).toEqual([])

    const res = await digestTake(null, a, { frames: false })
    expect(res.inputs).toHaveLength(1)
    expect(res.inputs[0]).toMatchObject({
      media: 'm1',
      file: 'm1/digest.json',
    })
    expect(res.inputs[0]!.outputFrom).toBeCloseTo(first, 3)
    const top = JSON.parse(await readFile(res.file, 'utf8'))
    expect(top.inputs).toEqual(res.inputs)
    // The first input's moments are as they were alone.
    expect(top.moments.map((m: { kind: string }) => m.kind)).toEqual(
      alone.digest.moments.map((m) => m.kind),
    )

    const m1 = JSON.parse(
      await readFile(join(res.outDir, 'm1', 'digest.json'), 'utf8'),
    )
    expect(m1.media).toBe('m1')
    // A step's window in the cut moves with the input, as a moment's does.
    for (const [i, st] of m1.steps.entries()) {
      const was = alone.digest.steps[i]!
      if (was.output) expect(st.output.in).toBeCloseTo(was.output.in + first, 3)
    }
    expect(m1.moments.length).toBe(alone.digest.moments.length)
    for (const [i, m] of m1.moments.entries()) {
      const was = alone.digest.moments[i]!
      expect(m.media).toBe('m1')
      // Source times are the input's own footage; output times are the film's.
      expect(m.source).toEqual(was.source)
      if (was.output) expect(m.output.in).toBeCloseTo(was.output.in + first, 3)
      else expect(m.output).toBeNull()
    }
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
