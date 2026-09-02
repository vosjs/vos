import { afterEach, describe, expect, it } from 'vitest'
import { lerpArray, mapTime, sample } from '@vosjs/timeline'
import {
  OVERLAY_BOX_PAD_X,
  OVERLAY_BOX_PAD_Y,
  OVERLAY_BOX_RADIUS,
  OVERLAY_FONT_FACES,
  TEXT_PRESETS,
  overlayFaceFor,
  overlayFontFaces,
  overlayFontString,
  overlayHit,
  overlayRect,
  overlaySegments,
  resolveOverlayBox,
  resolveOverlayFx,
  resolveOverlayStyle,
  wrapOverlayLines,
} from '../overlayText'
import {
  DEFAULT_BROWSER_BAR,
  DEFAULT_CAM_STYLE,
  DEFAULT_CURSOR_STYLE,
  DEFAULT_FRAME_STYLE,
  OVERLAY_LINE_HEIGHT,
} from '../types'
import {
  bothFrames,
  lowerMerged as lowerToComposition,
  studioEntryOf,
} from './helpers/studio'
import type { OverlayClip, ProjectDoc, TextOverlayClip } from '../types'

function clip(over: Partial<TextOverlayClip> = {}): TextOverlayClip {
  return {
    id: 'o1',
    kind: 'text',
    start: 0.5,
    duration: 2,
    text: 'Hello',
    preset: 'title',
    transform: { x: 0.5, y: 0.82, scale: 1, rotation: 0 },
    ...over,
  }
}

function makeDoc(overlays?: OverlayClip[]): ProjectDoc {
  return {
    source: {
      videoKey: 'blob:video',
      cursor: [{ t: 0, x: 100, y: 100, type: 'move' }],
      meta: {
        dpr: 2,
        zoom: 1,
        t0: 0,
        durationMs: 4000,
        width: 1600,
        height: 900,
        fps: 30,
      },
    },
    segments: [{ in: 0, out: 4 }],
    zoom: [],
    audio: [],
    cursor: DEFAULT_CURSOR_STYLE,
    cam: DEFAULT_CAM_STYLE,
    frame: { ...DEFAULT_FRAME_STYLE, browserBar: DEFAULT_BROWSER_BAR },
    ...(overlays !== undefined ? { overlays } : {}),
    export: { resolution: '1080p', fps: 30, format: 'mp4' },
  }
}

