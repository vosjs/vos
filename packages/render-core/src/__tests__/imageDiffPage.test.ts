import { describe, expect, it } from 'vitest'
import { buildImageDiffPage } from '../imageDiffPage'

describe('buildImageDiffPage', () => {
  it('embeds both images and the completion contract', () => {
    const html = buildImageDiffPage({
      candidateUrl: 'data:image/webp;base64,AAAA',
      goldenUrl: 'data:image/webp;base64,BBBB',
    })
    expect(html).toContain('data:image/webp;base64,AAAA')
    expect(html).toContain('data:image/webp;base64,BBBB')
    // The supervisor's poll contract: __renderComplete with rms on success,
    // error on failure — and a size-mismatch guard before any pixel math.
    expect(html).toContain('__renderComplete')
    expect(html).toContain('rms')
    expect(html).toContain('size mismatch')
  })

  it('no input can close the script tag — < is unicode-escaped', () => {
    const html = buildImageDiffPage({
      candidateUrl: 'data:image/webp;base64,a"b</script>',
      goldenUrl: 'data:image/webp;base64,x',
    })
    expect(html).not.toContain('b</script>')
    expect(html).toContain('\\u003c/script>')
  })
})
