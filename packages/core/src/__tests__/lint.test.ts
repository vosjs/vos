import { describe, expect, it } from 'vitest'
import {
  hasDeterminismErrors,
  lintVosConfig,
} from '../lint'
import type { VosConfigJson } from '../types'

const base: VosConfigJson = {
  version: 2,
  duration: 5,
  camera: { preset: 'perspective' },
  createContent: '() => ({ objects: [] })',
  createTimeline: '(ctx) => ctx.gsap.timeline()',
}

describe('lintVosConfig', () => {
  it('flags Math.random as an error', () => {
    const issues = lintVosConfig({ ...base, onFrame: '(ctx) => { const r = Math.random() }' })
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({ fn: 'onFrame', rule: 'random', severity: 'error' })
    expect(hasDeterminismErrors(issues)).toBe(true)
  })

  it('flags gsap.utils.random', () => {
    const issues = lintVosConfig({ ...base, createTimeline: '(ctx) => { ctx.gsap.utils.random(0, 1) }' })
    expect(issues.map((i) => i.rule)).toContain('gsap-random')
  })

  it('flags string-form random() tween values', () => {
    const between = lintVosConfig({
      ...base,
      createTimeline: "(ctx) => { ctx.gsap.to(o, { x: 'random(-100, 100)' }) }",
    })
    expect(between.map((i) => i.rule)).toContain('gsap-string-random')
    const fromArray = lintVosConfig({
      ...base,
      createTimeline: '(ctx) => { ctx.gsap.to(o, { x: "random([1, 2, 3])" }) }',
    })
    expect(fromArray.map((i) => i.rule)).toContain('gsap-string-random')
  })

  it("flags stagger from:'random'", () => {
    const issues = lintVosConfig({
      ...base,
      createTimeline: "(ctx) => { ctx.gsap.to(all, { y: 10, stagger: { from: 'random', each: 0.1 } }) }",
    })
    expect(issues.map((i) => i.rule)).toContain('gsap-string-random')
  })

  it('does not flag GLSL random( or numeric stagger', () => {
    const issues = lintVosConfig({
      ...base,
      // GLSL random( has no preceding JS quote; numeric stagger is deterministic
      createContent: '() => { const s = `float r = random(uv);`; return { objects: [] } }',
      createTimeline: '(ctx) => { ctx.gsap.to(all, { y: 10, stagger: 0.1 }) }',
    })
    expect(issues.map((i) => i.rule)).not.toContain('gsap-string-random')
  })

  it('flags wall-clock: Date.now, new Date, performance.now', () => {
    const rules = lintVosConfig({
      ...base,
      createContent: '() => { Date.now(); new Date(); performance.now(); return { objects: [] } }',
    }).map((i) => i.rule)
    expect(rules.filter((r) => r === 'wall-clock')).toHaveLength(3)
  })

  it('warns on timers/rAF and network (not errors)', () => {
    const issues = lintVosConfig({
      ...base,
      onFrame: '() => { setTimeout(()=>{},1); requestAnimationFrame(()=>{}); fetch("/x") }',
    })
    expect(issues.every((i) => i.severity === 'warn')).toBe(true)
    expect(hasDeterminismErrors(issues)).toBe(false)
    expect(issues.map((i) => i.rule).sort()).toEqual(['network', 'timer', 'timer'])
  })

  it('reports the correct line and function', () => {
    const issues = lintVosConfig({ ...base, onFrame: '(ctx) => {\n  const r = Math.random()\n}' })
    expect(issues[0]).toMatchObject({ fn: 'onFrame', line: 2 })
  })

  it('respects vos-lint-disable-next-line', () => {
    const clean = lintVosConfig({
      ...base,
      onFrame: '(ctx) => {\n  // vos-lint-disable-next-line random\n  const r = Math.random()\n}',
    })
    expect(clean).toHaveLength(0)
    // wrong rule name does not suppress
    const stillFlagged = lintVosConfig({
      ...base,
      onFrame: '(ctx) => {\n  // vos-lint-disable-next-line timer\n  const r = Math.random()\n}',
    })
    expect(stillFlagged).toHaveLength(1)
    // 'all' suppresses
    const allOff = lintVosConfig({
      ...base,
      onFrame: '(ctx) => {\n  // vos-lint-disable-next-line all\n  const r = Math.random()\n}',
    })
    expect(allOff).toHaveLength(0)
  })

  it('returns [] for a clean config', () => {
    expect(lintVosConfig(base)).toEqual([])
  })
})
