/**
 * The pure half of an HTML layer: the gate, the bleed reader, the faces from
 * the CSS, the geometry, the key and the composer. Every rule here exists
 * because the failure it catches is SILENT in the page: a malformed layer
 * never decodes, a URL-named face never applies, a clipped shadow reads as
 * a grey corner, and nothing anywhere says why.
 */
import { describe, expect, it } from 'vitest'
import {
  DESIGN_FRAME_WIDTH,
  HTML_LAYER_MAX_BYTES,
  cssFamilies,
  cssWeights,
  htmlLayerAssets,
  htmlLayerBleedFor,
  htmlLayerFaces,
  htmlLayerKey,
  htmlLayerLabel,
  htmlLayerPayload,
  htmlLayerPictureBox,
  htmlLayerProblems,
  htmlLayerSvg,
  htmlLayerText,
  htmlLayerUnhostedFamilies,
  htmlLayerWidth,
  wellFormedXml,
} from '../htmlLayer'
import { overlayRect } from '../overlayText'
import type { HtmlOverlayClip } from '../types'

const BOX = { width: 300, height: 132 }

const clip = (over: Partial<HtmlOverlayClip> = {}): HtmlOverlayClip => ({
  id: 'h1',
  kind: 'html',
  html: '<div class="card">Open Code</div>',
  box: BOX,
  start: 0,
  duration: 3,
  transform: { x: 0.5, y: 0.5, scale: 1, rotation: 0 },
  ...over,
})

const codes = (c: Partial<HtmlOverlayClip>) =>
  htmlLayerProblems(clip(c) as never).map((p) => p.code)
const problems = (c: Partial<HtmlOverlayClip>) =>
  htmlLayerProblems(clip(c) as never)
    .filter((p) => p.level === 'problem')
    .map((p) => p.code)

describe('htmlLayerProblems: the XML rules foreignObject enforces', () => {
  it('refuses an unclosed void tag, once per tag', () => {
    const list = htmlLayerProblems(clip({ html: '<div>a<br>b<br>c</div>' }))
    expect(list.filter((p) => p.code === 'unclosed-void')).toHaveLength(1)
    expect(list[0].level).toBe('problem')
  })

  it('accepts a self-closed void tag', () => {
    expect(
      problems({ html: '<div>a<br />b<img src="data:," /></div>' }),
    ).toEqual([])
  })

  it('refuses a bare ampersand but accepts an entity', () => {
    expect(codes({ html: '<div>Tom & Jerry</div>' })).toContain(
      'bare-ampersand',
    )
    expect(problems({ html: '<div>Tom &amp; Jerry</div>' })).toEqual([])
    expect(problems({ html: '<div>a &#183; b &#x2022; c</div>' })).toEqual([])
  })

  it('refuses an unquoted attribute value', () => {
    expect(codes({ html: '<div class=cta>x</div>' })).toContain('unquoted-attr')
    expect(problems({ html: '<div class="cta">x</div>' })).toEqual([])
  })

  it('refuses empty markup', () => {
    expect(codes({ html: '   ' })).toContain('empty')
  })

  it('warns past 32 KB and refuses past the ceiling', () => {
    const big = '<div>' + 'x'.repeat(40_000) + '</div>'
    const warn = htmlLayerProblems(clip({ html: big })).find(
      (p) => p.code === 'too-large',
    )
    expect(warn?.level).toBe('warning')
    const huge = '<div>' + 'x'.repeat(HTML_LAYER_MAX_BYTES) + '</div>'
    expect(problems({ html: huge })).toContain('too-large')
  })

  it("refuses a media clip's fields by name: the CSS is the chrome", () => {
    const list = htmlLayerProblems({
      ...clip(),
      shadow: 'soft',
      radius: 12,
      key: 'x.png',
    } as never)
    const fields = list
      .filter((p) => p.code === 'foreign-field')
      .map((p) => p.message)
    expect(fields).toHaveLength(3)
    expect(fields.join(' ')).toContain('"shadow"')
    expect(fields.join(' ')).toContain('"key"')
  })

  it('warns on a resource the SVG image can never fetch', () => {
    expect(codes({ html: '<img src="https://x.test/a.png" />' })).toContain(
      'external-resource',
    )
    expect(codes({ css: '.a{background:url(//x.test/a.png)}' })).toContain(
      'external-resource',
    )
    expect(codes({ html: '<img src="data:image/png;base64,AAAA" />' })).toEqual(
      [],
    )
  })

  it('warns on a wall-clock animation: the export cannot follow it', () => {
    const list = htmlLayerProblems(
      clip({ css: '.a{animation:spin 1s linear infinite}' }),
    )
    const wall = list.find((p) => p.code === 'wall-clock')
    expect(wall?.level).toBe('warning')
    expect(wall?.message).toContain('wall clock')
    expect(codes({ css: '.a{transition-duration:.2s}' })).toContain(
      'wall-clock',
    )
    // A property that merely contains the word is not an animation.
    expect(codes({ css: '.animation-card{color:red}' })).toEqual([])
  })

  it('warns on a family the catalog does not host', () => {
    const list = htmlLayerProblems(clip({ css: ".a{font-family:'Geist'}" }))
    const f = list.find((p) => p.code === 'unhosted-family')
    expect(f?.level).toBe('warning')
    expect(f?.message).toContain('Geist')
    expect(f?.message).toContain('/api/fonts')
    expect(codes({ css: ".a{font-family:'Inter'}" })).toEqual([])
    // An explicit font covers it.
    expect(
      codes({
        css: ".a{font-family:'Geist'}",
        fonts: [{ family: 'Geist', url: 'https://x.test/geist.woff2' }],
      }),
    ).toEqual(['external-resource'].filter(() => false))
  })
})

