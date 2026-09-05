/**
 * The brand's MARK as a file: what `vos brand` recorded as `logoUrl` (and
 * its on-dark twin), fetched once into the take's `brand/` folder so the
 * render page can load it from the take server (the site's own URL rarely
 * carries a CORS header, and a cross-origin image taints the canvas), with
 * its aspect read from the bytes. The parsers are pure.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'

export type MarkExt = 'svg' | 'png' | 'webp' | 'jpg'

export interface BrandMark {
  /** The key the render page loads: a take-dir path like `/brand/mark.svg`. */
  key: string
  /** Width over height. */
  aspect: number
}

export interface BrandMarks {
  /** The mark for light grounds (BRAND.md `logoUrl`). */
  light: BrandMark | null
  /** The mark for dark grounds (BRAND.md `logoOnDarkUrl`). */
  dark: BrandMark | null
  /** What could not be fetched or read, in words. */
  notes: string[]
}

/** The file kind a mark URL or path names; null for anything else (an .ico, a data URL). */
export function markExtension(url: string): MarkExt | null {
  const m = /\.(svg|png|webp|jpe?g)(?:[?#]|$)/i.exec(url)
  if (!m) return null
  const e = m[1].toLowerCase()
  return e === 'jpeg' ? 'jpg' : (e as MarkExt)
}

/** Width over height from the bytes: an SVG's viewBox or width/height, a PNG's IHDR, a WebP's VP8/VP8L/VP8X header, a JPEG's SOF. Null when unreadable. */
export function imageAspect(bytes: Uint8Array, ext: MarkExt): number | null {
  if (ext === 'svg') {
    const head = new TextDecoder().decode(bytes.subarray(0, 4096))
    const vb =
      /viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(
        head,
      )
    if (vb) return ratio(+vb[1], +vb[2])
    const w = /<svg[^>]*\swidth\s*=\s*["']([\d.]+)/i.exec(head)
    const h = /<svg[^>]*\sheight\s*=\s*["']([\d.]+)/i.exec(head)
    if (w && h) return ratio(+w[1], +h[1])
    return null
  }
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (ext === 'png') {
    if (bytes.length < 24 || bytes[0] !== 0x89 || bytes[1] !== 0x50) return null
    return ratio(dv.getUint32(16), dv.getUint32(20))
  }
  if (ext === 'webp') {
    if (bytes.length < 30) return null
    const tag = String.fromCharCode(...bytes.subarray(12, 16))
    if (tag === 'VP8X')
      return ratio(
        1 + (dv.getUint32(24, true) & 0xffffff),
        1 + (dv.getUint32(27, true) & 0xffffff),
      )
    if (tag === 'VP8L') {
      const b = dv.getUint32(21, true)
      return ratio(1 + (b & 0x3fff), 1 + ((b >> 14) & 0x3fff))
    }
    if (tag === 'VP8 ')
      return ratio(
        dv.getUint16(26, true) & 0x3fff,
        dv.getUint16(28, true) & 0x3fff,
      )
    return null
  }
  if (ext === 'jpg') {
    let i = 2
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) return null
      const marker = bytes[i + 1]
      const len = dv.getUint16(i + 2)
      if (
        marker >= 0xc0 &&
        marker <= 0xcf &&
        marker !== 0xc4 &&
        marker !== 0xc8 &&
        marker !== 0xcc
      ) {
        return ratio(dv.getUint16(i + 7), dv.getUint16(i + 5))
      }
      i += 2 + len
    }
    return null
  }
  return null
}

function ratio(w: number, h: number): number | null {
  return w > 0 && h > 0 ? w / h : null
}

/**
 * Fetch the brand's marks into `<takeDir>/brand/` and read their aspects.
 * A role may be a URL or a path (relative to the take). Absent roles are
 * absent marks; a failed fetch or an unreadable file is a note, never an
 * error: the kit falls back to the wordmark in words.
 */
export async function fetchBrandMarks(
  takeDir: string,
  roles: Record<string, string> | null | undefined,
): Promise<BrandMarks> {
  const out: BrandMarks = { light: null, dark: null, notes: [] }
  if (!roles) return out
  const one = async (
    role: 'logoUrl' | 'logoOnDarkUrl',
    name: string,
  ): Promise<BrandMark | null> => {
    const src = (roles[role] ?? '').trim()
    if (!src) return null
    const ext = markExtension(src)
    if (!ext) {
      out.notes.push(
        `${role}: ${src} is not an svg, png, webp or jpg; the wordmark stands in`,
      )
      return null
    }
    let bytes: Uint8Array
    try {
      if (/^https?:/i.test(src)) {
        const res = await fetch(src)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        bytes = new Uint8Array(await res.arrayBuffer())
      } else {
        const file = isAbsolute(src) ? src : resolve(takeDir, src)
        if (!existsSync(file)) throw new Error('no such file')
        bytes = new Uint8Array(await readFile(file))
      }
    } catch (e) {
      out.notes.push(
        `${role}: ${src} could not be read (${e instanceof Error ? e.message : String(e)}); the wordmark stands in`,
      )
      return null
    }
    const aspect = imageAspect(bytes, ext)
    if (!aspect) {
      out.notes.push(
        `${role}: ${src} has no readable size; the wordmark stands in`,
      )
      return null
    }
    await mkdir(join(takeDir, 'brand'), { recursive: true })
    await writeFile(join(takeDir, 'brand', `${name}.${ext}`), bytes)
    return { key: `/brand/${name}.${ext}`, aspect }
  }
  out.light = await one('logoUrl', 'mark')
  out.dark = await one('logoOnDarkUrl', 'mark-on-dark')
  return out
}
