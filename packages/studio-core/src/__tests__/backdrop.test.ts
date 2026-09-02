import { describe, expect, it } from 'vitest'
import {
  BACKDROP_DEFAULT_ON,
  DEFAULT_BACKDROP,
  defaultBackdropMedia,
  withDefaultBackdrop,
} from '../backdrop'
import {
  DEFAULT_CAM_STYLE,
  DEFAULT_CURSOR_STYLE,
  DEFAULT_FRAME_STYLE,
} from '../types'
import { lowerToComposition } from '../lower/lowerToComposition'
import type { ProjectDoc } from '../types'

// The house loop is a committed constant, the flip is one
// flag, and a doc opening on it carries the loop AND its ground so the
// pre-decode frame is the loop's own colour.

function makeDoc(): ProjectDoc {
  return {
    source: {
      videoKey: 'blob:video',
      cursor: [],
      meta: {
        dpr: 2,
        zoom: 1,
        t0: 0,
        durationMs: 3000,
        width: 1600,
        height: 900,
        fps: 30,
      },
    },
    segments: [{ in: 0, out: 3 }],
    zoom: [],
    audio: [],
    cursor: DEFAULT_CURSOR_STYLE,
    cam: DEFAULT_CAM_STYLE,
    frame: withDefaultBackdrop(DEFAULT_FRAME_STYLE),
    export: { resolution: '1080p', fps: 30, format: 'mp4' },
  }
}

describe('DEFAULT_BACKDROP', () => {
  it('is a durable public URL with a period and a ground', () => {
    expect(DEFAULT_BACKDROP.key).toMatch(/^https:\/\/assets\.vos\.so\//)
    expect(DEFAULT_BACKDROP.poster).toMatch(/^https:\/\/assets\.vos\.so\//)
    expect(DEFAULT_BACKDROP.duration).toBeGreaterThan(0)
    expect(DEFAULT_BACKDROP.ground).toMatch(/^#[0-9a-f]{6}$/)
  })

  it('withDefaultBackdrop writes the loop and its ground, nothing else', () => {
    const frame = withDefaultBackdrop(DEFAULT_FRAME_STYLE)
    expect(frame.background).toBe(DEFAULT_BACKDROP.ground)
    expect(frame.backgroundMedia).toEqual(defaultBackdropMedia())
    expect(frame.padding).toBe(DEFAULT_FRAME_STYLE.padding)
    expect(frame.browserBar).toBe(DEFAULT_FRAME_STYLE.browserBar)
  })

  it('lowers a default-backdrop doc with the loop in ctx.data (no bake, no recompile)', () => {
    const { data } = lowerToComposition(makeDoc())
    const frame = data.frame as {
      background: string
      backgroundMedia: { key: string; duration: number }
    }
    expect(frame.background).toBe(DEFAULT_BACKDROP.ground)
    expect(frame.backgroundMedia.key).toBe(DEFAULT_BACKDROP.key)
    expect(frame.backgroundMedia.duration).toBe(DEFAULT_BACKDROP.duration)
  })

  it('the flip is one flag, and DEFAULT_FRAME_STYLE follows it', () => {
    if (BACKDROP_DEFAULT_ON) {
      expect(DEFAULT_FRAME_STYLE.backgroundMedia?.key).toBe(
        DEFAULT_BACKDROP.key,
      )
      expect(DEFAULT_FRAME_STYLE.background).toBe(DEFAULT_BACKDROP.ground)
    } else {
      expect(DEFAULT_FRAME_STYLE.backgroundMedia).toBeUndefined()
    }
  })
})