describe('overlay styles + geometry mirror', () => {
  it('resolves preset with clamped overrides', () => {
    const st = resolveOverlayStyle(clip({ size: 999, color: '#ff5148' }))
    expect(st.size).toBe(200) // clamped to OVERLAY_SIZE_MAX
    expect(st.color).toBe('#ff5148')
    expect(st.weight).toBe(TEXT_PRESETS.title.weight)
  })

  it('font string mirrors ON_FRAME (weight px stack)', () => {
    const st = resolveOverlayStyle(clip())
    // ON_FRAME: ol.weight + ' ' + ol.fs*ol.scale*s + 'px ' + ol.stack
    expect(overlayFontString(st, 1, 1)).toBe(
      `600 64px ${TEXT_PRESETS.title.stack}`,
    )
    expect(overlayFontString(st, 2, 0.5)).toBe(
      `600 64px ${TEXT_PRESETS.title.stack}`,
    )
  })

  it('rect: fraction anchor × frame size, multi-line height, measured width', () => {
    const measure = (text: string) => text.length * 10
    // 16:9 frame: W = 1920, H = 1080 → anchor (0.5, 0.82) = (960, 885.6).
    const r = overlayRect(clip({ text: 'ab\nlonger' }), measure, 1920, 1080)
    expect(r.cx).toBe(960)
    expect(r.cy).toBeCloseTo(0.82 * 1080, 6)
    expect(r.w).toBe(60) // 'longer' = 6 chars * 10
    expect(r.h).toBeCloseTo(2 * 64 * OVERLAY_LINE_HEIGHT, 6)
  })

  it('style v2: catalog family swaps the stack and snaps the weight', () => {
    const st = resolveOverlayStyle(
      clip({ family: 'Playfair Display', weight: 650 }),
    )
    expect(st.stack).toMatch(/^'Playfair Display', /)
    expect(st.weight).toBe(600) // hosted steps 400/600/700 — snapped
  })

  it('style v2: unknown family fails open ahead of the preset stack', () => {
    const st = resolveOverlayStyle(clip({ family: 'Comic Serif Pro' }))
    expect(st.stack).toMatch(/^'Comic Serif Pro', Lexend/)
    expect(st.weight).toBe(600) // preset weight kept verbatim
  })

  it('style v2: weight-only override snaps against the preset family', () => {
    // Lexend hosts 400/600/700 — 500 snaps to 400 (nearest, ties low).
    expect(resolveOverlayStyle(clip({ weight: 500 })).weight).toBe(400)
    expect(resolveOverlayStyle(clip({ weight: 700 })).weight).toBe(700)
  })

  it('style v2: defaults and the italic font string', () => {
    const st = resolveOverlayStyle(clip())
    expect(st.fontStyle).toBe('normal')
    expect(st.align).toBe('center')
    expect(st.letterSpacing).toBe(0)
    expect(st.lineHeight).toBe(OVERLAY_LINE_HEIGHT)
    expect(st.stroke).toBeNull()
    const italic = resolveOverlayStyle(clip({ italic: true }))
    expect(overlayFontString(italic, 1, 1)).toBe(
      `italic 600 64px ${TEXT_PRESETS.title.stack}`,
    )
  })

  it('faces: preset-only docs carry exactly the base three', () => {
    expect(overlayFaceFor(clip())).toBeNull() // Lexend 600 is a base face
    expect(overlayFontFaces({ overlays: [clip()] })).toEqual(OVERLAY_FONT_FACES)
  })

  it('faces: overrides add hosted faces, deduped', () => {
    const styled = clip({ family: 'Playfair Display', weight: 700 })
    expect(overlayFaceFor(styled)).toEqual({
      family: 'Playfair Display',
      weight: 700,
      url: 'https://assets.vos.so/fonts/playfair-display/700.woff2',
    })
    const faces = overlayFontFaces({
      overlays: [styled, clip({ id: 'o2' }), styled],
    })
    expect(faces).toHaveLength(OVERLAY_FONT_FACES.length + 1)
    // Unknown families add nothing (nothing hosted to load).
    expect(
      overlayFontFaces({ overlays: [clip({ family: 'Comic Serif Pro' })] }),
    ).toEqual(OVERLAY_FONT_FACES)
  })

  it('rect uses the lineHeight override and letter spacing', () => {
    const measure = (text: string, _f: string, ls = 0) =>
      text.length * (10 + ls)
    const tight = overlayRect(clip({ lineHeight: 1 }), measure, 1920, 1080)
    expect(tight.h).toBeCloseTo(64, 6)
    const spaced = overlayRect(clip({ letterSpacing: 2 }), measure, 1920, 1080)
    // Measure callback receives the scaled spacing: 5 chars × (10 + 2).
    expect(spaced.w).toBeCloseTo(60, 6)
  })

  it('box resolves em paddings against the resolved size', () => {
    expect(resolveOverlayBox(clip())).toBeNull()
    const bx = resolveOverlayBox(clip({ box: { color: '#101014' } }))!
    // Title preset size 64: defaults scale with the font.
    expect(bx).toEqual({
      color: '#101014',
      opacity: 1,
      padX: OVERLAY_BOX_PAD_X * 64,
      padY: OVERLAY_BOX_PAD_Y * 64,
      radius: OVERLAY_BOX_RADIUS * 64,
    })
    const custom = resolveOverlayBox(
      clip({ size: 32, box: { color: '#fff', opacity: 0.5, paddingX: 1 } }),
    )!
    expect(custom.padX).toBe(32)
    expect(custom.opacity).toBe(0.5)
  })

  it('rect inflates by the box paddings (mirrors the pill draw)', () => {
    const measure = (text: string) => text.length * 10
    const bare = overlayRect(clip(), measure, 1920, 1080)
    const boxed = overlayRect(
      clip({ box: { color: '#101014' } }),
      measure,
      1920,
      1080,
    )
    expect(boxed.w).toBeCloseTo(bare.w + 2 * OVERLAY_BOX_PAD_X * 64, 6)
    expect(boxed.h).toBeCloseTo(bare.h + 2 * OVERLAY_BOX_PAD_Y * 64, 6)
    // Paddings ride transform.scale like the font does.
    const scaled = overlayRect(
      clip({
        box: { color: '#101014' },
        transform: { x: 0.5, y: 0.82, scale: 2, rotation: 0 },
      }),
      measure,
      1920,
      1080,
    )
    expect(scaled.h).toBeCloseTo(2 * (bare.h + 2 * OVERLAY_BOX_PAD_Y * 64), 6)
  })

  it('rect anchor is aspect-stable (same fraction, different frame width)', () => {
    const measure = () => 100
    const wide = overlayRect(clip(), measure, 1920, 1080)
    const tall = overlayRect(clip(), measure, 608, 1080)
    // Same RELATIVE position in both frames — the aspect-switch bug guard.
    expect(wide.cx / 1920).toBeCloseTo(tall.cx / 608, 9)
    expect(wide.cy).toBeCloseTo(tall.cy, 9)
  })

  it('hit test respects rotation (point rotated into local space)', () => {
    const measure = () => 200
    const r = overlayRect(
      clip({ transform: { x: 0.5, y: 0.5, scale: 1, rotation: 90 } }),
      measure,
      1000,
      1000,
    )
    // Rotated 90°: the 200-wide box now extends VERTICALLY (anchor 500,500).
    expect(overlayHit(r, 500, 590, 0)).toBe(true) // inside rotated box
    expect(overlayHit(r, 590, 500, 0)).toBe(false) // would be inside unrotated
  })
})

