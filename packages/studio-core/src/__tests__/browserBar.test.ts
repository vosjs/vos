import { afterEach, describe, expect, it } from 'vitest'
import { lerpArray, mapTime, sample } from '@vosjs/timeline'
import { lowerToComposition } from '../lower/lowerToComposition'
import {
  DEFAULT_BROWSER_BAR,
  DEFAULT_CAM_STYLE,
  DEFAULT_CURSOR_STYLE,
  DEFAULT_FRAME_STYLE,
  FRAME_BORDER_COLOR_DEFAULT,
  FRAME_BORDER_WIDTH_DEFAULT,
  MINIMAL_BAR_THEMES,
  pageDisplayUrl,
} from '../types'
import type { BrowserBarStyle, ProjectDoc } from '../types'

describe('pageDisplayUrl', () => {
  it('shows the hostname without www', () => {
    expect(pageDisplayUrl('https://www.example.com/')).toBe('example.com')
    expect(pageDisplayUrl('https://vos.so')).toBe('vos.so')
  })

  it('keeps a non-root path', () => {
    expect(pageDisplayUrl('https://github.com/vosjs/vos')).toBe(
      'github.com/vosjs/vos',
    )
  })

  it('rejects non-http(s) and unparsable urls', () => {
    expect(pageDisplayUrl('chrome://extensions')).toBe('')
    expect(pageDisplayUrl('not a url')).toBe('')
    expect(pageDisplayUrl(undefined)).toBe('')
  })
})

describe('browser bar defaults', () => {
  it('is off by default with a sensible height', () => {
    expect(DEFAULT_FRAME_STYLE.browserBar).toEqual(DEFAULT_BROWSER_BAR)
    expect(DEFAULT_BROWSER_BAR.kind).toBe('none')
    expect(DEFAULT_BROWSER_BAR.height).toBeGreaterThan(0)
  })
})

