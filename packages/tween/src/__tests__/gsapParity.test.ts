import { describe, expect, it } from 'vitest'
import gsap from 'gsap'
import { createTweenRecorder, type GsapBackend } from '../index'

/**
 * Cross-check the recorder's position resolution and delegation against real GSAP:
 * the recorded (startTime, duration) of each spec must match what GSAP itself reports
 * via `timeline.getChildren()`, and delegated seeks must actually drive the target.
 */
describe('real-GSAP parity', () => {
  it('recorded start/duration match gsap.getChildren()', () => {
    // Record via the recorder...
    const rec = createTweenRecorder(gsap as unknown as GsapBackend)
    const o = { a: 0, b: 0, c: 0, d: 0 }
    const tl = rec.timeline({ paused: true })
    tl.to(o, { a: 1, duration: 2 }) // default → 0
    tl.to(o, { b: 1, duration: 1 }) // append → 2
    tl.to(o, { c: 1, duration: 1 }, '<') // start of prev → 2
    tl.to(o, { d: 1, duration: 1 }, '+=0.5') // end (3) + 0.5 → 3.5

    // ...and build the identical timeline directly in GSAP as the oracle.
    const ref = gsap.timeline({ paused: true })
    ref.to({ a: 0 }, { a: 1, duration: 2 })
    ref.to({ b: 0 }, { b: 1, duration: 1 })
    ref.to({ c: 0 }, { c: 1, duration: 1 }, '<')
    ref.to({ d: 0 }, { d: 1, duration: 1 }, '+=0.5')
    const fromGsap = ref
      .getChildren(false, true, true)
      .map((k) => ({ start: k.startTime(), dur: k.duration() }))

    const recorded = tl.specs.map((s) => ({ start: s.startTime, dur: s.duration }))
    expect(recorded).toEqual(fromGsap)
    expect(recorded).toEqual([
      { start: 0, dur: 2 },
      { start: 2, dur: 1 },
      { start: 2, dur: 1 },
      { start: 3.5, dur: 1 },
    ])
  })

  it('delegates playback so a seek drives the real target', () => {
    const rec = createTweenRecorder(gsap as unknown as GsapBackend)
    const o = { x: 0 }
    const tl = rec.timeline({ paused: true })
    tl.to(o, { x: 100, duration: 1, ease: 'none' }, 0)
    tl.seek(0.5) // delegates to real gsap → linear ease → 50
    expect(o.x).toBeCloseTo(50, 3)
    expect(tl.duration()).toBeCloseTo(1, 3) // duration() reads through to gsap
  })
})
