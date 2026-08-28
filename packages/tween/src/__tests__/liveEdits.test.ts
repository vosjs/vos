import { describe, expect, it } from 'vitest'
import { createTweenRecorder } from '../index'

// applyEdits is re-appliable: every call starts from the RECORDED timing, so
// a live editor can hand the timeline its whole overlay on each change and an
// edit that leaves the overlay leaves the timeline too.

const build = () => {
  const rec = createTweenRecorder()
  const o = { x: 0, y: 0 }
  const tl = rec.timeline({ paused: true })
  tl.to(o, { x: 100, duration: 1, ease: 'none' }, 0)
  tl.to(o, { y: 50, duration: 1, ease: 'none' }, 1)
  return { tl, o }
}

describe('applyEdits, re-applied', () => {
  it('a second overlay replaces the first instead of stacking on it', () => {
    const { tl, o } = build()
    tl.applyEdits([{ index: 1, startTime: 3, duration: 2 }])
    expect(tl.duration()).toBe(5)
    tl.applyEdits([{ index: 1, startTime: 2 }])
    // duration went back to the recorded 1s: the first overlay's stretch is gone
    expect(tl.duration()).toBe(3)
    tl.seek(2.5, true)
    expect(o.y).toBe(25)
  })

  it('an empty overlay restores the recording', () => {
    const { tl, o } = build()
    tl.applyEdits([{ index: 0, duration: 4, to: { x: 10 } }])
    expect(tl.duration()).toBe(4)
    tl.applyEdits([])
    expect(tl.duration()).toBe(2)
    tl.seek(1, true)
    expect(o.x).toBe(100)
  })

  it('the same overlay twice is the same timeline', () => {
    const { tl } = build()
    const overlay = [{ index: 0, startTime: 0.5, ease: 'power2.out' }]
    tl.applyEdits(overlay)
    const once = JSON.stringify(tl.specs)
    tl.applyEdits(overlay)
    expect(JSON.stringify(tl.specs)).toBe(once)
  })
})
