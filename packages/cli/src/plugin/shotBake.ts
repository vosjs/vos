/**
 * The shot as an OBJECT: a full-bleed page capture padded with a
 * transparent margin, its corners rounded, a soft shadow under it, encoded
 * back to PNG. The image element the poster family binds carries none of
 * these (an engine ask), so the shot arrives already sitting on whatever
 * ground the template paints. Pure over decoded pixels; the blur is a
 * three-pass box blur (a gaussian to the eye) on the alpha mask.
 */
import { deflateSync } from 'node:zlib'
import type { Rgba } from './picture'

export interface BakeOptions {
  /** Transparent margin around the shot, as a fraction of its width (0.06). */
  margin?: number
  /** Corner radius as a fraction of the shot's width (0.014). */
  radius?: number
  /**
   * Shadow strength 0..1 (0.3); 0 = no shadow. Two layers share it: a
   * tight one at the edge and a wide one below, each at a low alpha, so
   * the shot reads as lifted rather than sitting in a dark pool.
   */
  shadow?: number
  /** The wide layer's blur radius as a fraction of the shot's width (0.05). */
  blur?: number
  /** The wide layer's offset downward as a fraction of the shot's width (0.02). */
  offsetY?: number
  /** A hairline around the shot, alpha 0..1 (0 = none), for light shots on light grounds. */
  hairline?: number
}

/** Box blur one channel of a w×h float plane, radius r, in place; three passes. */
function blurPlane(
  src: Float32Array,
  w: number,
  h: number,
  r: number,
  passes = 3,
) {
  if (r < 1) return
  const tmp = new Float32Array(src.length)
  for (let p = 0; p < passes; p++) {
    // horizontal
    for (let y = 0; y < h; y++) {
      let acc = 0
      const row = y * w
      for (let x = -r; x <= r; x++)
        acc += src[row + Math.min(w - 1, Math.max(0, x))]
      for (let x = 0; x < w; x++) {
        tmp[row + x] = acc / (2 * r + 1)
        const add = src[row + Math.min(w - 1, x + r + 1)]
        const sub = src[row + Math.max(0, x - r)]
        acc += add - sub
      }
    }
    // vertical
    for (let x = 0; x < w; x++) {
      let acc = 0
      for (let y = -r; y <= r; y++)
        acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x]
      for (let y = 0; y < h; y++) {
        src[y * w + x] = acc / (2 * r + 1)
        const add = tmp[Math.min(h - 1, y + r + 1) * w + x]
        const sub = tmp[Math.max(0, y - r) * w + x]
        acc += add - sub
      }
    }
  }
}

/** Coverage of a rounded rect at pixel (x, y) with 2x2 supersampling, 0..1. */
function roundedCoverage(
  x: number,
  y: number,
  rect: { x: number; y: number; w: number; h: number },
  r: number,
): number {
  let inside = 0
  for (const dy of [0.25, 0.75]) {
    for (const dx of [0.25, 0.75]) {
      const px = x + dx
      const py = y + dy
      if (
        px < rect.x ||
        py < rect.y ||
        px > rect.x + rect.w ||
        py > rect.y + rect.h
      )
        continue
      const cx = Math.min(Math.max(px, rect.x + r), rect.x + rect.w - r)
      const cy = Math.min(Math.max(py, rect.y + r), rect.y + rect.h - r)
      if ((px - cx) ** 2 + (py - cy) ** 2 <= r * r) inside++
    }
  }
  return inside / 4
}

/** Pad, round and shadow a shot. The output is RGBA with a transparent margin. */
export function bakeShot(shot: Rgba, opts: BakeOptions = {}): Rgba {
  const margin = Math.round(shot.w * (opts.margin ?? 0.06))
  const radius = shot.w * (opts.radius ?? 0.014)
  const shadowA = opts.shadow ?? 0.3
  const blur = Math.round(shot.w * (opts.blur ?? 0.05))
  const offsetY = Math.round(shot.w * (opts.offsetY ?? 0.02))
  const hair = opts.hairline ?? 0
  const w = shot.w + margin * 2
  const h = shot.h + margin * 2
  const out = new Uint8Array(w * h * 4)
  const rect = { x: margin, y: margin, w: shot.w, h: shot.h }

  if (shadowA > 0) {
    // Two layers: tight at the edge (a quarter of the blur, a fifth of the
    // offset, 0.4 of the strength) and wide below (0.6 of the strength).
    const layers: [number, number, number][] = [
      [Math.max(1, Math.round(blur / 4)), Math.round(offsetY / 5), 0.4],
      [blur, offsetY, 0.6],
    ]
    const acc = new Float32Array(w * h)
    for (const [lb, lo, share] of layers) {
      const mask = new Float32Array(w * h)
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const c = roundedCoverage(x, y - lo, rect, radius)
          if (c > 0) mask[y * w + x] = c
        }
      blurPlane(mask, w, h, Math.max(1, Math.round(lb / 2)))
      const a = shadowA * share
      // Layers composite over each other: 1 - (1-a1)(1-a2).
      for (let i = 0; i < w * h; i++)
        acc[i] = 1 - (1 - acc[i]) * (1 - mask[i] * a)
    }
    for (let i = 0; i < w * h; i++) {
      const a = acc[i]
      if (a <= 0.002) continue
      out[i * 4] = 0
      out[i * 4 + 1] = 0
      out[i * 4 + 2] = 0
      out[i * 4 + 3] = Math.round(a * 255)
    }
  }

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const cov = roundedCoverage(x, y, rect, radius)
      if (cov <= 0) continue
      const sx = Math.min(shot.w - 1, Math.max(0, x - margin))
      const sy = Math.min(shot.h - 1, Math.max(0, y - margin))
      const si = (sy * shot.w + sx) * 4
      const o = (y * w + x) * 4
      let r = shot.data[si]
      let g = shot.data[si + 1]
      let b = shot.data[si + 2]
      // A hairline at the edge: the outer 1.5 px darkened.
      if (hair > 0) {
        const edge = Math.min(
          x - rect.x,
          rect.x + rect.w - x,
          y - rect.y,
          rect.y + rect.h - y,
        )
        if (edge < 1.5) {
          r = Math.round(r * (1 - hair))
          g = Math.round(g * (1 - hair))
          b = Math.round(b * (1 - hair))
        }
      }
      // Composite the shot over whatever shadow lies under this pixel.
      const a = cov
      const ba = out[o + 3] / 255
      const outA = a + ba * (1 - a)
      const mix = (fg: number, bg: number) =>
        outA > 0 ? Math.round((fg * a + bg * ba * (1 - a)) / outA) : 0
      out[o] = mix(r, out[o])
      out[o + 1] = mix(g, out[o + 1])
      out[o + 2] = mix(b, out[o + 2])
      out[o + 3] = Math.round(outA * 255)
    }
  }
  return { w, h, data: out }
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
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i)
  out.set(body, 8)
  dv.setUint32(8 + body.length, crc32(out.subarray(4, 8 + body.length)))
  return out
}

/** Encode RGBA as an 8-bit truecolor-with-alpha PNG (the "up" filter per row). */
export function encodePng(img: Rgba): Uint8Array {
  const stride = img.w * 4
  const raw = new Uint8Array((stride + 1) * img.h)
  for (let y = 0; y < img.h; y++) {
    raw[y * (stride + 1)] = 2
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
