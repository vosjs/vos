import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { lerpArray, mapTime, sample } from '@vosjs/timeline'
import { lowerToComposition } from '../lower/lowerToComposition'
import { STUDIO_ENTRY_ID } from '../lower/studioEntry'
import { TEXT_LAYOUT_SOURCE_HASH, textLayoutCode } from '../richText/layoutCode'
import {
  BASE_FRAME_STYLE,
  DEFAULT_BROWSER_BAR,
  DEFAULT_CAM_STYLE,
  DEFAULT_CURSOR_STYLE,
} from '../types'
import { studioEntryOf } from './helpers/studio'
import type { OverlayClip, ProjectDoc, TextOverlayClip } from '../types'

/**
 * What a text layer costs per frame, counted on the overlay canvas: texture
 * uploads, `measureText` calls and `fillText` calls.
 *
 * The budget: a HOLD costs nothing (no paint, no upload, no measure), and a
 * styled layer is measured once, when it is laid out, never inside a frame
 * that only moves, fades or reveals it. The layer repaints when what it
 * shows changed, while something on it animates, once after an animation's
 * last frame, and once when a font face lands.
 */

function clip(over: Partial<TextOverlayClip> = {}): TextOverlayClip {
  return {
    id: 'o1',
    kind: 'text',
    start: 0.5,
    duration: 3,
    text: 'Hello',
    preset: 'caption',
    transform: { x: 0.5, y: 0.5, scale: 1, rotation: 0 },
    ...over,
  }
}

function makeDoc(overlays: OverlayClip[]): ProjectDoc {
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
    frame: { ...BASE_FRAME_STYLE, browserBar: DEFAULT_BROWSER_BAR },
    overlays,
    export: { resolution: '1080p', fps: 30, format: 'mp4' },
  }
}

interface FrameCost {
  uploaded: boolean
  measures: number
  fills: number
}
const QUIET: FrameCost = { uploaded: false, measures: 0, fills: 0 }

const EM_WRAP = clip({
  text: [
    { text: 'Set up ' },
    { text: 'different purposes', weight: 700 },
    { text: ' for every page of the product you ship' },
  ],
  maxWidth: 0.2,
})

