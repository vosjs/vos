import { describe, expect, it } from 'vitest'
import { contextResolver, createSpecPlayer } from '../index'
import type { TweenSpec } from '../index'

const el = (id: string, _props: Record<string, number>) =>
  ({ kind: 'element', id, scope: 'props' }) as const

const spec = (partial: Partial<TweenSpec> & Pick<TweenSpec, 'target' | 'to'>): TweenSpec => ({
  startTime: 0,
  duration: 1,
  ease: 'none',
  opaque: false,
  ...partial,
})

function scene() {
  const title = { props: { opacity: 1, y: 0 }, segments: [{ y: 0 }, { y: 0 }] }
  const uniforms = { iTime: { value: 0 } }
  const ctx = { elements: new Map([['title', title]]) }
  const content = { refs: { uniforms, group: { rotation: { y: 0 } } } }
  return { title, uniforms, ctx, content }
}

describe('createSpecPlayer', () => {
  it('resolves element/uniform/ref targets and samples values', () => {
    const s = scene()
    const player = createSpecPlayer(contextResolver(s.ctx, s.content))
    player.setSpecs([
      spec({ target: el('title', s.title.props), from: { opacity: 0 }, to: { opacity: 1 }, startTime: 0.5 }),
      spec({ target: { kind: 'uniform', path: 'iTime' }, to: { value: 4 }, duration: 4 }),
      spec({ target: { kind: 'ref', path: 'group.rotation' }, to: { y: 6.28 }, duration: 2 }),
      spec({ target: { kind: 'element', id: 'title', scope: 'segment', segmentIndex: 1 }, to: { y: 10 }, duration: 1 }),
    ])
    expect(player.duration()).toBe(4)

    player.seek(1)
    expect(s.title.props.opacity).toBeCloseTo(0.5, 6) // fromTo midpoint
    expect(s.uniforms.iTime.value).toBeCloseTo(1, 6)
    expect(s.content.refs.group.rotation.y).toBeCloseTo(3.14, 6)
    expect(s.title.segments[1].y).toBeCloseTo(10, 6)
    expect(s.title.segments[0].y).toBe(0) // untouched sibling segment
  })

  it('live swap: implicit starts keep the ORIGINAL base, not mid-animation values', () => {
    const s = scene()
    s.title.props.y = 5 // original base
    const player = createSpecPlayer(contextResolver(s.ctx, s.content))
    const v1: TweenSpec[] = [spec({ target: el('title', s.title.props), to: { y: 105 }, duration: 2 })]
    player.setSpecs(v1)
    player.seek(1)
    expect(s.title.props.y).toBeCloseTo(55, 6) // halfway 5→105

    // SET_DATA mid-playback: new spec list (new identity), implicit start again.
    const v2: TweenSpec[] = [spec({ target: el('title', s.title.props), to: { y: 205 }, duration: 2 })]
    player.setSpecs(v2)
    player.seek(1)
    expect(s.title.props.y).toBeCloseTo(105, 6) // halfway 5→205 — base preserved
  })

  it('memoizes by array identity (same list = no rebuild)', () => {
    const s = scene()
    let resolves = 0
    const player = createSpecPlayer((t) => {
      resolves++
      return contextResolver(s.ctx, s.content)(t)
    })
    const list = [spec({ target: el('title', s.title.props), to: { y: 10 } })]
    player.setSpecs(list)
    player.setSpecs(list)
    player.setSpecs(list)
    expect(resolves).toBe(1)
  })

  it('skips unresolvable targets (missing element, opaque)', () => {
    const s = scene()
    const player = createSpecPlayer(contextResolver(s.ctx, s.content))
    player.setSpecs([
      spec({ target: { kind: 'element', id: 'ghost', scope: 'props' }, to: { y: 1 } }),
      spec({ target: { kind: 'opaque', label: '#0' }, to: { t: 1 } }),
      spec({ target: el('title', s.title.props), to: { y: 3 }, duration: 1 }),
    ])
    expect(() => player.seek(0.5)).not.toThrow()
    expect(s.title.props.y).toBeCloseTo(1.5, 6)
  })

  it('empty/undefined specs are inert', () => {
    const s = scene()
    const player = createSpecPlayer(contextResolver(s.ctx, s.content))
    player.setSpecs(undefined)
    expect(() => player.seek(1)).not.toThrow()
    expect(player.duration()).toBe(0)
  })
})
