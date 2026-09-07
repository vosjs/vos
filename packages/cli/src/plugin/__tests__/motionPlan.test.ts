import { describe, expect, it } from 'vitest'
import { DEFAULT_CAM_STYLE, DEFAULT_CURSOR_STYLE } from '@vosjs/studio-core'
import {
  clickTimes,
  destinationMechanics,
  endCardInk,
  pickTrack,
  proposeMotion,
} from '../motionPlan'
import { applyDocOverrides } from '../docOverride'
import { lintDoc } from '../validateDoc'
import type { MusicCatalog } from '../motionPlan'
import type { ProjectDoc } from '@vosjs/studio-core'

function doc(): ProjectDoc {
  return {
    source: {
      videoKey: 'blob:recording',
      cursor: [
        { t: 0, x: 10, y: 10, type: 'move' },
        { t: 4000, x: 100, y: 100, type: 'down', button: 0 },
        { t: 4050, x: 100, y: 100, type: 'up', button: 0 },
        { t: 9000, x: 300, y: 100, type: 'down', button: 0 },
        { t: 9060, x: 300, y: 100, type: 'up', button: 0 },
      ],
      meta: {
        dpr: 1,
        zoom: 1,
        t0: 0,
        durationMs: 34000,
        width: 1920,
        height: 1080,
        fps: 30,
        steps: [
          { step: 0, id: 'settle', do: 'wait', tStart: 0, tEnd: 0.9 },
          { step: 1, id: 'hover', do: 'hover', tStart: 0.9, tEnd: 3.5 },
          { step: 2, id: 'open', do: 'click', tStart: 3.5, tEnd: 4.2 },
          { step: 3, id: 'loads', do: 'wait', tStart: 4.2, tEnd: 7 },
        ],
      },
    },
    segments: [{ in: 0, out: 34 }],
    zoom: [],
    audio: [],
    cursor: DEFAULT_CURSOR_STYLE,
    cam: DEFAULT_CAM_STYLE,
    frame: {
      background: '#111',
      padding: 48,
      radius: 12,
      shadow: 0.4,
      border: 0,
      aspectRatio: 'native',
      browserBar: {
        kind: 'none',
        url: '',
        showUrl: true,
        showControls: true,
        height: 44,
      },
    },
    export: { resolution: '1080p', fps: 30, format: 'mp4' },
  }
}

const catalog: MusicCatalog = {
  tracks: [
    {
      slug: 'fresh-focus',
      title: 'Fresh Focus',
      mood: 'upbeat',
      duration: 124,
      url: 'https://x/fresh.mp3',
    },
    {
      slug: 'slow-tide',
      title: 'Slow Tide',
      mood: 'calm',
      duration: 40,
      url: 'https://x/tide.mp3',
    },
  ],
  sfx: [
    {
      slug: 'sfx-click',
      title: 'Click',
      duration: 0.07,
      url: 'https://x/click.wav',
    },
  ],
}

const feed = {
  id: 'x-feed-cut',
  kind: 'video' as const,
  px: { w: 1920, h: 1080 },
  text: 'allowed' as const,
}
const loop = {
  id: 'github-readme-loop',
  kind: 'video' as const,
  px: { w: 1920, h: 1080 },
  text: 'none' as const,
}
const silent = {
  id: 'linkedin-feed-cut',
  kind: 'video' as const,
  px: { w: 1920, h: 1080 },
  text: 'allowed' as const,
}
const vertical = {
  id: 'shorts-linkedin-vertical-cut',
  kind: 'video' as const,
  px: { w: 1080, h: 1920 },
  text: 'expected' as const,
}