describe('bleed: room for what paints outside the box', () => {
  const SHADOW =
    '.cta{box-shadow:0 1px 2px rgba(0,0,0,.1),0 10px 22px rgba(0,0,0,.14),0 30px 60px rgba(0,0,0,.16)}'

  it('reads the furthest reach off the CSS', () => {
    // The widest layer is 0 30px 60px: 30 offset + 60 blur = 90, plus margin.
    expect(htmlLayerBleedFor(SHADOW)).toBe(104)
  })

  it('counts spread and a negative offset, skips inset', () => {
    expect(htmlLayerBleedFor('.a{box-shadow:-40px 0 10px 5px #000}')).toBe(
      Math.ceil(55 * 1.15),
    )
    expect(htmlLayerBleedFor('.a{box-shadow:inset 0 0 40px #000}')).toBe(0)
  })

  it('reads a drop-shadow filter and nothing else in filter', () => {
    expect(
      htmlLayerBleedFor('.a{filter:blur(20px) drop-shadow(0 8px 12px #000)}'),
    ).toBe(Math.ceil(20 * 1.15))
  })

  it('is zero when nothing paints outside', () => {
    expect(htmlLayerBleedFor('.a{color:red;border-radius:8px}')).toBe(0)
    expect(htmlLayerBleedFor(undefined)).toBe(0)
  })

  it('is derived when absent, so a shadowed layer needs no arithmetic', () => {
    expect(htmlLayerPictureBox(clip({ css: SHADOW })).bleed).toBe(104)
    expect(problems({ css: SHADOW })).toEqual([])
  })

  it('warns only when a STATED bleed is too small, naming the number', () => {
    const list = htmlLayerProblems(clip({ css: SHADOW, bleed: 10 }))
    const shadow = list.find((p) => p.code === 'shadow-clipped')
    expect(shadow?.level).toBe('warning')
    expect(shadow?.message).toContain('104')
    expect(codes({ css: SHADOW, bleed: 104 })).toEqual([])
  })
})