describe('overlay lowering', () => {
  it('omits overlays from data when absent or empty (byte parity)', () => {
    expect('overlays' in lowerToComposition(makeDoc()).data).toBe(false)
    expect('overlays' in lowerToComposition(makeDoc([])).data).toBe(false)
  })

  it('resolves preset values into data (no registry at runtime)', () => {
    const { data } = lowerToComposition(makeDoc([clip({ text: 'a\nb' })]))
    const o = (data.overlays as Record<string, unknown>[])[0]
    expect(o).toMatchObject({
      id: 'o1',
      start: 0.5,
      dur: 2,
      x: 0.5,
      y: 0.82,
      fs: 64,
      weight: 600,
      color: '#fafafa',
      enter: 'rise',
      exit: 'fade',
      lines: ['a', 'b'],
    })
    expect(String(o.stack)).toContain('Lexend')
  })

  it('bakes the box only when present (design px at fs; parity when absent)', () => {
    const bare = lowerToComposition(makeDoc([clip()]))
    const bareOl = (bare.data.overlays as Record<string, unknown>[])[0]
    expect('box' in bareOl).toBe(false)

    const boxed = lowerToComposition(
      makeDoc([clip({ box: { color: '#101014', opacity: 0.8 } })]),
    )
    const ol = (boxed.data.overlays as Record<string, unknown>[])[0]
    expect(ol.box).toEqual({
      c: '#101014',
      o: 0.8,
      px: OVERLAY_BOX_PAD_X * 64,
      py: OVERLAY_BOX_PAD_Y * 64,
      r: OVERLAY_BOX_RADIUS * 64,
    })
    // The pill block is EMITTED unconditionally (byte-identical program):
    // adding the first box must be a live SET_DATA, never a LOAD.
    expect(studioEntryOf(boxed.config).onFrame).toContain('ol.box')
    expect(String(bare.config.onFrame)).toBe(String(boxed.config.onFrame))
  })

  it('bakes style v2 only when non-default; faces + face ride ctx.data', () => {
    const bare = lowerToComposition(makeDoc([clip()]))
    const bareOl = (bare.data.overlays as Record<string, unknown>[])[0]
    for (const k of ['sty', 'ls', 'lh', 'align', 'stroke', 'face']) {
      expect(k in bareOl).toBe(false)
    }
    expect('overlayFonts' in bare.data).toBe(false)

    const styled = lowerToComposition(
      makeDoc([
        clip({
          family: 'Playfair Display',
          weight: 700,
          italic: true,
          align: 'left',
          letterSpacing: 3,
          lineHeight: 1.5,
          stroke: { color: '#000', width: 2 },
        }),
      ]),
    )
    const ol = (styled.data.overlays as Record<string, unknown>[])[0]
    expect(ol).toMatchObject({
      sty: 'italic',
      ls: 3,
      lh: 1.5,
      align: 'left',
      stroke: { c: '#000', w: 2 },
      face: {
        f: 'Playfair Display',
        w: 700,
        u: 'https://assets.vos.so/fonts/playfair-display/700.woff2',
      },
    })
    expect(styled.data.overlayFonts).toHaveLength(OVERLAY_FONT_FACES.length + 1)
    // Style edits are data, never program: byte-identical compile.
    expect(String(styled.config.onFrame)).toBe(String(bare.config.onFrame))
    expect(String(styled.config.setup)).toBe(String(bare.config.setup))
  })

  it('bakes font faces into SETUP, gated on data', () => {
    const { config } = lowerToComposition(makeDoc([clip()]))
    const setup = studioEntryOf(config).setup
    expect(setup).toContain('FontFace')
    expect(setup).toContain('assets.vos.so/fonts/')
    expect(setup).toContain('ctx.data.overlays')
  })
})

