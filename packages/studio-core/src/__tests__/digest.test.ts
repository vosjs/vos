import { describe, expect, it } from 'vitest'
import { projectFromArtifact } from '../ingest'
import { docCardLayout, focusBounds } from '../layout'
import { momentsFromDoc, planForDigest } from '../digest/moments'
import { sceneChanges } from '../digest/scenes'
import { zoomCoversRect, zoomWindow } from '../digest/framing'
import { STYLE_FIELDS, copyStyle, pickStyle } from '../digest/style'
import { planAutoZoom } from '../planner/autoZoom'
import type { CursorEvent, ProjectDoc, RecordingMeta } from '../types'

const W = 1280
const H = 720

/** Two click clusters, a typing session, a scroll run, an idle tail. */
function track(): CursorEvent[] {
  const ev: CursorEvent[] = []
  for (let t = 0; t <= 2000; t += 50)
    ev.push({ t, x: 200 + t / 10, y: 200, type: 'move' })
  const rect = { x: 380, y: 180, w: 120, h: 40 }
  ev.push({ t: 2100, x: 400, y: 200, type: 'down', button: 0, rect })
  ev.push({ t: 2200, x: 400, y: 200, type: 'up', button: 0, rect })
  ev.push({ t: 2600, x: 400, y: 200, type: 'down', button: 0, rect })
  ev.push({ t: 2700, x: 400, y: 200, type: 'up', button: 0, rect })
  for (let t = 2800; t <= 5000; t += 50)
    ev.push({ t, x: 400 + (t - 2800) / 8, y: 300, type: 'move' })
  // a field: click, then typing pings
  const field = { x: 600, y: 400, w: 300, h: 40 }
  ev.push({ t: 5100, x: 700, y: 420, type: 'down', button: 0, rect: field })
  ev.push({ t: 5200, x: 700, y: 420, type: 'up', button: 0, rect: field })
  for (let t = 5500; t <= 8700; t += 400)
    ev.push({ t, x: 750, y: 420, type: 'key', rect: field })
  // a scroll run
  const main = { x: 0, y: 0, w: 1280, h: 720 }
  for (let t = 9000; t <= 11000; t += 200)
    ev.push({ t, x: 750, y: 500, type: 'scroll', rect: main })
  ev.push({ t: 11500, x: 750, y: 500, type: 'move' })
  return ev
}

function meta(durationMs: number): RecordingMeta {
  return {
    dpr: 1,
    zoom: 1,
    t0: 0,
    durationMs,
    width: W,
    height: H,
    fps: 30,
    captureWidth: W,
    captureHeight: H,
  } as RecordingMeta
}

function doc(): ProjectDoc {
  const d = projectFromArtifact(
    { videoKey: 'recording.webm', cursor: track(), meta: meta(20_000) },
    'recording.webm',
  ).doc
  d.zoom = planAutoZoom(d.source.cursor, { width: W, height: H })
  return d
}

describe('momentsFromDoc', () => {
  it('lists the planner groupings in time order, in doc units, with stable ids', () => {
    const d = doc()
    const plan = planForDigest(d)
    const ms = momentsFromDoc(d, plan)
    expect(ms[0].kind).toBe('head')
    expect(ms[ms.length - 1].kind).toBe('tail')
    expect(ms.map((m) => m.id)).toEqual(
      ms.map((_, i) => `m${String(i + 1).padStart(2, '0')}`),
    )
    const kinds = ms.map((m) => m.kind)
    expect(kinds).toContain('click')
    expect(kinds).toContain('typing')
    expect(kinds).toContain('scroll')
    expect(kinds).toContain('idle') // 11.5s → 20s tail gap
    for (let i = 1; i < ms.length; i++)
      expect(ms[i].source.in).toBeGreaterThanOrEqual(ms[i - 1].source.in)
  })

  it('a click cluster carries normalized focus + rect that contain the click', () => {
    const d = doc()
    const ms = momentsFromDoc(d, planForDigest(d))
    const click = ms.find((m) => m.kind === 'click')!
    expect(click.clicks).toBe(2)
    expect(click.rect!.x).toBeCloseTo(380 / W, 3)
    expect(click.rect!.y).toBeCloseTo(180 / H, 3)
    expect(click.rect!.w).toBeCloseTo(120 / W, 3)
    expect(click.rect!.h).toBeCloseTo(40 / H, 3)
    expect(click.focus!.cx).toBeCloseTo(440 / W, 3)
    expect(click.focus!.cy).toBeCloseTo(200 / H, 3)
    expect(click.at).toBe(2.1)
    for (const v of [click.focus!.cx, click.focus!.cy]) {
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(1)
    }
  })

  it('the typing session opens at the absorbed click and frames the field', () => {
    const d = doc()
    const ms = momentsFromDoc(d, planForDigest(d))
    const typing = ms.find((m) => m.kind === 'typing')!
    expect(typing.source.in).toBe(5.1)
    expect(typing.source.out).toBe(8.7)
    expect(typing.at).toBe(8.7)
    expect(typing.pings).toBe(9)
    expect(typing.rect!.x).toBeCloseTo(600 / W, 3)
    expect(typing.rect!.w).toBeCloseTo(300 / W, 3)
  })

  it('names the planner proposals that cover each moment', () => {
    const d = doc()
    const plan = planForDigest(d)
    const ms = momentsFromDoc(d, plan)
    const click = ms.find((m) => m.kind === 'click')!
    expect(click.proposed.zoom).toBe(
      plan.zoom.find((z) => z.id.startsWith('z'))!.id,
    )
    const typing = ms.find((m) => m.kind === 'typing')!
    expect(typing.proposed.zoom).toMatch(/^k/)
    expect(typing.proposed.speed).toMatch(/^s/)
    const idle = ms.find((m) => m.kind === 'idle')!
    expect(idle.proposed.speed).toMatch(/^s/)
    expect(idle.at).toBeNull()
  })

  it('maps source windows to output through trims and speed', () => {
    const d = doc()
    d.segments = [{ in: 3, out: 20 }]
    d.speed = [{ id: 's9', in: 10, out: 20, rate: 2, source: 'manual' }]
    const ms = momentsFromDoc(d, planForDigest(d))
    const click = ms.find((m) => m.kind === 'click')!
    expect(click.output).toBeNull() // cut away by the trim
    expect(click.outputAt).toBeNull()
    const typing = ms.find((m) => m.kind === 'typing')!
    expect(typing.output!.in).toBeCloseTo(5.1 - 3, 3)
    const tail = ms[ms.length - 1]
    // 3..10 at 1× = 7s, 10..20 at 2× = 5s → output 12s
    expect(tail.output!.in).toBeCloseTo(12, 2)
  })

  it('folds activity bins and a transcript onto moments; scenes become moments', () => {
    const d = doc()
    const bins = new Array(20).fill(0.05)
    bins[3] = 0.9 // a scene at 3s
    const ms = momentsFromDoc(d, planForDigest(d), {
      bins,
      scenes: sceneChanges(bins),
      transcript: [{ start: 2, end: 3, text: 'press Export' }],
    })
    const scene = ms.find((m) => m.kind === 'scene')!
    expect(scene.source.in).toBe(3)
    expect(scene.at).toBe(3.04)
    const click = ms.find((m) => m.kind === 'click')!
    expect(click.activity).toBe(0.05)
    expect(click.said).toBe('press Export')
    expect(ms[0].said).toBeNull()
  })

  it('an empty track (browser-recorder take) still yields head, tail and scenes', () => {
    const d = projectFromArtifact(
      { videoKey: 'recording.webm', cursor: [], meta: meta(10_000) },
      'recording.webm',
    ).doc
    const ms = momentsFromDoc(d, planForDigest(d), { scenes: [4] })
    expect(ms.map((m) => m.kind)).toEqual(['head', 'scene', 'tail'])
  })
})

