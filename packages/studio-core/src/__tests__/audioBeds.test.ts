import { describe, expect, it } from 'vitest'
import {
  docOutputDuration,
  isMusicBed,
  musicBedClip,
  refillAudioBeds,
} from '../audioBeds'
import {
  DEFAULT_CAM_STYLE,
  DEFAULT_CURSOR_STYLE,
  DEFAULT_FRAME_STYLE,
  clipLength,
} from '../types'
import type { AudioClip, ProjectDoc } from '../types'

function makeDoc(audio: AudioClip[] = [], out = 20): ProjectDoc {
  return {
    source: {
      videoKey: 'blob:v',
      cursor: [],
      meta: {
        dpr: 1,
        zoom: 1,
        t0: 0,
        durationMs: out * 1000,
        width: 1600,
        height: 900,
        fps: 30,
      },
      sourceKind: 'video',
    },
    segments: [{ in: 0, out }],
    zoom: [],
    audio,
    cursor: DEFAULT_CURSOR_STYLE,
    cam: DEFAULT_CAM_STYLE,
    frame: DEFAULT_FRAME_STYLE,
    export: { resolution: '1080p', fps: 30, format: 'mp4' },
  }
}

const bed = (over: Partial<AudioClip> = {}): AudioClip => ({
  id: 'bed',
  key: 'https://assets.vos.so/music/fresh-focus.mp3',
  name: 'Fresh Focus',
  start: 0,
  in: 0,
  out: 10,
  duration: 124.1,
  gain: 0.5,
  fadeIn: 0,
  fadeOut: 1.5,
  ...over,
})

describe('docOutputDuration', () => {
  it('is the rate-aware output length', () => {
    expect(docOutputDuration(makeDoc([], 20))).toBe(20)
    const doc = makeDoc([], 20)
    doc.speed = [{ id: 's', in: 0, out: 10, rate: 2 }]
    expect(docOutputDuration(doc)).toBe(15)
  })
})

describe('musicBedClip', () => {
  it('trims a long track to the cut, starting at 0', () => {
    const clip = musicBedClip({
      id: 'a',
      key: 'k',
      name: 'n',
      trackDuration: 124.1,
      outputDuration: 20,
      hasMic: true,
    })
    expect(clip.start).toBe(0)
    expect(clip.out).toBe(20)
    expect(clip.loop).toBeUndefined()
    expect(clip.gain).toBe(0.5)
    expect(clip.fadeOut).toBe(1.5)
    expect(clip.duck).toBe(true)
    expect(clipLength(clip)).toBe(20)
  })

  it('loops a short track to fill the cut', () => {
    const clip = musicBedClip({
      id: 'a',
      key: 'k',
      name: 'n',
      trackDuration: 27.8,
      outputDuration: 60,
      hasMic: false,
    })
    expect(clip.out).toBe(27.8)
    expect(clip.loop).toBe(true)
    expect(clip.loopLen).toBe(60)
    expect(clip.duck).toBeUndefined()
    expect(clipLength(clip)).toBe(60)
  })

  it('clamps the fade on a very short cut', () => {
    const clip = musicBedClip({
      id: 'a',
      key: 'k',
      name: 'n',
      trackDuration: 124.1,
      outputDuration: 4,
      hasMic: false,
    })
    expect(clip.fadeOut).toBe(1)
  })
})

describe('isMusicBed', () => {
  it('recognizes looping and cut-covering clips at 0', () => {
    expect(isMusicBed(bed({ out: 20 }), 20)).toBe(true)
    expect(
      isMusicBed(bed({ out: 10, loop: true, loopLen: 20, duration: 10 }), 20),
    ).toBe(true)
  })

  it('rejects moved or shortened clips (the user took them over)', () => {
    expect(isMusicBed(bed({ start: 3, out: 23 }), 20)).toBe(false)
    expect(isMusicBed(bed({ out: 8 }), 20)).toBe(false)
  })
})

describe('refillAudioBeds', () => {
  it('extends a trimmed bed when the cut grows', () => {
    const doc = makeDoc([bed({ out: 20 })])
    expect(refillAudioBeds(doc, 20, 30)).toBe(true)
    expect(doc.audio[0].out).toBe(30)
    expect(doc.audio[0].loop).toBeUndefined()
  })

  it('shrinks a trimmed bed when the cut shrinks', () => {
    const doc = makeDoc([bed({ out: 20 })])
    expect(refillAudioBeds(doc, 20, 12)).toBe(true)
    expect(doc.audio[0].out).toBe(12)
  })

  it('flips a trimmed bed to loop when the cut outgrows the file', () => {
    const doc = makeDoc([bed({ out: 20, duration: 25 })])
    expect(refillAudioBeds(doc, 20, 40)).toBe(true)
    expect(doc.audio[0].out).toBe(25)
    expect(doc.audio[0].loop).toBe(true)
    expect(doc.audio[0].loopLen).toBe(40)
    expect(clipLength(doc.audio[0])).toBe(40)
  })

  it('re-fills a looping bed to the new duration', () => {
    const doc = makeDoc([
      bed({ out: 27.8, duration: 27.8, loop: true, loopLen: 60 }),
    ])
    expect(refillAudioBeds(doc, 60, 45)).toBe(true)
    expect(doc.audio[0].loopLen).toBe(45)
  })

  it('flips a looping bed back to a trim when the cut fits one pass', () => {
    const doc = makeDoc([
      bed({ out: 27.8, duration: 27.8, loop: true, loopLen: 60 }),
    ])
    expect(refillAudioBeds(doc, 60, 15)).toBe(true)
    expect(doc.audio[0].loop).toBeUndefined()
    expect(doc.audio[0].out).toBe(15)
    expect(clipLength(doc.audio[0])).toBe(15)
  })

  it('leaves clips that did not track the output end alone', () => {
    const sfx = bed({ id: 'fx', start: 5, out: 6, duration: 1.4 })
    const doc = makeDoc([sfx])
    expect(refillAudioBeds(doc, 20, 30)).toBe(false)
    expect(doc.audio[0]).toEqual(sfx)
  })

  it('no-ops when the duration is unchanged', () => {
    const doc = makeDoc([bed({ out: 20 })])
    expect(refillAudioBeds(doc, 20, 20.01)).toBe(false)
  })
})