const g = globalThis as Record<string, unknown>
afterEach(() => {
  delete g.window
  delete g.__vosTimeline
})

function runFrame(
  overlays: OverlayClip[],
  time: number,
  cache = new Map<string, unknown>(),
  // Wrap tests need proportional widths; everything else keeps the flat 42.
  measureWidth: (text: string) => number = () => 42,
) {
  const { config, data } = lowerToComposition(makeDoc(overlays))
  const onFrame = bothFrames(config)
  g.window = {
    __vos__: { isPaused: true, videoCache: cache, pendingDecodes: new Set() },
  }
  g.__vosTimeline = { mapTime, sample, lerpArray }

  const calls: string[] = []
  const texts: { text: string; x: number; y: number }[] = []
  const draws: unknown[][] = []
  const sets: Record<string, unknown> = {}
  const mkC2d = (tag: string) =>
    new Proxy(
      {},
      {
        get: (_t, key: string) => {
          if (key === 'measureText')
            return (text: string) => ({ width: measureWidth(text) })
          if (key === 'createLinearGradient')
            return () => ({ addColorStop: () => {} })
          if (key === 'fillText')
            return (text: string, x: number, y: number) => {
              calls.push(`${tag}.fillText`)
              texts.push({ text, x, y })
            }
          if (key === 'drawImage')
            return (...args: unknown[]) => {
              calls.push(`${tag}.drawImage`)
              draws.push(args)
            }
          return (..._args: unknown[]) => {
            calls.push(`${tag}.${key}`)
          }
        },
        set: (_t, key: string, v: unknown) => {
          sets[`${tag}.${key}`] = v
          calls.push(`${tag}.set.${key}`)
          return true
        },
      },
    )
  const layer = (tag: string) => ({
    c2d: mkC2d(tag),
    canvas: { width: 1920, height: 1080 },
    texture: { needsUpdate: false, dispose: () => undefined },
    mesh: null,
  })
  const refs = {
    bg: layer('bg'),
    card: layer('card'),
    ov: layer('ov'),
    video: {
      videoWidth: 1600,
      videoHeight: 900,
      readyState: 2,
      paused: true,
      currentTime: 0,
      play: () => undefined,
      pause: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    },
    cam: null,
  }
  const ctx = {
    time,
    data,
    renderer: undefined,
    resolution: {
      width: 1920,
      height: 1080,
      drawingBufferWidth: 1920,
      drawingBufferHeight: 1080,
    },
  }
  onFrame(ctx, { refs }, 1 / 30)
  return { calls, texts, draws, sets, ovTexture: refs.ov.texture }
}

