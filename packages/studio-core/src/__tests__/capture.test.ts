import { describe, expect, it } from 'vitest'
import {
  deriveViewportCrop,
  docToCropSpace,
  docToFullSpace,
  normalizeCaptureSpace,
} from '../capture'
import {
  DEFAULT_CAM_STYLE,
  DEFAULT_CURSOR_STYLE,
  DEFAULT_FRAME_STYLE,
} from '../types'
import type {
  CursorEvent,
  CursorTrack,
  ProjectDoc,
  RecordingMeta,
} from '../types'

const baseMeta: RecordingMeta = {
  dpr: 2,
  zoom: 1,
  t0: 0,
  durationMs: 10_000,
  width: 1280,
  height: 720,
  fps: 30,
}

describe('normalizeCaptureSpace', () => {
  it('is identity for tab captures', () => {
    const cursor: CursorTrack = [{ t: 0, x: 10, y: 20, type: 'move' }]
    const out = normalizeCaptureSpace(cursor, baseMeta)
    expect(out.cursor).toBe(cursor)
    expect(out.meta).toBe(baseMeta)
    expect(out.coverage).toBe(1)
  })

  it('drops (coverage 0) a non-tab capture whose geometry is unusable', () => {
    // Missing anchor rect: the raw viewport-space track must NEVER pass through
    // as frame space — the cursor would render at unrelated positions.
    const noAnchor = normalizeCaptureSpace(
      [{ t: 0, x: 10, y: 20, sx: 10, sy: 20, type: 'move' }],
      {
        ...baseMeta,
        captureSurface: 'window',
        captureWidth: 2000,
        captureHeight: 1200,
      },
    )
    expect(noAnchor.coverage).toBe(0)
    // Missing capture dims (e.g. track settings read after a native-stop ended
    // the source): same policy.
    const noDims = normalizeCaptureSpace(
      [{ t: 0, x: 10, y: 20, sx: 10, sy: 20, type: 'move' }],
      {
        ...baseMeta,
        captureSurface: 'window',
        windowRect: { x: 0, y: 0, w: 1000, h: 600 },
      },
    )
    expect(noDims.coverage).toBe(0)
  })

  it('maps window-capture events via windowRect and axis scales', () => {
    // Browser window at (100, 50), 1000×600 CSS — captured at 2000×1200 px (2× dpr).
    const meta: RecordingMeta = {
      ...baseMeta,
      captureSurface: 'window',
      windowRect: { x: 100, y: 50, w: 1000, h: 600 },
      captureWidth: 2000,
      captureHeight: 1200,
    }
    // Viewport begins 8px right / 80px below the window origin (chrome + toolbar).
    const out = normalizeCaptureSpace(
      [
        {
          t: 0,
          x: 42,
          y: 10,
          sx: 100 + 8 + 42,
          sy: 50 + 80 + 10,
          type: 'down',
          button: 0,
        },
      ],
      meta,
    )
    expect(out.cursor[0].x).toBeCloseTo((8 + 42) * 2)
    expect(out.cursor[0].y).toBeCloseTo((80 + 10) * 2)
    expect(out.meta.width).toBe(2000)
    expect(out.meta.height).toBe(1200)
    expect(out.meta.dpr).toBe(1)
    expect(out.coverage).toBe(1)
  })

  it('transforms element rects with the per-event viewport→screen offset', () => {
    const meta: RecordingMeta = {
      ...baseMeta,
      captureSurface: 'monitor',
      screenRect: { x: 0, y: 0, w: 1600, h: 900 },
      captureWidth: 3200,
      captureHeight: 1800,
    }
    // Viewport origin on screen = (200, 150) ⇒ sx = x + 200, sy = y + 150.
    const out = normalizeCaptureSpace(
      [
        {
          t: 0,
          x: 50,
          y: 60,
          sx: 250,
          sy: 210,
          type: 'down',
          rect: { x: 40, y: 50, w: 100, h: 20 },
        },
      ],
      meta,
    )
    expect(out.cursor[0].rect).toEqual({
      x: (40 + 200) * 2,
      y: (50 + 150) * 2,
      w: 200,
      h: 40,
    })
  })

  it('reports low coverage when events land outside the captured frame', () => {
    const meta: RecordingMeta = {
      ...baseMeta,
      captureSurface: 'monitor',
      // Sharing a display the browser is NOT on: everything maps out of frame.
      screenRect: { x: 0, y: 0, w: 1600, h: 900 },
      captureWidth: 1600,
      captureHeight: 900,
    }
    const out = normalizeCaptureSpace(
      [
        { t: 0, x: 0, y: 0, sx: -2000, sy: 100, type: 'move' },
        { t: 1, x: 0, y: 0, sx: -1900, sy: 200, type: 'move' },
        { t: 2, x: 0, y: 0, sx: 400, sy: 300, type: 'move' },
      ],
      meta,
    )
    expect(out.coverage).toBeCloseTo(1 / 3)
  })

  it('drops unmappable events (no screen coords) from the output', () => {
    const meta: RecordingMeta = {
      ...baseMeta,
      captureSurface: 'window',
      windowRect: { x: 0, y: 0, w: 800, h: 600 },
      captureWidth: 800,
      captureHeight: 600,
    }
    const out = normalizeCaptureSpace(
      [
        { t: 0, x: 1, y: 1, type: 'move' },
        { t: 1, x: 2, y: 2, sx: 2, sy: 2, type: 'move' },
      ],
      meta,
    )
    expect(out.cursor).toHaveLength(1)
    expect(out.cursor[0].t).toBe(1)
  })
})

