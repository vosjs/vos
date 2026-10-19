import { describe, expect, it } from 'vitest'
import { buildEncodePage } from '../encodePage'

const opts = {
  framesIndexUrl: 'http://127.0.0.1:1/t/x/frames.json',
  metaUrl: 'http://127.0.0.1:1/t/x/meta.json',
  framesBaseUrl: 'http://127.0.0.1:1/t/x/frames/',
  save: { method: 'POST' as const, url: 'http://127.0.0.1:1/t/x/save' },
}

describe('buildEncodePage', () => {
  it('imports mediabunny from esm.sh at the pinned version by default', () => {
    const html = buildEncodePage(opts)
    expect(html).toMatch(
      /import\("https:\/\/esm\.sh\/mediabunny@\d+\.\d+\.\d+\?target=es2022"\)/,
    )
  })

  it("imports mediabunny from the host's mirror when told", () => {
    const url =
      'https://assets.example/esm/mediabunny@1.55.7/dist/bundles/mediabunny.mjs'
    const html = buildEncodePage({ ...opts, mediabunnyUrl: url })
    expect(html).toContain(`import(${JSON.stringify(url)})`)
    expect(html).not.toContain('esm.sh')
  })
})
