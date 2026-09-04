/**
 * Picture primitives for the kit: what a still LOOKS like, measured from
 * its bytes, no browser and no model. A PNG decoder for the captures this
 * CLI writes (8-bit RGB/RGBA, non-interlaced; anything else reads as
 * unreadable rather than wrong), then the measurements the reference
 * assets were read with: the ground (the median of a border ring), the
 * card (the bounding box of what differs from the ground), the shadow (a
 * gradient band outside the card's bottom edge), ink coverage inside a
 * rect (how much of the card is content), and a difference hash so two
 * stills of one frame can be told apart from two frames.
 */
import { inflateSync } from 'node:zlib'

export interface Rgba {
  w: number
  h: number
  /** RGBA, row-major, 4 bytes per pixel. */
  data: Uint8Array
}

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

/**
 * Decode an 8-bit truecolor (with or without alpha) or greyscale
 * non-interlaced PNG. Returns null for anything else (palette, 16-bit,
 * interlaced): the picture checks then say "unreadable", never a wrong
 * number.
 */
export function decodePng(bytes: Uint8Array): Rgba | null {
  if (bytes.length < 33) return null
  for (let i = 0; i < 8; i++) if (bytes[i] !== PNG_SIG[i]) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let pos = 8
  let w = 0
  let h = 0
  let depth = 0
  let colorType = 0
  let interlace = 0
  const idat: Uint8Array[] = []
  while (pos + 8 <= bytes.length) {
    const len = view.getUint32(pos)
    const type = String.fromCharCode(
      bytes[pos + 4],
      bytes[pos + 5],
      bytes[pos + 6],
      bytes[pos + 7],
    )
    const start = pos + 8
    if (type === 'IHDR') {
      w = view.getUint32(start)
      h = view.getUint32(start + 4)
      depth = bytes[start + 8]
      colorType = bytes[start + 9]
      interlace = bytes[start + 12]
    } else if (type === 'IDAT') {
      idat.push(bytes.subarray(start, start + len))
    } else if (type === 'IEND') break
    pos = start + len + 4
  }
  if (!w || !h || depth !== 8 || interlace !== 0) return null
  const channels =
    colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 4 ? 2 : colorType === 0 ? 1 : 0
  if (!channels) return null
  const total = idat.reduce((n, c) => n + c.length, 0)
  const joined = new Uint8Array(total)
  let off = 0
  for (const c of idat) {
    joined.set(c, off)
    off += c.length
  }
  let raw: Uint8Array
  try {
    raw = new Uint8Array(inflateSync(joined))
  } catch {
    return null
  }
  const stride = w * channels
  if (raw.length < (stride + 1) * h) return null
  const out = new Uint8Array(w * h * 4)
  const prev = new Uint8Array(stride)
  const cur = new Uint8Array(stride)
  for (let y = 0; y < h; y++) {
    const filter = raw[y * (stride + 1)]
    const rowStart = y * (stride + 1) + 1
    for (let i = 0; i < stride; i++) {
      const x = raw[rowStart + i]
      const a = i >= channels ? cur[i - channels] : 0
      const b = prev[i]
      const c = i >= channels ? prev[i - channels] : 0
      let v: number
      switch (filter) {
        case 0:
          v = x
          break
        case 1:
          v = x + a
          break
        case 2:
          v = x + b
          break
        case 3:
          v = x + ((a + b) >> 1)
          break
        case 4: {
          const p = a + b - c
          const pa = Math.abs(p - a)
          const pb = Math.abs(p - b)
          const pc = Math.abs(p - c)
          v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)
          break
        }
        default:
          return null
      }
      cur[i] = v & 255
    }
    for (let px = 0; px < w; px++) {
      const o = (y * w + px) * 4
      const s = px * channels
      if (channels >= 3) {
        out[o] = cur[s]
        out[o + 1] = cur[s + 1]
        out[o + 2] = cur[s + 2]
        out[o + 3] = channels === 4 ? cur[s + 3] : 255
      } else {
        out[o] = out[o + 1] = out[o + 2] = cur[s]
        out[o + 3] = channels === 2 ? cur[s + 1] : 255
      }
    }
    prev.set(cur)
  }
  return { w, h, data: out }
}

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

const at = (img: Rgba, x: number, y: number): [number, number, number] => {
  const o = (y * img.w + x) * 4
  return [img.data[o], img.data[o + 1], img.data[o + 2]]
}

const median = (a: number[]) => {
  const s = [...a].sort((x, y) => x - y)
  return s[s.length >> 1] ?? 0
}

