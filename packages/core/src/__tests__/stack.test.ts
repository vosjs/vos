import { describe, expect, it } from 'vitest'
import { compileVosConfig } from '../compiler/compileVosConfig'
import { detectRequiredAddons } from '../addons/registry'
import { lintVosConfig } from '../lint/determinism'
import { generateRenderTemplate } from '../runtime/renderTemplate'
import { VOS_BRIDGE_PROTOCOL } from '../runtime/bridge'
import { vosConfigJsonSchema } from '../schema/configJsonSchema'
import type { VosConfigJson } from '../types/vosConfigJson'

// The program stack: more programs on one context, after the main one, each
// with its own ctx.data and error boundary. Schema, codegen, the live data
// channel, addon detection, the lints, and the protocol-5 bridge surface.

const base: VosConfigJson = {
  version: 2,
  duration: 4,
  camera: { preset: 'perspective', fov: 30 },
  createContent: '(ctx) => ({ objects: [], refs: {} })',
  createTimeline:
    "(ctx, content, duration) => { const tl = ctx.gsap.timeline(); tl.to({}, { duration, ease: 'none' }); return tl; }",
}

const hud = {
  id: 'hud',
  data: { label: 'take 1' },
  createContent:
    '(ctx) => { const m = new ctx.THREE.Mesh(new ctx.THREE.PlaneGeometry(1, 1)); ctx.overlayScene.add(m); return { objects: [m] } }',
  onFrame: '(ctx, content, dt) => { content.objects[0].position.x = ctx.time }',
}

describe('stack — schema', () => {
  it('accepts entries and refuses duplicate ids', () => {
    expect(
      vosConfigJsonSchema.safeParse({ ...base, stack: [hud] }).success,
    ).toBe(true)
    const dup = vosConfigJsonSchema.safeParse({
      ...base,
      stack: [hud, { ...hud }],
    })
    expect(dup.success).toBe(false)
  })

  it('an entry needs an id and nothing else', () => {
    expect(
      vosConfigJsonSchema.safeParse({ ...base, stack: [{ id: 'empty' }] })
        .success,
    ).toBe(true)
    expect(
      vosConfigJsonSchema.safeParse({ ...base, stack: [{ id: '' }] }).success,
    ).toBe(false)
  })
})

