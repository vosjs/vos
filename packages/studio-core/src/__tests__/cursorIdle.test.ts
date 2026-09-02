import { describe, expect, it } from 'vitest'
import {
  CURSOR_IDLE_FADE_IN,
  CURSOR_IDLE_FADE_OUT,
  CURSOR_IDLE_HOLD,
  cursorIdleFade,
} from '../lower/cursorIdle'
import type { CursorFadeKey } from '../lower/cursorIdle'
import type { CursorEvent, CursorTrack } from '../types'

const SPACE = { w: 1600, h: 900 }

/** Read the baked curve the way ON_FRAME does: linear between keys. */
function alphaAt(keys: CursorFadeKey[], t: number): number {
  if (keys.length === 0) return 1
  if (t <= keys[0].t) return keys[0].a
  const last = keys[keys.length - 1]
  if (t >= last.t) return last.a
  for (let i = 1; i < keys.length; i++) {
    if (keys[i].t >= t) {
      const a = keys[i - 1]
      const b = keys[i]
      return a.a + (b.a - a.a) * ((t - a.t) / (b.t - a.t || 1))
    }
  }
  return last.a
}

/** A burst of real movement: 60Hz samples marching away from (x, y). */
function sweep(fromMs: number, x: number, y: number, n = 10): CursorTrack {
  const out: CursorEvent[] = []
  for (let i = 0; i < n; i++) {
    out.push({ t: fromMs + i * 16, x: x + i * 12, y: y + i * 12, type: 'move' })
  }
  return out
}