describe('overlay drawing (stub ON_FRAME)', () => {
  it('draws visible text on the OVERLAY layer at design-px × s', () => {
    const { texts, calls } = runFrame([clip()], 1.5) // mid-hold
    expect(texts).toEqual([{ text: 'Hello', x: 0, y: 0 }]) // drawn at translated origin
    const i = calls.indexOf('ov.translate')
    expect(i).toBeGreaterThan(-1)
    expect(calls).toContain('ov.fillText')
  })

  it('draws nothing outside the clip span', () => {
    const { texts } = runFrame([clip()], 3.5)
    expect(texts).toEqual([])
  })

  it('multi-line: one fillText per line, vertically centered', () => {
    const { texts } = runFrame([clip({ text: 'a\nb' })], 1.5)
    expect(texts.length).toBe(2)
    expect(texts[0].y).toBeCloseTo(-texts[1].y, 6) // symmetric about the anchor
  })

  it('enter transition fades in (alpha < 1 early in the clip)', () => {
    const { sets } = runFrame([clip({ enter: 'fade' })], 0.5 + 0.05)
    const a = sets['ov.globalAlpha'] as number
    expect(a).toBeGreaterThan(0)
    expect(a).toBeLessThan(1)
  })

  it('hold is fully opaque with no offset (settled)', () => {
    const { sets, texts } = runFrame([clip()], 1.5)
    expect(sets['ov.globalAlpha']).toBe(1)
    expect(texts[0].y).toBe(0)
  })

  it('rotation applies about the anchor', () => {
    const { calls } = runFrame(
      [clip({ transform: { x: 0.5, y: 0.82, scale: 1, rotation: 10 } })],
      1.5,
    )
    expect(calls.indexOf('ov.rotate')).toBeGreaterThan(
      calls.indexOf('ov.translate'),
    )
  })

  it('overlay texture uploads during hold only when the visible set changes', () => {
    // Single-frame harness: visible overlay → dirty (first sight of the sig)
    const on = runFrame([clip()], 1.5)
    expect(on.ovTexture.needsUpdate).toBe(true)
    // No overlays → overlay layer clears once (first-frame sig change) but
    // draws no text
    const off = runFrame([], 1.5)
    expect(off.texts).toEqual([])
  })
})

describe('media overlays (V1b)', () => {
  const mediaClip = (over: Record<string, unknown> = {}): OverlayClip =>
    ({
      id: 'm0',
      kind: 'image',
      start: 0.5,
      duration: 2,
      key: 'blob:media',
      transform: { x: 0.5, y: 0.5, scale: 1, rotation: 0 },
      ...over,
    }) as OverlayClip

  it('lowers media clips with defaults (width/radius/opacity/loop)', () => {
    const { data } = lowerToComposition(makeDoc([mediaClip()]))
    const o = (data.overlays as Record<string, unknown>[])[0]
    expect(o).toMatchObject({
      kind: 'image',
      key: 'blob:media',
      w: 0.35,
      radius: 12,
      opacity: 1,
      loop: false,
      enter: 'rise',
      exit: 'fade',
    })
    expect('fs' in o).toBe(false)
  })

  it('SETUP warm-loads media overlay keys', () => {
    const { config } = lowerToComposition(makeDoc([mediaClip()]))
    expect(studioEntryOf(config).setup).toContain(
      'overlay media failed to load',
    )
  })

  it('draws a ready image overlay: rounded clip + centered drawImage on ov', () => {
    const img = { complete: true, naturalWidth: 800, naturalHeight: 400 }
    const { draws, calls } = runFrame(
      [mediaClip()],
      1.5,
      new Map([['blob:media', img]]),
    )
    const ovDraws = draws.filter((d) => d[0] === img)
    expect(ovDraws.length).toBe(1)
    // width = 0.35 × 1920 = 672; height follows aspect (800×400) → 336; centered.
    const [, dx, dy, dw, dh] = ovDraws[0] as [
      unknown,
      number,
      number,
      number,
      number,
    ]
    expect(dw).toBeCloseTo(672, 4)
    expect(dh).toBeCloseTo(336, 4)
    expect(dx).toBeCloseTo(-336, 4) // centered about the translated anchor
    expect(dy).toBeCloseTo(-168, 4)
    expect(calls).toContain('ov.clip') // rounded-corner clip
  })

  it('skips drawing while the media is not ready (fail-open)', () => {
    const img = { complete: false, naturalWidth: 0 }
    const { draws } = runFrame(
      [mediaClip()],
      1.5,
      new Map([['blob:media', img]]),
    )
    expect(draws.filter((d) => d[0] === img).length).toBe(0)
  })

  it('seeks a paused video overlay to CLIP-LOCAL time', () => {
    const vid = {
      videoWidth: 640,
      videoHeight: 360,
      readyState: 2,
      paused: true,
      currentTime: 0,
      duration: 10,
      playbackRate: 1,
      play: () => undefined,
      pause: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }
    runFrame(
      [mediaClip({ kind: 'video' })],
      1.5, // clip starts at 0.5 → local time 1.0
      new Map([['blob:media', vid]]),
    )
    expect(vid.currentTime).toBeCloseTo(1.0, 5)
  })

  it('loops clip-local time when loop is set', () => {
    const vid = {
      videoWidth: 640,
      videoHeight: 360,
      readyState: 2,
      paused: true,
      currentTime: 0,
      duration: 0.4,
      playbackRate: 1,
      play: () => undefined,
      pause: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }
    runFrame(
      [mediaClip({ kind: 'video', loop: true })],
      1.5,
      new Map([['blob:media', vid]]),
    )
    expect(vid.currentTime).toBeCloseTo(1.0 % 0.4, 5)
  })

  it('keeps drawing a video clip through an in-flight scrub seek (sticky readiness + coalescing)', () => {
    const vid = {
      videoWidth: 640,
      videoHeight: 360,
      readyState: 2,
      seeking: false,
      paused: true,
      currentTime: 1.0,
      duration: 10,
      playbackRate: 1,
      play: () => undefined,
      pause: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }
    const cache = new Map<string, unknown>([['blob:media', vid]])
    const r1 = runFrame([mediaClip({ kind: 'video' })], 1.5, cache)
    expect(r1.draws.filter((d) => d[0] === vid).length).toBe(1) // decoded once
    vid.readyState = 1 // scrub seek in flight — readyState dips
    vid.seeking = true
    const r2 = runFrame([mediaClip({ kind: 'video' })], 1.9, cache)
    expect(r2.draws.filter((d) => d[0] === vid).length).toBe(1) // STILL drawn (retained frame)
    expect(vid.currentTime).toBeCloseTo(1.0, 5) // seek coalesced — not re-issued mid-seek
  })
})

