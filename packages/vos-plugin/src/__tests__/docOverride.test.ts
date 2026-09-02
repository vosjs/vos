import { describe, expect, it } from 'vitest'
import { UsageError } from '../args'
import {
  applyAndValidate,
  applyDocOverrides,
  coerceValue,
  setPath,
} from '../docOverride'
import type { ProjectDoc } from '@vosso/studio-core'

/** Minimal doc — the fields the override + lint paths touch. */
function makeDoc(over: Partial<ProjectDoc> = {}): ProjectDoc {
  return {
    source: {
      videoKey: 'blob:recording',
      cursor: [],
      meta: {
        dpr: 1,
        zoom: 1,
        t0: 0,
        durationMs: 20000,
        width: 1280,
        height: 720,
        fps: 30,
        captureWidth: 1280,
        captureHeight: 720,
      },
    },
    segments: [{ in: 0, out: 20 }],
    zoom: [],
    audio: [],
    cursor: { smoothing: 0.5, size: 1 },
    cam: {},
    frame: {
      background: '#111',
      padding: 48,
      radius: 12,
      shadow: 0.4,
      border: 0,
      aspectRatio: 'auto',
      browserBar: { kind: 'none' },
    },
    export: { resolution: '720p', fps: 30, format: 'mp4' },
    ...over,
  } as unknown as ProjectDoc
}

describe('coerceValue', () => {
  it('parses JSON scalars, keeps non-JSON as strings', () => {
    expect(coerceValue('8')).toBe(8)
    expect(coerceValue('-4.5')).toBe(-4.5)
    expect(coerceValue('true')).toBe(true)
    expect(coerceValue('null')).toBe(null)
    expect(coerceValue('#000')).toBe('#000') // not JSON → string
    expect(coerceValue('rise')).toBe('rise')
    expect(coerceValue('{"rx":8}')).toEqual({ rx: 8 })
  })
})

describe('setPath', () => {
  it('sets a nested key, creating intermediate objects', () => {
    const o: Record<string, unknown> = {}
    setPath(o, 'frame.browserBar.kind', 'minimal')
    expect(o).toEqual({ frame: { browserBar: { kind: 'minimal' } } })
  })

  it('supports array indices', () => {
    const o: Record<string, unknown> = { zoom: [{ level: 2 }] }
    setPath(o, 'zoom[0].level', 3)
    expect((o.zoom as { level: number }[])[0].level).toBe(3)
  })

  it('rejects an invalid path', () => {
    expect(() => setPath({}, 'a..b', 1)).toThrow(UsageError)
    expect(() => setPath({}, '', 1)).toThrow(UsageError)
  })
})

describe('applyDocOverrides', () => {
  it('--frame maps a friendly name to the bar kind', () => {
    const doc = makeDoc()
    applyDocOverrides(doc, { frame: 'macos' })
    expect(doc.frame.browserBar.kind).toBe('mac-light')
  })

  it('rejects an unknown --frame', () => {
    expect(() => applyDocOverrides(makeDoc(), { frame: 'beos' })).toThrow(
      UsageError,
    )
  })

  it('--background infers video (with default duration) vs image kind', () => {
    const v = makeDoc()
    applyDocOverrides(v, {
      background: 'https://assets.vos.so/backgrounds/ember-drift-1080p.webm',
    })
    expect(v.frame.backgroundMedia).toMatchObject({
      kind: 'video',
      duration: 10,
      dim: 0,
    })
    const img = makeDoc()
    applyDocOverrides(img, { background: 'https://x/y.png' })
    expect(img.frame.backgroundMedia).toMatchObject({ kind: 'image' })
    expect(
      (img.frame.backgroundMedia as { duration?: number }).duration,
    ).toBeUndefined()
  })

  it('--background none clears the media layer', () => {
    const doc = makeDoc({
      frame: {
        ...makeDoc().frame,
        backgroundMedia: { kind: 'video', key: 'x', dim: 0 },
      } as never,
    })
    applyDocOverrides(doc, { background: 'none' })
    expect(doc.frame.backgroundMedia).toBe(null)
  })

  it('--set patches an arbitrary field with a coerced value', () => {
    const doc = makeDoc()
    applyDocOverrides(doc, {
      set: ['tilt[0].rx=8', 'frame.padding=120', 'tilt[0].source=manual'],
    })
    expect(doc.tilt?.[0]).toEqual({ rx: 8, source: 'manual' })
    expect(doc.frame.padding).toBe(120)
  })

  it('--set overrides an alias (aliases apply first)', () => {
    const doc = makeDoc()
    applyDocOverrides(doc, {
      frame: 'macos',
      set: ['frame.browserBar.kind=minimal'],
    })
    expect(doc.frame.browserBar.kind).toBe('minimal')
  })

  it('rejects a malformed --set expression', () => {
    expect(() =>
      applyDocOverrides(makeDoc(), { set: ['frame.padding'] }),
    ).toThrow(UsageError)
  })
})

describe('applyAndValidate (lint gate)', () => {
  it('passes a valid override', () => {
    const doc = makeDoc()
    expect(() =>
      applyAndValidate(doc, { frame: 'macos', set: ['frame.padding=96'] }),
    ).not.toThrow()
    expect(doc.frame.browserBar.kind).toBe('mac-light')
  })

  it('rejects an override that produces an invalid doc (out-of-range tilt)', () => {
    expect(() =>
      applyAndValidate(makeDoc(), {
        set: ['tilt=[{"id":"t","in":0,"out":1,"rx":99,"ry":0}]'],
      }),
    ).toThrow(/invalid doc/)
  })

  it('rejects a background video override missing a real key (lint catches it downstream)', () => {
    // dim out of range → lint problem surfaces through the gate
    expect(() =>
      applyAndValidate(makeDoc(), {
        set: ['frame.backgroundMedia={"kind":"image","key":"x","dim":5}'],
      }),
    ).toThrow(/invalid doc/)
  })
})
