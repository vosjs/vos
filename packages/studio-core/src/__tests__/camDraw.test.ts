import { afterEach, describe, expect, it } from 'vitest'
import { lerpArray, mapTime, rateAt, sample } from '@vosjs/timeline'
import {
  camBubbleRectAt,
  lowerToComposition,
} from '../lower/lowerToComposition'
import { camBubbleRect } from '../layout'
import {
  DEFAULT_CAM_STYLE,
  DEFAULT_CURSOR_STYLE,
  DEFAULT_FRAME_STYLE,
} from '../types'
import type { CamStyle, ProjectDoc } from '../types'

// Scrub-flicker regression: a seek in flight drops a video's readyState to
// HAVE_METADATA (1) until the new frame decodes. The cam bubble must NOT be
// gated on per-frame readiness (that blanks it on every scrub step) — it waits
// for the FIRST decoded frame, then keeps drawing the retained frame.
function makeCamDoc(): ProjectDoc {
  return {
    source: {
      videoKey: 'blob:v',
      cursor: [],
      meta: {
        dpr: 1,
        zoom: 1,
        t0: 0,
        durationMs: 5000,
        width: 1600,
        height: 900,
        fps: 30,
      },
      camKey: 'blob:cam',
    },
    segments: [{ in: 0, out: 5 }],
    zoom: [],
    audio: [],
    cursor: DEFAULT_CURSOR_STYLE,
    cam: DEFAULT_CAM_STYLE,
    frame: DEFAULT_FRAME_STYLE,
    export: { resolution: '1080p', fps: 30, format: 'mp4' },
  }
}

function makeVideoStub(readyState: number) {
  return {
    paused: true,
    currentTime: 0,
    duration: 5,
    readyState,
    videoWidth: 640,
    videoHeight: 360,
    volume: 1,
    play: () => undefined,
    pause: () => undefined,
  }
}

describe('cam bubble draw gating', () => {
  const g = globalThis as Record<string, unknown>

  afterEach(() => {
    delete g.window
    delete g.__vosTimeline
  })

  function frameRunner() {
    const { config, data } = lowerToComposition(makeCamDoc())
    const onFrame = new Function(`return (${config.onFrame as string})`)() as (
      ctx: unknown,
      content: unknown,
      dt: number,
    ) => void

    g.window = { __vos__: { isPaused: true } }
    g.__vosTimeline = { mapTime, rateAt, sample, lerpArray }

    const video = makeVideoStub(2)
    const cam = makeVideoStub(2)
    const refs = {
      c2d: null as unknown,
      canvas: { width: 1920, height: 1080 },
      texture: { needsUpdate: false, dispose: () => undefined },
      video,
      cam,
    }
    const ctx = {
      time: 1,
      data,
      renderer: undefined,
      resolution: {
        width: 1920,
        height: 1080,
        drawingBufferWidth: 1920,
        drawingBufferHeight: 1080,
      },
    }
    const run = () => {
      const calls: string[] = []
      refs.c2d = new Proxy(
        {},
        {
          get: (_t, key: string) => {
            if (key === 'measureText') return () => ({ width: 42 })
            if (key === 'createLinearGradient')
              return () => ({ addColorStop: () => {} })
            return () => {
              calls.push(key)
            }
          },
          set: () => true,
        },
      )
      onFrame(ctx, { refs }, 1 / 30)
      // Screen video always draws once; the cam bubble is the second drawImage.
      return calls.filter((k) => k === 'drawImage').length
    }
    return { run, cam }
  }

  it('keeps drawing the bubble while a scrub seek is in flight', () => {
    const { run, cam } = frameRunner()
    expect(run()).toBe(2) // ready: screen + cam

    cam.readyState = 1 // mid-seek (scrub step)
    expect(run()).toBe(2) // sticky: retained frame still drawn — no flicker
  })

  it('waits for the first decoded frame before showing the bubble', () => {
    const { run, cam } = frameRunner()
    cam.readyState = 0 // never had data yet
    expect(run()).toBe(1) // screen only — no empty black bubble
    cam.readyState = 2
    expect(run()).toBe(2)
  })
})