describe('text fx (TX6) — segmentation + normalization', () => {
  it('overlaySegments: line/word/char split per line; block bakes nothing', () => {
    expect(overlaySegments('Hi there\nGo', 'line')).toEqual([
      ['Hi there'],
      ['Go'],
    ])
    // word units keep their trailing whitespace (stable typewriter geometry)
    expect(overlaySegments('Hi there', 'word')).toEqual([['Hi ', 'there']])
    expect(overlaySegments('ab', 'char')).toEqual([['a', 'b']])
    expect(overlaySegments('Hi', 'block')).toEqual([])
  })

  it('char units are grapheme-safe (emoji stay whole)', () => {
    expect(overlaySegments('a👍b', 'char')).toEqual([['a', '👍', 'b']])
  })

  it('resolveOverlayFx: defaults resolve, block = one unit', () => {
    const fx = resolveOverlayFx(clip({ fx: { fx: 'fade' } }), 2)
    expect(fx).toMatchObject({ k: 'fade', u: 'block', d: 0, st: 0, n: 1 })
    expect(fx!.dur).toBeCloseTo(0.35, 6)
    expect(fx!.tt).toBeCloseTo(0.35, 6)
    expect(fx!.units).toEqual([])
    expect(resolveOverlayFx(clip(), 2)).toBeNull()
  })

  it('typewriter: step reveal (tiny dur), default 0.05s stagger, char units', () => {
    const fx = resolveOverlayFx(
      clip({ fx: { fx: 'typewriter', unit: 'char' } }),
      2,
    )!
    expect(fx.k).toBe('typewriter')
    expect(fx.n).toBe(5) // 'Hello'
    expect(fx.st).toBeCloseTo(0.05, 6)
    expect(fx.dur).toBeCloseTo(0.001, 6)
    expect(fx.units).toEqual([['H', 'e', 'l', 'l', 'o']])
  })

  it('stagger clamps so the whole entrance fits ~90% of the clip', () => {
    const fx = resolveOverlayFx(
      clip({ fx: { fx: 'fade', unit: 'char', stagger: 2, duration: 0.3 } }),
      2,
    )!
    // maxTotal = 1.8 → st = (1.8 − 0.3) / 4
    expect(fx.st).toBeCloseTo(0.375, 4)
    expect(fx.tt).toBeCloseTo(1.8, 4)
  })

  it('is a pure function of the doc (deterministic)', () => {
    const spec = clip({
      fx: { fx: 'rise', unit: 'word', direction: 'center', stagger: 0.1 },
    })
    expect(resolveOverlayFx(spec, 2)).toEqual(resolveOverlayFx(spec, 2))
  })
})

