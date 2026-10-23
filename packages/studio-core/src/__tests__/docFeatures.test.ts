/**
 * The document features a renderer must understand: each found in a
 * document by its predicate, compared against a renderer's release, and
 * baked into what an older renderer reads, on a copy.
 */
import { describe, expect, it } from 'vitest'
import {
  DOC_FEATURES,
  bakeDocFeatures,
  compareVersions,
  docFeatures,
  featuresNewerThan,
} from '../docFeatures'
import { lowerToComposition } from '../lower/lowerToComposition'
import {
  DEFAULT_CAM_STYLE,
  DEFAULT_CURSOR_STYLE,
  DEFAULT_FRAME_STYLE,
} from '../types'
import type { AudioClip, ProjectDoc, TextOverlayClip } from '../types'
import type { ProgramAnchorDoc } from '../doc/studioDoc'

const text = (
  id: string,
  start: number,
  over: Partial<TextOverlayClip> = {},
): TextOverlayClip => ({
  id,
  kind: 'text',
  text: id,
  preset: 'caption',
  start,
  duration: 1,
  transform: { x: 0.5, y: 0.8, scale: 1, rotation: 0 },
  ...over,
})

const score = (over: Partial<AudioClip> = {}): AudioClip => ({
  id: 'score',
  key: 'music/track.mp3',
  name: 'track',
  start: 0,
  in: 0,
  out: 8,
  duration: 30,
  gain: 0.5,
  fadeIn: 0,
  fadeOut: 0,
  ...over,
})

/** 10 s of footage, the first 2 s trimmed; step `save` at 6 s plays at 4 s. */
function take(): ProjectDoc {
  return {
    source: {
      videoKey: 'recording.webm',
      cursor: [],
      meta: {
        dpr: 1,
        zoom: 1,
        t0: 0,
        durationMs: 10_000,
        width: 1280,
        height: 720,
        fps: 30,
        steps: [
          {
            step: 0,
            id: 'save',
            do: 'click',
            tStart: 6,
            tEnd: 6.5,
            offCameraMs: 90_000,
          },
          { step: 1, id: 'gone', do: 'click', tStart: 1, tEnd: 1.2 },
        ],
      },
    },
    segments: [{ in: 2, out: 10 }],
    zoom: [],
    audio: [],
    cursor: DEFAULT_CURSOR_STYLE,
    cam: DEFAULT_CAM_STYLE,
    frame: DEFAULT_FRAME_STYLE,
    export: { resolution: '1080p', fps: 30, format: 'mp4' },
  }
}

describe('compareVersions', () => {
  it('orders releases numerically, a pre-release tag ignored', () => {
    expect(compareVersions('0.43.0', '0.42.4')).toBe(1)
    expect(compareVersions('0.42.10', '0.42.9')).toBe(1)
    expect(compareVersions('0.43.0', '0.43.0')).toBe(0)
    expect(compareVersions('v0.9.0', '0.10.0')).toBe(-1)
    expect(compareVersions('1.0.0-next.1', '1.0.0')).toBe(0)
  })
})

describe('the feature table', () => {
  it('names each feature once, with a release', () => {
    const ids = DOC_FEATURES.map((f) => f.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const f of DOC_FEATURES) expect(f.since).toMatch(/^\d+\.\d+\.\d+$/)
  })

  it('finds nothing in a plain take', () => {
    expect(docFeatures(take())).toEqual([])
  })

  it('finds anchors, {elapsed}, runs and loudness targets where they are', () => {
    const d = take()
    d.overlays = [
      text('a', 0, { anchor: { step: 'save' }, text: '{elapsed} later' }),
      text('b', 1, { anchor: { step: 'gone' } }),
      text('c', 2, { text: [{ text: 'Ship ' }, { text: 'it', weight: 700 }] }),
      // `{elapsed}` with no anchor is shown as written by every release.
      text('d', 3, { text: '{elapsed}' }),
    ]
    d.audio = [
      score({
        normalize: -16,
        loudness: {
          lufs: -20,
          peakDb: -3,
          at: '2026-10-22T00:00:00.000Z',
          src: 'music/track.mp3',
        },
      }),
      // A target with no measurement plays at its gain everywhere.
      score({ id: 'sfx', key: 'sfx.wav', normalize: -16 }),
    ]
    expect(docFeatures(d).map((u) => [u.feature.id, u.count] as const)).toEqual(
      [
        ['text-runs', 1],
        ['overlay-anchor', 2],
        ['text-elapsed', 1],
        ['audio-normalize', 1],
      ],
    )
    expect(featuresNewerThan(d, '0.42.4').map((u) => u.feature.id)).toEqual([
      'overlay-anchor',
      'text-elapsed',
      'audio-normalize',
    ])
    expect(featuresNewerThan(d, '0.43.0').map((u) => u.feature.id)).toEqual([
      'audio-normalize',
    ])
    expect(featuresNewerThan(d, '0.44.0')).toEqual([])
  })

  it('reads a program document too', () => {
    const p: ProgramAnchorDoc = {
      program: { config: { version: 2, duration: 4 } },
      overlays: [text('a', 0.5, { anchor: { step: 'x' } })],
      audio: [],
    }
    expect(docFeatures(p).map((u) => u.feature.id)).toEqual(['overlay-anchor'])
    const baked = bakeDocFeatures(p, '0.42.4')
    expect(baked.doc.overlays?.[0]).not.toHaveProperty('anchor')
    expect(baked.doc.overlays?.[0].start).toBe(0.5)
  })
})

