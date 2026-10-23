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
  ZOOM_FALSE_NOTE,
  applyZoomMarks,
  mediaBeats,
  oneZoomPerBeat,
  perBeatLine,
  zoomMarkLine,
  zoomMarkOf,
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

  /** The fixture's script with `zoom` marks on the steps named. */
  const marked = (marks: Record<string, boolean>): ActionsFile =>
    ({
      steps: (actions.steps as unknown as Record<string, unknown>[]).map((s) =>
        typeof s.id === 'string' && s.id in marks
          ? { ...s, zoom: marks[s.id] }
          : s,
      ),
    }) as unknown as ActionsFile

  it('keeps the zoom on each beat’s marked step, and none in a beat with no mark', () => {
    // `label` (typing, 4..5) pays off the draw beat, `tidy` (14..15) the arrows one.
    const d = doc()
    const script = marked({ label: true, tidy: true })
    const r = oneZoomPerBeat(d, new Map([['', script]]))
    expect(r.fallback).toBe(false)
    expect(d.zoom.map((z) => [z.id, z.source])).toEqual([
      ['z2', 'manual'],
      ['z5', 'manual'],
    ])
    expect(r.kept.map((k) => [k.step, k.action, k.id])).toEqual([
      ['draw', { step: 2, do: 'type' }, 'z2'],
      ['arrows', { step: 4, do: 'click' }, 'z5'],
    ])
    expect(r.none).toEqual([
      { media: '', step: null, caption: null, why: 'unmarked', ids: ['z0'] },
    ])
    expect(r.rejected).toBe(4)
    expect(d.rejected?.map((x) => [x.in, x.out, x.note])).toEqual([
      [0.2, 1.4, PER_BEAT_NOTE],
      [2, 3.5, PER_BEAT_NOTE],
      [7.5, 9.5, PER_BEAT_NOTE],
      [10, 12, PER_BEAT_NOTE],
    ])
    // A re-plan proposing them again drops them, and keeps the ones kept.
    for (const z of doc().zoom)
      expect(isRejected('zoom', z, d.rejected)).toBe(
        ['z0', 'z1', 'z3', 'z4'].includes(z.id),
      )
    // Running it again changes nothing.
    const before = JSON.stringify(d)
    oneZoomPerBeat(d, new Map([['', script]]))
    expect(JSON.stringify(d)).toBe(before)
    const line = perBeatLine(r)
    expect(line).toContain('beat "Draw the flow": marked #2 type, kept z2')
    expect(line).toContain('beat "Arrows attach": marked #4 click, kept z5')
    expect(line).toContain('the opening: no step marked "zoom", no zoom')
    expect(line).not.toContain('falling back')
  })

  it('keeps one zoom per marked step, never two that overlap, and says when a mark has none', () => {
    const d = doc({
      zoom: [
        zoom('z1', 2, 3.5),
        zoom('z2', 4, 7),
        // One long proposal under both marked steps of the arrows beat.
        zoom('z4', 10, 15.5),
      ],
    })
    const r = oneZoomPerBeat(
      d,
      new Map([
        ['', marked({ draw: true, label: true, arrows: true, tidy: true })],
      ]),
    )
    expect(d.zoom.map((z) => z.id)).toEqual(['z1', 'z2', 'z4'])
    expect(r.kept.map((k) => [k.action.step, k.id])).toEqual([
      [1, 'z1'],
      [2, 'z2'],
      [3, 'z4'],
    ])
    expect(r.none).toEqual([
      {
        media: '',
        step: 'arrows',
        caption: 'Arrows attach',
        why: 'no-proposal',
        action: { step: 4, do: 'click' },
        ids: [],
      },
    ])
    expect(perBeatLine(r)).toContain(
      'beat "Arrows attach": marked #4 click, but no proposal on it',
    )
  })

  it('falls back to each beat’s last gesture when no step is marked, never a key press, and says so', () => {
    const sceneSteps: StepSpan[] = [
      { step: 0, id: 'scene1', do: 'wait', tStart: 0, tEnd: 1.5 },
      { step: 1, do: 'move', tStart: 1.6, tEnd: 2.6 },
      { step: 2, id: 'box', do: 'drag', tStart: 3, tEnd: 5 },
      { step: 3, do: 'type', tStart: 6, tEnd: 7 },
      { step: 4, do: 'press', tStart: 7.1, tEnd: 7.4 },
      { step: 5, id: 'scene2', do: 'wait', tStart: 12, tEnd: 13 },
      { step: 6, do: 'wait', tStart: 13, tEnd: 20 },
    ]
    const sceneActions = {
      steps: [
        { id: 'scene1', do: 'wait', ms: 1500, caption: 'Draw the flow' },
        { do: 'move', x: 10, y: 10 },
        { id: 'box', do: 'drag', x: 10, y: 10, tx: 90, ty: 60 },
        { do: 'type', text: 'Sign up' },
        { do: 'press', key: 'Escape' },
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
        zoom('zd', 3, 5.2),
        // The typing, then the Escape that closes the beat.
        zoom('zt', 5.5, 7.05),
        zoom('ze', 7.06, 9),
        // The second scene only waits.
        zoom('zw', 13, 15),
      ],
    })
    const beats = mediaBeats('', d.source, sceneActions)
    expect(beats.map((b) => b.lastGesture?.step)).toEqual([3, undefined])
    const r = oneZoomPerBeat(d, new Map([['', sceneActions]]))
    expect(r.fallback).toBe(true)
    expect(d.zoom.map((z) => z.id)).toEqual(['zt'])
    expect(r.none.map((b) => [b.step, b.why, b.ids])).toEqual([
      ['scene2', 'no-gesture', ['zw']],
    ])
    const line = perBeatLine(r)
    expect(line).toContain(
      'no step is marked "zoom": falling back to each beat\'s last gesture',
    )
    expect(line).toContain(
      'beat "Draw the flow": last gesture #3 type, kept zt',
    )
    expect(line).toContain(
      'beat "Wait for it": no gesture to stand in, no zoom',
    )
  })

  it('never zooms on a step marked "zoom": false, per beat and in a plain plan', () => {
    // Per beat, no step marked true: the last gesture skips the false one.
    const d = doc()
    const never = marked({ label: false })
    const r = oneZoomPerBeat(d, new Map([['', never]]))
    expect(r.fallback).toBe(true)
    expect(r.kept.map((k) => [k.step, k.action.step, k.id])).toEqual([
      ['draw', 1, 'z1'],
      ['arrows', 4, 'z5'],
    ])
    // The proposal on the false step says why it went.
    expect(d.rejected?.find((x) => x.in === 4 && x.out === 7)?.note).toBe(
      ZOOM_FALSE_NOTE,
    )
    // So does one in a beat with no mark at all.
    const unmarked = doc()
    oneZoomPerBeat(
      unmarked,
      new Map([['', marked({ label: false, tidy: true })]]),
    )
    expect(
      unmarked.rejected?.find((x) => x.in === 4 && x.out === 7)?.note,
    ).toBe(ZOOM_FALSE_NOTE)
    expect(
      unmarked.rejected?.find((x) => x.in === 2 && x.out === 3.5)?.note,
    ).toBe(PER_BEAT_NOTE)
    // A plain plan: the proposal on the false step is rejected for good,
    // and a true step with nothing proposed on it is said.
    const plain = doc()
    const report = applyZoomMarks(
      plain,
      new Map([['', marked({ label: false, warm: true })]]),
    )
    expect(plain.zoom.map((z) => z.id)).toEqual(['z0', 'z1', 'z3', 'z4', 'z5'])
    expect(plain.rejected).toEqual([
      { id: 'r0', lane: 'zoom', in: 4, out: 7, note: ZOOM_FALSE_NOTE },
    ])
    expect(report.rejected).toEqual([{ media: '', step: 2, ids: ['z2'] }])
    expect(report.unproposed).toEqual([])
    const bare = doc({ zoom: [zoom('z2', 4, 7)] })
    const said = applyZoomMarks(bare, new Map([['', marked({ tidy: true })]]))
    expect(said.unproposed).toEqual([
      { media: '', step: 4, id: 'tidy', do: 'click' },
    ])
    expect(zoomMarkLine(said)).toBe(
      'zoom: true on step #4 tidy click, but the planner proposed no zoom there (none is invented)',
    )
    // A manual zoom on a false step is the person's: never touched.
    const mine = doc()
    mine.zoom[2] = { ...mine.zoom[2], source: 'manual' }
    applyZoomMarks(mine, new Map([['', never]]))
    expect(mine.zoom.some((z) => z.id === 'z2')).toBe(true)
  })

  it('reads a mark from actions.json first, then the recorded step, then the carried script', () => {
    const step: StepSpan = { ...steps[2], zoom: true }
    expect(zoomMarkOf(step, marked({ label: false }), undefined)).toBe(false)
    expect(zoomMarkOf(step, actions, undefined)).toBe(true)
    expect(
      zoomMarkOf(steps[2], null, {
        steps: [{}, {}, { id: 'label', zoom: true }],
      }),
    ).toBe(true)
    expect(zoomMarkOf(steps[2], actions, undefined)).toBeUndefined()
  })

  it('a beat with a manual zoom keeps only its manual ones', () => {
    const d = doc()
    // A manual zoom off the mark still wins its beat.
    d.zoom[1] = { ...d.zoom[1], source: 'manual' }
    const r = oneZoomPerBeat(
      d,
      new Map([['', marked({ label: true, arrows: true })]]),
    )
    expect(r.manual).toEqual([{ media: '', step: 'draw', ids: ['z1'] }])
    expect(d.zoom.map((z) => z.id)).toEqual(['z1', 'z4'])
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
