import { describe, expect, it } from 'vitest'
import { lintVosAssets } from '@vosjs/core/lint'
import { lowerProgramDoc } from '../lower/lowerStudioDoc'
import { lowerToComposition } from '../lower/lowerToComposition'
import {
  BASE_FRAME_STYLE,
  DEFAULT_BROWSER_BAR,
  DEFAULT_CAM_STYLE,
  DEFAULT_CURSOR_STYLE,
} from '../types'
import type { ProgramAnchorDoc } from '../doc/studioDoc'
import type { OverlayClip, ProjectDoc } from '../types'

/**
 * The code the lowering emits is checked by the same manifest lint a
 * person's program is. It declares no files and reads none, so the lint has
 * nothing to say about it: a warning here is the lint reading the engine's
 * own strings (a font URL, a local array) as a read of `ctx.assets`, and it
 * would be printed on every check and every push of a layered program.
 */

const tf = (y: number) => ({ x: 0.5, y, scale: 1, rotation: 0 })
const layers: OverlayClip[] = [
  {
    id: 't1',
    kind: 'text',
    start: 0,
    duration: 3,
    text: 'Ship it',
    preset: 'title',
    transform: tf(0.3),
  },
  {
    id: 't2',
    kind: 'text',
    start: 0,
    duration: 3,
    preset: 'caption',
    text: [{ text: 'Ship ' }, { text: 'faster', weight: 700, underline: true }],
    transform: tf(0.5),
  },
  {
    id: 'h1',
    kind: 'html',
    start: 0,
    duration: 3,
    html: '<div class="card">Open</div>',
    css: ".card{font-family:'Inter';background:#0b0b0d}",
    box: { width: 452, height: 302 },
    transform: tf(0.7),
  },
]

describe('the lowered code under the manifest lint', () => {
  it('a program document with layers', () => {
    const lowered = lowerProgramDoc({
      program: { config: { version: 2, duration: 4 } },
      overlays: layers,
    } as unknown as ProgramAnchorDoc)
    expect(lintVosAssets(lowered.config as never)).toEqual([])
  })

  it('a recording with layers', () => {
    const doc: ProjectDoc = {
      source: {
        videoKey: 'blob:video',
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
      overlays: layers,
      export: { resolution: '1080p', fps: 30, format: 'mp4' },
    }
    expect(lintVosAssets(lowerToComposition(doc).config as never)).toEqual([])
  })
})
