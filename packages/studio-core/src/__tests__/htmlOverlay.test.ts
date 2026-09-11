/**
 * A `kind: 'html'` layer through the engine: what the lowering emits, what
 * the page draws, and the contracts that keep a live edit honest: the page
 * builder mirrors the pure composer byte for byte, a pending picture keeps
 * the canvas repainting only while the clip is on screen, the previous
 * picture stands in while the next rasterizes, and a page that taints draws
 * no HTML layer and every other one.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { lerpArray, mapTime, sample } from '@vosjs/timeline'
import { htmlLayerSvg } from '../htmlLayer'
import { HTML_LAYER_SVG_CODE } from '../lower/studioEntry'
import {
  DEFAULT_CAM_STYLE,
  DEFAULT_CURSOR_STYLE,
  DEFAULT_FRAME_STYLE,
  isKeyedOverlay,
} from '../types'
import { lowerMerged as lowerToComposition } from './helpers/studio'
import type { HtmlOverlayClip, ProjectDoc } from '../types'

function makeDoc(over: Partial<ProjectDoc> = {}): ProjectDoc {
  return {
    source: {
      videoKey: 'blob:v',
      cursor: [],
      meta: {
        dpr: 1,
        zoom: 1,
        t0: 0,
        durationMs: 10000,
        width: 1920,
        height: 1080,
        fps: 30,
      },
    },
    segments: [{ in: 0, out: 10 }],
    zoom: [],
    audio: [],
    cursor: DEFAULT_CURSOR_STYLE,
    cam: DEFAULT_CAM_STYLE,
    frame: DEFAULT_FRAME_STYLE,
    export: { resolution: '1080p', fps: 30, format: 'mp4' },
    ...over,
  }
}

const htmlClip = (over: Partial<HtmlOverlayClip> = {}): HtmlOverlayClip => ({
  id: 'h1',
  kind: 'html',
  start: 1,
  duration: 3,
  html: '<div class="card">Open Code</div>',
  css: ".card{font-family:'Inter';font-weight:600;background:#0b0b0d;border-radius:18px;box-shadow:0 30px 60px rgba(0,0,0,.5)}",
  box: { width: 452, height: 302 },
  transform: { x: 0.7, y: 0.5, scale: 1, rotation: 0 },
  ...over,
})

/** The overlays the studio entry is handed for a doc. */
function overlaysOf(doc: ProjectDoc): any[] {
  const lowered = lowerToComposition(doc)
  return (lowered.data.overlays as any[]) ?? []
}

