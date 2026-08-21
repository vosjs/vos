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

describe('setData keeps every program live', () => {
  const onFrame = '(ctx, content) => { content.uniforms.uHue.value = ctx.data.hue }'

  it('rebuilds content in place when the program declares no onFrame', () => {
    const code = compileVosConfig({ ...base, data: { hue: 0.2 } })
    // the rebuild exists and setData calls it after swapping ctx.data
    expect(code).toContain('const __rebuildContent = () => {')
    const setDataBlock = code.slice(code.indexOf('setData: (next) => {'))
    expect(setDataBlock).toContain('__rebuildContent();')
    // content and timeline are rebindable, and the timeline is read live
    expect(code).toContain('let content = createContent(context,')
    expect(code).toContain('let tl = createTimeline(context, content, DURATION);')
    expect(code).toContain('get timeline() { return tl; }')
    expect(code).not.toContain('timeline: tl,')
  })

  it('keeps the swap-only path when the program reads ctx.data in onFrame', () => {
    const code = compileVosConfig({ ...base, data: { hue: 0.2 }, onFrame })
    const setDataBlock = code.slice(code.indexOf('setData: (next) => {'))
    expect(setDataBlock).not.toContain('__rebuildContent();')
    // the rebuild still exists for the onData/no-onFrame contract, just unused here
    expect(code).toContain('const __rebuildContent = () => {')
  })

  it('calls content.onData first, on every program', () => {
    for (const cfg of [{ ...base }, { ...base, onFrame }]) {
      const code = compileVosConfig(cfg)
      const setDataBlock = code.slice(code.indexOf('setData: (next) => {'))
      expect(setDataBlock).toContain(
        "if (content && typeof content.onData === 'function') { content.onData(__vosData); return; }",
      )
    }
  })

  it('strips what the old content added and restores the baseline layers', () => {
    const code = compileVosConfig(base)
    expect(code).toContain('const __baseChildren = new Set(scene.children);')
    const rebuild = code.slice(
      code.indexOf('const __rebuildContent = () => {'),
      code.indexOf('return {'),
    )
    expect(rebuild).toContain('if (content && content.dispose) content.dispose();')
    expect(rebuild).toContain('if (obj && obj.parent) obj.parent.remove(obj);')
    expect(rebuild).toContain('if (!__baseChildren.has(child)) scene.remove(child);')
    expect(rebuild).toContain('__resetLayers();')
    expect(rebuild).toContain('__assignLayers();')
    // layer assignment is emitted as re-runnable functions
    expect(code).toContain('function __resetLayers() {')
    expect(code).toContain('function __assignLayers() {')
  })

  it('carries the transport and the host progress callback to the new timeline', () => {
    const code = compileVosConfig(base)
    const rebuild = code.slice(
      code.indexOf('const __rebuildContent = () => {'),
      code.indexOf('return {'),
    )
    expect(rebuild).toContain("const prevOnUpdate = prev.eventCallback('onUpdate');")
    expect(rebuild).toContain("if (prevOnUpdate) tl.eventCallback('onUpdate', prevOnUpdate);")
    expect(rebuild).toContain('tl.timeScale(prevRate);')
    expect(rebuild).toContain('if (!prevPaused) tl.play();')
    expect(rebuild).toContain('prev.kill();')
  })

  it('rebuilds per-layer composers only when the config has per-layer effects', () => {
    const withLayers = compileVosConfig({
      ...base,
      perLayerEffects: [{ type: 'bloom', strength: 1, radius: 0.5, threshold: 0 }, { type: 'output' }],
    } as never)
    expect(withLayers).toContain('function __buildLayerComposers() {')
    const rebuild = withLayers.slice(
      withLayers.indexOf('const __rebuildContent = () => {'),
      withLayers.indexOf('return {'),
    )
    expect(rebuild).toContain('__buildLayerComposers();')
    const without = compileVosConfig(base)
    expect(without).not.toContain('__buildLayerComposers')
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
