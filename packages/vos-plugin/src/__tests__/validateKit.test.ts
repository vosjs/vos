import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { pngDimensions, sniffImage, validateKit } from '../validateKit'

/** A PNG whose header says w x h (the verifier reads only the IHDR). */
function pngHeader(w: number, h: number): Buffer {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const ihdr = Buffer.alloc(25)
  ihdr.writeUInt32BE(13, 0)
  ihdr.write('IHDR', 4, 'ascii')
  ihdr.writeUInt32BE(w, 8)
  ihdr.writeUInt32BE(h, 12)
  return Buffer.concat([sig, ihdr, Buffer.alloc(64)])
}

const webp = Buffer.concat([
  Buffer.from('RIFF', 'ascii'),
  Buffer.alloc(4),
  Buffer.from('WEBPVP8 ', 'ascii'),
  Buffer.alloc(32),
])

describe('pngDimensions / sniffImage', () => {
  it('reads the IHDR and names the bytes', () => {
    expect(pngDimensions(pngHeader(1280, 800))).toEqual({ w: 1280, h: 800 })
    expect(pngDimensions(webp)).toBeNull()
    expect(sniffImage(pngHeader(1, 1))).toBe('png')
    expect(sniffImage(webp)).toBe('webp')
    expect(sniffImage(Buffer.from([0xff, 0xd8, 0xff]))).toBe('jpeg')
  })
})

describe('validateKit', () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'vos-kit-'))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  async function kit(assets: unknown[]) {
    const p = join(dir, 'kit.json')
    await writeFile(p, JSON.stringify({ release: 'v1', assets }))
    return p
  }

  it('passes a kit whose files measure what the manifest and the spec say', async () => {
    const png = pngHeader(1280, 800)
    await writeFile(join(dir, 'cws-screenshot-1.png'), png)
    const p = await kit([
      {
        channel: 'cws',
        asset: 'screenshot',
        destination: 'cws-screenshot',
        path: 'media/kit/cws-screenshot-1.png',
        w: 1280,
        h: 800,
        bytes: png.length,
        seconds: null,
      },
    ])
    const v = await validateKit(p)
    expect(v.problems).toEqual([])
    expect(v.valid).toBe(true)
    expect(v.measured[0]).toMatchObject({ w: 1280, h: 800 })
  })

  it('catches the mislabelled image, the wrong size and the lying manifest', async () => {
    await writeFile(join(dir, 'og-card.png'), webp)
    const wrong = pngHeader(1200, 600)
    await writeFile(join(dir, 'cws-marquee.png'), wrong)
    const p = await kit([
      {
        channel: 'og',
        asset: 'card',
        destination: 'og-card',
        path: 'og-card.png',
        w: 1200,
        h: 630,
        bytes: webp.length,
        seconds: null,
      },
      {
        channel: 'cws',
        asset: 'marquee',
        destination: 'cws-marquee',
        path: 'cws-marquee.png',
        w: 1400,
        h: 560,
        bytes: wrong.length + 5,
        seconds: null,
      },
    ])
    const v = await validateKit(p)
    expect(v.valid).toBe(false)
    expect(v.problems.join('\n')).toMatch(/named \.png but its bytes are webp/)
    expect(v.problems.join('\n')).toMatch(
      /manifest says 1400x560, the file is 1200x600/,
    )
    expect(v.problems.join('\n')).toMatch(/spec wants 1400x560/)
    expect(v.problems.join('\n')).toMatch(
      /manifest says \d+ bytes, the file is/,
    )
  })

  it('names a missing file and a still-set below its count floor', async () => {
    const p = await kit([
      {
        channel: 'producthunt',
        asset: 'gallery',
        destination: 'producthunt-gallery',
        path: 'producthunt-gallery-1.png',
        w: 1270,
        h: 760,
        bytes: 1,
        seconds: null,
      },
    ])
    const v = await validateKit(p)
    expect(v.problems.join('\n')).toMatch(/is missing/)
    // A missing file is not counted toward the set, so the floor is unmet.
    expect(v.problems.join('\n')).not.toMatch(/spec wants 4-8/)
    const png = pngHeader(1270, 760)
    await writeFile(join(dir, 'producthunt-gallery-1.png'), png)
    const p2 = await kit([
      {
        channel: 'producthunt',
        asset: 'gallery',
        destination: 'producthunt-gallery',
        path: 'producthunt-gallery-1.png',
        w: 1270,
        h: 760,
        bytes: png.length,
        seconds: null,
      },
    ])
    const v2 = await validateKit(p2)
    expect(v2.problems.join('\n')).toMatch(/spec wants 4-8, the kit has 1/)
  })
})