describe('proposeMotion (the cut’s motion as data on the document)', () => {
  it('writes the entrance, the end card, a caption per beat, a bed and clicks onto the document', () => {
    const p = proposeMotion(doc(), {
      words: { headline: 'Ship it', brand: 'vosso', release: '1.7' },
      launch: { music: 'upbeat' },
      captions: [{ step: 1, id: 'hover', caption: 'Every program is a video' }],
      catalog,
    })
    expect(p.doc.frame.entrance).toEqual({ kind: 'tilt-in' })
    expect(p.doc.endCard).toEqual({
      seconds: 2.5,
      headline: 'Ship it',
      sub: 'vosso 1.7',
      wordmark: 'vosso',
    })
    expect(p.doc.overlays).toHaveLength(1)
    expect(p.doc.overlays?.[0]).toMatchObject({
      id: 'caption-1',
      text: 'Every program is a video',
    })
    expect(p.doc.overlays?.[0].start).toBeCloseTo(3.7, 3)
    expect(p.doc.audio[0]).toMatchObject({
      id: 'bed',
      key: 'https://x/fresh.mp3',
      start: 0,
    })
    expect(
      p.doc.audio.filter((a) => a.id.startsWith('click-')).map((a) => a.start),
    ).toEqual([4, 9])
    expect(p.notes).toEqual([
      'entrance tilt-in',
      'end card',
      '1 caption(s)',
      'bed fresh-focus',
      '2 click sound(s)',
    ])
    // The document it writes is a document the lint accepts.
    expect(lintDoc(p.doc).problems).toEqual([])
    // Pure: the input is untouched.
    expect(doc().endCard).toBeUndefined()
  })

  it('replaces only its own proposals on a second pass and keeps the maker’s clips', () => {
    const first = proposeMotion(doc(), {
      words: { brand: 'vosso' },
      launch: { music: 'calm' },
      captions: [{ step: 1, caption: 'one' }],
      catalog,
    }).doc
    first.overlays = [
      ...(first.overlays ?? []),
      {
        id: 'mine',
        kind: 'text',
        text: 'my title',
        preset: 'title',
        start: 0,
        duration: 2,
        transform: { x: 0.5, y: 0.5, scale: 1, rotation: 0 },
      },
    ]
    first.audio.push({
      id: 'voice',
      key: 'https://x/voice.mp3',
      name: 'voice',
      start: 1,
      in: 0,
      out: 3,
      duration: 3,
      gain: 1,
      fadeIn: 0,
      fadeOut: 0,
    })
    const again = proposeMotion(first, {
      words: { brand: 'vosso' },
      launch: { music: 'upbeat', captions: 'none' },
      captions: [{ step: 1, caption: 'one' }],
      catalog,
    }).doc
    expect(again.overlays?.map((o) => o.id)).toEqual(['mine'])
    expect(again.audio.map((a) => a.id)).toEqual([
      'voice',
      'bed',
      'click-0',
      'click-1',
    ])
    expect(again.audio.find((a) => a.id === 'bed')?.key).toBe(
      'https://x/fresh.mp3',
    )
  })

  it('roles switch things off and say what could not be proposed', () => {
    const p = proposeMotion(doc(), {
      words: {},
      launch: {
        entrance: 'none',
        endCard: 'none',
        music: 'jazz-that-is-not-there',
        clicks: 'none',
      },
      captions: [],
      catalog,
    })
    expect(p.doc.frame.entrance).toBeUndefined()
    expect(p.doc.endCard).toBeUndefined()
    expect(p.doc.audio).toEqual([])
    expect(p.skipped[0]).toMatch(
      /music "jazz-that-is-not-there" is not a catalog track or mood/,
    )
  })

  it('a bed loops to fill a longer cut and a mic ducks it; no clicks under a mic', () => {
    const d = doc()
    d.source.micKey = 'blob:mic'
    d.segments = [{ in: 0, out: 60 }]
    d.source.meta.durationMs = 60000
    const p = proposeMotion(d, {
      words: { brand: 'vosso' },
      launch: { music: 'slow-tide' },
      captions: [],
      catalog,
    })
    expect(p.doc.audio[0]).toMatchObject({
      id: 'bed',
      loop: true,
      loopLen: 60,
      duck: true,
      gain: 0.35,
    })
    expect(p.doc.audio.filter((a) => a.id.startsWith('click-'))).toHaveLength(0)
  })

  it('pickTrack and clickTimes', () => {
    expect(pickTrack(catalog, 'calm')!.slug).toBe('slow-tide')
    expect(pickTrack(catalog, 'none')).toBeNull()
    expect(pickTrack(null, 'upbeat')).toBeNull()
    expect(clickTimes(doc(), [3, 34])).toEqual([1, 6])
  })

  it('the end card’s ink follows the ground', () => {
    expect(endCardInk(null, null)).toBeNull()
    expect(
      endCardInk({ kind: 'dark', ground: '#07080b' } as never, {
        ink: '#123456',
      }),
    ).toBe('#ffffff')
    expect(
      endCardInk({ kind: 'plate', ground: '#f0f2f4' } as never, {
        ink: '#123456',
      }),
    ).toBe('#123456')
    expect(
      endCardInk({ kind: 'plate', ground: '#f0f2f4' } as never, null),
    ).toBe('#111111')
  })
})

describe('destinationMechanics (what the spec does at render time)', () => {
  const proposed = proposeMotion(doc(), {
    words: { headline: 'Ship it', brand: 'vosso' },
    launch: { music: 'upbeat' },
    captions: [{ step: 1, caption: 'x' }],
    catalog,
  }).doc

  it('a feed cut that plays sound keeps the document as it is', () => {
    const m = destinationMechanics(feed, proposed)
    expect(m.set).toEqual([])
    expect(m.unset).toEqual([])
  })

  it('a loop drops the entrance, the end card, the captions and the sound, and the result lints', () => {
    const m = destinationMechanics(loop, proposed)
    const d = structuredClone(proposed)
    applyDocOverrides(d, { set: m.set, unset: m.unset })
    expect(d.frame.entrance).toBeUndefined()
    expect(d.endCard).toBeUndefined()
    expect(d.audio).toEqual([])
    expect(d.overlays).toEqual([])
    expect(lintDoc(d).problems).toEqual([])
    expect(m.notes).toEqual(['loop: no entrance, no end card', 'no captions'])
  })

  it('a silent channel mutes the bed and keeps the words', () => {
    const m = destinationMechanics(silent, proposed)
    expect(m.set).toEqual(['audio=[]'])
    expect(m.unset).toEqual([])
  })

  it('the vertical cut reframes and follows the camera', () => {
    const m = destinationMechanics(vertical, proposed)
    expect(m.set).toContain('frame.fit=cover')
    expect(m.set).toContain('frame.focusFollow=camera')
    expect(m.set.some((s) => s.startsWith('frame.inset='))).toBe(true)
  })

  it('a still is not a video destination', () => {
    const m = destinationMechanics(
      {
        id: 'og-card',
        kind: 'still',
        px: { w: 1200, h: 630 },
        text: 'allowed',
      },
      proposed,
    )
    expect(m).toEqual({ set: [], unset: [], notes: [] })
  })
})
