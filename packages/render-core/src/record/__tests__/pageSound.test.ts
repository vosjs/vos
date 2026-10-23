import { describe, expect, it } from 'vitest'
import { PageSoundLog, soundSrcForMeta } from '../pageSound'
import type { MediaNote } from '../pageSound'
import { TakeClock } from '../takeClock'
import { withPageSound } from '../plan'
import type { ProjectDoc } from '@vosjs/studio-core'

/**
 * The page's media notes in the recorder's clock: a stretch heard across
 * an off-camera wait is two stretches, a navigation ends what the old page
 * played, and the plan places one clip per stretch at its output time.
 */
const note = (over: Partial<MediaNote>): MediaNote => ({
  id: 1,
  tag: 'audio',
  src: 'https://app.test/voice.mp3?sig=1',
  kind: 'playing',
  wall: 0,
  t: 0,
  rate: 1,
  paused: false,
  audible: true,
  volume: 0.8,
  duration: 10,
  ab: null,
  ...over,
})

describe('PageSoundLog', () => {
  it('splits a stretch at an off-camera wait and keeps the media time running', () => {
    const clock = new TakeClock(1000)
    const log = new PageSoundLog()
    log.add({ now: 2000, doc: 'a', notes: [note({ wall: 2000 })] }, 2000, 0)
    clock.pause(3000)
    clock.resume(5000)
    log.add(
      {
        now: 6000,
        doc: 'a',
        notes: [note({ kind: 'pause', wall: 6000, t: 4, paused: true })],
      },
      6000,
      1,
    )
    const [h] = log.heard(clock, 7000, 10_000)
    expect(h.src).toBe('https://app.test/voice.mp3?sig=1')
    expect(h.meta).toMatchObject({
      step: 0,
      src: 'https://app.test/voice.mp3',
      volume: 0.8,
      intervals: [
        { at: 1, from: 0, to: 1 },
        { at: 2, from: 3, to: 4 },
      ],
    })
  })

  it('ends what a page played when the page is gone, and reads the page clock through its skew', () => {
    const clock = new TakeClock(0)
    const log = new PageSoundLog()
    // The page's clock runs 500 ms behind the recorder's.
    log.add({ now: 500, doc: 'a', notes: [note({ wall: 500 })] }, 1000)
    log.add({ now: 2500, doc: 'a', notes: [] }, 3000)
    log.add({ now: 9000, doc: 'b', notes: [] }, 9500)
    const [h] = log.heard(clock, 10_000, 20_000)
    expect(h.meta.intervals).toEqual([{ at: 1, from: 0, to: 2 }])
  })

  it('says a muted play is not heard, and a video that decoded no sound is not either', () => {
    const clock = new TakeClock(0)
    const log = new PageSoundLog()
    log.add(
      {
        now: 0,
        doc: 'a',
        notes: [
          note({ id: 1, tag: 'video', audible: false, src: '/bg.webm' }),
          note({ id: 2, tag: 'video', ab: 0, src: '/silent.webm' }),
        ],
      },
      0,
    )
    const heard = log.heard(clock, 3000, 5000)
    expect(heard.map((h) => h.meta.muted)).toEqual([true, true])
    expect(heard.every((h) => h.meta.intervals.length === 0)).toBe(true)
  })

  it('keeps no query, and a blob or data address by its scheme', () => {
    expect(soundSrcForMeta('https://a.test/x.mp3?token=1#t')).toBe(
      'https://a.test/x.mp3',
    )
    expect(soundSrcForMeta('blob:https://a.test/123')).toBe('blob:')
    expect(soundSrcForMeta('data:audio/wav;base64,AAAA')).toBe(
      'data:audio/wav;',
    )
  })
})

describe('withPageSound', () => {
  const doc = (): ProjectDoc =>
    ({
      source: { meta: { durationMs: 10_000 } },
      segments: [{ in: 0, out: 10 }],
      speed: [
        { id: 's1', in: 0, out: 2, rate: 2, source: 'auto' },
        { id: 's2', in: 4, out: 6, rate: 2, source: 'auto' },
      ],
      audio: [
        {
          id: 'bed',
          key: 'music/bed.mp3',
          name: 'bed',
          start: 0,
          in: 0,
          out: 9,
          duration: 9,
          gain: 0.4,
          fadeIn: 0,
          fadeOut: 0,
        },
        {
          id: 'old',
          key: 'page-sound/old.mp3',
          name: 'old',
          start: 1,
          in: 0,
          out: 1,
          duration: 1,
          gain: 1,
          fadeIn: 0,
          fadeOut: 0,
          source: 'page',
        },
      ],
    }) as unknown as ProjectDoc

  it('places one clip per stretch at its output time and replaces only page clips', () => {
    const d = withPageSound(doc(), [
      {
        src: 'https://app.test/voice.mp3',
        file: 'page-sound/voice.mp3',
        duration: 3,
        volume: 0.5,
        intervals: [{ at: 4.5, from: 0, to: 1.5 }],
      },
      { src: 'https://app.test/bg.webm', intervals: [], muted: true },
    ])
    // The auto speed over the heard stretch went; the one before it stayed,
    // so the clip sits at 1 s (0..2 at 2x) + 2.5 s.
    expect(d.speed?.map((s) => s.id)).toEqual(['s1'])
    expect(d.audio.map((a) => a.id)).toEqual(['bed', 'page-1-1'])
    expect(d.audio[1]).toMatchObject({
      key: 'page-sound/voice.mp3',
      name: 'voice.mp3',
      start: 3.5,
      in: 0,
      out: 1.5,
      duration: 3,
      gain: 0.5,
      source: 'page',
    })
  })

  it('places nothing for a stretch with no file, and still clears the old page clips', () => {
    const d = withPageSound(doc(), [
      {
        src: 'https://app.test/voice.mp3',
        intervals: [{ at: 1, from: 0, to: 1 }],
      },
    ])
    expect(d.audio.map((a) => a.id)).toEqual(['bed'])
    expect(d.speed).toHaveLength(2)
  })
})
