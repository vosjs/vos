/**
 * The framing lint reads a span's OWN media: its clicks, in its source
 * seconds and its capture space. After a join, a zoom on the second media
 * must be judged against what that media showed, never against the
 * primary's click at the same second.
 */
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_CAM_STYLE,
  DEFAULT_CURSOR_STYLE,
  DEFAULT_FRAME_STYLE,
} from '@vosjs/studio-core'
import { lintDoc } from '../validateDoc'
import type { CursorTrack, Media, ProjectDoc } from '@vosjs/studio-core'

const meta = (durationMs: number) => ({
  dpr: 1,
  zoom: 1,
  t0: 0,
  durationMs,
  width: 1280,
  height: 720,
  fps: 30,
})

/** A press at 1.8 s on a 100×40 element centred at (fx, fy) of the frame. */
const pressAt = (fx: number, fy: number): CursorTrack => {
  const rect = { x: fx * 1280 - 50, y: fy * 720 - 20, w: 100, h: 40 }
  return [
    { t: 1000, x: rect.x + 50, y: rect.y + 20, type: 'move' },
    { t: 1800, x: rect.x + 50, y: rect.y + 20, type: 'down', rect },
    { t: 1900, x: rect.x + 50, y: rect.y + 20, type: 'up', rect },
  ]
}

const second: Media = {
  id: 'm1',
  videoKey: 'm1/recording.webm',
  cursor: pressAt(0.3, 0.6),
  meta: meta(6000),
}

const joined = (zoom: ProjectDoc['zoom']): ProjectDoc => ({
  source: {
    videoKey: 'recording.webm',
    cursor: pressAt(0.64, 0.16),
    meta: meta(6000),
  },
  media: [second],
  segments: [
    { in: 0, out: 6 },
    { in: 0, out: 6, media: 'm1' },
  ],
  zoom,
  audio: [],
  cursor: DEFAULT_CURSOR_STYLE,
  cam: DEFAULT_CAM_STYLE,
  frame: DEFAULT_FRAME_STYLE,
  export: { resolution: '720p', fps: 30, format: 'mp4' },
})

const beside = (doc: ProjectDoc) =>
  lintDoc(doc).warnings.filter((w) => w.includes('points beside'))

describe('framing a zoom on another media', () => {
  it('reads that media’s clicks, not the primary’s', () => {
    // Aimed at the second media's own press: clean.
    expect(
      beside(
        joined([
          {
            id: 'm1-z0',
            in: 1,
            out: 3,
            level: 2,
            cx: 0.3,
            cy: 0.6,
            media: 'm1',
          },
        ]),
      ),
    ).toEqual([])
    // Aimed at the primary's press while on the second media: that media's
    // press is outside the window, and the warning names its target.
    const off = beside(
      joined([
        {
          id: 'm1-z0',
          in: 1,
          out: 3,
          level: 2,
          cx: 0.64,
          cy: 0.16,
          media: 'm1',
        },
      ]),
    )
    expect(off).toHaveLength(1)
    expect(off[0]).toContain('(center 0.30, 0.60)')
  })

  it('still judges a primary zoom against the primary’s clicks', () => {
    expect(
      beside(
        joined([{ id: 'z0', in: 1, out: 3, level: 2, cx: 0.64, cy: 0.16 }]),
      ),
    ).toEqual([])
    const off = beside(
      joined([{ id: 'z0', in: 1, out: 3, level: 2, cx: 0.3, cy: 0.6 }]),
    )
    expect(off).toHaveLength(1)
    expect(off[0]).toContain('(center 0.64, 0.16)')
  })
})