/** The ground: the per-channel median of a 1% border ring, as `#rrggbb`. */
export function groundColour(img: Rgba): [number, number, number] {
  const ring = Math.max(1, Math.round(Math.min(img.w, img.h) * 0.01))
  const r: number[] = []
  const g: number[] = []
  const b: number[] = []
  const step = Math.max(1, Math.round(Math.max(img.w, img.h) / 400))
  for (let y = 0; y < img.h; y += step) {
    for (let x = 0; x < img.w; x += step) {
      if (x < ring || y < ring || x >= img.w - ring || y >= img.h - ring) {
        const p = at(img, x, y)
        r.push(p[0])
        g.push(p[1])
        b.push(p[2])
      }
    }
  }
  return [median(r), median(g), median(b)]
}

export const hex = (c: [number, number, number]) =>
  '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('')

const delta = (p: [number, number, number], q: [number, number, number]) =>
  Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]) + Math.abs(p[2] - q[2])

/**
 * The card: the bounding box of pixels whose channel-sum delta from the
 * ground exceeds `threshold` (60, the reference measurement). Null when
 * nothing differs (a flat image). Sampled every other pixel.
 */
export function cardBounds(
  img: Rgba,
  ground: [number, number, number],
  threshold = 60,
): Rect | null {
  let x0 = img.w
  let y0 = img.h
  let x1 = -1
  let y1 = -1
  const step = Math.max(1, Math.round(Math.max(img.w, img.h) / 700))
  for (let y = 0; y < img.h; y += step) {
    for (let x = 0; x < img.w; x += step) {
      if (delta(at(img, x, y), ground) > threshold) {
        if (x < x0) x0 = x
        if (y < y0) y0 = y
        if (x > x1) x1 = x
        if (y > y1) y1 = y
      }
    }
  }
  if (x1 < 0) return null
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 }
}

/**
 * Shadow presence, read INWARD from the object's faint edge: a soft shadow
 * is a halo whose delta from the ground grows toward the card, so the band
 * nearer the card must read darker than the outer band (a card fill, a
 * hard edge or a flat plate read flat). Sides read are left, right and
 * bottom, wherever the object clears the frame; the reading is the nearer
 * band's delta, else 0. Null when no side has room.
 */
export function haloReading(
  img: Rgba,
  ground: [number, number, number],
  card: Rect,
): number | null {
  const band = Math.max(2, Math.round(Math.min(img.w, img.h) * 0.012))
  const meanRect = (x0: number, y0: number, x1: number, y1: number) => {
    let sum = 0
    let n = 0
    const sx = Math.max(1, Math.round((x1 - x0) / 60))
    const sy = Math.max(1, Math.round((y1 - y0) / 60))
    for (let y = Math.max(0, y0); y < Math.min(img.h, y1); y += sy) {
      for (let x = Math.max(0, x0); x < Math.min(img.w, x1); x += sx) {
        sum += delta(at(img, x, y), ground)
        n++
      }
    }
    return n ? sum / n : 0
  }
  // Two bands, not three: the innermost band would reach the card's own
  // fill, which on a light card is LIGHTER than the halo and breaks the
  // rise. A halo is present when the band nearer the card is darker than
  // the outer one by a clear step and the outer one is not the ground.
  const rise = (bands: [number, number, number]) => {
    const [outer, mid] = bands
    return outer >= 3 && mid - outer >= 1.5 ? mid : 0
  }
  const readings: number[] = []
  const yA = card.y + card.h * 0.2
  const yB = card.y + card.h * 0.8
  if (card.x >= 1 && card.w > band * 4) {
    const x0 = card.x
    readings.push(
      rise([
        meanRect(x0, yA, x0 + band, yB),
        meanRect(x0 + band, yA, x0 + band * 2, yB),
        meanRect(x0 + band * 2, yA, x0 + band * 3, yB),
      ]),
    )
  }
  if (card.x + card.w <= img.w - 1 && card.w > band * 4) {
    const x1 = card.x + card.w
    readings.push(
      rise([
        meanRect(x1 - band, yA, x1, yB),
        meanRect(x1 - band * 2, yA, x1 - band, yB),
        meanRect(x1 - band * 3, yA, x1 - band * 2, yB),
      ]),
    )
  }
  if (card.y + card.h <= img.h - 1 && card.h > band * 4) {
    const y1 = card.y + card.h
    const xA = card.x + card.w * 0.2
    const xB = card.x + card.w * 0.8
    readings.push(
      rise([
        meanRect(xA, y1 - band, xB, y1),
        meanRect(xA, y1 - band * 2, xB, y1 - band),
        meanRect(xA, y1 - band * 3, xB, y1 - band * 2),
      ]),
    )
  }
  return readings.length ? Math.max(...readings) : null
}

/**
 * A drawn edge at the object's boundary: the strongest single column
 * within the first 24 px inside the faint edge (the halo lies between the
 * faint edge and the card, so the hairline sits a few px in), as the
 * median delta from the ground along its height. A hairline, a browser bar or a dark card reads
 * high; a light fill against a light plate reads its own small tone step.
 */