describe('camBubbleRect mirrors the painted geometry', () => {
  const g = globalThis as Record<string, unknown>

  afterEach(() => {
    delete g.window
    delete g.__vosTimeline
  })

  /**
   * Runs ON_FRAME with an args-recording c2d and recovers the bubble square
   * from the cam drawImage call: sh === diam (cover-fit scales by height for a
   * landscape cam), sy === by, and bx = sx - (diam - sw) / 2. This pins the
   * host oracle to the PAINTED pixels — if the ON_FRAME constants (24·s
   * margin, 40px floor, 18·s rounded radius) move, this fails.
   */
  function paintedBubble(
    camStyle: Partial<CamStyle>,
    mutate?: (doc: ProjectDoc) => void,
    time = 1,
  ) {
    const doc = makeCamDoc()
    doc.cam = { ...doc.cam, ...camStyle }
    mutate?.(doc)
    const { config, data } = lowerToComposition(doc)
    const onFrame = new Function(`return (${config.onFrame as string})`)() as (
      ctx: unknown,
      content: unknown,
      dt: number,
    ) => void
    g.window = { __vos__: { isPaused: true } }
    g.__vosTimeline = { mapTime, rateAt, sample, lerpArray }
    const camVideo = makeVideoStub(2)
    const draws: number[][] = []
    const c2d = new Proxy(
      {},
      {
        get: (_t, key: string) => {
          if (key === 'measureText') return () => ({ width: 42 })
          if (key === 'createLinearGradient')
            return () => ({ addColorStop: () => {} })
          if (key === 'drawImage')
            return (...args: unknown[]) => {
              draws.push(args.slice(1) as number[])
            }
          return () => undefined
        },
        set: () => true,
      },
    )
    const refs = {
      c2d,
      canvas: { width: 1920, height: 1080 },
      texture: { needsUpdate: false, dispose: () => undefined },
      video: makeVideoStub(2),
      cam: camVideo,
    }
    onFrame(
      {
        time,
        data,
        renderer: undefined,
        resolution: {
          width: 1920,
          height: 1080,
          drawingBufferWidth: 1920,
          drawingBufferHeight: 1080,
        },
      },
      { refs },
      1 / 30,
    )
    // draws[0] is the screen video; draws[1] is the cam (sx, sy, sw, sh).
    const [sx, sy, sw, sh] = draws[1]
    const diam = sh // landscape cam: cover-fit height === bubble size
    return { x: sx - (diam - sw) / 2, y: sy, size: diam }
  }

  it.each(['bottom-left', 'bottom-right', 'top-left', 'top-right'] as const)(
    'matches ON_FRAME at %s',
    (position) => {
      const painted = paintedBubble({ position, size: 0.3 })
      const rect = camBubbleRect(
        { ...DEFAULT_CAM_STYLE, position, size: 0.3 },
        1920,
        1080,
      )
      expect(painted.x).toBeCloseTo(rect.x, 6)
      expect(painted.y).toBeCloseTo(rect.y, 6)
      expect(painted.size).toBeCloseTo(rect.size, 6)
    },
  )

  it('free placement (x/y center fractions) wins over the corner', () => {
    const painted = paintedBubble({ x: 0.62, y: 0.31, size: 0.2 })
    const rect = camBubbleRect(
      { ...DEFAULT_CAM_STYLE, x: 0.62, y: 0.31, size: 0.2 },
      1920,
      1080,
    )
    expect(painted.x).toBeCloseTo(rect.x, 6)
    expect(painted.y).toBeCloseTo(rect.y, 6)
    // The oracle's own math: center fraction × frame − radius.
    expect(rect.x).toBeCloseTo(0.62 * 1920 - (0.2 * 1080) / 2, 6)
    expect(rect.y).toBeCloseTo(0.31 * 1080 - (0.2 * 1080) / 2, 6)
  })

  it('matches camBubbleRectAt through a cam pose span', () => {
    const withMotion = (doc: ProjectDoc) => {
      doc.camMotion = [{ id: 'm1', in: 2, out: 4, x: 0.7, y: 0.3, size: 0.35 }]
    }
    const doc = makeCamDoc()
    withMotion(doc)
    // Settled inside the span, and mid-ramp — the oracle must track the
    // painted pixels at ANY time, not just holds.
    for (const t of [3, 1.8, 0.5]) {
      const painted = paintedBubble({}, withMotion, t)
      const rect = camBubbleRectAt(doc, t)
      expect(painted.x).toBeCloseTo(rect.x, 4)
      expect(painted.y).toBeCloseTo(rect.y, 4)
      expect(painted.size).toBeCloseTo(rect.size, 4)
    }
  })

  it('mirrors the 40px floor and the rounded radius', () => {
    const painted = paintedBubble({ size: 0.01 })
    const rect = camBubbleRect({ ...DEFAULT_CAM_STYLE, size: 0.01 }, 1920, 1080)
    expect(rect.size).toBe(40)
    expect(painted.size).toBeCloseTo(40, 6)
    expect(camBubbleRect(DEFAULT_CAM_STYLE, 1920, 1080).radius).toBe(
      (DEFAULT_CAM_STYLE.size * 1080) / 2,
    )
    expect(
      camBubbleRect({ ...DEFAULT_CAM_STYLE, shape: 'rounded' }, 1920, 540)
        .radius,
    ).toBe(18 * (540 / 1080)) // rounded radius rides s, not the bubble size
  })
})

describe('cam bubble look knobs (radius / border / shadow)', () => {
  it('the rounded radius follows cam.radius, default 18·s', () => {
    const rounded = { ...DEFAULT_CAM_STYLE, shape: 'rounded' as const }
    expect(camBubbleRect(rounded, 1920, 1080).radius).toBe(18)
    expect(camBubbleRect({ ...rounded, radius: 30 }, 1920, 1080).radius).toBe(
      30,
    )
    expect(camBubbleRect({ ...rounded, radius: 30 }, 960, 540).radius).toBe(15)
    // A circle ignores it.
    expect(
      camBubbleRect(
        { ...DEFAULT_CAM_STYLE, shape: 'circle', radius: 30 },
        1920,
        1080,
      ).radius,
    ).toBe(
      camBubbleRect({ ...DEFAULT_CAM_STYLE, shape: 'circle' }, 1920, 1080)
        .radius,
    )
  })

  it('ON_FRAME defaults absent shadow to soft and the ring to the house 3px', () => {
    const { config } = lowerToComposition(makeCamDoc())
    const onFrame = (config as { onFrame: string }).onFrame
    expect(onFrame).toContain("camS.shadow || 'soft'")
    expect(onFrame).toContain('camS.border ? camS.border.width : 3')
  })
})
