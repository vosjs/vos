import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_CAM_STYLE,
  DEFAULT_CURSOR_STYLE,
  DEFAULT_FRAME_STYLE,
  isRejected,
} from '@vosjs/studio-core'
import {
  PER_BEAT_NOTE,
  mediaBeats,
  oneZoomPerBeat,
  perBeatLine,
  zoomModeOf,
} from '../beats'
import { planTake } from '../plan'
import { ensureTakeDir, loadTake, writeJson } from '../take'
import type {
  CursorEvent,
  ProjectDoc,
  StepSpan,
  ZoomSpan,
} from '@vosjs/studio-core'
import type { ActionsFile } from '../actions'

const zoom = (
  id: string,
  inS: number,
  outS: number,
  over: Partial<ZoomSpan> = {},
): ZoomSpan => ({
  id,
  in: inS,
  out: outS,
  level: 1.5,
  cx: 0.5,
  cy: 0.5,
  source: 'auto',
  ...over,
})

const steps: StepSpan[] = [
  { step: 0, id: 'warm', do: 'click', tStart: 0.5, tEnd: 1 },
  { step: 1, id: 'draw', do: 'drag', tStart: 2, tEnd: 3 },
  { step: 2, id: 'label', do: 'type', tStart: 4, tEnd: 5 },
  { step: 3, id: 'arrows', do: 'drag', tStart: 10, tEnd: 11 },
  { step: 4, id: 'tidy', do: 'click', tStart: 14, tEnd: 15 },
]
// Two beats: `draw` (2..10) and `arrows` (10..20); 0..2 is the opening.
const actions: ActionsFile = {
  steps: [
    { do: 'click', selector: '#a', id: 'warm' },
    { do: 'click', selector: '#b', id: 'draw', caption: 'Draw the flow' },
    { do: 'click', selector: '#c', id: 'label' },
    { do: 'click', selector: '#d', id: 'arrows', caption: 'Arrows attach' },
    { do: 'click', selector: '#e', id: 'tidy' },
  ],
} as unknown as ActionsFile

function doc(over: Partial<ProjectDoc> = {}): ProjectDoc {
  return {
    source: {
      videoKey: 'recording.webm',
      cursor: [],
      meta: {
        dpr: 1,
        zoom: 1,
        t0: 0,
        durationMs: 20000,
        width: 1280,
        height: 720,
        fps: 30,
        producer: 'cli',
        steps,
      },
    },
    segments: [{ in: 0, out: 20 }],
    zoom: [
      // The opening: no captioned step.
      zoom('z0', 0.2, 1.4),
      // The `draw` beat (its step 2..3): z1 is on the drag; z2, the
      // longest, frames the typing after it.
      zoom('z1', 2, 3.5),
      zoom('z2', 4, 7, { level: 1.8 }),
      zoom('z3', 7.5, 9.5),
      // The `arrows` beat (its step 10..11): z4 is on it; z5, longer, is not.
      zoom('z4', 10, 12),
      zoom('z5', 13, 18),
    ],
    audio: [],
    cursor: DEFAULT_CURSOR_STYLE,
    cam: DEFAULT_CAM_STYLE,
    frame: DEFAULT_FRAME_STYLE,
    export: { resolution: '1080p', fps: 30, format: 'mp4' },
    ...over,
  }
}