describe('a kind:html layer, lowered', () => {
  it('is not a keyed overlay: it has no file, only source', () => {
    const clip = htmlClip()
    expect(isKeyedOverlay(clip)).toBe(false)
    expect('key' in clip).toBe(false)
  })

  it('lowers to an IMAGE clip carrying its source, so ON_FRAME needs no branch', () => {
    const [o] = overlaysOf(makeDoc({ overlays: [htmlClip()] }))
    expect(o.kind).toBe('image')
    expect(o.html.markup).toContain('Open Code')
    expect(o.html.css).toContain('border-radius')
    expect(o.html.box).toEqual({ width: 452, height: 302 })
    // The bleed is DERIVED from the shadow: 30 + 60 = 90, with the margin.
    expect(o.html.bleed).toBe(104)
  })

  it('resolves faces from the CSS as URLs, never bytes', () => {
    const [o] = overlaysOf(makeDoc({ overlays: [htmlClip()] }))
    expect(o.html.faces).toEqual([
      {
        family: 'Inter',
        url: 'https://assets.vos.so/fonts/inter/400.woff2',
        weight: 400,
        style: 'normal',
      },
      {
        family: 'Inter',
        url: 'https://assets.vos.so/fonts/inter/600.woff2',
        weight: 600,
        style: 'normal',
      },
    ])
    expect(JSON.stringify(o.html)).not.toContain('base64')
  })

  it('keys the layer by a CACHE HANDLE that is never a URL', () => {
    const [o] = overlaysOf(makeDoc({ overlays: [htmlClip({ id: 'callout' })] }))
    expect(o.key.startsWith('html:callout:')).toBe(true)
    expect(o.key).not.toMatch(/^(https?:|\/|data:)/)
  })

  it('re-keys when the source changes, and only then', () => {
    const key = (c: Partial<HtmlOverlayClip>) =>
      overlaysOf(makeDoc({ overlays: [htmlClip(c)] }))[0].key
    const base = key({})
    expect(key({})).toBe(base)
    expect(
      key({ start: 5, transform: { x: 0.2, y: 0.2, scale: 2, rotation: 9 } }),
    ).toBe(base)
    expect(key({ html: '<div class="card">Composition</div>' })).not.toBe(base)
    expect(key({ css: '.card{background:#fff}' })).not.toBe(base)
    expect(key({ box: { width: 500, height: 302 } })).not.toBe(base)
    expect(key({ bleed: 12 })).not.toBe(base)
  })

  it('asks the compositor for NO chrome: the CSS is the chrome', () => {
    // The painter casts a clip's shadow from its BOX, and a layer is mostly
    // transparent bleed, so a 'soft' default came out as a black rectangle.
    const [o] = overlaysOf(makeDoc({ overlays: [htmlClip()] }))
    expect(o.shadow).toBe('none')
    expect(o.radius).toBe(0)
    expect(o.border).toBeUndefined()
    expect(o.card).toBeUndefined()
  })

  it('sizes at the design size by default: the picture box over 1920', () => {
    const [o] = overlaysOf(makeDoc({ overlays: [htmlClip()] }))
    expect(o.w).toBeCloseTo((452 + 208) / 1920, 3)
    const [w] = overlaysOf(makeDoc({ overlays: [htmlClip({ width: 0.4 })] }))
    expect(w.w).toBe(0.4)
  })

  it('keeps its timing and placement like any other clip', () => {
    const [o] = overlaysOf(makeDoc({ overlays: [htmlClip()] }))
    expect(o.start).toBe(1)
    expect(o.dur).toBe(3)
    expect(o.x).toBe(0.7)
    expect(o.enter).toBe('rise')
    expect(o.exit).toBe('fade')
  })

  it('leaves a doc without one byte-identical', () => {
    expect(JSON.stringify(overlaysOf(makeDoc()))).toBe('[]')
  })
})

describe('one composer, two homes', () => {
  // SETUP is a function string and cannot import the pure composer, so the
  // page carries a mirror. This is what keeps the mirror honest.
  const pageSvg = new Function(`return (${HTML_LAYER_SVG_CODE})`)() as (
    src: unknown,
    faces: unknown,
  ) => string

  const cases: [
    string,
    Parameters<typeof htmlLayerSvg>[0],
    Parameters<typeof htmlLayerSvg>[1],
  ][] = [
    ['bare', { html: '<div>x</div>', box: { width: 300, height: 132 } }, []],
    [
      'one face and a bleed',
      {
        html: '<p class="a">Tom &amp; Jerry</p>',
        css: '.a{color:#fff}',
        box: { width: 452, height: 302 },
        bleed: 96,
      },
      [
        {
          family: 'Inter',
          weight: 600,
          style: 'normal',
          dataUri: 'data:font/woff2;base64,AAAA',
        },
      ],
    ],
    [
      'two faces',
      { html: '<div/>', css: '', box: { width: 10, height: 10 }, bleed: 0 },
      [
        { family: 'Inter', weight: 400, style: 'normal', dataUri: 'data:,a' },
        {
          family: 'JetBrains Mono',
          weight: 700,
          style: 'italic',
          dataUri: 'data:,b',
        },
      ],
    ],
  ]

  for (const [name, src, faces] of cases)
    it(`the page builder mirrors the pure composer byte for byte: ${name}`, () => {
      expect(pageSvg(src, faces)).toBe(htmlLayerSvg(src, faces))
    })
})