describe('text fx (TX6) — lowering parity + baked payload', () => {
  it('fx bakes only when present (byte parity for fx-less docs)', () => {
    const { data } = lowerToComposition(makeDoc([clip()]))
    const ol = (data.overlays as Record<string, unknown>[])[0]
    expect('fx' in ol).toBe(false)
  })

  it('bakes the normalized payload for a staggered fx', () => {
    const { data } = lowerToComposition(
      makeDoc([clip({ fx: { fx: 'pop', unit: 'word', stagger: 0.08 } })]),
    )
    const ol = (data.overlays as Record<string, { fx: unknown }>[])[0]
    expect(ol.fx).toMatchObject({
      k: 'pop',
      u: 'word',
      d: 0,
      st: 0.08,
      n: 1, // 'Hello' is one word
      units: [['Hello']],
    })
  })
})

describe('text fx (TX6) — ON_FRAME per-unit draw (stub)', () => {
  const type = (over: Record<string, unknown> = {}) =>
    clip({
      fx: {
        fx: 'typewriter',
        unit: 'char',
        stagger: 0.1,
        ...over,
      } as TextOverlayClip['fx'],
    })

  it('typewriter reveals units by count as t advances', () => {
    // olT = t − 0.5; delays 0/.1/.2/.3/.4
    expect(runFrame([type()], 0.5).texts.length).toBe(1)
    expect(runFrame([type()], 0.75).texts.length).toBe(3)
    expect(runFrame([type()], 1.0).texts.length).toBe(5)
    expect(runFrame([type()], 2.0).texts.length).toBe(5) // settled
  })

  it('is deterministic at arbitrary t (same frame twice = same draw)', () => {
    const a = runFrame([type()], 0.6837)
    const b = runFrame([type()], 0.6837)
    expect(a.texts).toEqual(b.texts)
    expect(a.calls).toEqual(b.calls)
  })

  it('reverse direction reveals the tail first', () => {
    const r = runFrame([type({ direction: 'reverse' })], 0.55)
    // only the LAST char's delay is 0 in reverse
    expect(r.texts.length).toBe(1)
    expect(r.texts[0].text).toBe('o')
  })

  it('staggered fade: early frame draws only the units whose window opened', () => {
    const r = runFrame(
      [clip({ fx: { fx: 'fade', unit: 'char', stagger: 0.1, duration: 0.2 } })],
      0.55,
    )
    // olT = 0.05: unit0 mid-fade, unit1+ not started (alpha 0 → skipped)
    expect(r.texts.length).toBe(1)
  })

  it('per-unit stroke draws under each fill', () => {
    const r = runFrame(
      [{ ...type({ stagger: 0 }), stroke: { color: '#000', width: 4 } }],
      2.0,
    )
    const strokes = r.calls.filter((c) => c === 'ov.strokeText').length
    expect(strokes).toBe(5)
    expect(r.texts.length).toBe(5)
  })

  it('block fx rides the normal per-line draw (one fillText per line)', () => {
    const r = runFrame(
      [clip({ text: 'a\nb', fx: { fx: 'rise' } })],
      0.6, // mid-entrance
    )
    expect(r.texts.length).toBe(2)
    const a = r.sets['ov.globalAlpha'] as number
    expect(a).toBeGreaterThan(0)
    expect(a).toBeLessThan(1)
  })

  it('maxWidth: ON_FRAME wraps like the host mirror; fx units regroup, not recount', () => {
    // Stub measure: 10 design px per char. 'Hello world again' = 170px;
    // budget 0.05 × 1920 = 96px → tokens (60/60/50) wrap to 3 lines.
    const wrapClip = clip({
      text: 'Hello world again',
      maxWidth: 0.05,
      fx: { fx: 'typewriter', unit: 'word', stagger: 0.1 },
    })
    // Host mirror: same tokens, same budget, same lines.
    expect(
      wrapOverlayLines(['Hello world again'], (t) => t.length * 10, 96),
    ).toEqual(['Hello ', 'world ', 'again'])
    // ON_FRAME: 3 units revealed one per wrapped line as t advances.
    const px = (t: string) => t.length * 10
    const run = (time: number) => runFrame([wrapClip], time, new Map(), px)
    expect(run(0.55).texts.length).toBe(1)
    expect(run(0.75).texts.length).toBe(3)
    // Wrapped lines stack: three distinct y positions, symmetric block.
    const settled = run(2.0)
    const ys = [...new Set(settled.texts.map((t) => t.y))]
    expect(ys.length).toBe(3)
    expect(Math.min(...ys)).toBeCloseTo(-Math.max(...ys), 6)
  })

  it('maxWidth: overlayRect grows tall, capped wide (the picking mirror)', () => {
    const measure = (text: string) => text.length * 10
    const bare = overlayRect(
      clip({ text: 'Hello world again' }),
      measure,
      1920,
      1080,
    )
    const wrapped = overlayRect(
      clip({ text: 'Hello world again', maxWidth: 0.05 }),
      measure,
      1920,
      1080,
    )
    expect(bare.h).toBeCloseTo(64 * OVERLAY_LINE_HEIGHT, 6)
    expect(wrapped.h).toBeCloseTo(3 * 64 * OVERLAY_LINE_HEIGHT, 6)
    expect(wrapped.w).toBeLessThan(bare.w)
  })

  it('wrapOverlayLines: token wider than budget gets its own line; \\n respected', () => {
    const m = (t: string) => t.length * 10
    expect(wrapOverlayLines(['aaaaaaaaaaaa bb'], m, 60)).toEqual([
      'aaaaaaaaaaaa ',
      'bb',
    ])
    expect(wrapOverlayLines(['short', 'also short'], m, 200)).toEqual([
      'short',
      'also short',
    ])
    expect(wrapOverlayLines([''], m, 60)).toEqual([''])
  })

  it('redraw gate stays hot for the whole staggered span', () => {
    // tt = 0.4 + 0.001 ≫ olTD; at olT = 0.38 the legacy gate would have gone
    // cold (past 0.35) — fx must keep the texture uploading.
    const r = runFrame([type()], 0.88)
    expect(r.ovTexture.needsUpdate).toBe(true)
    expect(r.texts.length).toBe(4)
  })
})

