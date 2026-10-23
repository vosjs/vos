/**
 * A layer anchored to a step needs no `start`: the anchor places it. The
 * lowering, the lanes, the still, the output length and the pin resolver
 * read where the step plays; a layer whose step resolves nowhere and that
 * has no start to fall back to plays nowhere (it is left out, never put at
 * 0); and a layer that does carry a start keeps it as its fallback.
 */
import { describe, expect, it } from 'vitest'
import { docOutputDuration } from '../audioBeds'
import { bakeDocFeatures, docFeatures } from '../docFeatures'
import { layerStart } from '../lower/anchor'
import {
  lowerToComposition,
  ratedSegments,
  resolvePins,
} from '../lower/lowerToComposition'
import { lowerProgramDoc } from '../lower/lowerStudioDoc'
import { docStillTime } from '../lower/motion'
import { STUDIO_ENTRY_ID } from '../lower/studioEntry'
import { cameraModel, docCardLayout } from '../layout'
import { overlaysLane } from '../timeline/lanes'
import {
  DEFAULT_CAM_STYLE,
  DEFAULT_CURSOR_STYLE,
  DEFAULT_FRAME_STYLE,
} from '../types'
import type { ProgramAnchorDoc } from '../doc/studioDoc'
import type { OverlayClip, ProjectDoc, TextOverlayClip } from '../types'

const caption = (
  id: string,
  over: Partial<TextOverlayClip> = {},
): TextOverlayClip => {
  const clip: TextOverlayClip = {
    id,
    kind: 'text',
    text: id,
    preset: 'caption',
    start: 0,
    duration: 1,
    transform: { x: 0.5, y: 0.85, scale: 1, rotation: 0 },
    ...over,
  }
  if (!('start' in over)) delete clip.start
  return clip
}

function take(overlays: OverlayClip[]): ProjectDoc {
  return {
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
          {
            step: 0,
            id: 'open',
            do: 'click',
            tStart: 0.2,
            tEnd: 0.5,
            rect: { x: 600, y: 300, w: 80, h: 30 },
          },
          { step: 1, id: 'save', do: 'click', tStart: 6, tEnd: 6.4 },
          { step: 2, id: 'cut', do: 'click', tStart: 9, tEnd: 9.4 },
        ],
      },
    },
    // Source 0..8 then nothing: step `cut` (9 s) is out of the film.
    segments: [{ in: 0, out: 8 }],
    zoom: [],
    audio: [],
    cursor: DEFAULT_CURSOR_STYLE,
    cam: DEFAULT_CAM_STYLE,
    frame: DEFAULT_FRAME_STYLE,
    export: { resolution: '720p', fps: 30, format: 'mp4' },
    overlays,
  }
}

const entryOverlays = (d: ProjectDoc) =>
  (
    lowerToComposition(d).stack[STUDIO_ENTRY_ID] as {
      overlays?: { id: string; start: number }[]
    }
  ).overlays ?? []

describe('an anchored layer with no start', () => {
  it('plays where its step plays', () => {
    const d = take([caption('a', { anchor: { step: 'save', offset: 0.25 } })])
    expect(entryOverlays(d)).toEqual([
      expect.objectContaining({ id: 'a', start: 6.25 }),
    ])
    expect(layerStart(d.overlays![0], d, ratedSegments(d))).toBe(6.25)
    const lane = overlaysLane.items(d)
    expect(lane[0]).toMatchObject({ id: 'a', t: 6.25, duration: 1 })
    expect(overlaysLane.magnets!(d)).toEqual([6.25, 7.25])
  })

  it('plays nowhere when its step resolves nowhere, and is never put at 0', () => {
    const d = take([
      caption('lost', { anchor: { step: 'cut' } }),
      caption('kept', { anchor: { step: 'cut' }, start: 2 }),
    ])
    expect(entryOverlays(d).map((o) => [o.id, o.start])).toEqual([['kept', 2]])
    expect(overlaysLane.items(d).map((i) => i.id)).toEqual(['kept'])
    expect(layerStart(d.overlays![0], d, ratedSegments(d))).toBeNull()
  })

  it('lengthens the output and leads the still like a layer with a start', () => {
    // An ending after the footage: the step plus an offset past 8 s.
    const ending = take([
      caption('end', { anchor: { step: 'save', offset: 2.5 }, duration: 2 }),
    ])
    expect(docOutputDuration(ending)).toBeCloseTo(10.5, 6)
    // A layer entering at the opening holds the cover until it has entered.
    const opening = take([
      caption('hi', {
        anchor: { step: 'open' },
        anim: { enter: { kind: 'rise', seconds: 1 } },
      }),
    ])
    const plain = take([])
    expect(docStillTime(opening)).toBeGreaterThan(docStillTime(plain))
  })

  it('is placed beside its referent through its anchored life', () => {
    const d = take([
      caption('p', { anchor: { step: 'open' }, pin: { step: 'open' } }),
    ])
    const pins = resolvePins(
      d,
      docCardLayout(d),
      cameraModel(d.frame),
      lowerToComposition(d).data.zoomTrack as never,
    )
    expect(pins.has('p')).toBe(true)
  })

  it('is a feature an older renderer cannot read, baked into the start it resolves to', () => {
    const d = take([
      caption('a', { anchor: { step: 'save' } }),
      caption('lost', { anchor: { step: 'cut' } }),
    ])
    expect(
      docFeatures(d).find((u) => u.feature.id === 'anchor-without-start')
        ?.count,
    ).toBe(2)
    const baked = bakeDocFeatures(d, '0.44.0')
    const overlays = (baked.doc as ProjectDoc).overlays!
    expect(overlays.map((o) => [o.id, o.start, 'anchor' in o])).toEqual([
      ['a', 6, false],
    ])
    expect(baked.notes).toContainEqual(
      expect.stringContaining(
        'overlay lost: its step is cut out of the film, so it has no time',
      ),
    )
  })

  it('on a program, which has no steps, plays nowhere', () => {
    const doc = {
      program: { config: { version: 2, duration: 4 } },
      audio: [],
      overlays: [
        caption('a', { anchor: { step: 'save' } }),
        caption('b', { start: 1 }),
      ],
    } as unknown as ProgramAnchorDoc
    const low = lowerProgramDoc(doc)
    const entry = (
      low.config.stack as { id: string; data: Record<string, unknown> }[]
    ).find((e) => e.id === STUDIO_ENTRY_ID)!.data as {
      overlays: { id: string }[]
    }
    expect(entry.overlays.map((o) => o.id)).toEqual(['b'])
  })
})
