import { describe, expect, it } from 'vitest'
import {
  BASE_FRAME_STYLE,
  DEFAULT_BROWSER_BAR,
  DEFAULT_CAM_STYLE,
  DEFAULT_CURSOR_STYLE,
} from '../types'
import {
  isLoweredRecording,
  lowerToComposition,
} from '../lower/lowerToComposition'
import { lowerProgramDoc } from '../lower/lowerStudioDoc'
import type { ProgramAnchorDoc, ProjectDoc } from '../types'

const take: ProjectDoc = {
  source: {
    videoKey: 'https://assets.vos.so/x.webm',
    cursor: [{ t: 0, x: 100, y: 100, type: 'move' }],
    meta: {
      dpr: 2,
      zoom: 1,
      t0: 0,
      durationMs: 4000,
      width: 1600,
      height: 900,
      fps: 30,
    },
  },
  segments: [{ in: 0, out: 4 }],
  zoom: [],
  audio: [],
  cursor: DEFAULT_CURSOR_STYLE,
  cam: DEFAULT_CAM_STYLE,
  frame: { ...BASE_FRAME_STYLE, browserBar: DEFAULT_BROWSER_BAR },
  export: { resolution: '1080p', fps: 30, format: 'mp4' },
}

describe('a recording’s lowered program says so', () => {
  it('is the four functions this module writes, byte for byte', () => {
    expect(isLoweredRecording(lowerToComposition(take).config)).toBe(true)
  })

  it('a program document keeps the author’s functions, so it is not one', () => {
    const lowered = lowerProgramDoc({
      program: {
        config: {
          version: 2,
          duration: 4,
          createContent: '(ctx) => ({ dispose() {} })',
          createTimeline: '(ctx) => ctx.gsap.timeline()',
        },
      },
      overlays: [],
    } as unknown as ProgramAnchorDoc)
    expect(isLoweredRecording(lowered.config)).toBe(false)
  })

  it('a hand-written config, or no config, is not one', () => {
    expect(isLoweredRecording({ version: 2, setup: 'async (ctx) => {}' })).toBe(
      false,
    )
    expect(isLoweredRecording(null)).toBe(false)
    expect(isLoweredRecording('setup')).toBe(false)
  })
})
