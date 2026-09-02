import { afterEach, describe, expect, it } from 'vitest'
import { lerpArray, mapTime, sample } from '@vosjs/timeline'
import { lowerToComposition } from '../lower/lowerToComposition'
import {
  DEFAULT_CAM_STYLE,
  DEFAULT_CLICK_FX,
  DEFAULT_CURSOR_STYLE,
  DEFAULT_FRAME_STYLE,
} from '../types'
import type { ClickFxStyle, ProjectDoc } from '../types'
import type { Segment } from '@vosjs/timeline'

// Run the compiled ON_FRAME interpreter against stub canvas/video objects —
// the click-effect twin of browserBar.test.ts: catches one-var-scope syntax
// regressions AND asserts the effect drawing (radii, alphas, press scaling)
// at specific output times, since the effect is a pure function of t.
describe('click effects in ON_FRAME', () => {
  const g = globalThis as Record<string, unknown>

  afterEach(() => {
    delete g.window
    delete g.__vosTimeline
  })

  function makeDoc(
    clickFx: ClickFxStyle,
    segments: Segment[] = [{ in: 0, out: 3 }],
  ): ProjectDoc {
    return {
      source: {
        videoKey: 'blob:video',
        cursor: [
          { t: 0, x: 100, y: 100, type: 'move' },
          { t: 500, x: 300, y: 300, type: 'down', button: 0 },
          { t: 800, x: 300, y: 300, type: 'up', button: 0 },
        ],
        meta: {
          dpr: 2,
          zoom: 1,
          t0: 0,
          durationMs: 8000,
          width: 1600,
          height: 900,
          fps: 30,
        },
      },
      segments,
      zoom: [],
      audio: [],
      // Idle fade off: this fixture parks the cursor from 0.8s to the end, so
      // the dot would be faded out at most of the times asserted below. The
      // fade has its own suite (cursorIdle.test.ts) — these cases are about
      // click effects, and the dot is only their baseline arc count.
      cursor: { ...DEFAULT_CURSOR_STYLE, hideWhenIdle: false, clickFx },
      cam: DEFAULT_CAM_STYLE,
      frame: DEFAULT_FRAME_STYLE,
      export: { resolution: '1080p', fps: 30, format: 'mp4' },
    }
  }

  /** Runs one frame; returns recorded c2d calls ('arc:<radius>' carries args). */
  function runFrame(doc: ProjectDoc, time: number): string[] {
    const { config, data } = lowerToComposition(doc)
    const onFrame = new Function(`return (${config.onFrame as string})`)() as (
      ctx: unknown,
      content: unknown,
      dt: number,
    ) => void

    g.window = { __vos__: { isPaused: true } }
    g.__vosTimeline = { mapTime, sample, lerpArray }

    const calls: string[] = []
    const c2d = new Proxy(
      {},
      {
        get: (_t, key: string) => {
          if (key === 'measureText') return () => ({ width: 42 })
          if (key === 'createLinearGradient')
            return () => ({ addColorStop: () => {} })
          if (key === 'createRadialGradient')
            return (..._a: unknown[]) => ({
              addColorStop: (_o: number, col: string) =>
                calls.push('gradStop:' + col),
            })
          return (...args: unknown[]) => {
            if (key === 'arc') calls.push('arc:' + Number(args[2]).toFixed(2))
            else calls.push(key)
          }
        },
        set: (_t, key: string, v: unknown) => {
          if (
            (key === 'fillStyle' ||
              key === 'strokeStyle' ||
              key === 'shadowColor') &&
            typeof v === 'string'
          )
            calls.push(key + ':' + v)
          return true
        },
      },
    )
    const video = {
      videoWidth: 1600,
      videoHeight: 900,
      readyState: 2,
      paused: true,
      currentTime: time,
      duration: 8,
      play: () => undefined,
      pause: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }
    const ctx = {
      time,
      data,
      renderer: undefined,
      resolution: {
        width: 1920,
        height: 1080,
        drawingBufferWidth: 1920,
        drawingBufferHeight: 1080,
      },
    }
    const content = {
      refs: {
        c2d,
        canvas: { width: 1920, height: 1080 },
        texture: { needsUpdate: false, dispose: () => undefined },
        video,
        cam: null,
      },
    }
    onFrame(ctx, content, 1 / 30)
    return calls
  }

  const arcs = (calls: string[]) =>
    calls.filter((k) => k.startsWith('arc:')).map((k) => Number(k.slice(4)))
  const whiteStrokeAlphas = (calls: string[]) =>
    calls
      .filter((k) => k.startsWith('strokeStyle:rgba(255,255,255,'))
      .map((k) => Number(/,([\d.]+)\)$/.exec(k)![1]))

  it('lowers clicks + resolved styling into ctx.data', () => {
    const { data } = lowerToComposition(makeDoc(DEFAULT_CLICK_FX))
    const clicks = data.clicks as Record<string, number>[]
    expect(clicks).toHaveLength(1)
    expect(clicks[0]).toMatchObject({
      ot: 0.5,
      up: 0.8,
      st: 0.5,
      x: 300,
      y: 300,
      b: 0,
    })
    expect(data.clickFx).toEqual({
      style: 'ripple',
      press: true,
      k: 1,
      dur: 1,
      col: 0,
    })
  })

  it('lowers an empty click list when effects are fully off', () => {
    const { data } = lowerToComposition(
      makeDoc({
        style: 'none',
        press: false,
        intensity: 'medium',
        color: 'auto',
      }),
    )
    expect(data.clicks).toEqual([])
  })

  it('draws a ripple that expands and fades over the window', () => {
    const doc = makeDoc({
      style: 'ripple',
      press: false,
      intensity: 'medium',
      color: 'auto',
    })
    const early = runFrame(doc, 0.55) // u ≈ 0.24
    const late = runFrame(doc, 0.8) // u ≈ 0.8
    // auto ripple = dark rim + white ring at the same radius, then the cursor dot
    expect(arcs(early)).toHaveLength(3)
    expect(arcs(late)).toHaveLength(3)
    expect(arcs(late)[0]).toBeGreaterThan(arcs(early)[0]) // ring expands
    expect(whiteStrokeAlphas(late)[0]).toBeLessThan(whiteStrokeAlphas(early)[0]) // and fades
  })

  it('draws nothing outside the effect window', () => {
    const doc = makeDoc({
      style: 'ripple',
      press: false,
      intensity: 'medium',
      color: 'auto',
    })
    expect(arcs(runFrame(doc, 0.3))).toHaveLength(1) // before: cursor dot only
    expect(arcs(runFrame(doc, 2.5))).toHaveLength(1) // long after: cursor dot only
  })

  it('strokes an accent ripple in the resolved color plus a white outline', () => {
    const doc = makeDoc({
      style: 'ripple',
      press: false,
      intensity: 'medium',
      color: '#2563eb',
    })
    const calls = runFrame(doc, 0.55)
    expect(calls.some((k) => k.startsWith('strokeStyle:rgba(37,99,235,'))).toBe(
      true,
    )
    expect(whiteStrokeAlphas(calls).length).toBeGreaterThan(0)
  })

  it('scales intensity: strong draws a bigger ring than subtle', () => {
    const at = (intensity: ClickFxStyle['intensity']) =>
      arcs(
        runFrame(
          makeDoc({ style: 'ripple', press: false, intensity, color: 'auto' }),
          0.7,
        ),
      )[0]
    expect(at('strong')).toBeGreaterThan(at('subtle'))
  })

  it('press dips the cursor while the button is held', () => {
    const held = makeDoc({
      style: 'none',
      press: true,
      intensity: 'medium',
      color: 'auto',
    })
    const off = makeDoc({
      style: 'none',
      press: false,
      intensity: 'medium',
      color: 'auto',
    })
    const t = 0.65 // inside the real 0.5→0.8 press span
    const rHeld = arcs(runFrame(held, t))[0]
    const rOff = arcs(runFrame(off, t))[0]
    expect(rHeld / rOff).toBeCloseTo(0.82, 2)
    // released + rebound settled → back to full size
    expect(arcs(runFrame(held, 1.2))[0]).toBeCloseTo(rOff, 1)
  })

  it('renders the pulse as a colored radial gradient', () => {
    const doc = makeDoc({
      style: 'pulse',
      press: false,
      intensity: 'medium',
      color: '#ff5148',
    })
    const calls = runFrame(doc, 0.55)
    expect(calls.some((k) => k.startsWith('gradStop:rgba(255,81,72,'))).toBe(
      true,
    )
    expect(calls).toContain('fill')
  })

  it('glows the clicked element rect in highlight mode', () => {
    const doc = makeDoc({
      style: 'highlight',
      press: false,
      intensity: 'medium',
      color: '#2563eb',
    })
    doc.source.cursor = [
      {
        t: 500,
        x: 300,
        y: 300,
        type: 'down',
        button: 0,
        rect: { x: 260, y: 280, w: 200, h: 60 },
      },
      { t: 800, x: 300, y: 300, type: 'up', button: 0 },
    ]
    const calls = runFrame(doc, 0.65) // held: glow at full alpha
    expect(calls.some((k) => k.startsWith('strokeStyle:rgba(37,99,235,'))).toBe(
      true,
    )
    expect(calls.some((k) => k.startsWith('shadowColor:rgba(37,99,235,'))).toBe(
      true,
    )
    expect(arcs(calls)).toHaveLength(1) // no ripple arcs — just the cursor dot
    // after release + fade the glow is gone
    const late = runFrame(doc, 1.3)
    expect(late.some((k) => k.startsWith('strokeStyle:rgba(37,99,235,'))).toBe(
      false,
    )
  })

  it('falls back to a ripple for highlight clicks without a usable rect', () => {
    const doc = makeDoc({
      style: 'highlight',
      press: false,
      intensity: 'medium',
      color: 'auto',
    })
    // makeDoc's click has no rect → lowering attaches none → ripple fallback
    const calls = runFrame(doc, 0.55)
    expect(arcs(calls)).toHaveLength(3) // rim + ring + cursor dot
  })

  it('suppresses an effect bleeding across a cut (source-proximity guard)', () => {
    // click at source 0.95s; footage cuts to source 5s at output 1s. At output
    // 1.2 the ripple window is still open but srcT ≈ 5.2 — unrelated footage.
    const doc = makeDoc(
      { style: 'ripple', press: false, intensity: 'medium', color: 'auto' },
      [
        { in: 0, out: 1 },
        { in: 5, out: 8 },
      ],
    )
    doc.source.cursor = [
      { t: 950, x: 300, y: 300, type: 'down', button: 0 },
      { t: 1000, x: 300, y: 300, type: 'up', button: 0 },
    ]
    expect(arcs(runFrame(doc, 0.97)).length).toBeGreaterThan(1) // active before the cut
    expect(arcs(runFrame(doc, 1.2))).toHaveLength(1) // suppressed after it
  })

  it('hides the dot when cursor.visible is false, keeping the ripple', () => {
    const fx: ClickFxStyle = {
      style: 'ripple',
      press: false,
      intensity: 'medium',
      color: 'auto',
    }
    const shown = makeDoc(fx)
    const hidden = makeDoc(fx)
    hidden.cursor.visible = false
    // rim + ring + dot → rim + ring
    expect(arcs(runFrame(shown, 0.55))).toHaveLength(3)
    expect(arcs(runFrame(hidden, 0.55))).toHaveLength(2)
    // and no dot at a quiet moment either
    expect(arcs(runFrame(shown, 0.3))).toHaveLength(1)
    expect(arcs(runFrame(hidden, 0.3))).toHaveLength(0)
  })

  it('fades the dot out through a dwell when hideWhenIdle is on', () => {
    // The fixture's cursor parks at 0.8s and the take runs to 8s, so the fade
    // starts at 1.8s and is complete by 2.15s. Proves the baked curve actually
    // reaches the canvas — cursorIdle.test.ts owns the curve's shape.
    const doc = makeDoc({
      style: 'none',
      press: false,
      intensity: 'medium',
      color: 'auto',
    })
    doc.cursor.hideWhenIdle = true
    expect(arcs(runFrame(doc, 0.3))).toHaveLength(1) // inside the hold
    expect(arcs(runFrame(doc, 2.5))).toHaveLength(0) // deep in the dwell
    // Mid-ramp the dot is still drawn, at a reduced alpha.
    const mid = runFrame(doc, 1.95)
    expect(arcs(mid)).toHaveLength(1)
    const a = Number(
      /rgba\(255,255,255,([\d.]+)\)/.exec(
        mid.find((k) => k.startsWith('fillStyle:rgba(255,255,255,'))!,
      )![1],
    )
    expect(a).toBeGreaterThan(0)
    expect(a).toBeLessThan(0.95)
  })

  it('draws the dot for pre-toggle docs carrying no visible flag', () => {
    const doc = makeDoc({
      style: 'none',
      press: false,
      intensity: 'medium',
      color: 'auto',
    })
    delete (doc.cursor as Partial<typeof doc.cursor>).visible
    expect(arcs(runFrame(doc, 0.3))).toHaveLength(1)
  })
})
