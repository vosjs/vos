import { describe, expect, it } from 'vitest'
import {
  filmSummaryOf,
  musicSlugsOfDoc,
  programSceneTimes,
} from '../filmSummary'
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

function take(
  overlays: OverlayClip[],
  over: Partial<ProjectDoc> = {},
  source: Partial<ProjectDoc['source']> = {},
): ProjectDoc {
  return {
    source: {
      videoKey: 'recording.webm',
      cursor: [],
      meta: {
        dpr: 1,
        zoom: 1,
        t0: 0,
        durationMs: 20000,
        width: 1280,
        height: 720,
        fps: 30,
        steps: [
          { step: 0, id: 'open', do: 'click', tStart: 0.2, tEnd: 0.5 },
          { step: 1, id: 'save', do: 'click', tStart: 6, tEnd: 6.4 },
          {
            step: 2,
            id: 'go',
            do: 'click',
            tStart: 11.5,
            tEnd: 12,
            navigated: true,
          },
          { step: 3, id: 'share', do: 'click', tStart: 14, tEnd: 14.4 },
        ],
      },
      ...source,
    },
    segments: [{ in: 0, out: 20 }],
    zoom: [],
    audio: [],
    cursor: DEFAULT_CURSOR_STYLE,
    cam: DEFAULT_CAM_STYLE,
    frame: DEFAULT_FRAME_STYLE,
    export: { resolution: '720p', fps: 30, format: 'mp4' },
    overlays,
    ...over,
  }
}

describe('filmSummaryOf, a recording', () => {
  it('reads the length, the layers, the page change and the joins as cuts', () => {
    const d = take(
      [caption('a', { anchor: { step: 'save' } }), caption('b', { start: 2 })],
      {
        segments: [
          { in: 0, out: 8 },
          { in: 10, out: 20 },
        ],
      },
    )
    const s = filmSummaryOf(d, { seed: 'x' })
    expect(s.duration).toBe(18)
    // The layer at 2, the caption on `save` (6), the join at 8, the page
    // change at the end of `go` (12 in source = 10 output), and the end
    // of the second piece is the film's end, so it is not a cut.
    expect(s.cuts).toEqual([2, 6, 8, 10])
    expect(s.voice).toBe(false)
    expect(s.seed).toBe('x')
    // No marked step: the payoff is the last cut.
    expect(s.payoff).toBe(10)
  })

  it("takes the payoff from the script's zoom mark, and --at over it", () => {
    const d = take(
      [caption('a', { anchor: { step: 'save' } })],
      {},
      {
        script: {
          steps: [
            { id: 'open', do: 'click' },
            { id: 'save', do: 'click', zoom: true },
            { id: 'go', do: 'click' },
            { id: 'share', do: 'click', zoom: true },
          ],
        },
      },
    )
    const s = filmSummaryOf(d, { seed: 'x' })
    expect(s.payoff).toBe(14)
    expect(s.cuts).toContain(14)
    expect(filmSummaryOf(d, { seed: 'x', payoff: 3 }).payoff).toBe(3)
    // A payoff past the film is no payoff.
    expect(filmSummaryOf(d, { seed: 'x', payoff: 99 }).payoff).toBeUndefined()
  })

  it('hears a voice from the mic, from a voiceover clip, never from music', () => {
    expect(filmSummaryOf(take([]), { seed: 'x' }).voice).toBe(false)
    expect(
      filmSummaryOf(take([], {}, { micKey: 'mic.webm' }), { seed: 'x' }).voice,
    ).toBe(true)
    const clip = (key: string) => ({
      id: 'c',
      key,
      name: 'c',
      start: 0,
      in: 0,
      out: 5,
      duration: 5,
      gain: 1,
      fadeIn: 0,
      fadeOut: 0,
    })
    expect(
      filmSummaryOf(take([], { audio: [clip('voiceover.m4a')] }), { seed: 'x' })
        .voice,
    ).toBe(true)
    expect(
      filmSummaryOf(
        take([], {
          audio: [
            clip('https://assets.vos.so/music/late-summer.mp3'),
            clip('https://assets.vos.so/audio-sfx/sfx-click.wav'),
          ],
        }),
        { seed: 'x' },
      ).voice,
    ).toBe(false)
    expect(filmSummaryOf(take([]), { seed: 'x', voice: true }).voice).toBe(true)
  })

  it("carries the ask and the project's beds through", () => {
    const s = filmSummaryOf(take([]), {
      seed: 'x',
      mood: 'chill',
      words: 'soft piano',
      like: ['arpent'],
      fadeIn: true,
    })
    expect(s).toMatchObject({
      mood: 'chill',
      words: 'soft piano',
      like: ['arpent'],
      fadeIn: true,
    })
  })
})

describe('filmSummaryOf, a program', () => {
  const program: ProgramAnchorDoc = {
    program: {
      config: {
        version: 2,
        duration: 12,
        createTimeline:
          '(ctx) => { const tl = ctx.gsap.timeline(); tl.addLabel(\'open\', 0); tl.addLabel("reveal", 4.5); tl.addLabel(`end`, 10); return tl }',
      },
    },
    audio: [],
    overlays: [],
  } as unknown as ProgramAnchorDoc

  it('reads scene labels as cuts and the last scene as the payoff', () => {
    expect(programSceneTimes(program.program.config)).toEqual([4.5, 10])
    const s = filmSummaryOf(program, { seed: 'p' })
    expect(s.duration).toBe(12)
    expect(s.cuts).toEqual([4.5, 10])
    expect(s.payoff).toBe(10)
    expect(s.voice).toBe(false)
  })
})

describe('musicSlugsOfDoc', () => {
  it('names the library tracks a document plays, once each, sorted', () => {
    const clip = (id: string, key: string) => ({
      id,
      key,
      name: id,
      start: 0,
      in: 0,
      out: 5,
      duration: 5,
      gain: 1,
      fadeIn: 0,
      fadeOut: 0,
    })
    expect(
      musicSlugsOfDoc({
        audio: [
          clip('a', 'https://assets.vos.so/music/rooftop.mp3'),
          clip('b', 'https://assets.vos.so/music/arpent.mp3?v=1'),
          clip('c', 'https://assets.vos.so/music/rooftop.mp3'),
          clip('d', 'voice.m4a'),
        ],
      }),
    ).toEqual(['arpent', 'rooftop'])
  })
})
