import { describe, expect, it } from 'vitest'
import {
  buildStepMap,
  resolveAnchor,
  retimeCut,
  retimeOverlays,
  stepUnder,
} from '../reuse'
import type { OverlayClip, ProjectDoc, StepSpan } from '@vosjs/studio-core'

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

  it('finds an unnamed step by its place beside the nearest named one', () => {
    // A check was added after `open`, so every unnamed step after it moved
    // one index on; `move` and `hover` keep their place beside `zoom`.
    const oldS = steps([
      { id: 'open', do: 'wait', tStart: 0, tEnd: 1.5 },
      { do: 'move', tStart: 1.6, tEnd: 2.6 },
      { id: 'zoom', do: 'press', tStart: 3, tEnd: 5 },
      { do: 'hover', tStart: 5.5, tEnd: 7 },
    ])
    const newS = steps([
      { id: 'open', do: 'wait', tStart: 0, tEnd: 1.5 },
      { id: 'count', do: 'expect', tStart: 1.6, tEnd: 1.6 },
      { do: 'move', tStart: 1.7, tEnd: 2.4 },
      { id: 'zoom', do: 'press', tStart: 2.8, tEnd: 4.8 },
      { do: 'hover', tStart: 5.2, tEnd: 6.6 },
    ])
    const m = buildStepMap(oldS, newS, 8, 8)
    expect(m.unmatched).toEqual([])
    expect(m.matched).toBe(4)
    expect(m.map(1.6)).toBeCloseTo(1.7, 5)
    expect(m.map(5.5)).toBeCloseTo(5.2, 5)
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
    // 5.8 sits in the 3..6 stretch, between steps (#a ended at 3, more
    // than a second before; #b starts at 6), so it goes through the map:
    // 3..6 maps to 3..8 and the piecewise lerp puts it at 7.667.
    expect(cut.zoom[0].in).toBeCloseTo(7.667, 2)
    expect(cut.zoom[0].out - cut.zoom[0].in).toBeCloseTo(1.4, 5) // length kept
    expect(cut.report.mapped).toBe(1)
  })

  it('re-times rejected proposals like manual spans, one lane at a time', () => {
    const cut = retimeCut(
      doc({
        rejected: [
          { id: 'r0', lane: 'zoom', in: 5.8, out: 7.2 },
          // Two lanes may reject the same seconds; neither trims the other.
          { id: 'r1', lane: 'speed', in: 5.8, out: 7.2 },
          {
            id: 'r2',
            lane: 'zoom',
            in: 2.1,
            out: 3.1,
            anchor: { step: 0, offset: 0.1 },
          },
        ],
      }),
      newSteps,
      12000,
    )
    expect(cut.rejected.map((r) => r.id).sort()).toEqual(['r0', 'r1', 'r2'])
    const byId = Object.fromEntries(cut.rejected.map((r) => [r.id, r]))
    expect(byId.r0.in).toBeCloseTo(7.667, 2)
    expect(byId.r0.out - byId.r0.in).toBeCloseTo(1.4, 5)
    expect(byId.r1.in).toBeCloseTo(7.667, 2)
    expect(byId.r2.in).toBeCloseTo(2.1, 5) // the anchor carried it exactly
    expect(cut.report.anchored).toBe(1)
    expect(cut.report.mapped).toBe(2)
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
    // A span whose step is gone is dropped and named with what it framed,
    // never re-timed to a place with nothing under it.
    expect(missing.zoom).toHaveLength(0)
    expect(missing.report.flagged[0]).toMatch(/dropped; re-aim/)
    expect(missing.report.flagged[0]).toMatch(/0\.50, 0\.50 at 2\.0×/)
  })

  it('re-times a freeze moment (a legacy hold too) onto the new take', () => {
    const cut = retimeCut(
      doc({
        segments: [{ in: 0, out: 9.8, hold: 2 }],
        freeze: [
          { id: 'f0', at: 6.5, seconds: 1.5 },
          { id: 'f1', at: 3, seconds: 1, anchor: { step: 1, at: 'end' } },
        ],
      }),
      newSteps,
      12000,
    )
    // #b moved from 6..7 to 8..9: the map carries 6.5 → 8.5, the anchor
    // puts f1 at #b's end (9), the legacy hold at 9.8 maps inside 12 s.
    expect(cut.freeze).toEqual([
      { id: 'f0', at: 8.5, seconds: 1.5 },
      { id: 'f1', at: 9, seconds: 1, anchor: { step: 1, at: 'end' } },
      { id: 'h0', at: expect.any(Number), seconds: 2 },
    ])
    expect(cut.freeze[2].at).toBeGreaterThan(9)
    // The step map clamps to the new recording, so a freeze past the old
    // tail lands on the new one rather than vanishing.
    const late = retimeCut(
      doc({ freeze: [{ id: 'f0', at: 9.9, seconds: 1 }] }),
      newSteps,
      6000,
    )
    expect(late.freeze).toEqual([{ id: 'f0', at: 6, seconds: 1 }])
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

describe('re-record parity: a span follows the step it was made on', () => {
  const steps3 = (rows: Partial<StepSpan>[]): StepSpan[] =>
    rows.map((r, i) => ({
      step: r.step ?? i,
      do: r.do ?? 'click',
      tStart: r.tStart ?? i,
      tEnd: r.tEnd ?? i + 0.5,
      ...(r.id ? { id: r.id } : {}),
      ...(r.selector ? { selector: r.selector } : {}),
      ...(r.skipped ? { skipped: true } : {}),
    }))
  const base = (over: Partial<ProjectDoc>, oldSteps: StepSpan[]): ProjectDoc =>
    ({
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
          steps: oldSteps,
        },
      },
      segments: [{ in: 0, out: 20 }],
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
  // The product grew a panel: the drag runs 1.5 s longer and everything
  // after it lands 6 s later, the shape a real re-record showed.
  const oldS = steps3([
    { id: 'open', do: 'click', selector: '#open', tStart: 1, tEnd: 1.5 },
    { id: 'drag', do: 'drag', selector: '#speed', tStart: 3, tEnd: 5 },
    { step: 2, do: 'wait', tStart: 5, tEnd: 6 },
    { id: 'copy', do: 'click', selector: '#copy', tStart: 10, tEnd: 10.5 },
  ])
  const newS = steps3([
    { id: 'open', do: 'click', selector: '#open', tStart: 1, tEnd: 1.5 },
    { id: 'drag', do: 'drag', selector: '#speed', tStart: 3, tEnd: 6.5 },
    { step: 2, do: 'wait', tStart: 6.5, tEnd: 7.5 },
    { id: 'copy', do: 'click', selector: '#copy', tStart: 16, tEnd: 16.5 },
  ])

  it('finds the step under a moment: its window, or the gesture that just ended', () => {
    expect(stepUnder(3.4, oldS)?.id).toBe('drag') // inside the window
    expect(stepUnder(5.6, oldS)?.id).toBe('drag') // 0.6 s after it ended
    expect(stepUnder(7, oldS)).toBeNull() // between steps
    expect(stepUnder(10.2, oldS)?.id).toBe('copy')
  })

  it("keeps a manual span's offset from its step exactly, without an anchor", () => {
    const cut = retimeCut(
      base(
        {
          zoom: [
            {
              id: 'z-drag',
              in: 3.4,
              out: 5.2,
              level: 2,
              cx: 0.2,
              cy: 0.5,
              source: 'manual',
            },
            {
              id: 'z-copy',
              in: 10.2,
              out: 11,
              level: 2.5,
              cx: 0.8,
              cy: 0.3,
              source: 'manual',
            },
          ],
          speed: [{ id: 's-gap', in: 7, out: 9, rate: 3, source: 'manual' }],
        },
        oldS,
      ),
      newS,
      26000,
    )
    // The drag's span keeps its 0.4 s offset; the copy's its 0.2 s.
    expect(cut.zoom.map((z) => [z.id, z.in])).toEqual([
      ['z-drag', 3.4],
      ['z-copy', 16.2],
    ])
    expect(cut.zoom[0].out - cut.zoom[0].in).toBeCloseTo(1.8, 5)
    // The gap span sat between steps and went through the map.
    expect(cut.speed[0].in).toBeGreaterThan(9)
    expect(cut.report.anchored).toBe(2)
    expect(cut.report.mapped).toBe(1)
  })

  it('drops a span whose step is gone and names what it framed', () => {
    const gone = newS.filter((s) => s.id !== 'drag')
    const cut = retimeCut(
      base(
        {
          zoom: [
            {
              id: 'z-drag',
              in: 3.4,
              out: 5.2,
              level: 2,
              cx: 0.2,
              cy: 0.5,
              source: 'manual',
            },
          ],
          speed: [{ id: 's-drag', in: 3, out: 5, rate: 2, source: 'manual' }],
          freeze: [{ id: 'f-drag', at: 4, seconds: 1.5 }],
        },
        oldS,
      ),
      gone,
      26000,
    )
    expect(cut.zoom).toHaveLength(0)
    expect(cut.speed).toHaveLength(0)
    expect(cut.freeze).toHaveLength(0)
    const words = cut.report.flagged.join('\n')
    expect(words).toMatch(
      /zoom z-drag: it sat on step drag \(drag #speed\), which is missing/,
    )
    expect(words).toMatch(/0\.20, 0\.50 at 2\.0×/)
    expect(words).toMatch(/speed s-drag: .*\(2× speed\)/)
    expect(words).toMatch(/freeze f-drag: .*a 1\.5 s hold/)
  })

  it('never trims rejected proposals against each other', () => {
    const cut = retimeCut(
      base(
        {
          rejected: [
            { id: 'g0', lane: 'zoom', in: 3.2, out: 4.8 },
            { id: 'g1', lane: 'zoom', in: 3, out: 12 },
            { id: 'g2', lane: 'zoom', in: 10.1, out: 11 },
          ],
        },
        oldS,
      ),
      newS,
      26000,
    )
    expect(cut.rejected.map((r) => r.id).sort()).toEqual(['g0', 'g1', 'g2'])
    expect(cut.report.flagged.some((f) => f.includes('overlapped'))).toBe(false)
  })

  it('a layer after the footage (an end card) keeps its distance from the end when the footage grows or shrinks', () => {
    const card = (id: string, start: number, from?: string): OverlayClip => ({
      id,
      kind: 'text',
      preset: 'title',
      start,
      duration: 2,
      text: id,
      transform: { x: 0.5, y: 0.5, scale: 1, rotation: 0 },
      ...(from ? { from } : {}),
    })
    const prev = base(
      {
        freeze: [{ id: 'f0', at: 20, seconds: 2.5, from: 'endcard' }],
        overlays: [
          card('in-footage', 0.3),
          card('endcard-title', 20.35, 'endcard'),
          card('closing-line', 21),
        ],
      },
      oldS,
    )
    for (const [ms, end] of [
      [26000, 26],
      [17000, 17],
    ] as const) {
      const next = base(
        {
          source: {
            ...prev.source,
            meta: { ...prev.source.meta, durationMs: ms, steps: newS },
          },
          segments: [{ in: 0, out: end }],
          freeze: [{ id: 'f0', at: end, seconds: 2.5, from: 'endcard' }],
        },
        newS,
      )
      const report = { anchored: 0, mapped: 0, flagged: [] as string[] }
      const out = retimeOverlays(prev, next, report)
      const at = (id: string) => out.find((o) => o.id === id)?.start
      expect(at('in-footage')).toBe(0.3)
      expect(at('endcard-title')).toBeCloseTo(end + 0.35, 3)
      expect(at('closing-line')).toBeCloseTo(end + 1, 3)
      expect(report.flagged).toEqual([])
    }
  })

  it("a pinned layer follows its step's new output time; an unpinned one over a moved step is named", () => {
    const prev = base(
      {
        speed: [{ id: 'sp', in: 6, out: 10, rate: 4, source: 'manual' }],
        overlays: [
          {
            id: 'title',
            kind: 'text',
            preset: 'caption',
            start: 0.3,
            duration: 2,
            text: 'Hello',
            transform: { x: 0.5, y: 0.2, scale: 1, rotation: 0 },
          },
          {
            id: 'c-copy',
            kind: 'text',
            preset: 'caption',
            start: 7.5,
            duration: 3,
            text: 'Copy it',
            transform: { x: 0.5, y: 0.8, scale: 1, rotation: 0 },
            pin: { step: 'copy' },
          },
          {
            id: 'c-late',
            kind: 'text',
            preset: 'caption',
            start: 8.9,
            duration: 3,
            text: 'A beat after the press',
            transform: { x: 0.5, y: 0.9, scale: 1, rotation: 0 },
          },
          {
            id: 'c-loose',
            kind: 'text',
            preset: 'caption',
            start: 7.6,
            duration: 3,
            text: 'Also copy',
            transform: { x: 0.5, y: 0.9, scale: 1, rotation: 0 },
          },
        ],
      },
      oldS,
    )
    // The new cut, with its rate final: the same 4× span re-timed onto the
    // new drag's tail.
    const next = base(
      {
        source: {
          ...prev.source,
          meta: { ...prev.source.meta, durationMs: 26000, steps: newS },
        },
        segments: [{ in: 0, out: 26 }],
        speed: [{ id: 'sp', in: 7.5, out: 11.5, rate: 4, source: 'manual' }],
      },
      newS,
    )
    const report = { anchored: 0, mapped: 0, flagged: [] as string[] }
    const out = retimeOverlays(prev, next, report)
    // Old cut: copy's press at source 10 is output 6 + (10 - 6) / 4 = 7;
    // the callout sat 0.5 s after it. New cut: the press at source 16 is
    // output 7.5 + 1 + (16 - 11.5) = 13; the callout follows to 13.5.
    expect(out.find((o) => o.id === 'c-copy')?.start).toBeCloseTo(13.5, 3)
    expect(out.find((o) => o.id === 'title')?.start).toBe(0.3)
    // The loose callout keeps its second and is named with the step's new time.
    expect(out.find((o) => o.id === 'c-loose')?.start).toBe(7.6)
    const flag = report.flagged.find((f) => f.startsWith('overlay c-loose'))
    expect(flag).toMatch(/now plays at 13\.60s/)
    expect(flag).toMatch(/pin: \{ step: "copy" \}/)
    // A callout 1.9 s after the press is still about it.
    expect(out.find((o) => o.id === 'c-late')?.start).toBe(8.9)
    expect(report.flagged.find((f) => f.startsWith('overlay c-late'))).toMatch(
      /now plays at 14\.90s/,
    )
    expect(report.anchored).toBe(1)
  })
})
