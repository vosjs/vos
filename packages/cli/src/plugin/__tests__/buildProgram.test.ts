import { describe, expect, it } from 'vitest'
import { buildProgram, freeIdentifiers, functionSource } from '../buildProgram'

const OUTSIDE = 120

describe('functionSource', () => {
  it('keeps arrows and function expressions, rewrites method shorthand', () => {
    const arrow = (ctx: unknown) => ctx
    expect(functionSource(arrow as never)).toBe(arrow.toString())
    const obj = {
      createContent(ctx: unknown) {
        return ctx
      },
      async setup(ctx: unknown) {
        return ctx
      },
    }
    expect(functionSource(obj.createContent as never)).toMatch(
      /^function createContent\(ctx\)/,
    )
    expect(functionSource(obj.setup as never)).toMatch(
      /^async function setup\(ctx\)/,
    )
  })
})

describe('freeIdentifiers', () => {
  it('names what the string would carry no value for', () => {
    expect(
      freeIdentifiers(
        '(ctx) => { const k = ctx.resolution.height / 1080; return OUTSIDE * k + helper(k) }',
      ),
    ).toEqual(['OUTSIDE', 'helper'])
  })

  it('passes params, destructuring, inner functions, page and JS globals', () => {
    expect(
      freeIdentifiers(
        `(ctx, content) => {
          const { data: d, elements } = ctx
          const [a, ...rest] = [1, 2, 3]
          function inner(x = 1) { return Math.max(x, a) }
          const c = document.createElement('canvas')
          try { JSON.parse('{}') } catch (err) { console.log(err) }
          const o = { d, key: 1, [a]: 2 }
          outer: for (const i of rest) { if (i) break outer }
          return new Map([[o.key, inner(d.n) + elements.size + window.innerWidth]])
        }`,
      ),
    ).toEqual([])
  })

  it('throws on syntax the page cannot run (a TypeScript cast)', () => {
    expect(() => freeIdentifiers('(ctx) => ctx as any')).toThrow()
  })
})

describe('buildProgram', () => {
  it('stringifies the hooks and the stack, and locates them in the file', () => {
    const text = `export default {\n  createContent(ctx) {\n    return { objects: [] }\n  },\n}\n`
    const program = {
      version: 2,
      duration: 2,
      camera: { preset: 'fullscreen' },
      data: { word: 'Hi' },
      createContent(_ctx: unknown) {
        return { objects: [] }
      },
      createTimeline: (ctx: { gsap: { timeline: () => unknown } }) =>
        ctx.gsap.timeline(),
      stack: [{ id: 'grain', onFrame: (_ctx: unknown) => {} }],
    }
    const built = buildProgram(program, 'p.mjs', text)
    expect(built.problems).toEqual([])
    expect(typeof built.config.createContent).toBe('string')
    expect(built.config.createContent).toMatch(/^function createContent/)
    expect((built.config.stack as { onFrame: unknown }[])[0].onFrame).toMatch(
      /=>/,
    )
    expect(built.config.data).toEqual({ word: 'Hi' })
  })

  it('refuses a module-scope read and non-JSON data, naming each', () => {
    const program = {
      version: 2,
      duration: 2,
      camera: { preset: 'fullscreen' },
      data: { at: new Date(0), n: Number.NaN },
      createContent: (_ctx: unknown) => ({ objects: [], n: OUTSIDE }),
      createTimeline: (ctx: { gsap: { timeline: () => unknown } }) =>
        ctx.gsap.timeline(),
    }
    const built = buildProgram(program, 'p.mjs', '')
    expect(built.problems.map((p) => p.fn)).toEqual(['createContent', 'data'])
    expect(built.problems[0].message).toMatch(/`OUTSIDE`/)
    expect(built.problems[1].message).toMatch(/Date instance/)
  })
})