export function edgeContrast(
  img: Rgba,
  ground: [number, number, number],
  card: Rect,
): number {
  const yA = Math.max(0, Math.round(card.y + card.h * 0.2))
  const yB = Math.min(img.h, Math.round(card.y + card.h * 0.8))
  // The MEDIAN of a column, not its mean: a drawn edge is dark along its
  // whole height, while a column through page content is mostly fill with
  // a few dark rows, which a mean would mistake for an edge.
  const col = (x: number) => {
    if (x < 0 || x >= img.w) return 0
    const ds: number[] = []
    const step = Math.max(1, Math.round((yB - yA) / 80))
    for (let y = yA; y < yB; y += step) ds.push(delta(at(img, x, y), ground))
    return median(ds)
  }
  const depth = Math.min(24, Math.floor(card.w / 8))
  let best = 0
  for (let d = 0; d < depth; d++) {
    best = Math.max(best, col(card.x + d), col(card.x + card.w - 1 - d))
  }
  return best
}

/**
 * Ink coverage inside a rect: the share of sampled pixels that differ from
 * the rect's own median colour by more than `threshold`. A populated page
 * reads 0.2 and up; a blank canvas, a wallpaper or a flat panel reads
 * under 0.1.
 */
export function inkCoverage(img: Rgba, rect: Rect, threshold = 48): number {
  const x0 = Math.max(0, Math.floor(rect.x))
  const y0 = Math.max(0, Math.floor(rect.y))
  const x1 = Math.min(img.w, Math.ceil(rect.x + rect.w))
  const y1 = Math.min(img.h, Math.ceil(rect.y + rect.h))
  if (x1 - x0 < 2 || y1 - y0 < 2) return 0
  const step = Math.max(1, Math.round(Math.max(x1 - x0, y1 - y0) / 300))
  const r: number[] = []
  const g: number[] = []
  const b: number[] = []
  const pts: [number, number, number][] = []
  for (let y = y0; y < y1; y += step) {
    for (let x = x0; x < x1; x += step) {
      const p = at(img, x, y)
      pts.push(p)
      r.push(p[0])
      g.push(p[1])
      b.push(p[2])
    }
  }
  const base: [number, number, number] = [median(r), median(g), median(b)]
  let ink = 0
  for (const p of pts) if (delta(p, base) > threshold) ink++
  return pts.length ? ink / pts.length : 0
}

/**
 * A 64-bit difference hash: the image reduced to 9x8 luma, each bit "is
 * this cell brighter than its right neighbour". Two crops of ONE frame at
 * different aspects still hash within a few bits of each other; two
 * frames of a moving page do not. Returned as a 16-hex string.
 */
export function differenceHash(img: Rgba, rect?: Rect): string {
  const r = rect ?? { x: 0, y: 0, w: img.w, h: img.h }
  const cols = 9
  const rows = 8
  const cell: number[] = []
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      const x0 = Math.floor(r.x + (cx * r.w) / cols)
      const x1 = Math.max(x0 + 1, Math.floor(r.x + ((cx + 1) * r.w) / cols))
      const y0 = Math.floor(r.y + (cy * r.h) / rows)
      const y1 = Math.max(y0 + 1, Math.floor(r.y + ((cy + 1) * r.h) / rows))
      let sum = 0
      let n = 0
      const sx = Math.max(1, Math.floor((x1 - x0) / 8))
      const sy = Math.max(1, Math.floor((y1 - y0) / 8))
      for (let y = y0; y < y1 && y < img.h; y += sy) {
        for (let x = x0; x < x1 && x < img.w; x += sx) {
          const p = at(img, Math.max(0, x), Math.max(0, y))
          sum += 0.299 * p[0] + 0.587 * p[1] + 0.114 * p[2]
          n++
        }
      }
      cell.push(n ? sum / n : 0)
    }
  }
  let bits = ''
  for (let cy = 0; cy < rows; cy++) {
    let byte = 0
    for (let cx = 0; cx < cols - 1; cx++) {
      const l = cell[cy * cols + cx]
      const rr = cell[cy * cols + cx + 1]
      byte = (byte << 1) | (l > rr ? 1 : 0)
    }
    bits += byte.toString(16).padStart(2, '0')
  }
  return bits
}

/** Bits that differ between two hashes of equal length. */
export function hammingDistance(a: string, b: string): number {
  let d = 0
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    let x = parseInt(a[i], 16) ^ parseInt(b[i], 16)
    while (x) {
      d += x & 1
      x >>= 1
    }
  }
  return d + Math.abs(a.length - b.length) * 4
}

/** Relative luminance 0..1 of an sRGB triple. */
export function luminance(c: [number, number, number]): number {
  const lin = (v: number) => {
    const s = v / 255
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2])
}

