import { afterEach, describe, expect, it } from 'vitest'
import { lerpArray, mapTime, sample } from '@vosjs/timeline'
import {
  CURSOR_OFF_CODE,
  CURSOR_OFF_FADE,
  cursorOffAlpha,
} from '../lower/cursorOff'
import { lowerToComposition } from '../lower/lowerToComposition'
import { STUDIO_ENTRY_ID } from '../lower/studioEntry'
import {
  DEFAULT_CAM_STYLE,
  DEFAULT_CURSOR_STYLE,
  DEFAULT_FRAME_STYLE,
} from '../types'
import type { CursorOff, CursorStyle, ProjectDoc } from '../types'

/**
 * `cursor.off`: ranges in which the drawn cursor is hidden, in OUTPUT
 * seconds, read at the frame's time. The fades sit outside a range, so
 * every moment inside it is hidden; the ranges ride the cursor style's
 * data, so they are a live edit and a document without them lowers as
 * it did.
 */
const F = CURSOR_OFF_FADE

describe('cursorOffAlpha', () => {
  it('is 1 with no ranges', () => {
    expect(cursorOffAlpha(undefined, 3)).toBe(1)
    expect(cursorOffAlpha([], 3)).toBe(1)
  })

  it('is 0 inside a range and ramps over the fade beside each edge', () => {
    const off = [{ in: 4, out: 6 }]
    expect(cursorOffAlpha(off, 4)).toBe(0)
    expect(cursorOffAlpha(off, 5)).toBe(0)
    expect(cursorOffAlpha(off, 6)).toBe(0)
    expect(cursorOffAlpha(off, 4 - F / 2)).toBeCloseTo(0.5, 6)
    expect(cursorOffAlpha(off, 6 + F / 2)).toBeCloseTo(0.5, 6)
    expect(cursorOffAlpha(off, 4 - F)).toBeCloseTo(1, 6)
    expect(cursorOffAlpha(off, 6 + F)).toBeCloseTo(1, 6)
    expect(cursorOffAlpha(off, 2)).toBe(1)
    expect(cursorOffAlpha(off, 8)).toBe(1)
  })

  it('an absent out hides to the end and never returns', () => {
    const off = [{ in: 4 }]
    expect(cursorOffAlpha(off, 4)).toBe(0)
    expect(cursorOffAlpha(off, 1e6)).toBe(0)
    expect(cursorOffAlpha(off, 4 - F / 2)).toBeCloseTo(0.5, 6)
  })

  it('a range at 0 is hidden from the first frame, with no fade in', () => {
    const off = [{ in: 0, out: 2 }]
    expect(cursorOffAlpha(off, 0)).toBe(0)
    expect(cursorOffAlpha(off, 1)).toBe(0)
    expect(cursorOffAlpha(off, 2 + F / 2)).toBeCloseTo(0.5, 6)
  })

  it('overlapping ranges read as their union', () => {
    const off = [
      { in: 2, out: 5 },
      { in: 4, out: 7 },
    ]
    for (const t of [2, 3, 4.5, 5.5, 7]) expect(cursorOffAlpha(off, t)).toBe(0)
    expect(cursorOffAlpha(off, 8)).toBe(1)
  })

  it('a malformed range hides nothing', () => {
    const bad = [
      { in: 4, out: 3 },
      { in: Number.NaN },
      null,
      { out: 5 },
    ] as unknown as CursorOff[]
    for (const t of [0, 3.5, 4, 5]) expect(cursorOffAlpha(bad, t)).toBe(1)
  })

  it('the page code is the same rule', () => {
    const page = new Function(
      `"use strict"; ${CURSOR_OFF_CODE}; return cxoAlpha`,
    )() as typeof cursorOffAlpha
    const lists = [
      undefined,
      [],
      [{ in: 4, out: 6 }],
      [{ in: 0, out: 2 }],
      [{ in: 4 }],
      [
        { in: 1, out: 2 },
        { in: 1.9, out: 3, from: 'x' },
      ],
      [{ in: 4, out: 3 }, null],
    ] as unknown as CursorOff[][]
    for (const off of lists)
      for (let t = -0.5; t <= 9; t += 0.0375)
        expect(page(off, t)).toBeCloseTo(cursorOffAlpha(off, t), 12)
  })
})

const VIDEO = { width: 1600, height: 900 }
const W = 1920
const H = 1080

function makeDoc(cursor: Partial<CursorStyle>, segIn = 0): ProjectDoc {
  return {
    source: {
      videoKey: 'blob:video',
      cursor: [
        { t: 0, x: 400, y: 300, type: 'move' },
        { t: 5000, x: 800, y: 450, type: 'move' },
        { t: 10000, x: 900, y: 500, type: 'move' },
      ],
      meta: {
        dpr: 1,
        zoom: 1,
        t0: 0,
        durationMs: 10000,
        width: VIDEO.width,
        height: VIDEO.height,
        fps: 30,
      },
    },
    segments: [{ in: segIn, out: 10 }],
    zoom: [],
    audio: [],
    cursor: {
      ...DEFAULT_CURSOR_STYLE,
      hideWhenIdle: false,
      ...cursor,
    },
    cam: DEFAULT_CAM_STYLE,
    frame: DEFAULT_FRAME_STYLE,
    export: { resolution: '1080p', fps: 30, format: 'mp4' },
  }
}

