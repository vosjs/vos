import { describe, expect, it } from 'vitest'
import { compileVosConfig } from '../compiler/compileVosConfig'
import { lintVosConfig } from '../lint/determinism'
import { generateRenderTemplate } from '../runtime/renderTemplate'
import { vosConfigJsonSchema } from '../schema/configJsonSchema'
import type { VosConfigJson } from '../types/vosConfigJson'

// retime: evaluate the program at f(t). The output clock drives the
// transport; the program's own timeline is seeked at retime(outputTime, data)
// every frame; stack entries stay on output time.

const base: VosConfigJson = {
  version: 2,
  duration: 4,
  camera: { preset: 'perspective', fov: 30 },
  createContent: '(ctx) => ({ objects: [], refs: {} })',
  createTimeline:
    "(ctx, content, duration) => { const tl = ctx.gsap.timeline(); tl.to({}, { duration, ease: 'none' }); return tl; }",
}
const half: VosConfigJson = {
  ...base,
  data: { rate: 0.5 },
  retime: '(t, data) => t * data.rate',
}

describe('retime — schema and lint', () => {
  it('is an optional function string', () => {
    expect(vosConfigJsonSchema.safeParse(half).success).toBe(true)
    expect(vosConfigJsonSchema.safeParse({ ...base, retime: 3 }).success).toBe(
      false,
    )
  })

  it('is linted like every other hook', () => {
    const issues = lintVosConfig({ ...base, retime: '(t) => Math.random()' })
    expect(issues.some((i) => i.fn === 'retime' && i.rule === 'random')).toBe(
      true,
    )
  })
})

describe('retime — codegen', () => {
  it('without one, time and output time are the same number', () => {
    const code = compileVosConfig(base)
    expect(code).not.toContain('__clock')
    expect(code).not.toContain('__retime')
    expect(code).toContain('currentOutputTime = currentTime = tl.time();')
    expect(code).toContain('get outputTime() { return currentOutputTime; }')
    expect(code).toContain('get timeline() { return tl; }')
  })

  it('drives the transport on an output clock and seeks the program timeline', () => {
    const code = compileVosConfig(half)
    expect(code).toContain('const __retime = (t, data) => t * data.rate;')
    // The clock is a carrier of DURATION seconds, the timeline stays paused.
    expect(code).toContain('const __clock = gsap.timeline();')
    expect(code).toContain(
      "__clock.to({}, { duration: DURATION, ease: 'none' }, 0);",
    )
    // Per frame: output time from the clock, program time through the map.
    const loop = code.slice(code.indexOf('const renderFrame = () => {'))
    expect(loop).toContain('currentOutputTime = __clock.time();')
    expect(loop).toContain('currentTime = __retimeAt(currentOutputTime);')
    expect(loop).toContain('tl.seek(currentTime, false);')
    expect(loop).toContain('currentProgress = __clock.progress();')
    // The transport is the clock.
    expect(code).toContain('get timeline() { return __clock; }')
    expect(code).toContain('retime: true,')
  })

  it('clamps to the program timeline and falls back on a non-finite result', () => {
    const code = compileVosConfig(half)
    const fn = code.slice(
      code.indexOf('const __retimeAt'),
      code.indexOf('const __clock'),
    )
    expect(fn).toContain('if (!isFinite(r))')
    expect(fn).toContain('r = t;')
    expect(fn).toContain('Math.min(r, d)')
    expect(fn).toContain('Math.max(0,')
  })

  it('setDuration is always defined, on the clock', () => {
    const code = compileVosConfig(half)
    expect(code).toContain('if (true) {')
    expect(code).toContain('const __carrier = __clock;')
    // Without a retime the carrier opt-in stands as it was.
    const plain = compileVosConfig(base)
    expect(plain).toContain('if (tl.data && tl.data.vosCarrier === true) {')
    expect(plain).toContain('const __carrier = tl;')
  })

  it('cleanup kills the clock', () => {
    expect(compileVosConfig(half)).toContain('__clock.kill();')
  })

  it('a stack entry keeps output time under a retime', () => {
    const code = compileVosConfig({
      ...half,
      stack: [{ id: 'hud', onFrame: '(ctx) => { ctx.time }' }],
    })
    expect(code).toContain(
      'time: { get: () => context.outputTime, enumerable: true },',
    )
  })
})

describe('retime — bridge (protocol 7)', () => {
  it('READY says whether the transport is the clock', () => {
    const html = generateRenderTemplate(
      'export const initVos = async () => ({ timeline: null, cleanup: () => {} })',
      { mode: 'playback' },
    )
    expect(html).toContain('retime: !!result.retime')
  })
})