describe('cursorIdleFade', () => {
  it('bakes nothing for a cursor that never rests', () => {
    // 4s of continuous movement — no window survives the hold.
    const keys = cursorIdleFade(sweep(0, 0, 0, 240), {
      space: SPACE,
      sourceDuration: 4,
    })
    expect(keys).toEqual([])
  })

  it('fades out through a dwell and back in when movement resumes', () => {
    // move until 0.16s, park, move again at 5s.
    const track = [...sweep(0, 100, 100), ...sweep(5000, 220, 220)]
    const keys = cursorIdleFade(track, { space: SPACE, sourceDuration: 8 })

    const park = 0.144 // last move of the first sweep
    expect(alphaAt(keys, park + 0.5)).toBe(1) // still inside the hold
    expect(alphaAt(keys, park + CURSOR_IDLE_HOLD)).toBeCloseTo(1, 3)
    // halfway down the ramp
    expect(
      alphaAt(keys, park + CURSOR_IDLE_HOLD + CURSOR_IDLE_FADE_OUT / 2),
    ).toBeCloseTo(0.5, 1)
    expect(
      alphaAt(keys, park + CURSOR_IDLE_HOLD + CURSOR_IDLE_FADE_OUT),
    ).toBeCloseTo(0, 3)
    expect(alphaAt(keys, 3)).toBe(0) // deep in the dwell
    expect(alphaAt(keys, 5 + CURSOR_IDLE_FADE_IN)).toBeCloseTo(1, 3) // back up
  })

  it('leaves a short pause alone rather than half-fading it', () => {
    // A pause shorter than hold + fade would start a ramp and immediately
    // reverse it — a flicker, worse than leaving the cursor up.
    const brief = CURSOR_IDLE_HOLD + CURSOR_IDLE_FADE_OUT - 0.1
    const resume = Math.round((0.144 + brief) * 1000)
    const track = [...sweep(0, 100, 100), ...sweep(resume, 400, 400)]
    // sourceDuration stops at the last event so no trailing park is in play.
    expect(
      cursorIdleFade(track, {
        space: SPACE,
        sourceDuration: (resume + 144) / 1000,
      }),
    ).toEqual([])
  })

  it('detects the head park before the first movement', () => {
    // Recording rolls at 0; the user does not touch the mouse until 6s.
    const keys = cursorIdleFade(sweep(6000, 300, 300), {
      space: SPACE,
      sourceDuration: 10,
    })
    expect(keys.length).toBeGreaterThan(0)
    expect(alphaAt(keys, 0.2)).toBe(1)
    expect(alphaAt(keys, 3)).toBe(0)
    // The window closes on the first sample that clears the epsilon, one 60Hz
    // step after motion starts — so full opacity lands just past 6 + fade-in.
    expect(alphaAt(keys, 6.3)).toBe(1)
  })

  it('detects the tail park after the last movement', () => {
    // Track ends at ~0.16s but the take runs to 9s — the classic trailing park.
    const keys = cursorIdleFade(sweep(0, 100, 100), {
      space: SPACE,
      sourceDuration: 9,
    })
    expect(alphaAt(keys, 8)).toBe(0)
    expect(alphaAt(keys, 9)).toBe(0) // stays gone to the end
  })

  it('is back at full opacity by the time a click lands', () => {
    // Park from ~0.16s, click at 5s. The ring blooms at the click instant, so
    // the dot must have finished fading in before it, not after.
    const track: CursorTrack = [
      ...sweep(0, 100, 100),
      { t: 5000, x: 208, y: 208, type: 'down', button: 0 },
      { t: 5200, x: 208, y: 208, type: 'up', button: 0 },
    ]
    const keys = cursorIdleFade(track, { space: SPACE, sourceDuration: 9 })
    expect(alphaAt(keys, 5)).toBeCloseTo(1, 3)
    expect(alphaAt(keys, 3)).toBe(0) // it did still hide during the park
  })

  it('treats a click as activity, restarting the hold after it', () => {
    const track: CursorTrack = [
      ...sweep(0, 100, 100),
      { t: 5000, x: 208, y: 208, type: 'down', button: 0 },
      { t: 5100, x: 208, y: 208, type: 'up', button: 0 },
    ]
    const keys = cursorIdleFade(track, { space: SPACE, sourceDuration: 20 })
    // Immediately after the click the cursor is up, and the hold runs again
    // from the click rather than from the last move.
    expect(alphaAt(keys, 5.3)).toBe(1)
    expect(alphaAt(keys, 5.1 + CURSOR_IDLE_HOLD - 0.05)).toBeCloseTo(1, 2)
    expect(alphaAt(keys, 8)).toBe(0)
  })

  it('keeps fading through a scroll — scrolling is not cursor movement', () => {
    // scroll events re-emit the last position; they must not read as activity.
    const track: CursorTrack = [
      ...sweep(0, 100, 100),
      { t: 2000, x: 208, y: 208, type: 'scroll' },
      { t: 3000, x: 208, y: 208, type: 'scroll' },
      { t: 4000, x: 208, y: 208, type: 'scroll' },
    ]
    const keys = cursorIdleFade(track, { space: SPACE, sourceDuration: 6 })
    expect(alphaAt(keys, 3)).toBe(0)
    expect(alphaAt(keys, 5)).toBe(0)
  })

  it('keeps fading through typing pings — the caret is the actor, not the dot', () => {
    // `key` events synthesize the focused element's center (a place the cursor
    // never visited); a typing passage must not hold the parked dot on screen.
    const rect = { x: 180, y: 180, w: 240, h: 32 }
    const track: CursorTrack = [
      ...sweep(0, 100, 100),
      { t: 2000, x: 300, y: 196, type: 'key', rect },
      { t: 2350, x: 300, y: 196, type: 'key', rect },
      { t: 3100, x: 300, y: 196, type: 'key', rect },
      { t: 4200, x: 300, y: 196, type: 'key', rect },
    ]
    const keys = cursorIdleFade(track, { space: SPACE, sourceDuration: 6 })
    expect(alphaAt(keys, 3)).toBe(0)
    expect(alphaAt(keys, 5)).toBe(0)
  })

  it('emits strictly increasing keys', () => {
    const track: CursorTrack = [
      ...sweep(0, 100, 100),
      { t: 4000, x: 208, y: 208, type: 'down', button: 0 },
      { t: 4100, x: 208, y: 208, type: 'up', button: 0 },
      ...sweep(9000, 500, 500),
    ]
    const keys = cursorIdleFade(track, { space: SPACE, sourceDuration: 14 })
    expect(keys.length).toBeGreaterThan(4)
    for (let i = 1; i < keys.length; i++) {
      expect(keys[i].t).toBeGreaterThan(keys[i - 1].t)
    }
    for (const k of keys) expect(k.a === 0 || k.a === 1).toBe(true)
  })

  it('returns nothing for a track with no positioned events', () => {
    expect(
      cursorIdleFade([{ t: 0, x: 0, y: 0, type: 'scroll' }], {
        space: SPACE,
        sourceDuration: 5,
      }),
    ).toEqual([])
    expect(cursorIdleFade([], { space: SPACE, sourceDuration: 5 })).toEqual([])
  })
})
