import { describe, expect, it } from 'vitest'
import {
  LAYOUT_FRAME_FIELDS,
  REST_TILT_ID,
  copyLayout,
  copyStyle,
  layoutOf,
} from '../digest/style'
import { docRestTime } from '../lower/motion'
import {
  DEFAULT_CAM_STYLE,
  DEFAULT_CURSOR_STYLE,
  DEFAULT_FRAME_STYLE,
} from '../types'
import type { ProjectDoc, TextOverlayClip } from '../types'

function take(over: Partial<ProjectDoc> = {}): ProjectDoc {
  return {
    source: {
      videoKey: 'recording.webm',
      cursor: [],
      meta: {
        dpr: 1,
        zoom: 1,
        t0: 0,
        durationMs: 10000,
        width: 1600,
        height: 900,
        fps: 30,
      },
    },
    segments: [{ in: 0, out: 10 }],
    zoom: [],
    audio: [],
    cursor: DEFAULT_CURSOR_STYLE,
    cam: DEFAULT_CAM_STYLE,
    frame: { ...DEFAULT_FRAME_STYLE, aspectRatio: '16:9' },
    export: { resolution: '1080p', fps: 30, format: 'mp4' },
    ...over,
  }
}

const title = (text: string, x = 0.25): TextOverlayClip => ({
  id: 'stage-title',
  kind: 'text',
  text,
  preset: 'title',
  start: 0,
  duration: 6,
  transform: { x, y: 0.46, scale: 1, rotation: 0 },
  align: 'left',
  maxWidth: 0.36,
})

const exemplar = take({
  source: {
    videoKey: 'recording.webm',
    cursor: [],
    meta: {
      dpr: 1,
      zoom: 1,
      t0: 0,
      durationMs: 6000,
      width: 1600,
      height: 900,
      fps: 30,
    },
  },
  segments: [{ in: 0, out: 3, hold: 3 }],
  frame: {
    ...DEFAULT_FRAME_STYLE,
    aspectRatio: '1:1',
    background: '#f0f2f4',
    inset: { left: 0.44, right: -0.06, top: 0.3, bottom: -0.12 },
    radius: 16,
    shadow: 0.5,
    shadowContact: 0.2,
    entrance: { kind: 'tilt-in' },
    browserBar: {
      ...DEFAULT_FRAME_STYLE.browserBar,
      kind: 'mac-dark',
      url: 'exemplar.test',
    },
  },
  tilt: [{ id: 'stage', in: 0, out: 6, rx: 3, ry: 10 }],
  overlays: [
    title('Ship the poster'),
    {
      id: 'stage-mark',
      kind: 'image',
      key: 'brand/exemplar-mark.svg',
      width: 0.08,
      radius: 0,
      shadow: 'none',
      start: 0,
      duration: 6,
      transform: { x: 0.1, y: 0.86, scale: 1, rotation: 0 },
    },
  ],
})