describe('what a text layer costs per frame', () => {
  const g = globalThis as Record<string, unknown>
  afterEach(() => {
    delete g.window
    delete g.__vosTimeline
  })

  /**
   * The studio entry alone, on its own refs as at runtime, driven across
   * frames so its dirty state carries. `setData` swaps the entry's data the
   * way a live edit does.
   */
  function makeRunner(overlays: OverlayClip[]) {
    const lower = (o: OverlayClip[]) => {
      const lowered = lowerToComposition(makeDoc(o))
      return {
        entry: studioEntryOf(lowered.config),
        data: lowered.stack[STUDIO_ENTRY_ID],
      }
    }
    const first = lower(overlays)
    let data = first.data
    const onFrame = new Function(`return (${first.entry.onFrame})`)() as (
      ctx: unknown,
      content: unknown,
      dt: number,
    ) => void
    const vos: Record<string, unknown> = {
      isPaused: true,
      videoCache: new Map(),
      pendingDecodes: new Set(),
    }
    g.window = { __vos__: vos }
    g.__vosTimeline = { mapTime, sample, lerpArray }
    const count = { measures: 0, fills: 0 }
    const c2d = new Proxy(
      {},
      {
        get: (_t, key: string) => {
          if (key === 'measureText')
            return (text: string) => {
              count.measures++
              return { width: text.length * 10 }
            }
          if (key === 'fillText') return () => count.fills++
          return () => undefined
        },
        set: () => true,
      },
    )
    const ov = {
      c2d,
      canvas: { width: 1920, height: 1080 },
      texture: { needsUpdate: false, dispose: () => undefined },
      mesh: null,
    }
    const frame = (time: number): FrameCost => {
      ov.texture.needsUpdate = false
      count.measures = 0
      count.fills = 0
      onFrame(
        {
          time,
          data,
          renderer: undefined,
          resolution: {
            width: 1920,
            height: 1080,
            drawingBufferWidth: 1920,
            drawingBufferHeight: 1080,
          },
        },
        { refs: { ov, objects: null } },
        1 / 30,
      )
      return {
        uploaded: ov.texture.needsUpdate,
        measures: count.measures,
        fills: count.fills,
      }
    }
    return {
      frame,
      vos,
      program: first.entry.onFrame,
      setData: (o: OverlayClip[]) => {
        const next = lower(o)
        data = next.data
        return next.entry.onFrame
      },
    }
  }

  // The clip runs 0.5..3.5 s; its entrance and exit windows are 0.35 s, so
  // 1.5..2.5 s is a hold: nothing on the layer changes between these frames.
  const HOLD = [1.6, 1.7, 1.8]

  it('a held caption is laid out and painted once, then costs nothing', () => {
    const run = makeRunner([clip({ text: 'Ship it faster' })])
    // One line, one run: the layout measures it once.
    expect(run.frame(1.5)).toEqual({ uploaded: true, measures: 1, fills: 1 })
    for (const t of HOLD) expect(run.frame(t)).toEqual(QUIET)
  })

  it('a plain layer that reveals word by word measures nothing after its layout', () => {
    // The layout is kept, so the frames of an entrance after the first
    // only draw: no unit is measured twice.
    const run = makeRunner([
      clip({
        text: 'Set up different purposes for every page of the product',
        maxWidth: 0.3,
        anim: { enter: { kind: 'rise', unit: 'word' } },
      }),
    ])
    expect(run.frame(0.55).measures).toBeGreaterThan(0)
    for (const t of [0.6, 0.65, 0.7, 0.75]) {
      const c = run.frame(t)
      expect(c.uploaded).toBe(true)
      expect(c.measures).toBe(0)
      expect(c.fills).toBeGreaterThan(0)
    }
  })

  it('a plain pill caption that moves measures nothing after its layout', () => {
    // The pill is sized from the kept layout, never from a fresh measure.
    const run = makeRunner([
      clip({
        text: 'Set up different purposes for every page of the product',
        maxWidth: 0.3,
        align: 'left',
        box: { color: '#111827' },
        motion: [
          { at: 0, x: 0.3, y: 0.5 },
          { at: 2, x: 0.7, y: 0.5 },
        ],
      }),
    ])
    expect(run.frame(1.5).measures).toBeGreaterThan(0)
    for (const t of [1.6, 1.7, 1.8]) {
      const c = run.frame(t)
      expect(c.uploaded).toBe(true)
      expect(c.measures).toBe(0)
    }
  })

  it('a held styled, wrapped caption is measured once, at its layout', () => {
    const run = makeRunner([EM_WRAP])
    const first = run.frame(1.5)
    expect(first.uploaded).toBe(true)
    expect(first.measures).toBeGreaterThan(0)
    expect(first.fills).toBeGreaterThan(0)
    for (const t of HOLD) expect(run.frame(t)).toEqual(QUIET)
  })

  it('a styled layer that moves or reveals measures nothing after its layout', () => {
    const run = makeRunner([
      clip({
        ...EM_WRAP,
        anim: { enter: { kind: 'rise', unit: 'word' } },
      }),
    ])
    expect(run.frame(0.55).measures).toBeGreaterThan(0)
    for (const t of [0.6, 0.65, 0.7, 0.75]) {
      const c = run.frame(t)
      expect(c.uploaded).toBe(true)
      expect(c.measures).toBe(0)
    }
  })

  it('paints once more after an animation ends, then holds', () => {
    // The entrance window is 0.35 s: 0.84 is its last frame, drawn a moment
    // short of settled; the next frame settles it and the one after is quiet.
    const run = makeRunner([clip({ text: 'Ship it faster' })])
    expect(run.frame(0.84).uploaded).toBe(true)
    expect(run.frame(0.9).uploaded).toBe(true)
    expect(run.frame(0.95)).toEqual(QUIET)
  })

  it('an edit repaints a held layer, whatever field it touched', () => {
    const base = clip({ text: 'Ship it faster' })
    const run = makeRunner([base])
    run.frame(1.5)
    const edits: Partial<TextOverlayClip>[] = [
      { text: 'Ship it now' },
      { weight: 600 },
      { align: 'left' },
      { letterSpacing: 2 },
      { lineHeight: 1.5 },
      { italic: true },
      { shadow: 0 },
      { stroke: { color: '#000000', width: 2 } },
      { box: { color: '#111111' } },
      { family: 'Sora' },
      { text: [{ text: 'Ship it ' }, { text: 'faster', weight: 700 }] },
      { text: [{ text: 'Ship it ' }, { text: 'faster', color: '#ff0000' }] },
      { text: [{ text: 'Ship it ' }, { text: 'faster', underline: true }] },
      { text: [{ text: 'Ship it ' }, { text: 'faster', strike: true }] },
      {
        text: [{ text: 'Ship it ' }, { text: 'faster', highlight: '#333333' }],
      },
      { text: [{ text: 'Ship it ' }, { text: 'faster', italic: true }] },
    ]
    for (const e of edits) {
      run.setData([{ ...base, ...e }])
      expect(run.frame(1.6).uploaded, JSON.stringify(e)).toBe(true)
      expect(run.frame(1.7), JSON.stringify(e)).toEqual(QUIET)
      run.setData([base])
      run.frame(1.8)
    }
  })

  it('a face landing repaints a held layer once, and lays a styled one out again', () => {
    const run = makeRunner([EM_WRAP])
    run.frame(1.5)
    expect(run.frame(1.6)).toEqual(QUIET)
    run.vos.fontEpoch = ((run.vos.fontEpoch as number) || 0) + 1
    const landed = run.frame(1.7)
    expect(landed.uploaded).toBe(true)
    expect(landed.measures).toBeGreaterThan(0)
    expect(run.frame(1.8)).toEqual(QUIET)
  })

  it('a clip leaving clears the layer once', () => {
    const run = makeRunner([clip({ text: 'Ship it faster' })])
    run.frame(3.4)
    expect(run.frame(3.6).uploaded).toBe(true)
    expect(run.frame(3.7)).toEqual(QUIET)
  })

  it('a cached layout leaves with its clip', () => {
    const run = makeRunner([EM_WRAP])
    run.frame(1.5)
    expect(Object.keys(run.vos.textLayouts as object)).toEqual(['o1'])
    run.setData([])
    run.frame(1.6)
    expect(Object.keys(run.vos.textLayouts as object)).toEqual([])
  })

  it('the first styled run is data: the program does not change', () => {
    const run = makeRunner([clip({ text: 'Ship it faster' })])
    expect(run.setData([EM_WRAP])).toBe(run.program)
  })
})

describe('the generated layout code', () => {
  it('is regenerated whenever layout.ts changes', () => {
    const source = readFileSync(
      join(process.cwd(), '../elements/src/text/layout.ts'),
    )
    expect(TEXT_LAYOUT_SOURCE_HASH).toBe(
      createHash('sha256').update(source).digest('hex'),
    )
  })

  it('holds nothing that would end or open a template in a compiled module', () => {
    expect(textLayoutCode.includes('`')).toBe(false)
    expect(textLayoutCode.includes('${')).toBe(false)
  })

  it('declares the layout the page installs', () => {
    const api = new Function(`${textLayoutCode}; return __vosTextLayout`)() as {
      layoutText: unknown
      decorationRect: unknown
    }
    expect(typeof api.layoutText).toBe('function')
    expect(typeof api.decorationRect).toBe('function')
  })
})
