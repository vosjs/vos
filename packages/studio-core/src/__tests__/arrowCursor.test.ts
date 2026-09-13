import { afterEach, describe, expect, it } from 'vitest'
import { lerpArray, mapTime, sample } from '@vosjs/timeline'
import { projectFromArtifact } from '../ingest'
import { lowerToComposition } from '../lower/lowerToComposition'
import {
  DEFAULT_CAM_STYLE,
  DEFAULT_CURSOR_STYLE,
  DEFAULT_FRAME_STYLE,
} from '../types'
import type { CursorStyle, ProjectDoc } from '../types'

/**
 * The pointer's shape at the draw site: `style: 'arrow'` paints a closed
 * polygon with its tip on the recorded point; every other style paints
 * the dot (an arc). New takes open on the arrow; a stored 'default' keeps
 * the dot, so earlier takes render as they were cut.
 */
const VIDEO = { width: 1600, height: 900 }
const W = 1920
const H = 1080

describe('the pointer shape', () => {
  const g = globalThis as Record<string, unknown>
  afterEach(() => {
    delete g.window
    delete g.__vosTimeline
  })

  function makeDoc(cursor: CursorStyle): ProjectDoc {
    return {
      source: {
        videoKey: 'blob:video',
        cursor: [
          { t: 0, x: 400, y: 300, type: 'move' },
          { t: 900, x: 800, y: 450, type: 'move' },
          { t: 1000, x: 800, y: 450, type: 'move' },
        ],
        meta: {
          dpr: 2,
          zoom: 1,
          t0: 0,
          durationMs: 3000,
          width: VIDEO.width,
          height: VIDEO.height,
          fps: 30,
        },
      },
      segments: [{ in: 0, out: 3 }],
      zoom: [],
      audio: [],
      cursor,
      cam: DEFAULT_CAM_STYLE,
      frame: DEFAULT_FRAME_STYLE,
      export: { resolution: '1080p', fps: 30, format: 'mp4' },
    }
  }

  /** Path calls after the card clip (the cursor is drawn inside it). */
  function pointerCalls(cursor: CursorStyle): {
    arcs: number[][]
    lines: number[][]
    moves: number[][]
  } {
    const { config, data } = lowerToComposition(makeDoc(cursor))
    const onFrame = new Function(`return (${config.onFrame as string})`)() as (
      ctx: unknown,
      content: unknown,
      dt: number,
    ) => void
    g.window = { __vos__: { isPaused: true } }
    g.__vosTimeline = { mapTime, sample, lerpArray }
    const arcs: number[][] = []
    const lines: number[][] = []
    const moves: number[][] = []
    let clipped = false
    const c2d = new Proxy(
      {},
      {
        get: (_t, key: string) => {
          if (key === 'measureText') return () => ({ width: 42 })
          if (key === 'createLinearGradient')
            return () => ({ addColorStop: () => {} })
          return (...args: unknown[]) => {
            if (key === 'clip') clipped = true
            if (!clipped) return
            if (key === 'arc') arcs.push(args as number[])
            if (key === 'lineTo') lines.push(args as number[])
            if (key === 'moveTo') moves.push(args as number[])
          }
        },
        set: () => true,
      },
    )
    const video = {
      videoWidth: VIDEO.width,
      videoHeight: VIDEO.height,
      readyState: 2,
      paused: true,
      currentTime: 1.05,
      duration: 3,
      play: () => undefined,
      pause: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }
    const ctx = {
      time: 1.05,
      data,
      renderer: undefined,
      resolution: {
        width: W,
        height: H,
        drawingBufferWidth: W,
        drawingBufferHeight: H,
      },
    }
    const content = {
      refs: {
        c2d,
        canvas: { width: W, height: H },
        texture: { needsUpdate: false, dispose: () => undefined },
        video,
        cam: null,
      },
    }
    onFrame(ctx, content, 1 / 30)
    return { arcs, lines, moves }
  }

  it('new takes open on the arrow; the stored default stays the dot', () => {
    expect(DEFAULT_CURSOR_STYLE.style).toBe('default')
    const { doc } = projectFromArtifact(
      {
        videoKey: 'recording.webm',
        cursor: [],
        meta: {
          dpr: 1,
          zoom: 1,
          t0: 0,
          durationMs: 1000,
          width: VIDEO.width,
          height: VIDEO.height,
          fps: 30,
          captureSurface: 'tab',
          platform: 'mac',
          pageUrl: 'https://example.test/app',
        },
      },
      'recording.webm',
    )
    expect(doc.cursor.style).toBe('arrow')
  })

  it("'arrow' paints a closed polygon whose tip is the recorded point, and no dot", () => {
    const { arcs, lines, moves } = pointerCalls({
      ...DEFAULT_CURSOR_STYLE,
      style: 'arrow',
    })
    expect(arcs.length).toBe(0)
    expect(lines.length).toBe(6)
    // The tip: the last move at (800, 450) of a 1600×900 recording mapped
    // into the card. Every polygon point lies below and to the right of it.
    const [tx, ty] = moves[moves.length - 1]
    for (const [lx, ly] of lines) {
      expect(lx).toBeGreaterThanOrEqual(tx - 1e-6)
      expect(ly).toBeGreaterThanOrEqual(ty - 1e-6)
    }
    // It stands 2r tall (r = size/2 · s2; size 24 at s2 = 1 → 24 px).
    const tall = Math.max(...lines.map(([, ly]) => ly - ty))
    expect(tall).toBeCloseTo(24 * 0.83, 3)
  })

  it("'default' keeps the dot every earlier take was cut with", () => {
    const { arcs, lines } = pointerCalls({
      ...DEFAULT_CURSOR_STYLE,
      style: 'default',
    })
    expect(lines.length).toBe(0)
    expect(arcs.length).toBe(1)
    expect(arcs[0][2]).toBeCloseTo(12, 3) // radius = size / 2 at s2 = 1
  })
})