// Window-take viewport crop: browser window at (100, 50), 1200×800 DIPs,
// captured at 2400×1600 px (2×). Viewport 1200×713 → top chrome 87, no side
// chrome. Viewport origin on screen = (100, 137) ⇒ sx = x + 100, sy = y + 137.
const cropMeta: RecordingMeta = {
  dpr: 2,
  zoom: 1,
  t0: 0,
  durationMs: 10_000,
  width: 2400,
  height: 1600,
  fps: 30,
  captureSurface: 'window',
  windowRect: { x: 100, y: 50, w: 1200, h: 800 },
  viewport: { w: 1200, h: 713 },
  captureWidth: 2400,
  captureHeight: 1600,
}

/** n move events at viewport (x, y) with the top frame's viewport→screen offset. */
function topEvents(n: number, x = 40, y = 60): CursorEvent[] {
  return Array.from({ length: n }, (_, i) => ({
    t: i * 100,
    x,
    y,
    sx: x + 100,
    sy: y + 137,
    type: 'move' as const,
  }))
}

describe('deriveViewportCrop', () => {
  it('derives the crop when events agree with the window geometry', () => {
    expect(deriveViewportCrop(topEvents(5), cropMeta)).toEqual({
      x: 0,
      y: 87 * 2,
      w: 2400,
      h: 713 * 2,
    })
  })

  it('fails closed without enough agreeing events', () => {
    expect(deriveViewportCrop(topEvents(2), cropMeta)).toBeNull()
    expect(deriveViewportCrop([], cropMeta)).toBeNull()
    // No screen coords (old capture) → nothing to agree with.
    expect(
      deriveViewportCrop(
        [
          { t: 0, x: 1, y: 1, type: 'move' },
          { t: 1, x: 2, y: 2, type: 'move' },
          { t: 2, x: 3, y: 3, type: 'move' },
        ],
        cropMeta,
      ),
    ).toBeNull()
  })

  it('fails closed on mid-take geometry drift and page zoom', () => {
    const ev = topEvents(5)
    expect(
      deriveViewportCrop(ev, { ...cropMeta, windowMovedDuringTake: true }),
    ).toBeNull()
    expect(
      deriveViewportCrop(ev, { ...cropMeta, viewportChangedDuringTake: true }),
    ).toBeNull()
    expect(
      deriveViewportCrop(ev, { ...cropMeta, resizedDuringTake: true }),
    ).toBeNull()
    expect(deriveViewportCrop(ev, { ...cropMeta, zoom: 1.25 })).toBeNull()
  })

  it('fails closed when the browser window was unfocused for most of the take', () => {
    // Wrong-window share: the cursor events are still geometrically consistent
    // (they come from the recorded tab), so focus is the only tell.
    const ev = topEvents(5)
    expect(
      deriveViewportCrop(ev, { ...cropMeta, windowFocusedFrac: 0.2 }),
    ).toBeNull()
    expect(
      deriveViewportCrop(ev, { ...cropMeta, windowFocusedFrac: 0.9 }),
    ).not.toBeNull()
    // Old artifacts without the field keep working (no gate).
    expect(deriveViewportCrop(ev, cropMeta)).not.toBeNull()
  })

  it('fails closed when event offsets contradict chrome-on-top (docked devtools)', () => {
    // Devtools docked at the bottom: innerHeight 600 ⇒ outer−inner = 200, but the
    // real viewport top is still 87 below the window top — the window-derived
    // estimate (y+200) disagrees with every event offset (y+137) → no crop.
    const meta = { ...cropMeta, viewport: { w: 1200, h: 600 } }
    expect(deriveViewportCrop(topEvents(5), meta)).toBeNull()
  })

  it('ignores cross-origin-iframe events (offsets are the iframe origin)', () => {
    // 5 top-frame events + 8 iframe events whose viewport→screen offset is the
    // IFRAME's origin (400, 500) — they must not skew the crop.
    const iframeEvents: CursorEvent[] = Array.from({ length: 8 }, (_, i) => ({
      t: 1000 + i * 100,
      x: 10,
      y: 10,
      sx: 10 + 400,
      sy: 10 + 500,
      type: 'move' as const,
    }))
    expect(
      deriveViewportCrop([...topEvents(5), ...iframeEvents], cropMeta),
    ).toEqual({
      x: 0,
      y: 174,
      w: 2400,
      h: 1426,
    })
  })

  it('fails closed on axis-scale mismatch (wrong surface shared)', () => {
    // Captured pixels aren't a clean scale of this window: 2× wide, 1.5× tall.
    const meta = { ...cropMeta, captureHeight: 1200 }
    expect(deriveViewportCrop(topEvents(5), meta)).toBeNull()
  })

  it('fails closed on implausible chrome height', () => {
    // Viewport nearly as tall as the window (top chrome 8 px) — kiosk/undecorated
    // window; nothing worth cropping and the geometry is suspect.
    const meta = { ...cropMeta, viewport: { w: 1200, h: 792 } }
    const ev = topEvents(5).map((e) => ({ ...e, sy: e.y + 58 })) // offset = 50 + 8
    expect(deriveViewportCrop(ev, meta)).toBeNull()
  })

  it('never crops tab or monitor captures', () => {
    expect(
      deriveViewportCrop(topEvents(5), { ...cropMeta, captureSurface: 'tab' }),
    ).toBeNull()
    expect(
      deriveViewportCrop(topEvents(5), {
        ...cropMeta,
        captureSurface: 'monitor',
      }),
    ).toBeNull()
  })
})

