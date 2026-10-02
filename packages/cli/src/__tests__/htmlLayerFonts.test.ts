/**
 * An HTML layer's own face, named by a .woff2 beside its document: the lint
 * takes it, a push uploads it like any layer file, and a local render
 * serves it to the page.
 */
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { lowerProgramDoc } from '@vosjs/studio-core'
import { docOverlayRefs } from '../plugin/media'
import { htmlFontUrlProblem } from '../plugin/validateDoc'
import { programAssets } from '../programAssets'

const CONFIG = {
  version: 2,
  duration: 4,
  camera: { preset: 'fullscreen' },
  createContent:
    '(ctx) => { const m = new ctx.THREE.Mesh(); ctx.scene.add(m); return { objects: [m] } }',
  createTimeline: '(ctx) => ctx.gsap.timeline({ paused: true })',
}

const htmlLayer = (url: string) => ({
  id: 'h1',
  kind: 'html' as const,
  start: 0,
  duration: 4,
  transform: { x: 0.5, y: 0.5, scale: 1 },
  html: '<div class="t">Hi</div>',
  css: ".t{font-family:'Brand'}",
  box: { width: 600, height: 200 },
  fonts: [{ family: 'Brand', url }],
})

describe("an HTML layer's own face", () => {
  it('the lint takes a URL, a hosted file and a woff2 beside the document', () => {
    for (const ok of [
      'https://example.com/Brand.woff2',
      '/api/assets/11111111-2222-3333-4444-555555555555/file',
      'fonts/Brand.woff2',
      'Brand.WOFF2',
    ]) {
      expect(htmlFontUrlProblem(ok), ok).toBeNull()
    }
  })

  it('and refuses, in words, what no page could embed', () => {
    expect(htmlFontUrlProblem('fonts/Brand.ttf')).toMatch(
      /embeds its faces as woff2/,
    )
    expect(htmlFontUrlProblem('../Brand.woff2')).toMatch(/outside the document/)
    expect(htmlFontUrlProblem('/Users/me/Brand.woff2')).toMatch(
      /must be an https URL/,
    )
    expect(htmlFontUrlProblem('data:font/woff2;base64,AA')).toMatch(/must be/)
  })

  it('a push walks it like any layer file and re-points it', () => {
    const doc = { overlays: [htmlLayer('fonts/Brand.woff2')] }
    const refs = docOverlayRefs(doc as never)
    expect(refs.map((r) => r.key)).toEqual(['fonts/Brand.woff2'])
    refs[0].set('/api/assets/abc/file')
    expect(doc.overlays[0].fonts[0].url).toBe('/api/assets/abc/file')
    // A face already hosted is left alone.
    expect(
      docOverlayRefs({
        overlays: [htmlLayer('https://example.com/Brand.woff2')],
      } as never),
    ).toEqual([])
  })

  it('a local render serves it to the page, under the lowered face', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vos-html-font-'))
    writeFileSync(join(dir, 'Brand.woff2'), 'wOF2')
    const config = lowerProgramDoc({
      program: { config: CONFIG },
      overlays: [htmlLayer('Brand.woff2')],
    } as never).config as Record<string, unknown>
    const got = await programAssets(config, { baseDir: dir, log: () => {} })
    expect(got).not.toBeNull()
    const served = Object.entries(got!.files)
    expect(served).toHaveLength(1)
    expect(served[0][1]).toMatch(/Brand\.woff2$/)
    const face = (
      config.stack as {
        data: { overlays: { html: { faces: { url: string }[] } }[] }
      }[]
    )[0].data.overlays[0].html.faces.find((f) => f.url === served[0][0])
    expect(face).toBeTruthy()
  })
})
