import { describe, expect, it } from 'vitest'
import { buildStepMap, resolveAnchor, retimeCut } from '../reuse'
import type { ProjectDoc, StepSpan } from '@vosjs/studio-core'

/**
 * The reuse claim, tested at the pure layer: a cut made on one recording
 * re-times onto a NEW recording of the same script, and everything that
 * cannot follow is NAMED. The two-commit browser walk is smoke-recut.ts;
 * these fixtures pin the arithmetic.
 */

const steps = (rows: Partial<StepSpan>[]): StepSpan[] =>
  rows.map((r, i) => ({
    step: r.step ?? i,
    do: r.do ?? 'click',
    tStart: r.tStart ?? i,
    tEnd: r.tEnd ?? i + 0.5,
    ...(r.id ? { id: r.id } : {}),
    ...(r.selector ? { selector: r.selector } : {}),
    ...(r.skipped ? { skipped: true } : {}),
  }))

describe('buildStepMap', () => {
  it('maps matched step edges exactly and interpolates between them', () => {
    const oldS = steps([
      { do: 'click', selector: '#a', tStart: 1, tEnd: 2 },
      { step: 1, do: 'click', selector: '#b', tStart: 4, tEnd: 5 },
    ])
    // The same script ran slower: #b landed 3s later.
    const newS = steps([
      { do: 'click', selector: '#a', tStart: 1, tEnd: 2 },
      { step: 1, do: 'click', selector: '#b', tStart: 7, tEnd: 8 },
    ])
    const m = buildStepMap(oldS, newS, 6, 9)
    expect(m.matched).toBe(2)
    expect(m.map(1)).toBeCloseTo(1, 5) // matched edge, exact
    expect(m.map(4)).toBeCloseTo(7, 5)
    expect(m.map(3)).toBeCloseTo(4.5, 5) // halfway 2..4 → halfway 2..7
    expect(m.map(5.5)).toBeCloseTo(8.5, 5) // tail interpolates to duration
  })

  it('matches by id when indexes moved, and reports vanished steps', () => {
    const oldS = steps([
      { id: 'cta', do: 'click', selector: '#go', tStart: 2, tEnd: 3 },
      { step: 1, do: 'click', selector: '#gone', tStart: 5, tEnd: 6 },
    ])
    // cta moved to index 2 (a wait was inserted); #gone left the UI.
    const newS = steps([
      { do: 'wait', tStart: 0, tEnd: 1 },
      { step: 1, do: 'wait', tStart: 1, tEnd: 2 },
      { step: 2, id: 'cta', do: 'click', selector: '#go', tStart: 6, tEnd: 7 },
    ])
    const m = buildStepMap(oldS, newS, 8, 10)
    expect(m.matched).toBe(1)
    expect(m.unmatched.map((s) => s.selector)).toEqual(['#gone'])
    expect(m.map(2)).toBeCloseTo(6, 5) // the id carried the anchor
  })

  it('a skipped step in the new take is no match', () => {
    const oldS = steps([{ do: 'click', selector: '#x', tStart: 1, tEnd: 2 }])
    const newS = steps([
      { do: 'click', selector: '#x', tStart: 1, tEnd: 1.01, skipped: true },
    ])
    const m = buildStepMap(oldS, newS, 4, 4)
    expect(m.matched).toBe(0)
    expect(m.unmatched).toHaveLength(1)
  })
})

describe('resolveAnchor', () => {
  const newS = steps([
    { id: 'cta', do: 'click', selector: '#go', tStart: 6, tEnd: 7 },
  ])
  it('resolves id and index refs against either edge with offset', () => {
    expect(resolveAnchor({ step: 'cta' }, newS)).toBeCloseTo(6)
    expect(
      resolveAnchor({ step: 0, at: 'end', offset: 0.4 }, newS),
    ).toBeCloseTo(7.4)
    expect(resolveAnchor({ step: 'nope' }, newS)).toBeNull()
  })
})