describe('normalizeCaptureSpace with viewport crop', () => {
  it('rewrites cursor, rects, and meta into crop space', () => {
    const out = normalizeCaptureSpace(
      [
        { ...topEvents(1)[0], rect: { x: 30, y: 40, w: 100, h: 20 } },
        ...topEvents(4),
      ],
      cropMeta,
    )
    expect(out.crop).toEqual({ x: 0, y: 174, w: 2400, h: 1426 })
    // Event at viewport (40, 60) → crop space = viewport CSS px × 2 scale.
    expect(out.cursor[0].x).toBeCloseTo(80)
    expect(out.cursor[0].y).toBeCloseTo(120)
    // Element rect shifts by the same crop origin.
    expect(out.cursor[0].rect).toEqual({ x: 60, y: 80, w: 200, h: 40 })
    // Meta dims are the crop dims — layout/planner/zoom need no crop awareness.
    expect(out.meta.width).toBe(2400)
    expect(out.meta.height).toBe(1426)
    expect(out.meta.captureWidth).toBe(2400)
    expect(out.meta.captureHeight).toBe(1426)
    expect(out.coverage).toBe(1)
  })

  it('keeps the uncropped mapping when no crop can be derived', () => {
    const out = normalizeCaptureSpace(topEvents(5), { ...cropMeta, zoom: 1.5 })
    expect(out.crop).toBeUndefined()
    // Full capture-frame space, as before the crop feature.
    expect(out.cursor[0].x).toBeCloseTo((40 + 100 - 100) * 2)
    expect(out.cursor[0].y).toBeCloseTo((60 + 137 - 50) * 2)
    expect(out.meta.width).toBe(2400)
    expect(out.meta.height).toBe(1600)
  })
})