describe('media overlay style', () => {
  const media = (over: Record<string, unknown> = {}): OverlayClip =>
    ({
      id: 'm1',
      kind: 'image',
      key: 'blob:x',
      start: 0,
      duration: 2,
      transform: { x: 0.5, y: 0.5, scale: 1, rotation: 0 },
      ...over,
    }) as OverlayClip

  it('absent fields lower with NO shadow/border keys (byte parity)', () => {
    const { data } = lowerToComposition(makeDoc([media()]))
    const ol = (data.overlays as Record<string, unknown>[])[0]
    expect('shadow' in ol).toBe(false)
    expect('border' in ol).toBe(false)
    expect(ol.radius).toBe(12)
  })

  it('set fields ride the lowered clip', () => {
    const { data } = lowerToComposition(
      makeDoc([media({ shadow: 'none', border: { width: 3, color: '#fff' } })]),
    )
    const ol = (data.overlays as Record<string, unknown>[])[0]
    expect(ol.shadow).toBe('none')
    expect(ol.border).toEqual({ width: 3, color: '#fff' })
  })

  it('a zero-width border is not emitted', () => {
    const { data } = lowerToComposition(
      makeDoc([media({ border: { width: 0, color: '#fff' } })]),
    )
    expect('border' in (data.overlays as Record<string, unknown>[])[0]).toBe(
      false,
    )
  })

  it('ON_FRAME defaults absent shadow to soft and strokes the border', () => {
    const { config } = lowerToComposition(makeDoc([media()]))
    const onFrame = studioEntryOf(config).onFrame
    expect(onFrame).toContain("ol.shadow || 'soft'")
    expect(onFrame).toContain('ol.border && ol.border.width > 0')
  })
})
