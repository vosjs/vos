/**
 * Frame prep: a capture harness asks the composition for a frame's footage
 * BEFORE the paint (`window.__vos__.framePrep`), so the paint draws the
 * right frame the first time. The steps it runs are the same source ON_FRAME's
 * syncVid runs (`FRAME_STEP_SRC`, inlined into both scopes): a target the hook
 * has met registers nothing in the paint, which is what turns two paints per
 * frame into one. The pins here are the wiring; the behavioural proof is
 * `bench-render.ts` (paints per frame 2 → 1) and `verify-export-parity.ts`.
 */
import { describe, expect, it } from 'vitest'
import { FRAME_STEP_SRC, lowerToComposition } from '../lower/lowerToComposition'
import {
  DEFAULT_CAM_STYLE,
  DEFAULT_CURSOR_STYLE,
  DEFAULT_FRAME_STYLE,
} from '../types'
import type { ProjectDoc } from '../types'

function makeDoc(): ProjectDoc {
  return {
    source: {
      videoKey: 'blob:v',
      cursor: [],
      meta: {
        dpr: 1,
        zoom: 1,
        t0: 0,
        durationMs: 20_000,
        width: 1600,
        height: 900,
        fps: 30,
      },
    },
    segments: [{ in: 0, out: 20 }],
    zoom: [],
    audio: [],
    cursor: DEFAULT_CURSOR_STYLE,
    cam: DEFAULT_CAM_STYLE,
    frame: DEFAULT_FRAME_STYLE,
    export: { resolution: '1080p', fps: 30, format: 'mp4' },
  }
}

interface Steps {
  stepPaused: (vid: unknown, srcT: number) => void
  stepBg: (el: unknown, t: number) => void
}

/** The step functions evaluated against a stub namespace. */
function steps(ns: { pendingDecodes: Set<Promise<void>> }): Steps {
  return new Function(
    'ns',
    `${FRAME_STEP_SRC}\nreturn { stepPaused: stepPaused, stepBg: stepBg }`,
  )(ns) as Steps
}

function videoStub(over: Record<string, unknown> = {}) {
  const listeners = new Map<string, () => void>()
  return {
    paused: true,
    readyState: 2,
    currentTime: 0,
    duration: 10,
    pause() {
      this.paused = true
    },
    addEventListener(name: string, fn: () => void) {
      listeners.set(name, fn)
    },
    removeEventListener(name: string) {
      listeners.delete(name)
    },
    /** Test seam: the browser's 'seeked' after a currentTime write. */
    fireSeeked() {
      listeners.get('seeked')?.()
    },
    ...over,
  }
}

describe('frame prep wiring', () => {
  const config = lowerToComposition(makeDoc()).config as unknown as {
    setup: string
    onFrame: string
  }

  it('registers the card hook in setup, keyed so a warm LOAD re-registers', () => {
    expect(config.setup).toContain('ns.framePrep = ns.framePrep || new Map()')
    expect(config.setup).toContain("ns.framePrep.set('voila.card'")
    // Playback never prepares a frame: the hook stands down while playing.
    expect(config.setup).toContain('if (ns.isPaused === false) return')
  })

  it('inlines ONE step source into both scopes, and syncVid runs it', () => {
    expect(config.setup).toContain('function stepPaused(vid, srcT)')
    expect(config.onFrame).toContain('function stepPaused(vid, srcT)')
    expect(config.onFrame).toContain('stepPaused(vid, srcT)')
    expect(config.onFrame).toContain('stepBg(bgEl, bgT)')
    // The paint's own copy is the fallback for stub harnesses that never
    // run setup; the two copies are the same string by construction.
    const src = FRAME_STEP_SRC.trim()
    expect(config.setup.replace(/\s+/g, ' ')).toContain(
      src.replace(/\s+/g, ' '),
    )
    expect(config.onFrame.replace(/\s+/g, ' ')).toContain(
      src.replace(/\s+/g, ' '),
    )
  })
})

describe('the paused step', () => {
  it('asks a WebCodecs provider by PTS once per target, never twice', async () => {
    const ns = { pendingDecodes: new Set<Promise<void>>() }
    const { stepPaused } = steps(ns)
    const seeks: number[] = []
    const wcp = {
      req: -1,
      duration: 10,
      seek(t: number) {
        this.req = t
        seeks.push(t)
        return Promise.resolve()
      },
    }
    const vid = videoStub({ __voilaWc: wcp })
    stepPaused(vid, 1.5)
    expect(seeks).toEqual([1.5])
    expect(ns.pendingDecodes.size).toBe(1)
    // The hook met the target; the paint's own call is a no-op.
    stepPaused(vid, 1.5)
    expect(seeks).toEqual([1.5])
    await Promise.resolve()
    await Promise.resolve()
    expect(ns.pendingDecodes.size).toBe(0)
  })

  it('seeks the element once and registers its seeked promise', async () => {
    const ns = { pendingDecodes: new Set<Promise<void>>() }
    const { stepPaused } = steps(ns)
    const vid = videoStub()
    stepPaused(vid, 2)
    expect(vid.currentTime).toBe(2)
    expect(ns.pendingDecodes.size).toBe(1)
    // At the target already: nothing registers (the one-paint condition).
    stepPaused(vid, 2)
    expect(ns.pendingDecodes.size).toBe(1)
    vid.fireSeeked()
    await Promise.resolve()
    await Promise.resolve()
    expect(ns.pendingDecodes.size).toBe(0)
  })

  it('clamps the target to the element duration', () => {
    const ns = { pendingDecodes: new Set<Promise<void>>() }
    const { stepPaused } = steps(ns)
    const vid = videoStub({ duration: 3 })
    stepPaused(vid, 7)
    expect(vid.currentTime).toBe(3)
  })

  it('coalesces the background seek while one is in flight', () => {
    const ns = { pendingDecodes: new Set<Promise<void>>() }
    const { stepBg } = steps(ns)
    const busy = videoStub({ seeking: true, currentTime: 3 })
    stepBg(busy, 0.7)
    expect(busy.currentTime).toBe(3)
    expect(ns.pendingDecodes.size).toBe(0)
    const idle = videoStub({ seeking: false, currentTime: 3 })
    stepBg(idle, 0.7)
    expect(idle.currentTime).toBe(0.7)
    expect(ns.pendingDecodes.size).toBe(1)
  })
})