describe('bakeDocFeatures', () => {
  it('bakes an anchored caption into the start it plays at, its {elapsed} filled', () => {
    const d = take()
    d.overlays = [
      text('a', 0, { anchor: { step: 'save' }, text: '{elapsed} later' }),
      text('b', 1.5, { anchor: { step: 'gone' } }),
    ]
    const before = structuredClone(d)
    const r = bakeDocFeatures(d, '0.42.4')
    expect(d).toEqual(before)
    expect(r.baked.map((f) => f.id)).toEqual(['overlay-anchor', 'text-elapsed'])
    expect(r.unbakeable).toEqual([])
    const [a, b] = r.doc.overlays as TextOverlayClip[]
    expect(a).not.toHaveProperty('anchor')
    expect(a.start).toBe(4)
    expect(a.text).toBe('2 minutes later')
    // A step trimmed out of the cut keeps its fallback start, and says so.
    expect(b).not.toHaveProperty('anchor')
    expect(b.start).toBe(1.5)
    expect(r.notes).toEqual([
      'overlay b: its step is cut out of the film, so it plays at its fallback start (1.50s)',
    ])
    // The baked document plays as the anchored one does.
    expect(featuresNewerThan(r.doc, '0.42.4')).toEqual([])
    const lowered = (x: ProjectDoc) =>
      JSON.stringify(lowerToComposition(x).stack)
    expect(lowered(r.doc as ProjectDoc)).toBe(lowered(d))
  })

  it('bakes a loudness target into the gain, and says when 1 is not enough', () => {
    const d = take()
    const at = '2026-10-22T00:00:00.000Z'
    d.audio = [
      // -10 LUFS to -16: ×0.5 then the 0.5 trim.
      score({
        normalize: -16,
        loudness: { lufs: -10, peakDb: -1, at, src: 'music/track.mp3' },
      }),
      // -30 to -16 at a full trim: ×5, more than an older renderer plays.
      score({
        id: 'quiet',
        key: 'quiet.wav',
        gain: 1,
        normalize: -16,
        loudness: { lufs: -30, peakDb: -30, at, src: 'quiet.wav' },
      }),
    ]
    const r = bakeDocFeatures(d, '0.43.0')
    expect(r.baked.map((f) => f.id)).toEqual(['audio-normalize'])
    const [a, q] = r.doc.audio
    expect(a).not.toHaveProperty('normalize')
    expect(a.gain).toBe(Math.round(Math.pow(10, -6 / 20) * 0.5 * 1000) / 1000)
    expect(q.gain).toBe(1)
    expect(r.notes).toEqual([
      'audio quiet: its target asks for gain 5.01, which an older renderer cannot play; baked at 1, so it plays 14.0 dB quieter than asked',
    ])
  })

  it('names a feature it cannot bake', () => {
    const d = take()
    d.overlays = [text('c', 2, { text: [{ text: 'bold', weight: 700 }] })]
    const r = bakeDocFeatures(d, '0.37.0')
    expect(r.baked).toEqual([])
    expect(r.unbakeable.map((f) => f.id)).toEqual(['text-runs'])
  })
})
