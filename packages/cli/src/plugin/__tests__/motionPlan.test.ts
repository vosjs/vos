import { describe, expect, it } from 'vitest'
import { DEFAULT_CAM_STYLE, DEFAULT_CURSOR_STYLE } from '@vosjs/studio-core'
import {
  clickTimes,
  destinationMechanics,
  endCardInk,
  pickTrack,
  proposeMotion,
  templateWords,
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
    // The card enters and, as its footage ends, recedes under the end
    // card: the one vocabulary, no field of its own for either.
    expect(p.doc.frame.anim).toEqual({
      enter: 'tilt-in',
      exit: { kind: 'recede', seconds: 0.7 },
    })
    expect(p.doc.endCard).toBeUndefined()
    expect(p.doc.frame.entrance).toBeUndefined()
    // The end card is clips after the footage, stamped where they came from.
    expect(p.doc.overlays?.map((o) => o.id)).toEqual([
      'endcard-title',
      'endcard-sub',
      'endcard-mark',
      'caption-1',
    ])
    const title = p.doc.overlays!.find((o) => o.id === 'endcard-title')!
    expect(title).toMatchObject({
      kind: 'text',
      text: 'Ship it',
      from: 'endcard',
      anim: { enter: 'rise', exit: 'none' },
    })
    expect(title.start).toBeCloseTo(34.35, 3)
    const sub = p.doc.overlays!.find((o) => o.id === 'endcard-sub')!
    expect((sub as { text: string }).text).toBe('vosso 1.7')
    const caption = p.doc.overlays!.find((o) => o.id === 'caption-1')!
    expect(caption).toMatchObject({
      text: 'Every program is a video',
      anim: { enter: 'rise', exit: 'fade' },
    })
    expect(caption.start).toBeCloseTo(3.7, 3)
    expect(p.doc.audio[0]).toMatchObject({
      id: 'bed',
      key: 'https://x/fresh.mp3',
      start: 0,
    })
    expect(
      p.doc.audio.filter((a) => a.id.startsWith('click-')).map((a) => a.start),
    ).toEqual([4, 9])
    expect(p.notes).toEqual([
      'enter tilt-in',
      'end card',
      '1 caption(s)',
      'bed fresh-focus',
      '2 click sound(s)',
    ])
    // The bed fills the whole output, the end card included.
    expect(p.doc.audio[0].out).toBeCloseTo(36.5, 3)
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
    // The maker's clip stays; the end card's clips are re-laid after it.
    expect(again.overlays?.map((o) => o.id)).toEqual([
      'mine',
      'endcard-sub',
      'endcard-mark',
    ])
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
    expect(p.doc.frame.anim).toBeUndefined()
    expect(p.doc.overlays).toBeUndefined()
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
    // 60 s of footage plus the 2.5 s end card the wordmark earns.
    expect(p.doc.audio[0]).toMatchObject({
      id: 'bed',
      loop: true,
      loopLen: 62.5,
      duck: true,
      gain: 0.35,
    })
    expect(p.doc.audio.filter((a) => a.id.startsWith('click-'))).toHaveLength(0)
  })

  it('a template the recipe names is laid at its anchor and takes the release words', () => {
    const template: ProjectDoc = {
      ...doc(),
      segments: [{ in: 0, out: 4 }],
      frame: {
        ...doc().frame,
        anim: { exit: { kind: 'fade', seconds: 0.5 } },
      },
      overlays: [
        {
          id: 'endcard-title',
          kind: 'text',
          text: 'placeholder',
          preset: 'title',
          start: 4.2,
          duration: 2.3,
          transform: { x: 0.5, y: 0.5, scale: 1, rotation: 0 },
        },
      ],
    }
    const p = proposeMotion(doc(), {
      words: { headline: 'Ship it', brand: 'vosso' },
      launch: { endCard: 'vos-t', entrance: 'none' },
      captions: [],
      catalog: null,
      templates: [{ from: 'vos-t', doc: template, at: 'end' }],
    })
    // The named template stands in for the house end card.
    expect(p.doc.overlays?.map((o) => o.id)).toEqual(['endcard-title'])
    expect(p.doc.overlays?.[0]).toMatchObject({
      from: 'vos-t',
      text: 'Ship it',
    })
    expect(p.doc.overlays?.[0].start).toBeCloseTo(34.2, 3)
    expect(p.doc.frame.anim).toEqual({ exit: { kind: 'fade', seconds: 0.5 } })
    expect(p.notes).toEqual(['vos-t at the end'])
    // A step anchor lands at the step's settle; an unknown step is said.
    const atStep = proposeMotion(doc(), {
      words: {},
      launch: { endCard: 'none', entrance: 'none' },
      captions: [],
      catalog: null,
      templates: [
        { from: 'vos-t', doc: template, at: { step: 'open' } },
        { from: 'vos-u', doc: template, at: { step: 'nope' } },
      ],
    })
    expect(atStep.doc.overlays?.[0].start).toBeCloseTo(4.4 + 4.2, 3)
    expect(atStep.skipped).toEqual(['vos-u: step nope was not recorded'])
    expect(
      templateWords({ headline: 'A', kicker: 'K', brand: 'B', release: '2' }),
    ).toEqual({
      'stage-title': 'A',
      'endcard-title': 'A',
      'stage-kicker': 'K',
      'stage-brand': 'B',
      'endcard-mark': 'B',
      'endcard-sub': 'B 2',
    })
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

  it("a loop drops the card's motion, every template clip, the captions and the sound, and the result lints", () => {
    const m = destinationMechanics(loop, proposed)
    const d = structuredClone(proposed)
    applyDocOverrides(d, { set: m.set, unset: m.unset })
    expect(d.frame.anim).toBeUndefined()
    expect(d.audio).toEqual([])
    expect(d.overlays).toEqual([])
    expect(lintDoc(d).problems).toEqual([])
    expect(m.notes).toEqual([
      'loop: no card motion',
      'no template clips, no captions',
    ])
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
