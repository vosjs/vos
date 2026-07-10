import { describe, expect, it } from 'vitest'
import {
  createTweenRecorder,
  extractTimeline,
  makeElementsMap,
  runCreateTimeline,
  tagTarget,
  tagUniforms,
  targetKey,
} from '../index'

describe('RecordingTimeline — recording & targets', () => {
  it('records element props tweens with resolved absolute times', () => {
    const rec = createTweenRecorder()
    const el = tagTarget({} as Record<string, number>, { kind: 'element', id: 'title', scope: 'props' })
    const tl = rec.timeline({ paused: true })
    tl.fromTo(el, { opacity: 0, scale: 0.8 }, { opacity: 1, scale: 1, duration: 1.5, ease: 'power2.out' }, 0.5)

    expect(tl.specs).toHaveLength(1)
    const s = tl.specs[0]
    expect(s.target).toEqual({ kind: 'element', id: 'title', scope: 'props' })
    expect(s.from).toEqual({ opacity: 0, scale: 0.8 })
    expect(s.to).toEqual({ opacity: 1, scale: 1 })
    expect(s.startTime).toBe(0.5)
    expect(s.duration).toBe(1.5)
    expect(s.ease).toBe('power2.out')
    expect(s.opaque).toBe(false)
    expect(tl.recordedDuration).toBe(2.0)
  })

  it('binds shader uniforms', () => {
    const rec = createTweenRecorder()
    const uniforms = tagUniforms({ iTime: { value: 0 } })
    const tl = rec.timeline()
    tl.to(uniforms.iTime, { value: 8, duration: 4, ease: 'none' }, 0)
    expect(tl.specs[0].target).toEqual({ kind: 'uniform', path: 'iTime' })
    expect(tl.specs[0].to).toEqual({ value: 8 })
  })

  it('marks callbacks / modifiers / non-numeric values opaque but keeps numeric props', () => {
    const rec = createTweenRecorder()
    const o = {}
    const tl = rec.timeline()
    tl.to(o, {
      x: 100,
      color: '#ff0000',
      duration: 1,
      onUpdate: () => {},
      modifiers: { x: (v: number) => v },
    })
    const s = tl.specs[0]
    expect(s.to).toEqual({ x: 100 })
    expect(s.opaque).toBe(true)
    expect(s.opaqueKeys).toEqual(expect.arrayContaining(['onUpdate', 'modifiers', 'color']))
  })

  it('assigns stable opaque handles to untagged objects', () => {
    const rec = createTweenRecorder()
    const a = {}
    const tl = rec.timeline()
    tl.to(a, { x: 1, duration: 1 }, 0)
    tl.to(a, { x: 2, duration: 1 }, 1) // same object → same opaque label
    tl.to({}, { x: 3, duration: 1 }, 2) // different object → different label
    const labels = tl.specs.map((s) => targetKey(s.target))
    expect(labels[0]).toBe(labels[1])
    expect(labels[0]).not.toBe(labels[2])
  })
})

describe('position resolution', () => {
  it('handles default-append, <, >, += and labels', () => {
    const rec = createTweenRecorder()
    const o = {}
    const tl = rec.timeline()
    tl.to(o, { x: 1, duration: 2 }) // default → 0
    tl.to(o, { x: 2, duration: 1 }) // default append → 2
    tl.to(o, { x: 3, duration: 1 }, '<') // start of prev → 2
    tl.to(o, { x: 4, duration: 1 }, '>') // end of prev (2+1=3) → 3
    tl.addLabel('mark', 10)
    tl.to(o, { x: 5, duration: 1 }, 'mark') // → 10
    tl.to(o, { x: 6, duration: 1 }, '+=5') // end (11) + 5 → 16
    expect(tl.specs.map((s) => s.startTime)).toEqual([0, 2, 2, 3, 10, 16])
  })

  it('applies delay on top of the resolved position', () => {
    const rec = createTweenRecorder()
    const tl = rec.timeline()
    tl.to({}, { x: 1, duration: 1, delay: 0.25 }, 2)
    expect(tl.specs[0].startTime).toBe(2.25)
  })
})

