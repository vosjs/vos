import { describe, expect, it } from 'vitest'
import { ASSET_ROUTE } from '../programAssets'
import { previewPages } from '../render'

/**
 * `vos preview` serves a program's declared files itself, so the page it
 * hands the player bakes the served paths as the program's `ctx.assets`.
 */
const config = {
  version: 2,
  duration: 2,
  camera: { preset: 'fullscreen' },
  assets: {
    logo: { ref: './logo.png' },
    shots: { ref: ['./1.png', 'https://example.com/2.png'] },
  },
  createContent: '(ctx) => ({ objects: [], url: ctx.assets.logo })',
  createTimeline: '(ctx) => ctx.gsap.timeline({ paused: true })',
}

describe('previewPages with declared files', () => {
  it('bakes each served path, in the manifest order', () => {
    const logo = `${ASSET_ROUTE}aaaa/logo.png`
    const one = `${ASSET_ROUTE}bbbb/1.png`
    const { hostHtml } = previewPages(config, {
      assets: { logo, shots: [one, 'https://example.com/2.png'] },
      files: { [logo]: '/tmp/logo.png', [one]: '/tmp/1.png' },
    })
    // The code rides the host page as a JSON string, so quotes are escaped.
    expect(hostHtml).toContain(`\\"logo\\":\\"${logo}\\"`)
    expect(hostHtml).toContain(
      `\\"shots\\":[\\"${one}\\",\\"https://example.com/2.png\\"]`,
    )
    expect(hostHtml).not.toContain('./logo.png')
  })

  it('keeps the refs as written when nothing was resolved', () => {
    const { hostHtml } = previewPages(config)
    expect(hostHtml).toContain('\\"logo\\":\\"./logo.png\\"')
  })
})