describe('a kind:html layer, painted', () => {
  const g = globalThis as Record<string, unknown>
  afterEach(() => {
    delete g.window
    delete g.__vosTimeline
  })

  /** A decoded picture the way the cache holds one. */
  const picture = (w: number, h: number) => ({
    complete: true,
    naturalWidth: w,
    naturalHeight: h,
  })

  /**
   * Both programs over one set of refs (the layerDirty harness), with a c2d
   * that RECORDS drawImage so the painted width can be read back.
   */
  function makeRunner(
    doc: ProjectDoc,
    cache = new Map<string, unknown>(),
    vos: Record<string, unknown> = {},
  ) {
    const { config, data } = lowerToComposition(doc)
    // Each program gets its OWN refs, as at runtime (`bothFrames` shares
    // one set, and two programs writing `ov.sig` on one ref dirty each other
    // forever, which is not a contract, only the harness).
    const mainFrame = new Function(
      `return (${config.onFrame as string})`,
    )() as (ctx: unknown, content: unknown, dt: number) => void
    const entry = (config.stack as { onFrame: string }[])[0]
    const entryFrame = new Function(`return (${entry.onFrame})`)() as (
      ctx: unknown,
      content: unknown,
      dt: number,
    ) => void
    g.window = {
      __vos__: {
        isPaused: true,
        videoCache: cache,
        pendingDecodes: new Set(),
        ...vos,
      },
    }
    g.__vosTimeline = { mapTime, sample, lerpArray }
    const draws: unknown[][] = []
    const c2d = new Proxy(
      {},
      {
        get: (_t, key: string) => {
          if (key === 'measureText') return () => ({ width: 42 })
          if (key === 'createLinearGradient')
            return () => ({ addColorStop: () => {} })
          if (key === 'drawImage')
            return (...args: unknown[]) => draws.push(args)
          return () => {}
        },
        set: () => true,
      },
    )
    const tex = () => ({ needsUpdate: false, dispose: () => undefined })
    const ovTex = tex()
    const layer = (t: { needsUpdate: boolean }) => ({
      c2d,
      canvas: { width: 1920, height: 1080 },
      texture: t,
      mesh: null,
    })
    const plain = new Proxy(
      {},
      {
        get: () => () => ({ addColorStop: () => {}, width: 42 }),
        set: () => true,
      },
    )
    const mainRefs = {
      bg: {
        c2d: plain,
        canvas: { width: 1920, height: 1080 },
        texture: tex(),
        mesh: null,
      },
      card: {
        c2d: plain,
        canvas: { width: 1920, height: 1080 },
        texture: tex(),
        mesh: null,
      },
      ov: {
        c2d: plain,
        canvas: { width: 1920, height: 1080 },
        texture: tex(),
        mesh: null,
      },
      video: {
        videoWidth: 1920,
        videoHeight: 1080,
        readyState: 2,
        paused: true,
        currentTime: 0,
        play() {},
        pause() {},
        addEventListener() {},
        removeEventListener() {},
      },
      cam: null,
    }
    const refs = {
      bg: layer(tex()),
      card: layer(tex()),
      ov: layer(ovTex),
      video: {
        videoWidth: 1920,
        videoHeight: 1080,
        readyState: 2,
        paused: true,
        currentTime: 0,
        play() {},
        pause() {},
        addEventListener() {},
        removeEventListener() {},
      },
      cam: null,
    }
    return {
      ovTex,
      draws,
      /** The overlay pictures drawn this frame (the card's footage draw excluded). */
      pictures: () =>
        draws.filter((d) => (d[0] as { naturalWidth?: number })?.naturalWidth),
      frame(time: number) {
        ovTex.needsUpdate = false
        draws.length = 0
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
        mainFrame(ctx, { refs: mainRefs }, 1 / 30)
        entryFrame(ctx, { refs }, 1 / 30)
      },
    }
  }

  const keyOf = (doc: ProjectDoc) => overlaysOf(doc)[0].key as string

  it('width is a fraction of the FRAME: a 1920-wide box paints 1920 px wide', () => {
    // The document-model trap the POC recorded as "a fraction of the CARD"
    // was the bleed: the picture is the box PLUS its bleed, so a shadowed
    // full-frame layer landed narrower than the frame. With no shadow, no
    // bleed, and the design-size default, the layer spans the frame.
    const doc = makeDoc({
      overlays: [
        htmlClip({
          css: '.card{background:#000}',
          box: { width: 1920, height: 1080 },
          transform: { x: 0.5, y: 0.5, scale: 1, rotation: 0 },
        }),
      ],
    })
    const run = makeRunner(doc, new Map([[keyOf(doc), picture(1920, 1080)]]))
    run.frame(2)
    const draw = run.draws.find(
      (d) => d[0] && (d[0] as { naturalWidth?: number }).naturalWidth === 1920,
    )
    expect(draw).toBeDefined()
    expect(draw![3]).toBeCloseTo(1920)
    expect(draw![4]).toBeCloseTo(1080)
  })

  it('repaints while pending, paints once landed, and stays quiet outside its span', () => {
    // The overlay canvas repaints every frame a clip is VISIBLE (the
    // entry's `ov.active`), text and html alike; what an html layer adds is
    // that a pending picture forces the repaint so the landing shows, and
    // that a pending picture dirties nothing while the clip is off screen.
    const doc = makeDoc({ overlays: [htmlClip()] })
    const pending = makeRunner(doc)
    pending.frame(2)
    expect(pending.ovTex.needsUpdate).toBe(true)
    pending.frame(2.1)
    expect(pending.ovTex.needsUpdate).toBe(true) // still rasterizing
    expect(pending.pictures()).toHaveLength(0) // nothing to draw yet, no blank

    const landed = makeRunner(doc, new Map([[keyOf(doc), picture(660, 510)]]))
    landed.frame(2)
    expect(landed.pictures()).toHaveLength(1)
    landed.frame(2.1)
    expect(landed.pictures()).toHaveLength(1)

    const off = makeRunner(doc) // pending, but the clip starts at 1s
    off.frame(0.5)
    expect(off.ovTex.needsUpdate).toBe(true) // the first frame clears once
    off.frame(0.6)
    expect(off.ovTex.needsUpdate).toBe(false)
  })

  it('draws the previous picture while the next rasterizes', () => {
    const doc = makeDoc({ overlays: [htmlClip()] })
    const last = picture(660, 510)
    const run = makeRunner(doc, new Map(), { htmlLast: { h1: last } })
    run.frame(2)
    expect(run.draws.some((d) => d[0] === last)).toBe(true)
  })

  it('asks the page builder once per key when the picture is missing', () => {
    const doc = makeDoc({ overlays: [htmlClip()] })
    const asked: string[] = []
    const run = makeRunner(doc, new Map(), {
      buildHtmlLayer: (oc: { key: string }) => asked.push(oc.key),
    })
    run.frame(2)
    run.frame(2.1)
    expect(asked).toEqual([keyOf(doc)])
  })

  it('draws nothing on a page that taints, and keeps every other layer', () => {
    const doc = makeDoc({
      overlays: [
        htmlClip(),
        {
          id: 't1',
          kind: 'text',
          start: 1,
          duration: 3,
          text: 'Still here',
          preset: 'title',
          transform: { x: 0.5, y: 0.82, scale: 1, rotation: 0 },
        },
      ],
    })
    const asked: string[] = []
    const run = makeRunner(doc, new Map([[keyOf(doc), picture(660, 510)]]), {
      htmlSafe: false,
      buildHtmlLayer: (oc: { key: string }) => asked.push(oc.key),
    })
    run.frame(2)
    expect(run.pictures()).toHaveLength(0)
    expect(asked).toEqual([])
    // The text overlay still repaints the canvas on the first frame.
    expect(run.ovTex.needsUpdate).toBe(true)
  })

  it('sweeps the picture of a clip that left the document', () => {
    const doc = makeDoc({
      overlays: [htmlClip({ id: 'stays' })],
    })
    const cache = new Map<string, unknown>([['html:gone:abc', picture(1, 1)]])
    const vos = {
      htmlLast: { gone: picture(1, 1), stays: picture(1, 1) },
      htmlKeys: { gone: 'html:gone:abc' },
      htmlWant: { gone: 'html:gone:abc' },
      htmlErrors: { gone: 'x' },
    }
    const run = makeRunner(doc, cache, vos)
    run.frame(2)
    expect(cache.has('html:gone:abc')).toBe(false)
    expect(Object.keys(vos.htmlLast)).toEqual(['stays'])
    expect(vos.htmlKeys).toEqual({})
    expect(vos.htmlWant).toEqual({})
    expect(vos.htmlErrors).toEqual({})
  })
})