describe('faces: the CSS names the family, the catalog answers', () => {
  it('reads families in order, deduped, generics dropped', () => {
    expect(
      cssFamilies(
        '.a{font-family:\'Inter\',-apple-system,system-ui,sans-serif}.b{font-family:"JetBrains Mono", ui-monospace, monospace}.c{font-family:Inter}',
      ),
    ).toEqual(['Inter', 'JetBrains Mono'])
  })

  it('reads weights from the CSS and the markup, 400 always', () => {
    expect(cssWeights(undefined)).toEqual([400])
    expect(cssWeights('.a{font-weight:600}.b{font-weight:bold}')).toEqual([
      400, 600, 700,
    ])
    expect(cssWeights('', '<strong>x</strong>')).toEqual([400, 700])
  })

  it('resolves hosted families to catalog URLs at the weights asked for', () => {
    const faces = htmlLayerFaces(
      clip({
        css: ".a{font-family:'Inter';font-weight:700}.code{font-family:'JetBrains Mono'}",
      }),
    )
    // Every family at every weight the source asks for (a cross product;
    // a face nobody sets costs one fetch, never a wrong glyph).
    expect(faces).toEqual([
      {
        family: 'Inter',
        url: 'https://assets.vos.so/fonts/inter/400.woff2',
        weight: 400,
        style: 'normal',
      },
      {
        family: 'Inter',
        url: 'https://assets.vos.so/fonts/inter/700.woff2',
        weight: 700,
        style: 'normal',
      },
      {
        family: 'JetBrains Mono',
        url: 'https://assets.vos.so/fonts/jetbrains-mono/400.woff2',
        weight: 400,
        style: 'normal',
      },
      {
        family: 'JetBrains Mono',
        url: 'https://assets.vos.so/fonts/jetbrains-mono/700.woff2',
        weight: 700,
        style: 'normal',
      },
    ])
    // The document carries no URL: the whole point of the shape.
    expect(
      JSON.stringify(clip({ css: ".a{font-family:'Inter'}" })),
    ).not.toContain('assets.vos.so')
  })

  it('snaps an unhosted weight to the nearest step, deduped', () => {
    const faces = htmlLayerFaces(
      clip({ css: ".a{font-family:'Lexend';font-weight:500}" }),
    )
    // Lexend hosts 400, 600, 700: 500 snaps to 400 (the nearer, first) and
    // merges with the always-present 400.
    expect(faces.map((f) => f.weight)).toEqual([400])
  })

  it('appends an explicit face for what the catalog lacks, and names the rest', () => {
    const c = clip({
      css: ".a{font-family:'Geist'}.b{font-family:'Comic Neue'}",
      fonts: [
        { family: 'Geist', url: 'https://x.test/geist.woff2', weight: 500 },
      ],
    })
    expect(htmlLayerFaces(c)).toEqual([
      {
        family: 'Geist',
        url: 'https://x.test/geist.woff2',
        weight: 500,
        style: 'normal',
      },
    ])
    expect(htmlLayerUnhostedFamilies(c)).toEqual(['Comic Neue'])
  })
})

describe('geometry: the picture box, the width, the rect', () => {
  it('sizes a layer at its design size by default, bleed included', () => {
    expect(htmlLayerWidth(clip())).toBeCloseTo(300 / DESIGN_FRAME_WIDTH)
    const shadowed = clip({ css: '.a{box-shadow:0 0 20px #000}' })
    const pb = htmlLayerPictureBox(shadowed)
    expect(pb).toEqual({ width: 300 + 46, height: 132 + 46, bleed: 23 })
    expect(htmlLayerWidth(shadowed)).toBeCloseTo(346 / DESIGN_FRAME_WIDTH)
    expect(htmlLayerWidth(clip({ width: 0.5 }))).toBe(0.5)
    // A box wider than the frame lands at the frame.
    expect(htmlLayerWidth(clip({ box: { width: 4000, height: 100 } }))).toBe(1)
  })

  it('overlayRect mirrors the lowering: the picture box aspect, no probe', () => {
    const c = clip({ css: '.a{box-shadow:0 0 20px #000}' })
    const r = overlayRect(c, () => 0, 1920, 1080)
    expect(r.cx).toBe(960)
    expect(r.cy).toBe(540)
    expect(r.w).toBeCloseTo(346)
    expect(r.h).toBeCloseTo(178)
    const scaled = overlayRect(
      clip({ transform: { x: 0.5, y: 0.5, scale: 2, rotation: 0 } }),
      () => 0,
      1920,
      1080,
    )
    expect(scaled.w).toBeCloseTo(600)
  })
})

describe('label: the words the markup carries', () => {
  it('strips tags, reads entities, collapses space', () => {
    expect(
      htmlLayerText(
        '<div class="a"><style>.x{}</style><b>Open</b> &amp; <i>Code</i>\n  now</div>',
      ),
    ).toBe('Open & Code now')
    expect(htmlLayerLabel(clip({ html: '<div>&#8984;K</div>' }))).toBe('⌘K')
    expect(htmlLayerLabel(clip({ html: '<div></div>' }))).toBe('HTML')
    expect(
      htmlLayerLabel(clip({ html: '<p>' + 'word '.repeat(20) + '</p>' })),
    ).toHaveLength(24)
  })
})