// Run the compiled ON_FRAME interpreter string against stub canvas/video objects —
// catches syntax errors and drawing-path regressions the compile test can't.
describe('ON_FRAME smoke run', () => {
  const g = globalThis as Record<string, unknown>

  afterEach(() => {
    delete g.window
    delete g.__vosTimeline
  })

  function makeDoc(
    browserBar: BrowserBarStyle,
    frameExtra: Partial<ProjectDoc['frame']> = {},
  ): ProjectDoc {
    return {
      source: {
        videoKey: 'blob:video',
        cursor: [
          { t: 0, x: 100, y: 100, type: 'move' },
          { t: 500, x: 300, y: 300, type: 'down' },
        ],
        meta: {
          dpr: 2,
          zoom: 1,
          t0: 0,
          durationMs: 3000,
          width: 1600,
          height: 900,
          fps: 30,
        },
      },
      segments: [{ in: 0, out: 3 }],
      zoom: [{ id: 'z1', in: 0.5, out: 1.5, level: 1.6, cx: 0.5, cy: 0.5 }],
      audio: [],
      cursor: DEFAULT_CURSOR_STYLE,
      cam: DEFAULT_CAM_STYLE,
      frame: { ...DEFAULT_FRAME_STYLE, ...frameExtra, browserBar },
      export: { resolution: '1080p', fps: 30, format: 'mp4' },
    }
  }

  function runFrame(
    browserBar: BrowserBarStyle,
    frameExtra: Partial<ProjectDoc['frame']> = {},
  ): string[] {
    const { config, data } = lowerToComposition(makeDoc(browserBar, frameExtra))

    const onFrame = new Function(`return (${config.onFrame as string})`)() as (
      ctx: unknown,
      content: unknown,
      dt: number,
    ) => void

    g.window = { __vos__: { isPaused: true } }
    g.__vosTimeline = { mapTime, sample, lerpArray }

    const calls: string[] = []
    const c2d = new Proxy(
      {},
      {
        get: (_t, key: string) => {
          if (key === 'measureText') return () => ({ width: 42 })
          if (key === 'createLinearGradient')
            return () => ({ addColorStop: () => {} })
          return (...args: unknown[]) => {
            // roundRect keeps its args so geometry tests can pin WHERE a
            // rounded rect was drawn (the border-outside-the-card guarantee).
            calls.push(
              key === 'roundRect' ? 'roundRect:' + args.join(',') : key,
            )
          }
        },
        set: (_t, key: string, v: unknown) => {
          // Record color assignments so theme tests can assert what was painted.
          if (key === 'fillStyle' && typeof v === 'string')
            calls.push('fillStyle:' + v)
          if (key === 'strokeStyle' && typeof v === 'string')
            calls.push('strokeStyle:' + v)
          if (key === 'lineWidth') calls.push('lineWidth:' + String(v))
          if (key === 'globalAlpha') calls.push('globalAlpha:' + String(v))
          return true
        },
      },
    )
    const video = {
      videoWidth: 1600,
      videoHeight: 900,
      readyState: 2,
      paused: true,
      currentTime: 0.5,
      duration: 3,
      play: () => undefined,
      pause: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }
    const ctx = {
      time: 0.5,
      data,
      renderer: undefined,
      resolution: {
        width: 1920,
        height: 1080,
        drawingBufferWidth: 1920,
        drawingBufferHeight: 1080,
      },
    }
    const content = {
      refs: {
        c2d,
        canvas: { width: 1920, height: 1080 },
        texture: { needsUpdate: false, dispose: () => undefined },
        video,
        cam: null,
      },
    }
    onFrame(ctx, content, 1 / 30)
    return calls
  }

  it('draws without a bar (kind none)', () => {
    const calls = runFrame(DEFAULT_BROWSER_BAR)
    expect(calls).toContain('drawImage')
    expect(calls).not.toContain('fillText')
  })

  it('draws the mac bar with traffic lights and the url pill', () => {
    const calls = runFrame({
      kind: 'mac-light',
      url: 'example.com',
      showUrl: true,
      showControls: true,
      height: 44,
    })
    expect(calls).toContain('fillText') // url pill text
    expect(calls.filter((k) => k === 'arc').length).toBeGreaterThanOrEqual(3) // traffic lights (+cursor)
    expect(calls).toContain('drawImage')
  })

  it('draws the windows bar controls as strokes', () => {
    const calls = runFrame({
      kind: 'windows-dark',
      url: 'example.com',
      showUrl: true,
      showControls: true,
      height: 44,
    })
    expect(calls).toContain('strokeRect') // maximize glyph
    expect(calls).toContain('fillText')
  })

  it('paints the minimal bar with the selected theme colors', () => {
    const theme = MINIMAL_BAR_THEMES.find((t) => t.id === 'snow')
    const calls = runFrame({
      kind: 'minimal',
      url: 'example.com',
      showUrl: true,
      showControls: true,
      height: 44,
      theme,
    })
    expect(calls).toContain('fillStyle:#f8fafc') // themed bar
    expect(calls).toContain('fillStyle:#ffffff') // themed pill
    expect(calls).toContain('fillStyle:rgba(0,0,0,0.08)') // light theme → dark hairline
  })

  it('keeps the built-in graphite minimal look without a theme', () => {
    const calls = runFrame({
      kind: 'minimal',
      url: 'example.com',
      showUrl: true,
      showControls: true,
      height: 44,
    })
    expect(calls).toContain('fillStyle:#141417')
    expect(calls).toContain('fillStyle:rgba(255,255,255,0.08)')
  })

  it('strokes the card border when frame.border is set', () => {
    // Baseline already strokes once (the cursor dot outline) — the border adds one.
    const strokes = (calls: string[]) =>
      calls.filter((k) => k === 'stroke').length
    expect(strokes(runFrame(DEFAULT_BROWSER_BAR, { border: 0.35 }))).toBe(
      strokes(runFrame(DEFAULT_BROWSER_BAR)) + 1,
    )
  })

  it('draws a border with no width/colour as the white hairline', () => {
    // The look every take shipped with before the two knobs existed: absent
    // fields must render exactly this, or old docs change under their owners.
    const calls = runFrame(DEFAULT_BROWSER_BAR, { border: 0.35 })
    expect(calls).toContain('strokeStyle:' + FRAME_BORDER_COLOR_DEFAULT)
    expect(calls).toContain('globalAlpha:0.35')
  })

  it('takes borderWidth and borderColor from the doc', () => {
    const calls = runFrame(DEFAULT_BROWSER_BAR, {
      border: 0.8,
      borderWidth: 6,
      borderColor: '#0af',
    })
    expect(calls).toContain('strokeStyle:#0af')
    expect(calls).toContain('globalAlpha:0.8')
    // Card chrome scales by s2, so the emitted lineWidth is 6 * s2, never 6 —
    // read the width the border itself set (the one after its globalAlpha)
    // and compare it against the same take drawn at the default width.
    const borderWidth = (calls: string[], alpha: string) => {
      const at = calls.indexOf('globalAlpha:' + alpha)
      expect(at).toBeGreaterThan(-1)
      const w = calls.slice(at).find((k) => k.startsWith('lineWidth:'))
      return Number(w?.slice('lineWidth:'.length))
    }
    const scale =
      borderWidth(calls, '0.8') /
      borderWidth(runFrame(DEFAULT_BROWSER_BAR, { border: 0.8 }), '0.8')
    expect(scale).toBeCloseTo(6 / FRAME_BORDER_WIDTH_DEFAULT, 5)
  })

  it('draws the border OUTSIDE the card, never over the footage', () => {
    // The stroke path is expanded by half the width, so its inner edge lands
    // exactly on the card's edge (a CSS outline). Inset, a 24px border ate
    // 24px of the recording. The card rect is the clip drawn just before the
    // border's own globalAlpha; compare the two roundRects.
    const calls = runFrame(DEFAULT_BROWSER_BAR, { border: 0.8, borderWidth: 6 })
    const at = calls.indexOf('globalAlpha:0.8')
    expect(at).toBeGreaterThan(-1)
    const nums = (k: string) =>
      k
        .slice(k.indexOf(':') + 1)
        .split(',')
        .map(Number)
    const card = calls
      .slice(0, at)
      .filter((k) => k.startsWith('roundRect:'))
      .at(-1)
    const border = calls.slice(at).find((k) => k.startsWith('roundRect:'))
    const lwCall = calls.slice(at).find((k) => k.startsWith('lineWidth:'))
    expect(card).toBeDefined()
    expect(border).toBeDefined()
    expect(lwCall).toBeDefined()
    const lw = Number(lwCall!.slice('lineWidth:'.length))
    const [cx0, cy0, cw, ch, cr] = nums(card!)
    const [bx, by, bw, bh, br] = nums(border!)
    expect(bx).toBeCloseTo(cx0 - lw / 2, 5)
    expect(by).toBeCloseTo(cy0 - lw / 2, 5)
    expect(bw).toBeCloseTo(cw + lw, 5)
    expect(bh).toBeCloseTo(ch + lw, 5)
    // The outer corner rounds with the width, the CSS-border rule.
    expect(br).toBeCloseTo(cr + lw / 2, 5)
  })
})