describe('one zoom per beat', () => {
  it('reads the beats from the captioned steps, the opening before the first', () => {
    const d = doc()
    expect(
      mediaBeats('', d.source, actions).map((b) => [b.step, b.in, b.out]),
    ).toEqual([
      [null, 0, 2],
      ['draw', 2, 10],
      ['arrows', 10, 20],
    ])
  })

  it('keeps the one on the captioned step, and rejects the rest like a person', () => {
    const d = doc()
    const r = oneZoomPerBeat(d, new Map([['', actions]]))
    expect(d.zoom.map((z) => [z.id, z.source])).toEqual([
      ['z1', 'manual'],
      ['z4', 'manual'],
    ])
    expect(r.kept.map((k) => [k.step, k.id])).toEqual([
      ['draw', 'z1'],
      ['arrows', 'z4'],
    ])
    // The opening has no captioned step: it keeps no zoom.
    expect(r.none).toEqual([
      { media: '', step: null, caption: null, ids: ['z0'] },
    ])
    expect(r.rejected).toBe(4)
    expect(d.rejected).toEqual([
      { id: 'r0', lane: 'zoom', in: 0.2, out: 1.4, note: PER_BEAT_NOTE },
      { id: 'r1', lane: 'zoom', in: 4, out: 7, note: PER_BEAT_NOTE },
      { id: 'r2', lane: 'zoom', in: 7.5, out: 9.5, note: PER_BEAT_NOTE },
      { id: 'r3', lane: 'zoom', in: 13, out: 18, note: PER_BEAT_NOTE },
    ])
    // A re-plan proposing them again drops them, and keeps the ones kept.
    for (const z of doc().zoom)
      expect(isRejected('zoom', z, d.rejected)).toBe(
        ['z0', 'z2', 'z3', 'z5'].includes(z.id),
      )
    // Running it again changes nothing.
    const before = JSON.stringify(d)
    oneZoomPerBeat(d, new Map([['', actions]]))
    expect(JSON.stringify(d)).toBe(before)
    expect(perBeatLine(r)).toMatch(
      /3 beats held zooms, 2 proposals on a beat's action kept .*; beat "Draw the flow": action #1 drag, kept z1; beat "Arrows attach": action #3 drag, kept z4; the opening: no zoom/,
    )
  })

  it('of several on the captioned step keeps the one most on it, and keeps none when none is', () => {
    const d = doc({
      zoom: [
        // On `draw` (2..3): z1 covers 0.3 s of it, z2 0.8 s; z1 is higher.
        zoom('z1', 1.9, 2.3, { level: 2 }),
        zoom('z2', 2.2, 6),
        // The `arrows` beat holds only the tidy-up after its step.
        zoom('z5', 13, 18),
      ],
    })
    const r = oneZoomPerBeat(d, new Map([['', actions]]))
    expect(r.kept.map((b) => [b.step, b.id])).toEqual([['draw', 'z2']])
    expect(r.none.map((b) => [b.step, b.ids])).toEqual([['arrows', ['z5']]])
    expect(d.zoom.map((z) => z.id)).toEqual(['z2'])
    expect(perBeatLine(r)).toMatch(
      /beat "Arrows attach": action #3 drag, no zoom on it/,
    )
  })

  it('takes the first acting step after a caption written on a wait, and keeps none in a beat that never acts', () => {
    const sceneSteps: StepSpan[] = [
      { step: 0, id: 'scene1', do: 'wait', tStart: 0, tEnd: 1.5 },
      { step: 1, do: 'move', tStart: 1.6, tEnd: 2.6 },
      { step: 2, id: 'box', do: 'drag', tStart: 3, tEnd: 5 },
      { step: 3, do: 'type', tStart: 6, tEnd: 7 },
      { step: 4, id: 'scene2', do: 'wait', tStart: 12, tEnd: 13 },
      { step: 5, do: 'wait', tStart: 13, tEnd: 20 },
    ]
    const sceneActions = {
      steps: [
        { id: 'scene1', do: 'wait', ms: 1500, caption: 'Draw the flow' },
        { do: 'move', x: 10, y: 10 },
        { id: 'box', do: 'drag', x: 10, y: 10, tx: 90, ty: 60 },
        { do: 'type', text: 'Sign up' },
        { id: 'scene2', do: 'wait', ms: 1000, caption: 'Wait for it' },
        { do: 'wait', ms: 7000 },
      ],
    } as unknown as ActionsFile
    const base = doc()
    const d = doc({
      source: {
        ...base.source,
        meta: { ...base.source.meta, steps: sceneSteps },
      },
      zoom: [
        // The move that prepares it, the drag that draws, the typing after.
        zoom('zm', 1.5, 2.8),
        zoom('zd', 3, 5.2),
        zoom('zt', 5.5, 10),
        // The second scene only waits.
        zoom('zw', 13, 15),
      ],
    })
    const beats = mediaBeats('', d.source, sceneActions)
    expect(beats.map((b) => b.action)).toEqual([
      { in: 3, out: 5, step: 2, do: 'drag' },
      undefined,
    ])
    const r = oneZoomPerBeat(d, new Map([['', sceneActions]]))
    expect(d.zoom.map((z) => z.id)).toEqual(['zd'])
    expect(r.kept.map((b) => b.id)).toEqual(['zd'])
    expect(r.none.map((b) => [b.step, b.ids])).toEqual([['scene2', ['zw']]])
    expect(perBeatLine(r)).toContain(
      'beat "Draw the flow": action #2 drag, kept zd',
    )
    expect(perBeatLine(r)).toContain(
      'beat "Wait for it": no acting step, no zoom',
    )
  })

  it('a beat with a manual zoom keeps only its manual ones', () => {
    const d = doc()
    // A manual zoom off the step still wins its beat.
    d.zoom[2] = { ...d.zoom[2], source: 'manual' }
    const r = oneZoomPerBeat(d, new Map([['', actions]]))
    expect(r.manual).toEqual([{ media: '', step: 'draw', ids: ['z2'] }])
    expect(d.zoom.map((z) => z.id)).toEqual(['z2', 'z4'])
  })

  it('leaves a media with no captioned step as planned, and names it', () => {
    const d = doc({
      media: [
        {
          id: 'm1',
          videoKey: 'm1/recording.webm',
          cursor: [],
          meta: { ...doc().source.meta, steps: [steps[0]] },
        },
      ],
      segments: [
        { in: 0, out: 20 },
        { in: 0, out: 20, media: 'm1' },
      ],
    })
    d.zoom.push(
      zoom('m1-z0', 0.6, 2, { media: 'm1' }),
      zoom('m1-z1', 3, 4, { media: 'm1' }),
    )
    const r = oneZoomPerBeat(d, new Map([['', actions]]))
    expect(r.uncaptioned).toEqual(['m1'])
    expect(d.zoom.filter((z) => z.media === 'm1')).toHaveLength(2)
    expect(perBeatLine(r)).toMatch(/no captioned step in media m1/)
    // A media's embedded script carries its captions too.
    d.media![0].script = {
      steps: [{ do: 'click', id: 'warm', caption: 'Warm up' }],
    }
    const again = oneZoomPerBeat(d, new Map([['', actions]]), {
      only: new Set(['m1']),
    })
    expect(again.kept).toEqual([
      {
        media: 'm1',
        step: 'warm',
        caption: 'Warm up',
        action: { step: 0, do: 'click' },
        id: 'm1-z0',
      },
    ])
    expect(d.rejected?.at(-1)).toMatchObject({ media: 'm1', in: 3, out: 4 })
  })

  it('takes no captioned step at all as the current behaviour', () => {
    const d = doc()
    const r = oneZoomPerBeat(d, new Map([['', null]]))
    expect(r.uncaptioned).toEqual([''])
    expect(d.zoom).toHaveLength(6)
    expect(d.rejected).toBeUndefined()
  })

  it('reads --zooms', () => {
    expect(zoomModeOf(undefined)).toBeNull()
    expect(zoomModeOf('per-beat')).toBe('per-beat')
    expect(zoomModeOf('few')).toEqual({
      error: expect.stringMatching(/per-beat/),
    })
  })
})