describe('stack — codegen', () => {
  it('emits nothing without a stack (the artifact stays as it was)', () => {
    const code = compileVosConfig(base)
    expect(code).not.toContain('__stack')
    expect(code).toContain('setData: (next) => {')
  })

  it('runs an entry on a context of its own data, after the main content', () => {
    const code = compileVosConfig({ ...base, stack: [hud] })
    // The entry table, with its baked data.
    expect(code).toContain('id: "hud"')
    expect(code).toContain('baked: {"label":"take 1"}')
    // Its context derives from the main one: every live getter inherited,
    // `data` overridden with the entry's own slot.
    expect(code).toContain(
      's.ctx = Object.create(context, { data: { get: () => s.data, enumerable: true } })',
    )
    // Mounted after the main content and before layer assignment.
    const mainAt = code.indexOf('let content = createContent(context')
    const mountAt = code.indexOf('for (const s of __stack) {')
    const layersAt = code.indexOf('function __assignLayers()')
    expect(mainAt).toBeGreaterThan(0)
    expect(mountAt).toBeGreaterThan(mainAt)
    expect(layersAt).toBeGreaterThan(mountAt)
    // Runtime override of an entry's data, the deps.data way.
    expect(code).toContain(
      '(deps && deps.stack && deps.stack[def.id]) ?? def.baked',
    )
  })

  it('each entry runs in its own try/catch and is disabled on a throw', () => {
    const code = compileVosConfig({ ...base, stack: [hud] })
    expect(code).toContain('catch (e) { __stackFail(s, e); }')
    expect(code).toContain('s.ok = false;')
    // A failed entry is skipped every frame after.
    expect(code).toContain('if (!s.ok || !s.def.onFrame) continue;')
  })

  it("ticks an entry's onFrame after the main one, on one delta clock", () => {
    // Main program with no onFrame: the clock exists for the entry alone.
    const code = compileVosConfig({ ...base, stack: [hud] })
    expect(code).toContain('const timer = new THREE.Timer();')
    expect(code).toContain('__stackFrame(deltaTime);')
    expect(code).not.toContain('onFrame(context, content, deltaTime);')
    // Both: main first, then the stack.
    const both = compileVosConfig({
      ...base,
      onFrame: '(ctx) => {}',
      stack: [hud],
    })
    const mainAt = both.indexOf('onFrame(context, content, deltaTime);')
    const stackAt = both.indexOf('__stackFrame(deltaTime);')
    expect(mainAt).toBeGreaterThan(0)
    expect(stackAt).toBeGreaterThan(mainAt)
  })

  it('setData takes a target and routes it to the entry (three rungs)', () => {
    const code = compileVosConfig({ ...base, stack: [hud] })
    expect(code).toContain('setData: (next, target) => {')
    expect(code).toContain(
      'if (target != null) { __stackSetData(target, next); return; }',
    )
    // The entry's rungs: onData, else onFrame reads next frame, else rebuild.
    const fn = code.slice(code.indexOf('const __stackSetData'))
    expect(fn).toContain("typeof s.content.onData === 'function'")
    expect(fn).toContain('if (s.def.onFrame) return;')
    expect(fn).toContain('__stackDisposeOne(s);')
  })

  it('a main-content rebuild re-creates the live entries', () => {
    const code = compileVosConfig({ ...base, stack: [hud] })
    const rebuild = code.slice(
      code.indexOf('const __rebuildContent'),
      code.indexOf('get timeline() { return tl; }'),
    )
    expect(rebuild).toContain('for (const s of __stack) {')
    expect(rebuild).toContain('if (!s.ok) continue;')
  })

  it('cleanup disposes the stack and the instance exposes its state', () => {
    const code = compileVosConfig({ ...base, stack: [hud] })
    expect(code).toContain('for (const s of __stack) __stackDisposeOne(s);')
    expect(code).toContain('ids: __stack.map((s) => s.id)')
    expect(code).toContain(
      'state: () => __stack.map((s) => ({ id: s.id, ok: s.ok, error: s.error }))',
    )
    expect(code).toContain('onError: (cb) => {')
  })

  it("an entry's setup earns the loaders registry without a main setup", () => {
    const code = compileVosConfig({
      ...base,
      stack: [
        {
          id: 'logo',
          setup:
            "async (ctx) => ({ tex: await new ctx.loaders.TextureLoader().loadAsync('x.png') })",
          createContent: '(ctx, s) => ({ objects: [] })',
        },
      ],
    })
    expect(code).toContain('const loaders = {')
    expect(code).toContain('const setupContext = {')
    expect(code).toContain(
      's.setupData = await s.def.setup(Object.create(setupContext, { data: { get: () => s.data, enumerable: true } }));',
    )
    // The main program still has no setup call.
    expect(code).not.toContain('const setupData = await setup(setupContext);')
  })
})

describe('stack — addons and lints', () => {
  it("detects addons from an entry's strings", () => {
    const addons = detectRequiredAddons({
      ...base,
      stack: [
        {
          id: 'model',
          setup:
            'async (ctx) => ({ g: await ctx.loaders.gltf.loadAsync("a.glb") })',
        },
      ],
    })
    expect(addons).toContain('GLTFLoader')
  })

  it("lints an entry's strings and names the entry", () => {
    const issues = lintVosConfig({
      ...base,
      stack: [{ id: 'hud', onFrame: '(ctx) => { Math.random() }' }],
    })
    expect(issues.some((i) => i.entry === 'hud' && i.rule === 'random')).toBe(
      true,
    )
    expect(lintVosConfig(base)).toEqual([])
  })
})

describe('stack — bridge (protocol 5)', () => {
  const html = generateRenderTemplate(
    'export const initVos = async () => ({ timeline: null, cleanup: () => {} })',
    { mode: 'playback' },
  )

  it('advertises the stack in READY and pushes STACK_ERROR', () => {
    expect(VOS_BRIDGE_PROTOCOL).toBe(5)
    expect(html).toContain('stack: result.stack ? result.stack.ids : []')
    expect(html).toContain(
      "__post({ type: 'STACK_ERROR', id: e.id, error: e.error })",
    )
  })

  it('routes a targeted SET_DATA to the entry and answers GET_STACK_STATE', () => {
    expect(html).toContain('__current.setData(msg.data, msg.target)')
    expect(html).toContain("case 'GET_STACK_STATE':")
    expect(html).toContain("type: 'STACK_STATE'")
    // LOAD carries per-entry data beside deps.data.
    expect(html).toContain('if (stackData != null) deps.stack = stackData;')
  })
})