describe('key: content-addressed, a handle and never a URL', () => {
  const key = (c: Partial<HtmlOverlayClip>) => {
    const k = clip(c)
    return htmlLayerKey(k, htmlLayerFaces(k), htmlLayerPictureBox(k).bleed)
  }

  it('re-keys when the picture would change, and only then', () => {
    const base = key({})
    expect(key({})).toBe(base)
    expect(base.startsWith('html:h1:')).toBe(true)
    expect(base).not.toMatch(/^(https?:|\/|data:)/)
    // Not a repaint: moving, retiming, scaling, animating.
    expect(
      key({
        start: 5,
        transform: { x: 0.2, y: 0.2, scale: 2, rotation: 9 },
        anim: { enter: 'fade' },
      }),
    ).toBe(base)
    // A repaint: the markup, the CSS, the box, the bleed, a face.
    expect(key({ html: '<div class="card">Composition</div>' })).not.toBe(base)
    expect(key({ css: '.card{color:#fff}' })).not.toBe(base)
    expect(key({ box: { width: 301, height: 132 } })).not.toBe(base)
    expect(key({ bleed: 12 })).not.toBe(base)
    expect(key({ css: ".card{font-family:'Inter'}" })).not.toBe(base)
  })
})

describe('the composer', () => {
  it('lays the component out in design units with the XHTML namespace', () => {
    const svg = htmlLayerSvg({ html: '<div>x</div>', box: BOX })
    expect(svg).toContain('viewBox="0 0 300 132"')
    expect(svg).toContain('width="300" height="132"')
    expect(svg).toContain('xmlns="http://www.w3.org/1999/xhtml"')
    expect(svg).toContain('<foreignObject')
    expect(svg).not.toContain('@font-face')
  })

  it('inlines every face as bytes and names no URL', () => {
    const svg = htmlLayerSvg({ html: '<div>x</div>', box: BOX }, [
      {
        family: 'Lexend',
        weight: 600,
        style: 'normal',
        dataUri: 'data:font/woff2;base64,AAAA',
      },
    ])
    expect(svg).toContain("font-family:'Lexend'")
    expect(svg).toContain('url(data:font/woff2;base64,AAAA)')
    expect(svg).toContain('font-weight:600')
    expect(svg).not.toContain('https://')
  })

  it('grows the box by the bleed on every side and insets the component', () => {
    const svg = htmlLayerSvg({ html: '<div>x</div>', box: BOX, bleed: 70 })
    expect(svg).toContain('viewBox="0 0 440 272"')
    expect(svg).toContain('padding:70px')
    expect(htmlLayerSvg({ html: '<div>x</div>', box: BOX, bleed: 0 })).toBe(
      htmlLayerSvg({ html: '<div>x</div>', box: BOX }),
    )
  })
})

describe('wellFormedXml: the real question, asked of a real parser', () => {
  const parser = (fail: string | null) => () => ({
    getElementsByTagName: (name: string) =>
      name === 'parsererror' && fail !== null ? [{ textContent: fail }] : [],
  })
  it('passes when the parser raises nothing', () => {
    expect(wellFormedXml('<svg/>', parser(null))).toEqual({ ok: true })
  })
  it('reports the parser error in one line', () => {
    expect(
      wellFormedXml('<svg><br></svg>', parser('error on line 1:\n  tag br')),
    ).toEqual({ ok: false, error: 'error on line 1: tag br' })
    expect(wellFormedXml('<svg>', parser(''))).toEqual({
      ok: false,
      error: 'The markup is not well-formed XML.',
    })
  })
})

describe('htmlLayerAssets: images the source names by URL', () => {
  it('reads src attributes and url() values, deduped, protocol-relative included', () => {
    const { inlinable, foreign } = htmlLayerAssets({
      html: '<img src="https://assets.vos.so/i/a.png" /><img src="https://assets.vos.so/i/a.png" /><img src="//x.test/b.png" />',
      css: '.a{background:url("https://assets.vos.so/i/c.svg")}.b{mask:url(//assets.vos.so/i/d.svg)}',
    })
    expect(inlinable).toEqual([
      'https://assets.vos.so/i/a.png',
      'https://assets.vos.so/i/c.svg',
      '//assets.vos.so/i/d.svg',
    ])
    expect(foreign).toEqual(['//x.test/b.png'])
  })

  it('warns on a host the page cannot inline, names it, and says nothing about the hosted one', () => {
    const list = htmlLayerProblems(
      clip({
        html: '<img src="https://assets.vos.so/i/a.png" /><img src="https://x.test/b.png" />',
      }),
    )
    const ext = list.filter((p) => p.code === 'external-resource')
    expect(ext).toHaveLength(1)
    expect(ext[0].message).toContain('https://x.test/b.png')
    expect(ext[0].message).toContain('assets.vos.so')
  })
})

