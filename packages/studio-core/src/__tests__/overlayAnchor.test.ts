/**
 * Layers anchored to a recorder step: the lowering starts the clip where
 * its step plays in the cut (through the trims, the speed spans and the
 * media order), fills `{elapsed}` from the step's off-camera wait, falls
 * back to `start` when the step is cut out, and leaves a document without
 * an anchor exactly as it was.
 */
import { describe, expect, it } from 'vitest'
import { lowerToComposition, ratedSegments } from '../lower/lowerToComposition'
import {
  formatElapsed,
  resolveAnchor,
  resolveOverlayAnchors,
  sourceMomentToOutput,
} from '../lower/anchor'
import { docOutputDuration } from '../audioBeds'
import { STUDIO_ENTRY_ID } from '../lower/studioEntry'
import {
  DEFAULT_CAM_STYLE,
  DEFAULT_CURSOR_STYLE,
  DEFAULT_FRAME_STYLE,
} from '../types'
import type {
  Media,
  OverlayAnchor,
  ProjectDoc,
  StepSpan,
  TextOverlayClip,
} from '../types'

const meta = (durationMs: number, steps: StepSpan[]) => ({
  dpr: 1,
  zoom: 1,
  t0: 0,
  durationMs,
  width: 1280,
  height: 720,
  fps: 30,
  steps,
})

const primarySteps: StepSpan[] = [
  { step: 0, do: 'goto', tStart: 0, tEnd: 0.5 },
  { step: 1, id: 'open', do: 'click', tStart: 6, tEnd: 6.4 },
  { step: 2, id: 'gone', do: 'click', tStart: 3, tEnd: 3.2 },
  { step: 3, id: 'save', do: 'click', tStart: 9, tEnd: 9.5 },
]

const second: Media = {
  id: 'm1',
  videoKey: 'second.webm',
  cursor: [],
  meta: {
    ...meta(8000, [
      { step: 0, id: 'share', do: 'click', tStart: 2, tEnd: 2.5 },
      {
        step: 1,
        id: 'later',
        do: 'await',
        tStart: 5,
        tEnd: 5,
        ...{ offCameraMs: 12 * 60_000 },
      } as StepSpan,
    ]),
  },
}

const caption = (
  id: string,
  anchor: OverlayAnchor | undefined,
  text = id,
  start = 0.5,
): TextOverlayClip => ({
  id,
  kind: 'text',
  text,
  preset: 'caption',
  start,
  duration: 1.5,
  transform: { x: 0.5, y: 0.86, scale: 1, rotation: 0 },
  ...(anchor ? { anchor } : {}),
})

function doc(over: Partial<ProjectDoc> = {}): ProjectDoc {
  return {
    source: {
      videoKey: 'recording.webm',
      cursor: [],
      meta: meta(10000, primarySteps),
    },
    // Trim 2..4 out of the primary; then the second media, source 1..7.
    segments: [
      { in: 0, out: 2 },
      { in: 4, out: 10 },
      { in: 1, out: 7, media: 'm1' },
    ],
    media: [second],
    // The primary's 4..6 at 2×: output 2..3 for it.
    speed: [{ id: 's1', in: 4, out: 6, rate: 2 }],
    zoom: [],
    audio: [],
    cursor: DEFAULT_CURSOR_STYLE,
    cam: DEFAULT_CAM_STYLE,
    frame: DEFAULT_FRAME_STYLE,
    export: { resolution: '1080p', fps: 30, format: 'mp4' },
    ...over,
  }
}

const entryOverlays = (d: ProjectDoc) =>
  (
    lowerToComposition(d).stack[STUDIO_ENTRY_ID] as {
      overlays: { id: string; start: number; text?: unknown }[]
    }
  ).overlays