// "Original" frame mode: lossless crop-space ↔ full-space doc remap.
describe('docToFullSpace / docToCropSpace', () => {
  const RECT = { x: 0, y: 174, w: 2400, h: 1426 }

  function cropSpaceDoc(): ProjectDoc {
    return {
      source: {
        videoKey: 'blob:video',
        cursor: [
          {
            t: 0,
            x: 80,
            y: 120,
            type: 'move',
            rect: { x: 60, y: 80, w: 200, h: 40 },
          },
          { t: 500, x: 300, y: 300, type: 'down' },
        ],
        meta: {
          dpr: 1,
          zoom: 1,
          t0: 0,
          durationMs: 10_000,
          width: RECT.w,
          height: RECT.h,
          fps: 30,
          captureSurface: 'window',
          captureWidth: RECT.w,
          captureHeight: RECT.h,
        },
        crop: { ...RECT },
        chromeCrop: { rect: { ...RECT }, frameW: 2400, frameH: 1600 },
      },
      segments: [{ in: 0, out: 10 }],
      zoom: [{ id: 'z1', in: 1, out: 3, level: 2, cx: 0.25, cy: 0.5 }],
      audio: [],
      cursor: { ...DEFAULT_CURSOR_STYLE },
      cam: { ...DEFAULT_CAM_STYLE },
      frame: { ...DEFAULT_FRAME_STYLE },
      export: { resolution: '1080p', fps: 30, format: 'mp4' },
    }
  }

  it('remaps cursor, rects, zoom focus, and meta into full space', () => {
    const d = cropSpaceDoc()
    docToFullSpace(d)
    expect(d.source.crop).toBeUndefined()
    expect(d.source.chromeCrop).toBeDefined() // kept for the way back
    expect(d.source.cursor[0].x).toBe(80) // x: crop.x = 0
    expect(d.source.cursor[0].y).toBe(120 + 174)
    expect(d.source.cursor[0].rect).toEqual({
      x: 60,
      y: 80 + 174,
      w: 200,
      h: 40,
    })
    expect(d.source.meta.width).toBe(2400)
    expect(d.source.meta.height).toBe(1600)
    // cy: (174 + 0.5 · 1426) / 1600
    expect(d.zoom[0].cy).toBeCloseTo((174 + 0.5 * 1426) / 1600, 10)
    expect(d.zoom[0].cx).toBeCloseTo(0.25, 10)
  })

  it('round-trips losslessly', () => {
    const d = cropSpaceDoc()
    const before = JSON.parse(JSON.stringify(d)) as ProjectDoc
    docToFullSpace(d)
    docToCropSpace(d)
    expect(d.source.crop).toEqual(RECT)
    expect(d.source.meta.width).toBe(before.source.meta.width)
    expect(d.source.cursor[0].x).toBeCloseTo(before.source.cursor[0].x, 10)
    expect(d.source.cursor[0].y).toBeCloseTo(before.source.cursor[0].y, 10)
    expect(d.zoom[0].cx).toBeCloseTo(before.zoom[0].cx, 10)
    expect(d.zoom[0].cy).toBeCloseTo(before.zoom[0].cy, 10)
  })

  it('is a no-op in the already-requested space or without a chromeCrop', () => {
    const d = cropSpaceDoc()
    docToCropSpace(d) // already cropped
    expect(d.source.cursor[0].y).toBe(120)
    const noCc = cropSpaceDoc()
    noCc.source.chromeCrop = undefined
    docToFullSpace(noCc)
    expect(noCc.source.crop).toEqual(RECT) // untouched
    expect(noCc.source.cursor[0].y).toBe(120)
  })

  it('clamps a chrome-aimed focus when re-entering crop space', () => {
    const d = cropSpaceDoc()
    docToFullSpace(d)
    d.zoom[0].cy = 0.02 // aimed at the title-bar area, above the viewport
    docToCropSpace(d)
    expect(d.zoom[0].cy).toBe(0)
  })
})
