import { describe, expect, it } from 'vitest'
import { projectFromArtifact } from '../ingest'
import { planAutoZoom } from '../planner/autoZoom'
import type { CursorTrack, RecordingArtifact, RecordingMeta } from '../types'

// A desktop app's window is a take like a page's: the frame is the window,
// the cursor is in the window's own points, and presses carry the bounds of
// what was pressed. It keeps its cursor and plans a zoom; what it does not get
// is a browser bar, because its footage already shows the window's title bar.

// The shape a capture helper writes for a Retina window: points for the
// cursor space, pixels for the video.
const meta: RecordingMeta = {
  dpr: 2,
  zoom: 1,
  t0: 1794475400000,
  durationMs: 6692,
  width: 656,
  height: 422,
  fps: 60,
  captureWidth: 1312,
  captureHeight: 844,
  captureSurface: 'app',
  platform: 'mac',
  producer: 'desktop',
  app: { name: 'TextEdit', id: 'com.apple.TextEdit' },
}

const button = { x: 560, y: 6, w: 80, h: 22 }
const field = { x: 16, y: 60, w: 320, h: 28 }

/** Travel to a button and press it, type in a field, then press the button again. */
const cursor: CursorTrack = [
  ...Array.from({ length: 40 }, (_, i) => ({
    t: 1200 + i * 16,
    x: 120 + i * 12,
    y: 330 - i * 8,
    type: 'move' as const,
  })),
  { t: 2358, x: 600, y: 17, type: 'down', button: 0, rect: button },
  { t: 2430, x: 600, y: 17, type: 'up', button: 0 },
  { t: 3055, x: 176, y: 74, type: 'key', rect: field },
  { t: 3414, x: 176, y: 74, type: 'key', rect: field },
  { t: 3790, x: 176, y: 74, type: 'key', rect: field },
  { t: 5399, x: 600, y: 17, type: 'down', button: 0, rect: button },
  { t: 5470, x: 600, y: 17, type: 'up', button: 0 },
]

function artifact(over: Partial<RecordingMeta> = {}): RecordingArtifact {
  return { videoKey: 'recording.mp4', cursor, meta: { ...meta, ...over } }
}

describe("ingesting an app window's take", () => {
  it('keeps the cursor: the track is already in the frame', () => {
    const { doc } = projectFromArtifact(artifact(), 'recording.mp4')
    expect(doc.source.cursor).toHaveLength(cursor.length)
    expect(doc.source.cursor[0]).toEqual(cursor[0])
    expect(doc.cursor.visible).toBe(true)
    expect(doc.source.meta.width).toBe(656)
    expect(doc.source.meta.captureWidth).toBe(1312)
  })

  it('draws no browser bar and takes no crop: the window is its own frame', () => {
    const { doc } = projectFromArtifact(artifact(), 'recording.mp4')
    expect(doc.frame.browserBar.kind).toBe('none')
    expect(doc.source.crop).toBeUndefined()
    expect(doc.source.chromeCrop).toBeUndefined()
  })

  it('decodes through the element until frame-accurate decode is proven', () => {
    const { doc } = projectFromArtifact(artifact(), 'recording.mp4')
    expect(doc.source.frameSource).toBe('html5')
  })

  it("keeps its cursor when the window moved: the producer follows the window, so the track stays the window's", () => {
    // `windowMovedDuringTake` is a browser display capture's fact; an app
    // take's helper re-reads the window's frame at every sample and never
    // sets it. The gate is the surface's, so a stray flag must not matter.
    const { doc } = projectFromArtifact(
      artifact({ windowMovedDuringTake: true }),
      'recording.mp4',
    )
    expect(doc.source.cursor.length).toBeGreaterThan(0)
  })

  it('plans a zoom from its presses and typing, in the window', () => {
    const { doc } = projectFromArtifact(artifact(), 'recording.mp4')
    const spans = planAutoZoom(doc.source.cursor, {
      width: doc.source.meta.width,
      height: doc.source.meta.height,
      duration: doc.source.meta.durationMs / 1000,
    })
    expect(spans.length).toBeGreaterThan(0)
    for (const s of spans) {
      expect(s.in).toBeGreaterThanOrEqual(0)
      expect(s.out).toBeLessThanOrEqual(meta.durationMs / 1000 + 1e-6)
      // the focus is a fraction of the WINDOW, not of a screen
      expect(s.cx).toBeGreaterThanOrEqual(0)
      expect(s.cx).toBeLessThanOrEqual(1)
      expect(s.cy).toBeGreaterThanOrEqual(0)
      expect(s.cy).toBeLessThanOrEqual(1)
    }
  })

  it('a page take is untouched: it still wears the platform bar', () => {
    const { doc } = projectFromArtifact(
      artifact({ captureSurface: undefined, producer: 'cli', app: undefined }),
      'recording.webm',
    )
    expect(doc.frame.browserBar.kind).not.toBe('none')
  })
})