describe('extraction — specs → tracks', () => {
  it('turns a fromTo into two keyframes with the ease on the destination', () => {
    const rec = createTweenRecorder()
    const el = tagTarget({} as Record<string, number>, { kind: 'element', id: 'a', scope: 'props' })
    const tl = rec.timeline()
    tl.fromTo(el, { opacity: 0 }, { opacity: 1, duration: 1, ease: 'sine.inOut' }, 0.5)
    const doc = extractTimeline(tl)
    const track = doc.tracks.find((t) => t.property === 'opacity')!
    expect(track.hasOpaque).toBe(false)
    expect(track.track.keyframes).toEqual([
      { t: 0.5, value: 0 },
      { t: 1.5, value: 1, ease: 'sine.inOut' },
    ])
  })

  it('chains sequential .to off the prior anchor and flags a leading .to', () => {
    const rec = createTweenRecorder()
    const el = tagTarget({} as Record<string, number>, { kind: 'element', id: 'b', scope: 'props' })
    const tl = rec.timeline()
    tl.set(el, { x: 0 }, 0) // anchor
    tl.to(el, { x: 100, duration: 1, ease: 'none' }, 0)
    tl.to(el, { x: 200, duration: 1, ease: 'none' }, 1)
    const doc = extractTimeline(tl)
    const track = doc.tracks.find((t) => t.property === 'x')!
    expect(track.hasOpaque).toBe(false) // .set provided the anchor
    expect(track.track.keyframes.map((k) => [k.t, k.value])).toEqual([
      [0, 0],
      [1, 100],
      [2, 200],
    ])

    // Without the anchoring .set, a leading .to has an unknown implicit start.
    const rec2 = createTweenRecorder()
    const el2 = tagTarget({} as Record<string, number>, { kind: 'element', id: 'c', scope: 'props' })
    const tl2 = rec2.timeline()
    tl2.to(el2, { x: 100, duration: 1 }, 0)
    expect(extractTimeline(tl2).tracks.find((t) => t.property === 'x')!.hasOpaque).toBe(true)
  })
})

describe('runCreateTimeline — host-side extraction from a function string', () => {
  const SOURCE = `(ctx, content, duration) => {
    const { gsap, elements } = ctx
    const tl = gsap.timeline({ paused: true })
    const u = content.refs.uniforms
    tl.to(u.iTime, { value: duration, duration, ease: 'none' }, 0)
    const title = elements.get('title')
    tl.fromTo(title.props, { opacity: 0 }, { opacity: 1, duration: 1, ease: 'power2.out' }, 0.5)
    title.segments.forEach((seg, i) => {
      tl.fromTo(seg, { rotationX: -90 }, { rotationX: 90, duration: 0.9, ease: 'none' }, i * 0.1)
    })
    return tl
  }`

  it('extracts uniform + element + per-segment tracks', () => {
    const elements = makeElementsMap({ title: 3 })
    const ctx = { gsap: createTweenRecorder(), elements }
    const content = { refs: { uniforms: tagUniforms({ iTime: { value: 0 } }) } }
    const tl = runCreateTimeline(SOURCE, ctx, content, 4)!
    const doc = extractTimeline(tl)

    expect(doc.tracks.some((t) => t.target.kind === 'uniform' && t.property === 'value')).toBe(true)
    expect(
      doc.tracks.some(
        (t) => t.target.kind === 'element' && t.target.scope === 'props' && t.property === 'opacity',
      ),
    ).toBe(true)
    const segTracks = doc.tracks.filter(
      (t) => t.target.kind === 'element' && t.target.scope === 'segment',
    )
    expect(segTracks).toHaveLength(3)
    expect(doc.duration).toBeGreaterThan(0)
  })

  it('survives a body that throws partway (partial extraction)', () => {
    const bad = `(ctx, content) => {
      const tl = ctx.gsap.timeline()
      tl.to({}, { x: 1, duration: 1 }, 0)
      content.refs.missing.deep.boom()  // throws
      return tl
    }`
    const ctx = { gsap: createTweenRecorder(), elements: new Map() }
    const tl = runCreateTimeline(bad, ctx, { refs: {} })
    expect(tl).not.toBeNull()
    expect(tl!.specs.length).toBe(1) // the tween before the throw survived
  })
})