describe('ON_FRAME reads cursor.off at output time', () => {
  const g = globalThis as Record<string, unknown>
  afterEach(() => {
    delete g.window
    delete g.__vosTimeline
  })

  /** The dot's opacity at `time` (0 when it is not drawn), read off its fill. */
  function dotAlpha(doc: ProjectDoc, time: number): number {
    const { config, data } = lowerToComposition(doc)
    const onFrame = new Function(
      `"use strict"; return (${config.onFrame as string})`,
    )() as (ctx: unknown, content: unknown, dt: number) => void
    g.window = { __vos__: { isPaused: true } }
    g.__vosTimeline = { mapTime, sample, lerpArray }
    let clipped = false
    let fill = ''
    const dots: number[] = []
    const c2d = new Proxy(
      {},
      {
        get: (_t, key: string) => {
          if (key === 'measureText') return () => ({ width: 42 })
          if (key === 'createLinearGradient')
            return () => ({ addColorStop: () => {} })
          return () => {
            if (key === 'clip') clipped = true
            if (!clipped || key !== 'arc') return
            const m = /^rgba\(255,255,255,([\d.e-]+)\)$/.exec(fill)
            if (m) dots.push(Number(m[1]) / 0.95)
          }
        },
        set: (_t, key: string, v: unknown) => {
          if (key === 'fillStyle') fill = String(v)
          return true
        },
      },
    )
    const video = {
      videoWidth: VIDEO.width,
      videoHeight: VIDEO.height,
      readyState: 2,
      paused: true,
      currentTime: time,
      duration: 10,
      play: () => undefined,
      pause: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }
    onFrame(
      {
        time,
        data,
        renderer: undefined,
        resolution: {
          width: W,
          height: H,
          drawingBufferWidth: W,
          drawingBufferHeight: H,
        },
      },
      {
        refs: {
          c2d,
          canvas: { width: W, height: H },
          texture: { needsUpdate: false, dispose: () => undefined },
          video,
          cam: null,
        },
      },
      1 / 30,
    )
    expect(dots.length).toBeLessThanOrEqual(1)
    return dots[0] ?? 0
  }

  it('hides the dot inside a range and fades it at the edges', () => {
    const doc = makeDoc({ off: [{ in: 4, out: 6 }] })
    expect(dotAlpha(doc, 3)).toBeCloseTo(1, 6)
    expect(dotAlpha(doc, 4 - F / 2)).toBeCloseTo(0.5, 6)
    expect(dotAlpha(doc, 4)).toBe(0)
    expect(dotAlpha(doc, 5)).toBe(0)
    expect(dotAlpha(doc, 6)).toBe(0)
    expect(dotAlpha(doc, 6 + F / 2)).toBeCloseTo(0.5, 6)
    expect(dotAlpha(doc, 7)).toBeCloseTo(1, 6)
  })

  it('an open range hides it to the end; a range at 0 from the first frame', () => {
    const open = makeDoc({ off: [{ in: 4, from: 'endcard' }] })
    expect(dotAlpha(open, 3)).toBeCloseTo(1, 6)
    expect(dotAlpha(open, 9.9)).toBe(0)
    const start = makeDoc({ off: [{ in: 0, out: 2 }] })
    expect(dotAlpha(start, 0)).toBe(0)
    expect(dotAlpha(start, 1)).toBe(0)
    expect(dotAlpha(start, 3)).toBeCloseTo(1, 6)
  })

  it('is read in OUTPUT seconds, never source', () => {
    // The first 4 s of footage are trimmed: output 1 is source 5. A range
    // over output 0.5..1.5 hides it there, though no source second in it
    // is under the range.
    const doc = makeDoc({ off: [{ in: 0.5, out: 1.5 }] }, 4)
    expect(dotAlpha(doc, 1)).toBe(0)
    expect(dotAlpha(doc, 3)).toBeCloseTo(1, 6)
  })

  it('multiplies into the idle fade, never lifts it', () => {
    const doc = makeDoc({ off: [{ in: 4, out: 6 }] })
    // hidden outright wins too
    expect(
      dotAlpha({ ...doc, cursor: { ...doc.cursor, visible: false } }, 3),
    ).toBe(0)
  })
})

describe('a document without cursor.off', () => {
  it('lowers to the same data, and adding a range is a data edit', () => {
    const plain = makeDoc({})
    const a = lowerToComposition(plain)
    expect('off' in (a.data.cursorStyle as object)).toBe(false)
    // the same document again lowers byte-identically
    expect(JSON.stringify(lowerToComposition(makeDoc({})))).toBe(
      JSON.stringify(a),
    )
    const b = lowerToComposition(makeDoc({ off: [{ in: 1, out: 2 }] }))
    // the program is the same program (the config minus its data); only
    // the cursor style's data moved
    const program = (c: Record<string, unknown>) => {
      const { data: _data, stack, ...rest } = c
      return JSON.stringify({
        ...rest,
        stack: (stack as { data?: unknown }[]).map(
          ({ data: _d, ...entry }) => entry,
        ),
      })
    }
    expect(program(b.config)).toBe(program(a.config))
    const { cursorStyle: ca, ...restA } = a.data
    const { cursorStyle: cb, ...restB } = b.data
    expect(JSON.stringify(restB)).toBe(JSON.stringify(restA))
    expect((cb as CursorStyle).off).toEqual([{ in: 1, out: 2 }])
    expect(ca).toEqual(plain.cursor)
    expect(JSON.stringify(b.stack[STUDIO_ENTRY_ID])).toBe(
      JSON.stringify(a.stack[STUDIO_ENTRY_ID]),
    )
  })
})
