import { describe, expect, it } from 'vitest'
import {
  DEFAULT_CAM_STYLE,
  DEFAULT_CURSOR_STYLE,
  DEFAULT_FRAME_STYLE,
} from '../types'
import { docStillTime, docRestTime, ownFreezes } from '../lower/motion'
import { applyTemplate } from '../digest/style'
import type { Media, ProjectDoc, TextOverlayClip } from '../types'

const meta = (durationMs: number) => ({
  dpr: 1,
  zoom: 1,
  t0: 0,
  durationMs,
  width: 1600,
  height: 900,
  fps: 30,
})

function take(over: Partial<ProjectDoc> = {}): ProjectDoc {
  return {
    source: { videoKey: 'blob:a', cursor: [], meta: meta(10000) },
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

const title = (start: number, seconds?: number): TextOverlayClip => ({
  id: `t${start}`,
  kind: 'text',
  text: 'Hello',
  preset: 'title',
  start,
  duration: 3,
  transform: { x: 0.5, y: 0.5, scale: 1, rotation: 0 },
  anim: { enter: seconds === undefined ? 'fade' : { kind: 'fade', seconds } },
})

describe('docStillTime: the frame that stands for a document', () => {
  it('the author’s own still wins, clamped to the output', () => {
    expect(docStillTime(take({ still: 4.2 }))).toBe(4.2)
    expect(docStillTime(take({ still: 99 }))).toBe(10)
    expect(docStillTime(take({ still: -1 }))).toBe(0)
  })

  it('an own freeze is the rest; a template’s freeze is not', () => {
    const own = take({ freeze: [{ id: 'f0', at: 6, seconds: 2 }] })
    expect(docStillTime(own)).toBe(6)
    expect(ownFreezes(own)).toHaveLength(1)
    const laid = take({
      freeze: [{ id: 'f0', at: 10, seconds: 2, from: 'endcard' }],
    })
    expect(ownFreezes(laid)).toHaveLength(0)
    // the old rest still reads it; the still does not
    expect(docRestTime(laid)).toBe(10)
    expect(docStillTime(laid)).toBe(0.5)
  })

  it('the hero: after the card and the opening clips have entered, plus a beat', () => {
    // no entrance, no clips: the default
    expect(docStillTime(take())).toBe(0.5)
    // the card enters over 1.2 s
    const enter = take({
      frame: {
        ...DEFAULT_FRAME_STYLE,
        anim: { enter: { kind: 'tilt-in', seconds: 1.2 } },
      },
    })
    expect(docStillTime(enter)).toBe(1.45)
    // an opening title finishes entering later than the card
    const words = take({
      frame: {
        ...DEFAULT_FRAME_STYLE,
        anim: { enter: { kind: 'tilt-in', seconds: 1.2 } },
      },
      overlays: [title(0.8, 0.7), title(7)],
    })
    expect(docStillTime(words)).toBe(1.75)
    // a clip past the opening window does not count
    expect(docStillTime(take({ overlays: [title(7)] }))).toBe(0.5)
    // never past the footage
    const short = take({
      segments: [{ in: 0, out: 1 }],
      frame: {
        ...DEFAULT_FRAME_STYLE,
        anim: { enter: { kind: 'rise', seconds: 3 } },
      },
    })
    expect(docStillTime(short)).toBeCloseTo(1 - 1 / 30, 3)
  })

  it('an own freeze on the second media maps through that media', () => {
    const m1: Media = {
      id: 'm1',
      videoKey: 'blob:b',
      cursor: [],
      meta: meta(4000),
    }
    const d = take({
      media: [m1],
      segments: [
        { in: 0, out: 10 },
        { in: 0, out: 4, media: 'm1' },
      ],
      freeze: [{ id: 'f0', at: 4, seconds: 1, media: 'm1' }],
    })
    expect(docStillTime(d)).toBe(14)
  })

  it('an own freeze at the end survives an end card laid on it', () => {
    const tpl = take({
      segments: [{ in: 0, out: 4 }],
      freeze: [{ id: 'f0', at: 4, seconds: 2.5 }],
    })
    const mine = take({ freeze: [{ id: 'rest', at: 10, seconds: 1 }] })
    const { doc } = applyTemplate(tpl, mine, {
      at: 'end',
      from: 'vos-endcard',
      words: {},
      keys: {},
    })
    expect(doc.freeze).toEqual([{ id: 'rest', at: 10, seconds: 2.5 }])
    expect(docStillTime(doc)).toBe(10)
    // with no own freeze the template's is laid, stamped, and the still is the hero
    const bare = applyTemplate(tpl, take(), {
      at: 'end',
      from: 'vos-endcard',
      words: {},
      keys: {},
    }).doc
    expect(bare.freeze?.[0]).toMatchObject({ at: 10, from: 'vos-endcard' })
    expect(docStillTime(bare)).toBe(0.5)
  })
})
