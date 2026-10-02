import { describe, expect, it } from 'vitest'
import { UsageError } from '../args'
import { outputSizeFor, RENDER_FALLBACK, STILL_FALLBACK } from '../outputSize'
import { previewPages } from '../render'

const portrait = { size: { width: 1080, height: 1920 } }

describe('outputSizeFor', () => {
  it('renders a program at its declared size by default', () => {
    expect(outputSizeFor(portrait, {}, RENDER_FALLBACK)).toMatchObject({
      width: 1080,
      height: 1920,
      source: 'declared',
    })
    expect(outputSizeFor(portrait, {}, STILL_FALLBACK)).toMatchObject({
      width: 1080,
      height: 1920,
    })
  })

  it('keeps the old defaults for a program that declares none', () => {
    expect(outputSizeFor({}, {}, RENDER_FALLBACK)).toMatchObject({
      width: 1920,
      height: 1080,
      source: 'default',
    })
    expect(outputSizeFor({}, {}, STILL_FALLBACK)).toMatchObject({
      width: 1280,
      height: 720,
    })
  })

  it('keeps the aspect when one edge is given', () => {
    expect(
      outputSizeFor(portrait, { height: '3840' }, RENDER_FALLBACK),
    ).toMatchObject({ width: 2160, height: 3840, source: 'derived' })
    expect(
      outputSizeFor(
        { size: { width: 1080, height: 1080 } },
        { width: '512' },
        STILL_FALLBACK,
      ),
    ).toMatchObject({ width: 512, height: 512 })
  })

  it('notes a render at another aspect than the declared one', () => {
    const r = outputSizeFor(
      portrait,
      { width: '1920', height: '1080' },
      RENDER_FALLBACK,
    )
    expect(r).toMatchObject({ width: 1920, height: 1080, source: 'flags' })
    expect(r.note).toMatch(/declares 1080x1920 \(9:16\)/)
    expect(
      outputSizeFor(portrait, { width: '540', height: '960' }, RENDER_FALLBACK)
        .note,
    ).toBeUndefined()
  })

  it('refuses a non-positive edge', () => {
    expect(() => outputSizeFor({}, { width: '0' }, RENDER_FALLBACK)).toThrow(
      UsageError,
    )
  })
})

describe('previewPages', () => {
  const config = {
    version: 2,
    duration: 2,
    camera: { preset: 'fullscreen' },
    createContent: '() => ({ objects: [] })',
    createTimeline: '(ctx) => ctx.gsap.timeline({ paused: true })',
  }
  it('letterboxes the player to a declared aspect', () => {
    const { hostHtml } = previewPages({ ...config, ...portrait })
    expect(hostHtml).toContain('calc(100vh * 1080 / 1920)')
    expect(hostHtml).toContain('calc(100vw * 1920 / 1080)')
  })
  it('fills the window when the program declares none', () => {
    const { hostHtml } = previewPages(config)
    expect(hostHtml).toContain('width:100%;height:100%')
  })
})
