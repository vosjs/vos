import { describe, expect, it } from 'vitest'
import { DEFAULT_CAM_STYLE, DEFAULT_CURSOR_STYLE } from '@vosjs/studio-core'
import { clickTimes, pickTrack, planMotion } from '../motionPlan'
import { applyDocOverrides } from '../docOverride'
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
      browserBar: { kind: 'none', url: '', showUrl: true, showControls: true, height: 44 },
    },
    export: { resolution: '1080p', fps: 30, format: 'mp4' },
  }
}

const catalog: MusicCatalog = {
  tracks: [
    { slug: 'fresh-focus', title: 'Fresh Focus', mood: 'upbeat', duration: 124, url: 'https://x/fresh.mp3' },
    { slug: 'slow-tide', title: 'Slow Tide', mood: 'calm', duration: 40, url: 'https://x/tide.mp3' },
  ],
  sfx: [{ slug: 'sfx-click', title: 'Click', duration: 0.07, url: 'https://x/click.wav' }],
}

const feed = { id: 'x-feed-cut', kind: 'video' as const, px: { w: 1920, h: 1080 }, text: 'allowed' as const }
const loop = { id: 'github-readme-loop', kind: 'video' as const, px: { w: 1920, h: 1080 }, text: 'none' as const }
const vertical = { id: 'shorts-linkedin-vertical-cut', kind: 'video' as const, px: { w: 1080, h: 1920 }, text: 'expected' as const }

describe('planMotion', () => {
  it('a feed cut enters, ends on a card, carries captions, a bed and clicks', () => {
    const plan = planMotion({
      destination: feed,
      doc: doc(),
      range: [0, 34],
      words: { headline: 'Ship it', brand: 'vosso', release: '1.7' },
      launch: { music: 'upbeat' },
      captions: [{ step: 1, id: 'hover', caption: 'Every program is a video' }],
      catalog,
    })
    expect(plan.set).toContain('frame.entrance={"kind":"tilt-in"}')
    const end = plan.set.find((s) => s.startsWith('endCard='))!
    expect(JSON.parse(end.slice(8))).toEqual({ seconds: 2.5, headline: 'Ship it', sub: 'vosso 1.7', wordmark: 'vosso' })
    const overlays = JSON.parse(plan.set.find((s) => s.startsWith('overlays='))!.slice(9)) as { text: string; start: number }[]
    expect(overlays).toHaveLength(1)
    expect(overlays[0].text).toBe('Every program is a video')
    expect(overlays[0].start).toBeCloseTo(3.7, 3)
    const audio = JSON.parse(plan.set.find((s) => s.startsWith('audio='))!.slice(6)) as { id: string; key: string; start: number }[]
    expect(audio[0]).toMatchObject({ id: 'bed', key: 'https://x/fresh.mp3', start: 0 })
    expect(audio.filter((a) => a.id.startsWith('click-')).map((a) => a.start)).toEqual([4, 9])
    // The overrides apply to a doc and pass the lint's shape.
    const d = doc()
    applyDocOverrides(d, { set: plan.set })
    expect(d.frame.entrance?.kind).toBe('tilt-in')
    expect(d.endCard?.headline).toBe('Ship it')
    expect(d.audio).toHaveLength(3)
  })

  it('a loop takes nothing: no entrance, no end card, no sound, no words', () => {
    const plan = planMotion({
      destination: loop,
      doc: doc(),
      range: [0, 20],
      words: { headline: 'Ship it', brand: 'vosso' },
      launch: { music: 'upbeat' },
      captions: [{ step: 1, caption: 'x' }],
      catalog,
    })
    expect(plan.set).toEqual([])
  })

  it('the vertical cut reframes and follows the camera', () => {
    const plan = planMotion({
      destination: vertical,
      doc: doc(),
      range: [0, 34],
      words: { brand: 'vosso' },
      launch: {},
      captions: [],
      catalog: null,
    })
    expect(plan.set).toContain('frame.fit=cover')
    expect(plan.set).toContain('frame.focusFollow=camera')
    expect(plan.set.some((s) => s.startsWith('frame.inset='))).toBe(true)
  })

  it('roles switch things off and say what could not be added', () => {
    const plan = planMotion({
      destination: feed,
      doc: doc(),
      range: [0, 34],
      words: {},
      launch: { entrance: 'none', endCard: 'none', music: 'jazz-that-is-not-there', clicks: 'none' },
      captions: [],
      catalog,
    })
    expect(plan.set.some((s) => s.startsWith('frame.entrance'))).toBe(false)
    expect(plan.set.some((s) => s.startsWith('endCard'))).toBe(false)
    expect(plan.set.some((s) => s.startsWith('audio'))).toBe(false)
    expect(plan.skipped[0]).toMatch(/music "jazz-that-is-not-there" is not a catalog track or mood/)
  })

  it('a bed loops to fill a longer cut and a mic ducks it', () => {
    const d = doc()
    d.source.micKey = 'blob:mic'
    const plan = planMotion({
      destination: feed,
      doc: d,
      range: [0, 60],
      words: { brand: 'vosso' },
      launch: { music: 'slow-tide' },
      captions: [],
      catalog,
    })
    const audio = JSON.parse(plan.set.find((s) => s.startsWith('audio='))!.slice(6)) as Record<string, unknown>[]
    expect(audio[0]).toMatchObject({ loop: true, loopLen: 60, duck: true, gain: 0.35 })
    // No click sounds under a mic.
    expect(audio.filter((a) => String(a.id).startsWith('click-'))).toHaveLength(0)
  })

  it('pickTrack and clickTimes', () => {
    expect(pickTrack(catalog, 'calm')!.slug).toBe('slow-tide')
    expect(pickTrack(catalog, 'none')).toBeNull()
    expect(pickTrack(null, 'upbeat')).toBeNull()
    expect(clickTimes(doc(), [3, 34])).toEqual([1, 6])
  })
})
