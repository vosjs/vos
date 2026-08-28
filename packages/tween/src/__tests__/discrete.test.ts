import { describe, expect, it } from 'vitest'
import { createSampler, createTweenRecorder, parseVars } from '../index'

// Discrete values: a boolean or a plain string in a tween's vars is not
// interpolated, but it is not lost either. The recorder keeps it on
// `spec.discrete` and the sampler applies it as a step at the tween's start,
// which is what lets `set(media.props, { playing: true })` work on the vos
// backend the way it does on GSAP.

describe('discrete values', () => {
  it('parseVars keeps booleans and strings beside the opaque marker', () => {
    const p = parseVars({
      playing: true,
      mode: 'b',
      opacity: 1,
      onUpdate: () => {},
    })
    expect(p.props).toEqual({ opacity: 1 })
    expect(p.opaque).toBe(true)
    expect(p.opaqueKeys.sort()).toEqual(['mode', 'onUpdate', 'playing'])
    expect(p.discrete).toEqual({ playing: true, mode: 'b' })
    // Nested objects and functions stay dropped.
    expect(parseVars({ x: { y: 1 } }).discrete).toBeUndefined()
  })

  it('the sampler steps them at the start time and keeps the base before it', () => {
    const rec = createTweenRecorder()
    const props: Record<string, unknown> = { playing: false, gain: 1 }
    const tl = rec.timeline()
    tl.set(props, { playing: true }, 1)
    tl.to(props, { gain: 0, duration: 2, ease: 'none' }, 1)
    tl.set(props, { playing: false }, 3)
    const s = createSampler(tl.entries)

    s.seek(0)
    expect(props.playing).toBe(false)
    s.seek(1)
    expect(props.playing).toBe(true)
    s.seek(2)
    expect(props.playing).toBe(true)
    expect(props.gain).toBeCloseTo(0.5, 6)
    s.seek(3)
    expect(props.playing).toBe(false)
    // Seeking backwards is pure: the value at 2 is the value at 2.
    s.seek(2)
    expect(props.playing).toBe(true)
  })

  it('the latest-started step wins, ties to insertion order', () => {
    const rec = createTweenRecorder()
    const props: Record<string, unknown> = { mode: 'a' }
    const tl = rec.timeline()
    tl.set(props, { mode: 'b' }, 1)
    tl.set(props, { mode: 'c' }, 1)
    tl.to(props, { mode: 'd', duration: 1 }, 0.5)
    const s = createSampler(tl.entries)
    s.seek(0.75)
    expect(props.mode).toBe('d')
    s.seek(1)
    expect(props.mode).toBe('c')
  })
})