describe('one zoom per beat, through a re-plan', () => {
  it('a plan after it proposes none of the rejected spans again', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vos-beats-'))
    const paths = await ensureTakeDir(dir)
    // Four clicks on four targets: two in each captioned beat.
    const events: CursorEvent[] = []
    const clicks = [
      { t: 1500, x: 200, y: 200 },
      { t: 5000, x: 900, y: 500 },
      { t: 9500, x: 300, y: 600 },
      { t: 13000, x: 1000, y: 150 },
    ]
    for (const c of clicks) {
      const rect = { x: c.x - 40, y: c.y - 15, w: 80, h: 30 }
      for (let t = c.t - 800; t < c.t; t += 50)
        events.push({ t, x: c.x - (c.t - t) / 10, y: c.y, type: 'move' })
      events.push({ t: c.t, x: c.x, y: c.y, type: 'down', button: 0, rect })
      events.push({ t: c.t + 80, x: c.x, y: c.y, type: 'up', button: 0, rect })
    }
    await writeJson(paths.cursor, events)
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
      captureSurface: 'tab',
      producer: 'cli',
      steps: clicks.map((c, i) => ({
        step: i,
        id: `s${i}`,
        do: 'click',
        tStart: c.t / 1000 - 0.3,
        tEnd: c.t / 1000 + 0.1,
      })),
    })
    await writeJson(paths.actions, {
      steps: clicks.map((_, i) => ({
        do: 'click',
        selector: `#s${i}`,
        id: `s${i}`,
        ...(i === 0
          ? { caption: 'First' }
          : i === 2
            ? { caption: 'Second' }
            : {}),
      })),
    })
    const first = await planTake(dir)
    const proposed = first.doc.zoom.length
    expect(proposed).toBeGreaterThanOrEqual(3)
    // What `vos plan --zooms per-beat` runs after planning.
    const take = await loadTake(dir)
    const report = oneZoomPerBeat(first.doc, new Map([['', take.actions]]))
    expect(report.kept).toHaveLength(2)
    expect(first.doc.zoom).toHaveLength(2)
    expect(report.rejected).toBe(proposed - 2)
    await writeJson(paths.doc, first.doc, true)
    const kept = first.doc.zoom.map((z) => z.id)
    const again = await planTake(dir)
    expect(again.doc.zoom.map((z) => z.id)).toEqual(kept)
  })
})