describe('a caption anchored to a step', () => {
  it('starts where the step plays, through a trim and a 2× span', () => {
    // Step `open` at source 6: 0..2 plays 2 s, 4..6 at 2× plays 1 s, so
    // source 6 is output 3.
    const r = resolveAnchor(doc(), { step: 'open' }, ratedSegments(doc()))
    expect(r.start).toBe(3)
    // Its end edge, 6.4, is 0.4 s further at 1×; an offset is OUTPUT time.
    expect(
      resolveAnchor(
        doc(),
        { step: 'open', at: 'end', offset: 0.25 },
        ratedSegments(doc()),
      ).start,
    ).toBe(3.65)
    // By index: step 3 (`save`) at source 9 is output 3 + 3 = 6.
    expect(resolveAnchor(doc(), { step: 3 }, ratedSegments(doc())).start).toBe(
      6,
    )
  })

  it('on a second media, reads that media’s steps and its place in the cut', () => {
    // The primary plays 2 + 1 + 4 = 7 s; the second's source 2 is 1 s in.
    const r = resolveAnchor(
      doc(),
      { step: 'share', media: 'm1' },
      ratedSegments(doc()),
    )
    expect(r.start).toBe(8)
    // The same id on the primary is no step of its own.
    expect(
      resolveAnchor(doc(), { step: 'share' }, ratedSegments(doc())).miss,
    ).toBe('step')
  })

  it('the lowering bakes the resolved start into the layer', () => {
    const lowered = entryOverlays(
      doc({
        overlays: [
          caption('a', { step: 'open' }),
          caption('b', { step: 'share', media: 'm1', offset: 0.2 }),
          caption('plain', undefined, 'plain', 1.25),
        ],
      }),
    )
    expect(lowered.map((o) => [o.id, o.start])).toEqual([
      ['a', 3],
      ['b', 8.2],
      ['plain', 1.25],
    ])
  })

  it('follows a speed change with no edit to the caption', () => {
    const faster = doc({
      speed: [{ id: 's1', in: 4, out: 6, rate: 4 }],
      overlays: [caption('a', { step: 'open' })],
    })
    expect(entryOverlays(faster)[0].start).toBe(2.5)
  })

  it('fills {elapsed} with the step’s off-camera wait', () => {
    const lowered = entryOverlays(
      doc({
        overlays: [
          caption('w', { step: 'later', media: 'm1' }, '{elapsed} later'),
          {
            ...caption('runs', { step: 'later', media: 'm1' }),
            text: [{ text: 'After ' }, { text: '{elapsed}', weight: 700 }],
          },
        ],
      }),
    )
    expect(lowered[0].text).toBe('12 minutes later')
    // A styled run keeps its style around the filled words.
    expect(lowered[1].text).toBe('After 12 minutes')
    expect(JSON.stringify(lowered[1])).toContain('{"t":"12 minutes","f":1}')
  })

  it('reads a wait from meta.skips first, then offCameraMs, never a step’s ms', () => {
    // The recorder's shape: a skip names its step by index and id, says
    // where in the footage the cut is and how long the wait ran.
    const skips = doc()
    const meta = skips.source.meta as unknown as {
      skips: unknown
      steps: Record<string, unknown>[]
    }
    meta.skips = [
      { step: 3, id: 'save', at: 9, ms: 40_000 },
      { step: 1, at: 6, ms: 95_000, timedOut: true },
    ]
    // A copy: the fixture's step list is shared by every document.
    meta.steps = meta.steps.map((st, i) =>
      i === 1 ? { ...st, offCameraMs: 5_000 } : st,
    )
    const rated = ratedSegments(skips)
    expect(resolveAnchor(skips, { step: 'save' }, rated).elapsedMs).toBe(40_000)
    // By index, and the skip wins over the step's own field.
    expect(resolveAnchor(skips, { step: 'open' }, rated).elapsedMs).toBe(95_000)
    // A step's `ms` is its reading time in the script, not a wait.
    const reading = doc()
    reading.source.meta.steps = reading.source.meta.steps!.map((st, i) =>
      i === 3 ? ({ ...st, ms: 700 } as StepSpan) : st,
    )
    expect(
      resolveAnchor(reading, { step: 'save' }, ratedSegments(reading))
        .elapsedMs,
    ).toBeUndefined()
    // No wait recorded: the words are left as written.
    const out = resolveOverlayAnchors(
      doc({ overlays: [caption('x', { step: 'open' }, '{elapsed} on')] }),
      ratedSegments(doc()),
    )
    expect((out.overlays![0] as TextOverlayClip).text).toBe('{elapsed} on')
  })

  it('on the beat after an await, reads the nearest earlier wait on its media', () => {
    const d = doc()
    ;(d.source.meta as unknown as { skips: unknown }).skips = [
      { step: 1, id: 'open', at: 6, ms: 10 * 60_000 },
    ]
    const rated = ratedSegments(d)
    // `save` waited for nothing; the await before it, `open`, did.
    const r = resolveAnchor(d, { step: 'save' }, rated)
    expect(r.elapsedMs).toBe(10 * 60_000)
    expect(r.elapsedFrom?.id).toBe('open')
    // The step before any wait reads none, and a step's own wait is its own.
    expect(resolveAnchor(d, { step: 0 }, rated).elapsedMs).toBeUndefined()
    expect(
      resolveAnchor(d, { step: 'open' }, rated).elapsedFrom,
    ).toBeUndefined()
    // Another media's waits are its own: `share` comes before `later`.
    expect(
      resolveAnchor(d, { step: 'share', media: 'm1' }, rated).elapsedMs,
    ).toBeUndefined()
    const lowered = entryOverlays(
      doc({
        overlays: [caption('landing', { step: 'save' }, '{elapsed} later')],
      }),
    )
    expect(lowered[0].text).toBe('{elapsed} later')
    const withWait = doc({
      overlays: [caption('landing', { step: 'save' }, '{elapsed} later')],
    })
    ;(withWait.source.meta as unknown as { skips: unknown }).skips = [
      { step: 1, ms: 10 * 60_000 },
    ]
    expect(entryOverlays(withWait)[0].text).toBe('10 minutes later')
  })

  it('falls back to start when the step is cut out, or not there', () => {
    const d = doc({
      overlays: [
        caption('cut', { step: 'gone' }, 'cut', 1.75),
        caption('none', { step: 'nope' }, 'none', 2.25),
      ],
    })
    expect(resolveAnchor(d, { step: 'gone' }, ratedSegments(d)).miss).toBe(
      'cut',
    )
    expect(entryOverlays(d).map((o) => o.start)).toEqual([1.75, 2.25])
  })

  it('a caption anchored past the footage lengthens the output like any layer', () => {
    const d = doc({
      overlays: [caption('end', { step: 'save', offset: 6 })],
    })
    // Footage: 2 + 1 + 4 + 6 = 13 s; the caption starts at 12 and runs 1.5.
    expect(docOutputDuration(d)).toBeCloseTo(13.5, 6)
  })

  it('a document without an anchor lowers byte-identically', () => {
    const plain = doc({ overlays: [caption('plain', undefined)] })
    const rated = ratedSegments(plain)
    expect(resolveOverlayAnchors(plain, rated)).toBe(plain)
    const before = JSON.stringify(lowerToComposition(plain))
    expect(JSON.stringify(lowerToComposition(structuredClone(plain)))).toBe(
      before,
    )
  })
})

describe('sourceMomentToOutput', () => {
  it('maps a moment on a closing edge, and none in a trimmed gap', () => {
    const rated = [
      { in: 0, out: 2 },
      { in: 4, out: 6 },
    ]
    expect(sourceMomentToOutput(rated, 2)).toBe(2)
    expect(sourceMomentToOutput(rated, 3)).toBeNull()
    expect(sourceMomentToOutput(rated, 6)).toBe(4)
  })
})

describe('formatElapsed', () => {
  it('rounds to the unit a person says', () => {
    expect(formatElapsed(1_000)).toBe('1 second')
    expect(formatElapsed(38_000)).toBe('40 seconds')
    expect(formatElapsed(59_000)).toBe('1 minute')
    expect(formatElapsed(12 * 60_000 + 20_000)).toBe('12 minutes')
    expect(formatElapsed(2 * 3_600_000)).toBe('2 hours')
    expect(formatElapsed(3 * 86_400_000)).toBe('3 days')
  })
})
