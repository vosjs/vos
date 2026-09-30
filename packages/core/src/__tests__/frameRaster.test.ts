import { describe, expect, it } from 'vitest'
import { compileVosConfig } from '../compiler/compileVosConfig'
import type { VosConfigJson } from '../types/vosConfigJson'

// Text written in a frame (onFrame, a stack entry, a tween's onUpdate) is
// rasterized before that frame draws, so every capture of the frame, a still
// included, shows it.

const base: VosConfigJson = {
  version: 2,
  duration: 2,
  camera: { preset: 'fullscreen' },
  createContent: '(ctx) => ({ objects: [], refs: {} })',
  createTimeline:
    "(ctx, content, duration) => { const tl = ctx.gsap.timeline(); tl.to({}, { duration, ease: 'none' }); return tl; }",
}
const withText: VosConfigJson = {
  ...base,
  elements: [{ id: 't', type: 'text', content: 'Hi', position: 'center' }],
  onFrame:
    "(ctx) => { ctx.elements.get('t').props.content = String(Math.floor(ctx.time)) }",
}
const FLUSH =
  'elements.forEach((el) => { if (el.flushRaster) el.flushRaster(); });'

describe('the frame flushes element rasters before it draws', () => {
  it('flushes after onFrame and before the clear', () => {
    const code = compileVosConfig(withText)
    const loop = code.slice(code.indexOf('const renderFrame = () => {'))
    const onFrame = loop.indexOf('onFrame(context, content, deltaTime);')
    const flush = loop.indexOf(FLUSH)
    const clear = loop.indexOf('renderer.clear();')
    expect(onFrame).toBeGreaterThan(-1)
    expect(flush).toBeGreaterThan(onFrame)
    expect(clear).toBeGreaterThan(flush)
  })

  it('flushes for elements a tween drives, with no onFrame', () => {
    const code = compileVosConfig({
      ...withText,
      onFrame: undefined,
    })
    expect(code).toContain(FLUSH)
  })

  it('a program without elements emits nothing', () => {
    expect(compileVosConfig(base)).not.toContain('flushRaster')
  })
})
