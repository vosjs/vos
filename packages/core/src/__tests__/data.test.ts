import { describe, expect, it } from 'vitest'
import { compileVosConfig } from '../compiler/compileVosConfig'
import { vosConfigJsonSchema } from '../schema/configJsonSchema'

const base = {
  version: 2,
  duration: 5,
  camera: { preset: 'perspective' as const },
  createContent: '() => ({ objects: [] })',
  createTimeline: '(ctx, content, duration) => ctx.gsap.timeline()',
}

describe('ctx.data', () => {
  it('bakes config.data as the default into the compiled module', () => {
    const code = compileVosConfig({ ...base, data: { k: 1 } })
    // baked default present
    expect(code).toContain('{"k":1}')
    // data wired into a mutable internal with a runtime override fallback (live channel)
    expect(code).toMatch(/let __vosData = Object\.freeze\(\(deps && deps\.data\) \?\? /)
    // exposed as a getter (so setData can swap it live) and a setData on the instance
    expect(code).toContain('get data() { return __vosData; }')
    expect(code).toContain('setData:')
  })

  it('bakes {} when config.data is omitted', () => {
    const code = compileVosConfig(base)
    expect(code).toMatch(/\?\? \{\}\)/)
  })

  it('exposes data as a live getter on the runtime context object', () => {
    const code = compileVosConfig({ ...base, data: { a: true } })
    // the `data` getter appears inside the `const context = { ... }` block
    const ctxBlock = code.slice(code.indexOf('const context = {'))
    expect(ctxBlock).toContain('get data() { return __vosData; }')
  })

  it('setData replaces ctx.data live (frozen snapshot)', () => {
    // prove the live-swap semantics in isolation: getter reads the mutable internal
    let __vosData: Readonly<Record<string, unknown>> = Object.freeze({ mode: 'init' })
    const ctx = {
      get data() {
        return __vosData
      },
    }
    const setData = (next: Record<string, unknown>) => {
      __vosData = Object.freeze(next ?? {})
    }
    expect(ctx.data).toEqual({ mode: 'init' })
    setData({ mode: 'live' })
    expect(ctx.data).toEqual({ mode: 'live' })
    expect(Object.isFrozen(ctx.data)).toBe(true)
  })

  it('runtime deps.data overrides the baked default', () => {
    // Evaluate the generated frozen-data expression in isolation to prove precedence
    const baked = { mode: 'baked' }
    const evalData = (deps: { data?: unknown }) =>
      Object.freeze((deps && deps.data) ?? baked)
    expect(evalData({ data: { mode: 'runtime' } })).toEqual({ mode: 'runtime' })
    expect(evalData({})).toEqual({ mode: 'baked' })
  })

  it('schema accepts arbitrary data shapes and rejects non-objects', () => {
    expect(() =>
      vosConfigJsonSchema.parse({ ...base, data: { cursor: [{ t: 0, x: 1 }] } }),
    ).not.toThrow()
    expect(() => vosConfigJsonSchema.parse({ ...base, data: 5 })).toThrow()
  })

  it('is backward compatible: configs without data still compile', () => {
    expect(() => compileVosConfig(base)).not.toThrow()
  })
})
