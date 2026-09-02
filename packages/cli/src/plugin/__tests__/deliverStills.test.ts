import { describe, expect, it } from 'vitest'
import { FULL_BLEED, SCREENSHOT_DEFAULTS, stillOverridesFor } from '../deliver'
import { applyDocOverrides } from '../docOverride'
import type { ProjectDoc } from '@vosjs/studio-core'

function doc(): ProjectDoc {
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
    zoom: [{ id: 'z', in: 1, out: 4, level: 1.8, cx: 0.5, cy: 0.5 }],
    tilt: [{ id: 't', in: 1, out: 4, rx: 6, ry: -6 }],
    audio: [],
    cursor: {
      visible: true,
      smoothing: 0.5,
      size: 1,
      clickFx: { style: 'ripple' },
    },
    cam: {},
    frame: {
      background: '#111',
      padding: 48,
      radius: 12,
      shadow: 0.4,
      border: 0,
      aspectRatio: 'auto',
      browserBar: { kind: 'mac-light' },
    },
  } as unknown as ProjectDoc
}

describe('stillOverridesFor (the screenshot policy)', () => {
  it('a screenshot-genre still is the real page, full bleed, uncomposed', () => {
    const o = stillOverridesFor({ fit: 'cover', genre: 'screenshot' }, {})
    expect(o?.set?.[0]).toBe('frame.fit=cover')
    for (const s of SCREENSHOT_DEFAULTS) expect(o?.set).toContain(s)
    const d = doc()
    applyDocOverrides(d, o!)
    expect(d.zoom).toEqual([])
    expect(d.tilt).toEqual([])
    expect(d.frame.padding).toBe(0)
    expect(d.frame.browserBar.kind).toBe('none')
    expect(d.frame.fit).toBe('cover')
  })

  it('--composed keeps the cut and the chrome on a screenshot', () => {
    const o = stillOverridesFor(
      { fit: 'cover', genre: 'screenshot' },
      { composed: true },
    )
    expect(o?.set).toEqual(['frame.fit=cover'])
  })

  it('a card with no poster is a full-bleed cover crop of the real page, camera kept', () => {
    const o = stillOverridesFor({ fit: 'cover', genre: 'card' }, {})
    expect(o?.set?.[0]).toBe('frame.fit=cover')
    for (const s of FULL_BLEED) expect(o?.set).toContain(s)
    expect(o?.set).not.toContain('zoom=[]')
    const d = doc()
    applyDocOverrides(d, o!)
    expect(d.zoom).toHaveLength(1)
    expect(d.frame.browserBar.kind).toBe('none')
    expect(d.cursor.visible).toBe(false)
    expect(
      stillOverridesFor({ fit: 'contain', genre: 'card' }, { composed: true }),
    ).toBeUndefined()
  })

  it('a screenshot hides the cursor dot and the click ring', () => {
    const d = doc()
    applyDocOverrides(
      d,
      stillOverridesFor({ fit: 'cover', genre: 'screenshot' }, {})!,
    )
    expect(d.cursor.visible).toBe(false)
    expect(d.cursor.clickFx.style).toBe('none')
  })

  it("the user's own --set applies last and wins", () => {
    const o = stillOverridesFor(
      { fit: 'cover', genre: 'screenshot' },
      { overrides: { set: ['frame.padding=24'] } },
    )
    const d = doc()
    applyDocOverrides(d, o!)
    expect(d.frame.padding).toBe(24)
    expect(d.zoom).toEqual([])
  })
})
