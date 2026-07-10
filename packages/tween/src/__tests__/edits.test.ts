import { describe, expect, it } from 'vitest'
import { createTweenRecorder } from '../index'

const build = () => {
  const rec = createTweenRecorder()
  const o = { x: 0, y: 0 }
  const state = { t: 0 }
  const calls: number[] = []
  const tl = rec.timeline({ paused: true })
  tl.set(o, { x: 0 }, 0)
  tl.to(o, { x: 100, duration: 1, ease: 'none' }, 0)
  tl.to(o, { y: 50, duration: 1, ease: 'none' }, 1)
  // Opaque onUpdate tween (the shader idiom) — retimable without understanding it.
  tl.to(
    state,
    {
      t: 1,
      duration: 1,
      ease: 'none',
      onUpdate: () => calls.push(tl.time() as number),
    },
    2,
  )
  return { tl, o, state, calls }
}

describe('applyEdits', () => {
  it('retimes a tween (values shift to the new window) and recomputes duration', () => {
    const { tl, o } = build()
    expect(tl.duration()).toBe(3)

    tl.applyEdits([{ index: 2, startTime: 2, duration: 2 }]) // y tween: 1..2 → 2..4
    expect(tl.duration()).toBe(4)

    tl.seek(1.5, true)
    expect(o.y).toBe(0) // not started yet under the edit
    tl.seek(3, true)
    expect(o.y).toBe(25) // halfway through the stretched tween
    tl.seek(4, true)
    expect(o.y).toBe(50)
  })

  it('re-eases a tween', () => {
    const { tl, o } = build()
    tl.seek(0.5, true)
    expect(o.x).toBeCloseTo(50, 6) // 'none'
    tl.applyEdits([{ index: 1, ease: 'power2.in' }])
    tl.seek(0.5, true)
    expect(o.x).toBeCloseTo(100 * 0.5 ** 3, 6) // cubic-in at midpoint
  })

  it('retimes an opaque onUpdate tween (fires in the new window only)', () => {
    const { tl, state, calls } = build()
    tl.applyEdits([{ index: 3, startTime: 0.25, duration: 0.5 }])
    tl.seek(0.5, false) // inside the new window → onUpdate fires, driver at midpoint
    expect(state.t).toBeCloseTo(0.5, 6)
    expect(calls.length).toBeGreaterThan(0)
    tl.seek(2.5, false) // old window — must be inert now (end state persists)
    expect(state.t).toBe(1)
  })

  it('shrinking the last tween shrinks the master duration', () => {
    const { tl } = build()
    tl.applyEdits([{ index: 3, duration: 0.25 }])
    expect(tl.duration()).toBe(2.25)
  })

  it('ignores out-of-range indices and non-finite values', () => {
    const { tl } = build()
    expect(() =>
      tl.applyEdits([
        { index: 99, startTime: 5 },
        { index: 1, startTime: Number.NaN },
      ]),
    ).not.toThrow()
    expect(tl.duration()).toBe(3)
  })

  it('value overrides: destination, explicit-from, and pinning an implicit start', () => {
    const { tl, o } = build()
    tl.applyEdits([
      { index: 1, to: { x: 200 } }, // x: 0→200 instead of 0→100
      { index: 2, from: { y: 10 } }, // pin the .to's implicit start (was chained 0)
    ])
    tl.seek(0.5, true)
    expect(o.x).toBeCloseTo(100, 6) // midpoint of 0→200
    tl.seek(1.5, true)
    expect(o.y).toBeCloseTo(30, 6) // midpoint of pinned 10→50
  })

  it('value override on a relative prop replaces the delta with an absolute', () => {
    const rec = createTweenRecorder()
    const o = { y: 2 }
    const tl = rec.timeline({ paused: true })
    tl.set(o, { y: 2 }, 0)
    tl.to(o, { y: '+=1', duration: 1, ease: 'none' }, 0)
    tl.seek(1, true)
    expect(o.y).toBeCloseTo(3, 6) // relative: 2 + 1
    tl.applyEdits([{ index: 1, to: { y: 10 } }])
    tl.seek(1, true)
    expect(o.y).toBeCloseTo(10, 6) // absolute override wins
    expect(tl.specs[1].toRelative).toBeUndefined()
  })

  it('edits are idempotent re-application (editor re-applies full overlay)', () => {
    const { tl, o } = build()
    const overlay = [{ index: 2, startTime: 2 }]
    tl.applyEdits(overlay)
    tl.applyEdits(overlay) // same overlay again — same result
    tl.seek(2.5, true)
    expect(o.y).toBe(25)
    expect(tl.duration()).toBe(3) // y ends at 3 (= the opaque tween's end)
  })
})
