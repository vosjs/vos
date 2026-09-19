import { describe, expect, it } from 'vitest'
import { lintVosPostprocessing } from '../lint'
import type { VosConfigJson } from '../types'

const base: VosConfigJson = {
  version: 2,
  duration: 5,
  camera: { preset: 'perspective' },
  createContent: '() => ({ objects: [] })',
  createTimeline: '(ctx) => ctx.gsap.timeline()',
}

const withChain = (passes: unknown[]): VosConfigJson =>
  ({ ...base, postprocessing: passes }) as VosConfigJson

describe('lintVosPostprocessing', () => {
  it('says nothing about a config with no chain', () => {
    expect(lintVosPostprocessing(base)).toEqual([])
    expect(lintVosPostprocessing(withChain([]))).toEqual([])
  })

  it('accepts a chain terminated by the output pass', () => {
    expect(
      lintVosPostprocessing(
        withChain([
          { type: 'bloom' },
          { type: 'filmGrain' },
          { type: 'output' },
        ]),
      ),
    ).toEqual([])
  })

  it('flags a chain that never applies the output pass', () => {
    const issues = lintVosPostprocessing(
      withChain([{ type: 'bloom' }, { type: 'filmGrain' }]),
    )
    expect(issues.map((i) => i.rule)).toEqual(['missing-output'])
    expect(issues[0].chain).toBe('postprocessing')
    expect(issues[0].severity).toBe('warn')
    expect(issues[0].message).toContain('filmGrain')
  })

  it('flags an output pass that is not last', () => {
    const issues = lintVosPostprocessing(
      withChain([{ type: 'bloom' }, { type: 'output' }, { type: 'glitch' }]),
    )
    expect(issues.map((i) => i.rule)).toEqual(['output-not-last'])
    expect(issues[0].message).toContain('index 1 of 3')
  })

  it('lints the per-layer chain too, and names which chain it means', () => {
    const cfg = {
      ...base,
      postprocessing: [{ type: 'output' }],
      perLayerEffects: [{ type: 'dotScreen' }],
    } as unknown as VosConfigJson
    const issues = lintVosPostprocessing(cfg)
    expect(issues.map((i) => i.chain)).toEqual(['perLayerEffects'])
  })
})
