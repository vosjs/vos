/**
 * `vos validate` on a layer anchored to a step: the anchor's shape, where
 * it plays once resolved (or the fallback it plays at), `{elapsed}` with
 * nothing to fill it, and two captions on screen at the same time.
 */
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_CAM_STYLE,
  DEFAULT_CURSOR_STYLE,
  DEFAULT_FRAME_STYLE,
} from '@vosjs/studio-core'
import { lintDoc } from '../validateDoc'
import type { ProjectDoc, TextOverlayClip } from '@vosjs/studio-core'

const text = (
  id: string,
  start: number,
  over: Partial<TextOverlayClip> = {},
): TextOverlayClip => ({
  id,
  kind: 'text',
  text: id,
  preset: 'label',
  start,
  duration: 1,
  transform: { x: 0.5, y: 0.2, scale: 1, rotation: 0 },
  ...over,
})

const takeA = (): ProjectDoc => ({
  source: {
    videoKey: 'recording.webm',
    cursor: [],
    meta: {
      dpr: 1,
      zoom: 1,
      t0: 0,
      durationMs: 10000,
      width: 1280,
      height: 720,
      fps: 30,
      steps: [
        { step: 0, id: 'open', do: 'click', tStart: 2, tEnd: 2.5 },
        { step: 1, id: 'save', do: 'click', tStart: 6, tEnd: 6.5 },
      ],
    },
  },
  segments: [{ in: 0, out: 10 }],
  zoom: [],
  audio: [],
  cursor: DEFAULT_CURSOR_STYLE,
  cam: DEFAULT_CAM_STYLE,
  frame: DEFAULT_FRAME_STYLE,
  export: { resolution: '720p', fps: 30, format: 'mp4' },
})

describe('validate: anchored captions', () => {
  it('names an anchor that cannot resolve, and two captions on screen at once', () => {
    const doc = takeA()
    doc.overlays = [
      text('a', 0, {
        preset: 'caption',
        anchor: { step: 'open' },
        duration: 2,
      }),
      text('b', 3, { preset: 'caption', duration: 1 }),
      text('c', 9, { preset: 'caption', anchor: { step: 'nope' } }),
      text('d', 5, { preset: 'caption', text: '{elapsed} later' }),
    ]
    const { problems, warnings } = lintDoc(doc)
    expect(problems).toEqual([])
    // `a` plays at its step (2 s) until 4 s, over `b` at 3 s.
    expect(
      warnings.some((w) =>
        /overlays\[0\] \(a\).*overlays\[1\] \(b\).*same time/.test(w),
      ),
    ).toBe(true)
    expect(
      warnings.some((w) =>
        /overlays\[2\]\.anchor: step "nope" is not in its meta\.steps.*fallback start \(9\.00s\)/.test(
          w,
        ),
      ),
    ).toBe(true)
    expect(
      warnings.some((w) =>
        /overlays\[3\]: its words carry \{elapsed\}/.test(w),
      ),
    ).toBe(true)
  })

  it('refuses a malformed anchor in words', () => {
    const doc = takeA()
    doc.overlays = [
      text('a', 0, { anchor: { step: -1, offset: 'x' } as never }),
    ]
    expect(lintDoc(doc).problems).toEqual([
      'overlays[0].anchor.step must be a step id (string) or its index (integer ≥ 0)',
      'overlays[0].anchor.offset must be a number (OUTPUT seconds)',
    ])
  })
})
