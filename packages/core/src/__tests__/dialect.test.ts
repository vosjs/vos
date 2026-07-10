import { describe, expect, it } from 'vitest'
import { hasDialectErrors, lintVosDialect } from '../lint'
import type { VosConfigJson } from '../types'

const base: VosConfigJson = {
  version: 2,
  duration: 5,
  camera: { preset: 'perspective' },
  createContent: '() => ({ objects: [] })',
  createTimeline: '(ctx) => ctx.gsap.timeline()',
}

const ct = (body: string): VosConfigJson => ({ ...base, createTimeline: body })

describe('lintVosDialect', () => {
  it('accepts an in-dialect timeline', () => {
    const issues = lintVosDialect(
      ct("(ctx) => { const tl = ctx.gsap.timeline({ paused: true }); tl.fromTo(o.props, { opacity: 0 }, { opacity: 1, duration: 1, ease: 'power2.out' }, 0.5); return tl }"),
    )
    expect(issues).toEqual([])
    expect(hasDialectErrors(issues)).toBe(false)
  })

  it('flags registerPlugin and named plugins', () => {
    const reg = lintVosDialect(ct('(ctx) => { ctx.gsap.registerPlugin(DrawSVGPlugin) }'))
    expect(reg.map((i) => i.rule)).toContain('plugin')
    const draw = lintVosDialect(ct("(ctx) => { tl.to('path', { drawSVG: '100%' }) }"))
    // DrawSVG-style demo trips BOTH the DOM-target rule and (via the string) nothing else
    expect(draw.map((i) => i.rule)).toContain('dom-target')
    const scroll = lintVosDialect(ct('(ctx) => { ScrollTrigger.create({}) }'))
    expect(scroll.map((i) => i.rule)).toContain('plugin')
  })

  it('flags modifiers', () => {
    const issues = lintVosDialect(
      ct('(ctx) => { tl.to(p, { y: 1, modifiers: { y: (v) => v } }) }'),
    )
    expect(issues.map((i) => i.rule)).toContain('modifiers')
    expect(hasDialectErrors(issues)).toBe(true)
  })

  it('flags string/selector targets', () => {
    const issues = lintVosDialect(ct('(ctx) => { tl.to("#id", { x: 10 }); tl.from(".cls", { x: 0 }) }'))
    expect(issues.filter((i) => i.rule === 'dom-target')).toHaveLength(2)
  })

  it('flags playback-control, repeatRefresh, snap', () => {
    const rules = lintVosDialect(
      ct('(ctx) => { tl.addPause(1); tl.to(p, { x: 1, snap: { x: 5 }, repeatRefresh: true }) }'),
    ).map((i) => i.rule)
    expect(rules).toContain('playback-control')
    expect(rules).toContain('snap')
    expect(rules).toContain('repeat-refresh')
  })

  it('warns (not errors) on immediateRender and unsupported eases', () => {
    const issues = lintVosDialect(
      ct("(ctx) => { tl.to(p, { x: 1, ease: 'elastic.out', immediateRender: false }) }"),
    )
    expect(issues.every((i) => i.severity === 'warn')).toBe(true)
    expect(hasDialectErrors(issues)).toBe(false)
    expect(issues.map((i) => i.rule).sort()).toEqual(['immediate-render', 'unknown-ease'])
  })

  it('flags parameterized eases but accepts supported families', () => {
    const param = lintVosDialect(ct("(ctx) => { tl.to(p, { x: 1, ease: 'back.out(1.7)' }) }"))
    expect(param.map((i) => i.rule)).toContain('unknown-ease')
    const ok = lintVosDialect(ct("(ctx) => { tl.to(p, { x: 1, ease: 'sine.inOut' }); tl.to(p, { y: 1, ease: 'none' }) }"))
    expect(ok.map((i) => i.rule)).not.toContain('unknown-ease')
  })

  it('respects vos-lint-disable-next-line', () => {
    const clean = lintVosDialect(
      ct('(ctx) => {\n  // vos-lint-disable-next-line modifiers\n  tl.to(p, { y: 1, modifiers: { y: (v) => v } })\n}'),
    )
    expect(clean).toEqual([])
  })
})
