import { deflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import {
  decodePng,
  differenceHash,
  edgeEnergy,
  hammingDistance,
  inkCoverage,
  lightness,
  measureStill,
} from '../picture'
import type { Rgba } from '../picture'

/** A raster to paint on, then encode as the PNG the decoder must read. */
function raster(w: number, h: number, fill: [number, number, number]): Rgba {
  const data = new Uint8Array(w * h * 4)
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = fill[0]
    data[i * 4 + 1] = fill[1]
    data[i * 4 + 2] = fill[2]
    data[i * 4 + 3] = 255
  }
  return { w, h, data }
}

function rect(img: Rgba, x: number, y: number, w: number, h: number, c: [number, number, number]) {
  for (let yy = y; yy < y + h; yy++)
    for (let xx = x; xx < x + w; xx++) {
      if (xx < 0 || yy < 0 || xx >= img.w || yy >= img.h) continue
      const o = (yy * img.w + xx) * 4
      img.data[o] = c[0]
      img.data[o + 1] = c[1]
      img.data[o + 2] = c[2]
    }
}

const crcTable = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()
function crc32(buf: Uint8Array): number {
  let c = 0xffffffff
  for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function chunk(type: string, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + body.length)
  const dv = new DataView(out.buffer)
  dv.setUint32(0, body.length)
  out.set([...type].map((ch) => ch.charCodeAt(0)), 4)
  out.set(body, 8)
  dv.setUint32(8 + body.length, crc32(out.subarray(4, 8 + body.length)))
  return out
}

/** Encode RGBA as an 8-bit truecolor+alpha PNG with the "up" filter on every row. */
function encodePng(img: Rgba): Uint8Array {
  const stride = img.w * 4
  const raw = new Uint8Array((stride + 1) * img.h)
  for (let y = 0; y < img.h; y++) {
    raw[y * (stride + 1)] = 2 // up
    for (let i = 0; i < stride; i++) {
      const cur = img.data[y * stride + i]
      const up = y ? img.data[(y - 1) * stride + i] : 0
      raw[y * (stride + 1) + 1 + i] = (cur - up) & 255
    }
  }
  const ihdr = new Uint8Array(13)
  const dv = new DataView(ihdr.buffer)
  dv.setUint32(0, img.w)
  dv.setUint32(4, img.h)
  ihdr[8] = 8
  ihdr[9] = 6
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', new Uint8Array(deflateSync(raw))),
    chunk('IEND', new Uint8Array(0)),
  ]
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}

/** A card on a plate, with a shadow band under it and some "ink" inside. */
function cardOnPlate(): Rgba {
  const img = raster(400, 200, [240, 242, 244])
  rect(img, 40, 60, 320, 130, [220, 220, 220]) // shadow-ish band spills below
  rect(img, 40, 40, 320, 140, [255, 255, 255]) // the card
  for (let i = 0; i < 12; i++) rect(img, 60 + i * 24, 70 + (i % 3) * 30, 14, 10, [30, 30, 30])
  return img
}

describe('decodePng', () => {
  it('round-trips an 8-bit RGBA PNG through every filter the encoder used', () => {
    const src = cardOnPlate()
    const img = decodePng(encodePng(src))
    expect(img).not.toBeNull()
    expect(img!.w).toBe(400)
    expect(img!.h).toBe(200)
    expect(Array.from(img!.data)).toEqual(Array.from(src.data))
  })

  it('refuses what is not a readable PNG rather than guessing', () => {
    expect(decodePng(new Uint8Array([1, 2, 3]))).toBeNull()
    expect(decodePng(new Uint8Array(Buffer.from('RIFF....WEBP', 'ascii')))).toBeNull()
  })
})

describe('measureStill', () => {
  it('reads the ground, the card, its width, padding and the shadow band', () => {
    const m = measureStill(cardOnPlate())
    expect(m.ground).toBe('#f0f2f4')
    expect(m.card).not.toBeNull()
    expect(m.widthPct).toBeCloseTo(0.8, 1)
    expect(m.pad!.left).toBeCloseTo(0.1, 1)
    expect(m.bleed).toEqual([])
    expect(m.separation).toBeGreaterThan(2)
    expect(m.ink).toBeGreaterThan(0.02)
  })

  it('a full-bleed frame bleeds on all four sides with no shadow to read', () => {
    const img = raster(300, 150, [10, 10, 60])
    for (let i = 0; i < 40; i++) rect(img, (i * 37) % 290, (i * 53) % 140, 6, 6, [240, 240, 255])
    rect(img, 0, 0, 4, 4, [240, 240, 255])
    rect(img, 296, 146, 4, 4, [240, 240, 255])
    const m = measureStill(img)
    expect(m.bleed.sort()).toEqual(['bottom', 'left', 'right', 'top'])
    expect(m.shadow).toBeNull()
  })
})

describe('ink, hashes and edges', () => {
  it('a blank panel reads near zero ink; a populated one reads well above', () => {
    const blank = raster(200, 100, [250, 250, 250])
    expect(inkCoverage(blank, { x: 0, y: 0, w: 200, h: 100 })).toBe(0)
    const busy = raster(200, 100, [250, 250, 250])
    for (let i = 0; i < 30; i++) rect(busy, (i * 13) % 190, (i * 29) % 90, 10, 8, [20, 20, 20])
    expect(inkCoverage(busy, { x: 0, y: 0, w: 200, h: 100 })).toBeGreaterThan(0.08)
  })

  it('two crops of one picture hash alike; a different picture does not', () => {
    const a = cardOnPlate()
    const b = cardOnPlate()
    rect(b, 300, 150, 60, 30, [90, 120, 200]) // a small change in one corner
    const c = raster(400, 200, [240, 242, 244])
    for (let i = 0; i < 40; i++) rect(c, (i * 31) % 380, (i * 47) % 180, 18, 12, [40, 40, 40])
    const ha = differenceHash(a)
    expect(hammingDistance(ha, differenceHash(b))).toBeLessThanOrEqual(6)
    expect(hammingDistance(ha, differenceHash(c))).toBeGreaterThan(10)
  })

  it('edge energy falls when a fine texture is read at half size', () => {
    const fine = raster(400, 200, [255, 255, 255])
    for (let x = 0; x < 400; x += 2) rect(fine, x, 0, 1, 200, [0, 0, 0])
    expect(edgeEnergy(fine, 400)).toBeGreaterThan(edgeEnergy(fine, 100))
  })

  it('lightness is the CIE L* the separation check compares', () => {
    expect(lightness([255, 255, 255])).toBeCloseTo(100, 0)
    expect(lightness([0, 0, 0])).toBe(0)
    expect(lightness([240, 242, 244])).toBeGreaterThan(94)
  })
})
