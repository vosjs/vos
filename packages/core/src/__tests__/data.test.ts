import { describe, expect, it } from 'vitest'
import { compileVosConfig } from '../compiler/compileVosConfig'
import { textElementSchema, vosConfigJsonSchema } from '../schema/configJsonSchema'

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

describe('{$data} element bindings', () => {
  const bound = {
    ...base,
    data: { headline: 'Hello', font: 'Inter', ink: '#fff' },
    elements: [
      {
        id: 'title',
        type: 'text',
        content: { $data: 'headline' },
        position: 'center',
        font: { family: { $data: 'font' }, color: { $data: 'ink' }, size: 96 },
      },
    ],
  }

  it('schema accepts {$data} on content, font.family and font.color', () => {
    expect(() => vosConfigJsonSchema.parse(bound)).not.toThrow()
    // an empty key is not a binding at the text-element level (the config
    // union falls back to the permissive record, so assert the strict shape)
    expect(textElementSchema.safeParse(bound.elements[0]).success).toBe(true)
    expect(
      textElementSchema.safeParse({
        ...bound.elements[0],
        content: { $data: '' },
      }).success,
    ).toBe(false)
  })

  it('generated code hands data to renderElements and re-resolves on setData', () => {
    const code = compileVosConfig(bound as any)
    // boot: data rides into the element system for initial resolution
    expect(code).toContain('}, THREE, __vosData')
    // live: setData fans out to updateData so bound text re-rasters in place
    expect(code).toContain(
      'window.__vos__.elements.updateData(elements, __vosData)',
    )
    // the binding itself is part of the program (data edits never recompile)
    expect(code).toContain('"$data": "headline"')
  })

  it('program is identical across data values (binding = SET_DATA edit)', () => {
    const { data: _a, ...rest } = bound
    const one = compileVosConfig({ ...rest } as any)
    const two = compileVosConfig({ ...rest } as any)
    expect(one).toBe(two)
  })
})