describe('htmlLayerProblems: a live layer', () => {
  it('lets a live layer keep its keyframes: the scrub is the honest form', () => {
    const css = '.a{animation:spin 1s linear infinite}'
    expect(codes({ css })).toContain('wall-clock')
    expect(codes({ css, live: true })).not.toContain('wall-clock')
  })

  it('warns when a live layer authors animation-delay: the scrub overrides it', () => {
    const list = htmlLayerProblems(
      clip({ css: '.a{animation:a 2s;animation-delay:.5s}', live: true }),
    )
    const d = list.find((p) => p.code === 'live-delay')
    expect(d?.level).toBe('warning')
    expect(d?.message).toContain('animation-delay')
    expect(codes({ css: '.a{animation:a 2s}', live: true })).toEqual([])
  })

  it('warns on placeholders in a STILL layer, which shows them as written', () => {
    expect(codes({ html: '<div>{{t}}</div>' })).toContain('placeholder-still')
    expect(codes({ html: '<div>{{ data.count }}</div>' })).toContain(
      'placeholder-still',
    )
    expect(codes({ html: '<div>{{t}}</div>', live: true })).toEqual([])
  })
})

describe('htmlLayerSvg: assets and the live form', () => {
  it('swaps every named asset for its bytes, in the markup and the CSS', () => {
    const svg = htmlLayerSvg(
      {
        html: '<img src="https://assets.vos.so/i/a.png" />',
        css: '.a{background:url(https://assets.vos.so/i/a.png)}',
        box: { width: 10, height: 10 },
      },
      [],
      [
        {
          url: 'https://assets.vos.so/i/a.png',
          dataUri: 'data:image/png;base64,AAAA',
        },
      ],
    )
    expect(svg).not.toContain('assets.vos.so')
    expect(svg.match(/data:image\/png;base64,AAAA/g)).toHaveLength(2)
  })

  it('a still leaves placeholders as written and carries no scrub block', () => {
    const svg = htmlLayerSvg({
      html: '<div>{{t}}</div>',
      css: '.a{animation:a 2s}',
      box: { width: 10, height: 10 },
    })
    expect(svg).toContain('{{t}}')
    expect(svg).not.toContain('--vos-t')
    expect(svg).not.toContain('animation-play-state')
  })

  it('a live layer fills t and data (escaped as text) and scrubs after the author CSS', () => {
    const svg = htmlLayerSvg({
      html: '<div>{{t}} · {{ data.name }} · {{data.missing}}</div>',
      css: '.a{animation:a 2s}',
      box: { width: 10, height: 10 },
      live: true,
      t: 1.23456,
      data: { name: 'Tom & <Jerry>' },
    })
    expect(svg).toContain('1.235 · Tom &amp; &lt;Jerry&gt; · </div>')
    expect(svg).toContain('.vos-html-layer{--vos-t:1.235}')
    expect(svg).toContain(
      '.vos-html-layer,.vos-html-layer *{animation-play-state:paused!important;animation-delay:calc(var(--vos-t) * -1s)!important}',
    )
    // After the author's CSS, so the scrub's !important wins a tie.
    expect(svg.indexOf('.a{animation:a 2s}')).toBeLessThan(
      svg.indexOf('animation-play-state'),
    )
  })
})

describe('htmlLayerKey and payload: assets and live', () => {
  const base = clip({
    html: '<img src="https://assets.vos.so/i/a.png" />',
  })
  it('keys on the named assets, and on live and its data', () => {
    const k = (c: HtmlOverlayClip) => htmlLayerPayload(c).key
    expect(k(base)).not.toBe(
      k({ ...base, html: '<img src="https://assets.vos.so/i/b.png" />' }),
    )
    expect(k(base)).not.toBe(k({ ...base, live: true }))
    expect(k({ ...base, live: true, data: { n: 1 } })).not.toBe(
      k({ ...base, live: true, data: { n: 2 } }),
    )
    // Data without live changes nothing: a still reads no placeholders.
    expect(k(base)).toBe(k({ ...base, data: { n: 1 } }))
  })

  it('hands the page the inlinable assets and the live flag with its data', () => {
    expect(htmlLayerPayload(base).html.assets).toEqual([
      'https://assets.vos.so/i/a.png',
    ])
    expect(htmlLayerPayload(base).html.live).toBeUndefined()
    const live = htmlLayerPayload({ ...base, live: true, data: { n: 1 } }).html
    expect(live.live).toBe(true)
    expect(live.data).toEqual({ n: 1 })
  })
})