describe('sceneChanges', () => {
  it('fires on a jump after a quiet bin, never on sustained motion', () => {
    expect(sceneChanges([0.1, 0.8, 0.9, 0.1, 0.1, 0.6])).toEqual([1, 5])
    expect(sceneChanges([0.8, 0.9, 0.9])).toEqual([])
  })
})

describe('zoomCoversRect', () => {
  const layout = docCardLayout(doc())

  it('the window at the focus bound meets the card edge (pinned to focusBounds)', () => {
    const level = 2
    const b = focusBounds(level, layout)
    // focusBounds covers the CARD (bar + video), so the window's top edge at
    // the bound is the card top, expressed in video coords.
    const cardTop = (layout.cardY - layout.dy) / layout.dh
    const cardBottom = (layout.cardY + layout.cardH - layout.dy) / layout.dh
    const w = zoomWindow({ level, cx: b.minX, cy: b.minY }, layout)
    expect(w.x0).toBeCloseTo(0, 6)
    expect(w.y0).toBeCloseTo(cardTop, 6)
    const w2 = zoomWindow({ level, cx: b.maxX, cy: b.maxY }, layout)
    expect(w2.x1).toBeCloseTo(1, 6)
    expect(w2.y1).toBeCloseTo(cardBottom, 6)
  })

  it('a zoom on the rect covers it; the same zoom pointed elsewhere does not', () => {
    const rect = { x: 0.3, y: 0.25, w: 0.09, h: 0.06 }
    expect(
      zoomCoversRect({ level: 2.2, cx: 0.34, cy: 0.28 }, rect, layout),
    ).toBe(true)
    expect(zoomCoversRect({ level: 2.2, cx: 0.8, cy: 0.8 }, rect, layout)).toBe(
      false,
    )
    expect(zoomCoversRect({ level: 1, cx: 0.8, cy: 0.8 }, rect, layout)).toBe(
      true,
    )
  })
})

describe('copyStyle', () => {
  it('carries exactly the style fields and removes what the seed lacks', () => {
    const from = doc()
    from.zoomStyle = 'keynote'
    from.zoomParams = { hold: 2 }
    from.frame.padding = 96
    const to = doc()
    to.tiltStyle = 'strong'
    to.zoom = [{ id: 'u0', in: 1, out: 2, level: 2, cx: 0.5, cy: 0.5 }]
    const next = copyStyle(from, to)
    expect(next.zoomStyle).toBe('keynote')
    expect(next.zoomParams).toEqual({ hold: 2 })
    expect(next.frame.padding).toBe(96)
    expect(next.tiltStyle).toBeUndefined()
    expect(next.zoom).toEqual(to.zoom) // the cut is untouched
    expect(
      Object.keys(pickStyle(from)).every((k) =>
        (STYLE_FIELDS as readonly string[]).includes(k),
      ),
    ).toBe(true)
    expect(next.frame).not.toBe(from.frame) // cloned
  })
})
