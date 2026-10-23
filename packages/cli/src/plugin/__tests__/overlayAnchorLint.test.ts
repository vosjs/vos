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
  it('judges an anchored layer over a press where it plays, not at its stale or absent start', () => {
    const doc = takeA()
    // `save` pressed at 6 s on an element under the caption's box.
    doc.source.cursor = [
      {
        t: 6000,
        x: 640,
        y: 640,
        type: 'down',
        button: 0,
        rect: { x: 340, y: 560, w: 600, h: 160 },
      },
      { t: 6100, x: 640, y: 640, type: 'up', button: 0 },
    ] as ProjectDoc['source']['cursor']
    const over = {
      preset: 'caption' as const,
      transform: { x: 0.5, y: 0.86, scale: 1, rotation: 0 },
      duration: 2,
    }
    const stale = takeA()
    stale.source = doc.source
    stale.overlays = [
      // Its fallback says 40 s (where it played before a trim); it plays at 5.8 s.
      text('stale', 40, { ...over, anchor: { step: 'save', offset: -0.2 } }),
    ]
    const { start: _s, ...noStart } = text('none', 0, {
      ...over,
      anchor: { step: 'save', offset: -0.2 },
    })
    void _s
    const absent = takeA()
    absent.source = doc.source
    absent.overlays = [noStart as TextOverlayClip]
    for (const d of [stale, absent])
      expect(
        lintDoc(d).warnings.filter((w) =>
          w.includes('sits over the thing being clicked'),
        ),
      ).toEqual([
        'overlays[0] sits over the thing being clicked at 6.0s (output 6.0s) — pin it to that step (pin: { step }) so it sits beside the target and follows it, or move it off',
      ])
  })

  it('says when a caption anchored to one media starts over the next media’s footage', () => {
    const doc = takeA()
    doc.media = [
      {
        id: 'm1',
        videoKey: 'm1/recording.webm',
        cursor: [],
        meta: { ...doc.source.meta, durationMs: 4000, steps: [] },
      },
    ] as unknown as ProjectDoc['media']
    // The primary trimmed to end just after `save`, then m1.
    doc.segments = [
      { in: 0, out: 6.6 },
      { in: 0, out: 4, media: 'm1' },
    ] as ProjectDoc['segments']
    doc.overlays = [
      // After its gesture plus 0.2 s: 6.7 s, over m1.
      text('late', 0, {
        preset: 'caption',
        anchor: { step: 'save', at: 'end', offset: 0.2 },
        duration: 2,
      }),
      // At its start: 6 s, over its own footage.
      text('ok', 0, {
        preset: 'caption',
        anchor: { step: 'save', at: 'start' },
        duration: 0.5,
      }),
    ]
    const { problems, warnings } = lintDoc(doc)
    expect(problems).toEqual([])
    expect(warnings.filter((w) => w.includes('another scene'))).toEqual([
      'overlays[0] (late): anchored to step "save", it starts at 6.70s, after that media\'s footage there ends (6.60s), where segments[1] plays media "m1": it speaks over another scene. Anchor it to the step\'s start (anchor.at: "start"), lower anchor.offset, or keep more of the footage it is about',
    ])
  })

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

  it('notes the earlier wait an anchored {elapsed} reads, and warns only when there is none', () => {
    const doc = takeA()
    doc.overlays = [
      text('landing', 3, {
        preset: 'caption',
        anchor: { step: 'save' },
        text: '{elapsed} later',
      }),
    ]
    const none = lintDoc(doc)
    expect(
      none.warnings.some((w) =>
        /overlays\[0\]: \{elapsed\} stays as written, because neither step "save" nor any step before it/.test(
          w,
        ),
      ),
    ).toBe(true)
    expect(none.notes).toBeUndefined()
    ;(doc.source.meta as unknown as { skips: unknown }).skips = [
      { step: 0, id: 'open', at: 2, ms: 12 * 60_000 },
    ]
    const found = lintDoc(doc)
    expect(found.warnings.some((w) => w.includes('{elapsed}'))).toBe(false)
    expect(found.notes).toEqual([
      'overlays[0]: {elapsed} reads the off-camera wait of step "open" (12 minutes), the nearest one before step "save", which waited for nothing itself',
    ])
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

  it('needs no start on an anchored layer, and refuses one placed nowhere, naming its step', () => {
    const doc = takeA()
    const { start: _a, ...placed } = text('a', 0, {
      preset: 'caption',
      anchor: { step: 'save', offset: 0.2 },
    })
    const { start: _b, ...lost } = text('b', 0, {
      preset: 'caption',
      anchor: { step: 'nope' },
    })
    const { start: _c, ...bare } = text('c', 0)
    doc.overlays = [placed, lost, bare] as never
    const { problems, warnings } = lintDoc(doc)
    expect(problems).toEqual([
      'overlays[1].anchor: step "nope" is not in its meta.steps, and the layer has no start to fall back to, so it would play nowhere; re-anchor it, keep the footage that step plays in, or give it a start',
      'overlays[2].start must be ≥ 0 (OUTPUT seconds)',
    ])
    expect(warnings.some((w) => w.includes('overlays[0]'))).toBe(false)
  })

  it('refuses an anchored layer with no start on a program, which has no steps', () => {
    const { start: _s, ...clip } = text('a', 0, { anchor: { step: 'open' } })
    const doc = {
      program: { config: { version: 2, duration: 4 } },
      overlays: [clip],
      audio: [],
    }
    expect(
      lintDoc(doc as never).problems.filter((p) => p.includes('overlays[0]')),
    ).toEqual([
      'overlays[0].anchor: names step "open", but a program document has no recorder steps, and the layer has no start to fall back to; give it a start',
    ])
  })
})