describe('copyLayout', () => {
  it('copies the card placement and keeps the take’s aspect and chrome', () => {
    const mine = take()
    const { doc } = copyLayout(exemplar, mine)
    expect(doc.frame.inset).toEqual(exemplar.frame.inset)
    expect(doc.frame.radius).toBe(16)
    expect(doc.frame.shadowContact).toBe(0.2)
    expect(doc.frame.entrance).toEqual({ kind: 'tilt-in' })
    expect(doc.frame.background).toBe('#f0f2f4')
    expect(doc.frame.aspectRatio).toBe('16:9')
    expect(doc.frame.browserBar).toEqual(mine.frame.browserBar)
    expect(mine.frame.inset).toBeUndefined() // pure
    expect(doc.frame).not.toBe(exemplar.frame) // cloned
  })

  it('removes a layout field the exemplar leaves absent', () => {
    const mine = take({
      frame: { ...DEFAULT_FRAME_STYLE, focus: { cx: 0, cy: 0 }, fit: 'cover' },
    })
    const { doc } = copyLayout(exemplar, mine)
    expect(doc.frame.focus).toBeUndefined()
    expect(doc.frame.fit).toBeUndefined()
  })

  it('keeps the take’s own words on a same-id text clip, its other clips, and never the exemplar’s mark', () => {
    const mine = take({
      overlays: [
        title('My own headline', 0.6),
        {
          id: 'caption-1',
          kind: 'text',
          text: 'a caption',
          preset: 'caption',
          start: 1,
          duration: 2,
          transform: { x: 0.5, y: 0.8, scale: 1, rotation: 0 },
        },
      ],
    })
    const { doc, notes } = copyLayout(exemplar, mine)
    const t = doc.overlays?.find((o) => o.id === 'stage-title')
    expect(t?.kind).toBe('text')
    expect((t as TextOverlayClip).text).toBe('My own headline')
    expect(t?.transform.x).toBe(0.25)
    expect(t?.duration).toBe(10)
    expect(doc.overlays?.some((o) => o.id === 'caption-1')).toBe(true)
    expect(doc.overlays?.some((o) => o.id === 'stage-mark')).toBe(false)
    expect(notes.join(' ')).toMatch(/stage-mark/)
  })

  it('takes the placeholder words when the take has no such clip, and a key handed in for the mark', () => {
    const { doc, notes } = copyLayout(exemplar, take(), {
      keys: { 'stage-mark': 'brand/mark.svg' },
    })
    const t = doc.overlays?.find((o) => o.id === 'stage-title')
    expect((t as TextOverlayClip).text).toBe('Ship the poster')
    const m = doc.overlays?.find((o) => o.id === 'stage-mark')
    expect(m && m.kind === 'image' ? m.key : null).toBe('brand/mark.svg')
    expect(notes).toEqual([])
  })

  it('writes the rest lean over the whole take when the track is empty, and keeps a planned camera', () => {
    const { doc } = copyLayout(exemplar, take())
    expect(doc.tilt).toEqual([
      { id: REST_TILT_ID, in: 0, out: 10, rx: 3, ry: 10, source: 'manual' },
    ])
    const planned = take({
      tilt: [{ id: 't0', in: 2, out: 5, rx: 6, ry: -9, source: 'auto' }],
    })
    const kept = copyLayout(exemplar, planned)
    expect(kept.doc.tilt).toEqual(planned.tilt)
    expect(kept.notes.join(' ')).toMatch(/lean kept/)
  })

  it('carries the trailing hold onto the take’s last segment', () => {
    const mine = take({
      segments: [
        { in: 0, out: 4 },
        { in: 6, out: 9 },
      ],
    })
    const { doc } = copyLayout(exemplar, mine)
    expect(doc.segments).toEqual([
      { in: 0, out: 4 },
      { in: 6, out: 9, hold: 3 },
    ])
  })

  it('reports what a document carries of a layout', () => {
    expect(layoutOf(exemplar)).toEqual({
      frame: LAYOUT_FRAME_FIELDS.filter((k) =>
        [
          'background',
          'padding',
          'radius',
          'shadow',
          'shadowContact',
          'inset',
          'border',
          'entrance',
        ].includes(k),
      ),
      clips: ['stage-title', 'stage-mark'],
      lean: true,
      hold: true,
    })
    expect(layoutOf(take()).clips).toEqual([])
    expect(layoutOf(take()).hold).toBe(false)
  })

  it('copyStyle carries the layout only when asked, byte-identical otherwise', () => {
    const plain = copyStyle(exemplar, take())
    expect(plain.overlays).toBeUndefined()
    expect(plain.tilt).toBeUndefined()
    expect(plain.segments[0].hold).toBeUndefined()
    const withLayout = copyStyle(exemplar, take(), { layout: true })
    expect(withLayout.overlays?.map((o) => o.id)).toEqual(['stage-title'])
    expect(withLayout.tilt?.[0].id).toBe(REST_TILT_ID)
    expect(withLayout.segments[0].hold).toBe(3)
  })
})

describe('docRestTime', () => {
  it('is null with no trailing hold, the hold’s start otherwise', () => {
    expect(docRestTime(take())).toBeNull()
    expect(docRestTime(take({ segments: [{ in: 2, out: 8, hold: 3 }] }))).toBe(
      6,
    )
  })

  it('reads through speed spans and earlier cuts', () => {
    const doc = take({
      segments: [
        { in: 0, out: 4 },
        { in: 10, out: 14, hold: 2 },
      ],
      speed: [{ id: 's0', in: 0, out: 4, rate: 2 }],
    })
    expect(docRestTime(doc)).toBe(6)
  })

  it('ignores a hold off the last segment and yields to an end card', () => {
    expect(
      docRestTime(
        take({
          segments: [
            { in: 0, out: 4, hold: 2 },
            { in: 10, out: 14 },
          ],
        }),
      ),
    ).toBeNull()
    expect(
      docRestTime(
        take({
          segments: [{ in: 2, out: 8, hold: 3 }],
          endCard: { headline: 'Ship it' },
        }),
      ),
    ).toBeNull()
  })
})