describe('retimeCut', () => {
  const doc = (over: Partial<ProjectDoc>): ProjectDoc =>
    ({
      source: {
        videoKey: 'recording.webm',
        cursor: [],
        meta: {
          dpr: 1,
          zoom: 1,
          t0: 0,
          durationMs: 10000,
          width: 1280,
          height: 720,
          fps: 30,
          steps: steps([
            { do: 'click', selector: '#a', tStart: 2, tEnd: 3 },
            { step: 1, do: 'click', selector: '#b', tStart: 6, tEnd: 7 },
          ]),
        },
      },
      segments: [{ in: 0, out: 10 }],
      zoom: [],
      audio: [],
      cursor: { smoothing: 0.5, size: 1 },
      cam: {},
      frame: {
        background: '#111',
        padding: 0,
        radius: 0,
        shadow: 0,
        border: 0,
        aspectRatio: 'auto',
        browserBar: { kind: 'none' },
      },
      export: { resolution: '720p', fps: 30, format: 'mp4' },
      ...over,
    }) as unknown as ProjectDoc

  // The same script, re-recorded: #a runs at the same time, #b lands 2s later.
  const newSteps = steps([
    { do: 'click', selector: '#a', tStart: 2, tEnd: 3 },
    { step: 1, do: 'click', selector: '#b', tStart: 8, tEnd: 9 },
  ])

  it('re-times manual camera spans onto the moved step; autos drop for re-planning', () => {
    const cut = retimeCut(
      doc({
        zoom: [
          {
            id: 'u1',
            in: 5.8,
            out: 7.2,
            level: 2,
            cx: 0.5,
            cy: 0.5,
            source: 'manual',
          },
          {
            id: 'z0',
            in: 2,
            out: 3,
            level: 1.8,
            cx: 0.5,
            cy: 0.5,
            source: 'auto',
          },
        ],
      }),
      newSteps,
      12000,
    )
    expect(cut.zoom.map((z) => z.id)).toEqual(['u1'])
    // 5.8 sits in the 3..6 stretch, which maps to 3..8 — piecewise lerp
    // puts it at 7.667. (An explicit anchor would preserve the 0.2s offset
    // to #b exactly; the map interpolates — that difference is why anchors
    // exist.)
    expect(cut.zoom[0].in).toBeCloseTo(7.667, 2)
    expect(cut.zoom[0].out - cut.zoom[0].in).toBeCloseTo(1.4, 5) // length kept
    expect(cut.report.mapped).toBe(1)
  })

  it('an explicit anchor wins over the map and reports when its step vanished', () => {
    const anchored = retimeCut(
      doc({
        zoom: [
          {
            id: 'u2',
            in: 2.1,
            out: 3.1,
            level: 2,
            cx: 0.5,
            cy: 0.5,
            source: 'manual',
            anchor: { step: 0, offset: 0.1 },
          },
        ],
      }),
      newSteps,
      12000,
    )
    expect(anchored.zoom[0].in).toBeCloseTo(2.1, 5)
    expect(anchored.report.anchored).toBe(1)

    const missing = retimeCut(
      doc({
        zoom: [
          {
            id: 'u3',
            in: 2.1,
            out: 3.1,
            level: 2,
            cx: 0.5,
            cy: 0.5,
            source: 'manual',
            anchor: { step: 'vanished' },
          },
        ],
      }),
      newSteps,
      12000,
    )
    expect(missing.report.flagged.some((f) => f.includes('u3'))).toBe(true)
    expect(missing.zoom).toHaveLength(1) // fell back to the map, not dropped
  })

  it('an untrimmed take stays untrimmed at the new length; trims re-time', () => {
    const untrimmed = retimeCut(doc({}), newSteps, 12000)
    expect(untrimmed.segments).toEqual([{ in: 0, out: 12 }])

    const trimmed = retimeCut(
      doc({ segments: [{ in: 5.5, out: 10 }] }),
      newSteps,
      12000,
    )
    // 5.5 (0.5 before old #b) follows the shift toward 8.
    expect(trimmed.segments[0].in).toBeGreaterThan(6.5)
    expect(trimmed.segments[0].out).toBeCloseTo(12, 5)
  })

  it('names a span that lands outside the new recording and drops it', () => {
    const cut = retimeCut(
      doc({
        zoom: [
          {
            id: 'u9',
            in: 9.8,
            out: 10,
            level: 2,
            cx: 0.5,
            cy: 0.5,
            source: 'manual',
          },
        ],
      }),
      newSteps,
      2000, // the new take is 2s — the tail span cannot exist
    )
    expect(cut.zoom).toHaveLength(0)
    expect(cut.report.flagged.some((f) => f.includes('u9'))).toBe(true)
  })
})
