import { describe, expect, it } from 'vitest'
import { imageAspect, markExtension } from '../markAsset'

const enc = (s: string) => new TextEncoder().encode(s)

describe('the brand mark file', () => {
  it('names the file kind from a URL or a path', () => {
    expect(markExtension('https://vos.so/mark.svg')).toBe('svg')
    expect(markExtension('https://cdn.acme.test/p/acme-wordmark.png?v=3')).toBe(
      'png',
    )
    expect(markExtension('brand/logo.JPEG')).toBe('jpg')
    expect(markExtension('https://acme.test/favicon.ico')).toBeNull()
  })

  it('reads an SVG aspect from the viewBox, then width and height', () => {
    expect(
      imageAspect(enc('<svg viewBox="0 0 48 48"><path/></svg>'), 'svg'),
    ).toBe(1)
    expect(
      imageAspect(enc('<svg xmlns="x" viewBox="0, 0, 300, 100"/>'), 'svg'),
    ).toBe(3)
    expect(imageAspect(enc('<svg width="200" height="50"/>'), 'svg')).toBe(4)
    expect(imageAspect(enc('<svg><rect/></svg>'), 'svg')).toBeNull()
  })

  it('reads a PNG aspect from its header', () => {
    const png = new Uint8Array(32)
    png.set([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48,
      0x44, 0x52,
    ])
    const dv = new DataView(png.buffer)
    dv.setUint32(16, 512)
    dv.setUint32(20, 128)
    expect(imageAspect(png, 'png')).toBe(4)
    expect(imageAspect(new Uint8Array(8), 'png')).toBeNull()
  })
})