/** CIE L* (0..100) of an sRGB triple, for a card-vs-ground separation. */
export function lightness(c: [number, number, number]): number {
  const y = luminance(c)
  return y > 0.008856 ? 116 * Math.cbrt(y) - 16 : 903.3 * y
}

/** The median colour inside a rect (sampled). */
export function medianColour(img: Rgba, rect: Rect): [number, number, number] {
  const r: number[] = []
  const g: number[] = []
  const b: number[] = []
  const x0 = Math.max(0, Math.floor(rect.x))
  const y0 = Math.max(0, Math.floor(rect.y))
  const x1 = Math.min(img.w, Math.ceil(rect.x + rect.w))
  const y1 = Math.min(img.h, Math.ceil(rect.y + rect.h))
  const step = Math.max(1, Math.round(Math.max(x1 - x0, y1 - y0) / 200))
  for (let y = y0; y < y1; y += step) {
    for (let x = x0; x < x1; x += step) {
      const p = at(img, x, y)
      r.push(p[0])
      g.push(p[1])
      b.push(p[2])
    }
  }
  return [median(r), median(g), median(b)]
}

/**
 * Edge energy at a scale: the mean absolute luma step between horizontal
 * neighbours after downscaling the image so its width is `width` cells.
 * The half-size legibility rule compares the energy at full and at half
 * size: a tile that keeps most of its edges when shrunk still reads.
 */
export function edgeEnergy(img: Rgba, width: number): number {
  const cols = Math.max(2, Math.min(width, img.w))
  const rows = Math.max(2, Math.round((cols * img.h) / img.w))
  const lum: number[] = []
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      const x = Math.min(img.w - 1, Math.floor(((cx + 0.5) * img.w) / cols))
      const y = Math.min(img.h - 1, Math.floor(((cy + 0.5) * img.h) / rows))
      const p = at(img, x, y)
      lum.push(0.299 * p[0] + 0.587 * p[1] + 0.114 * p[2])
    }
  }
  let sum = 0
  let n = 0
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 1; cx < cols; cx++) {
      sum += Math.abs(lum[cy * cols + cx] - lum[cy * cols + cx - 1])
      n++
    }
  }
  return n ? sum / n : 0
}

/** Measure a still the way the reference assets were measured. */
export interface StillMeasure {
  w: number
  h: number
  ground: string
  card: Rect | null
  /** The card's width as a fraction of the frame. */
  widthPct: number | null
  /** Padding on each side as fractions of the frame. */
  pad: { left: number; right: number; top: number; bottom: number } | null
  /** Sides where the card runs to (or past) the frame edge (< 0.5% room). */
  bleed: ('left' | 'right' | 'top' | 'bottom')[]
  /** The shadow halo reading inward from the object's edge; null when no side clears the frame. */
  shadow: number | null
  /** The strongest drawn edge at the boundary (a hairline, a bar, a dark card). */
  edge: number
  /** Ink coverage inside the card (or the whole frame when no card). */
  ink: number
  /** L* difference between the card's median and the ground. */
  separation: number | null
  hash: string
}

export function measureStill(img: Rgba): StillMeasure {
  const g = groundColour(img)
  // Two thresholds: the STRONG box is the content (60, the reference
  // measurement); the FAINT box (12) is the object, halo and hairline
  // included, which is what a light card on a light plate needs to be
  // found by at all.
  const strong = cardBounds(img, g, 60)
  const faint = cardBounds(img, g, 12) ?? strong
  const card = faint
  const bleed: StillMeasure['bleed'] = []
  let pad: StillMeasure['pad'] = null
  let widthPct: number | null = null
  let shadow: number | null = null
  let edge = 0
  let separation: number | null = null
  if (card) {
    pad = {
      left: card.x / img.w,
      right: (img.w - card.x - card.w) / img.w,
      top: card.y / img.h,
      bottom: (img.h - card.y - card.h) / img.h,
    }
    for (const side of ['left', 'right', 'top', 'bottom'] as const)
      if (pad[side] < 0.005) bleed.push(side)
    widthPct = card.w / img.w
    shadow = haloReading(img, g, card)
    edge = edgeContrast(img, g, card)
    const body = strong ?? card
    const inner = {
      x: body.x + body.w * 0.1,
      y: body.y + body.h * 0.1,
      w: body.w * 0.8,
      h: body.h * 0.8,
    }
    separation = Math.abs(lightness(medianColour(img, inner)) - lightness(g))
  }
  const inkRect = strong ?? card ?? { x: 0, y: 0, w: img.w, h: img.h }
  return {
    w: img.w,
    h: img.h,
    ground: hex(g),
    card,
    widthPct,
    pad,
    bleed,
    shadow,
    edge,
    ink: inkCoverage(img, inkRect),
    separation,
    hash: differenceHash(img, inkRect),
  }
}
