/**
 * `vos validate <kit.json> --picture`: what each asset LOOKS like, read
 * from its bytes the way the spec pass reads its size. Every finding
 * carries a code, a severity, a message written from the failure it was
 * built on, a fix hint and (where it has one) a box, so an agent can
 * self-check by name before it renders and a reader can find the spot.
 *
 * Checks, and the failure each was written from:
 *   blank       a card whose subject is under the ink floor (a wallpaper,
 *               an empty canvas)
 *   duplicate   two stills of one frame (a kit of eight crops of one frame)
 *   subject     the card's width off the band, or a card bled on all four
 *               sides where a card was asked for; a screenshot not full bleed
 *   separation  a light card on a light ground with no shadow and no edge
 *   halfsize    a tile that loses its edges at half size (the store rule)
 *   sliced      a text box crossing the frame edge (a headline cut mid-word)
 *   safe        a text box outside the destination's safe rect
 *   contrast    a text box under APCA Lc 60 (headline) / 75 (body)
 *   firstlast   a video whose first or last frame is blank or bled
 *
 * Text boxes come from the manifest (the poster leg records the element
 * layout it rendered), never from OCR: a take frame's page text is
 * unknown, so those three checks run only where the kit says where words
 * are. Pure over decoded pixels; the video frames come through ffmpeg
 * when it is on PATH and are skipped, said, when it is not.
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile } from 'node:fs/promises'
import {
  decodePng,
  edgeEnergy,
  hammingDistance,
  inkCoverage,
  measureStill,
  medianColour,
} from './picture'
import type { Rect, Rgba, StillMeasure } from './picture'
import type { Destination } from '@vosjs/studio-core'

const execFileP = promisify(execFile)

export type PictureCode =
  | 'blank'
  | 'duplicate'
  | 'subject'
  | 'separation'
  | 'halfsize'
  | 'sliced'
  | 'safe'
  | 'contrast'
  | 'firstlast'
  | 'unreadable'

export interface PictureFinding {
  code: PictureCode
  severity: 'error' | 'warning' | 'info'
  /** The asset's destination id (or ids, for a duplicate group). */
  asset: string
  message: string
  fixHint: string
  /** Where, in pixels of the asset, when the finding has a place. */
  bbox?: Rect
}

/** A text box the manifest records, as fractions of the asset. */
export interface TextBox {
  x: number
  y: number
  w: number
  h: number
  /** `#rrggbb` of the type, for the contrast check. */
  color?: string
  /** 'headline' (Lc 60) or 'body' (Lc 75); absent = headline. */
  role?: 'headline' | 'body'
  /** For the message. */
  label?: string
}

export interface PictureAsset {
  destination: string
  path: string
  file: string
  spec?: Pick<Destination, 'genre' | 'kind' | 'text' | 'safe' | 'px'>
  text?: TextBox[]
  seconds?: number | null
  /** The manifest says this screenshot kept the cut's camera and chrome. */
  composed?: boolean
  /**
   * A poster card's shot placement (fractions; a bleed runs past 1): the
   * composition is the template's, so the subject is the SHOT, and the
   * ground is designed rather than a plate to find a card on.
   */
  shot?: { x: number; y: number; w: number; h: number }
}

/** The band the reference assets were measured to. */
export const SUBJECT_BAND = { min: 0.6, max: 0.92 }
/** Ink coverage under which a card's subject is blank. */
export const BLANK_INK = 0.12
/** L* difference under which a card needs a shadow to sit. */
export const SEPARATION_L = 8
/** Shadow halo reading above which a shadow is present. */
export const SHADOW_PRESENT = 6
/** Edge contrast above which a drawn edge (a hairline, a bar) separates the card. */
export const EDGE_PRESENT = 40
/** Hamming bits under which two stills are one frame. */
export const DUPLICATE_BITS = 6
/** Edge energy kept at half size, below which a tile stops reading. */
export const HALFSIZE_KEEP = 0.45

/** APCA (W3 0.1.9) lightness contrast of text on a background, |Lc|. */
export function apcaContrast(
  text: [number, number, number],
  bg: [number, number, number],
): number {
  const lum = (c: [number, number, number]) => {
    const ch = (v: number) => Math.pow(v / 255, 2.4)
    let y = 0.2126729 * ch(c[0]) + 0.7151522 * ch(c[1]) + 0.072175 * ch(c[2])
    if (y < 0.022) y += Math.pow(0.022 - y, 1.414)
    return y
  }
  const yt = lum(text)
  const yb = lum(bg)
  if (Math.abs(yb - yt) < 0.0005) return 0
  let sapc: number
  if (yb > yt) {
    sapc = (Math.pow(yb, 0.56) - Math.pow(yt, 0.57)) * 1.14
    return sapc < 0.1 ? 0 : (sapc - 0.027) * 100
  }
  sapc = (Math.pow(yb, 0.65) - Math.pow(yt, 0.62)) * 1.14
  return sapc > -0.1 ? 0 : -(sapc + 0.027) * 100
}

const pct = (v: number) => `${Math.round(v * 100)}%`

const hexToRgb = (h: string): [number, number, number] | null => {
  const m = /^#([0-9a-f]{6})$/i.exec(h.trim())
  if (!m) return null
  const n = parseInt(m[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** The checks on one still's measurement; pure. */
export function stillFindings(
  a: PictureAsset,
  img: Rgba,
  m: StillMeasure,
): PictureFinding[] {
  const out: PictureFinding[] = []
  const genre = a.spec?.genre
  const bledAll = m.bleed.length === 4

  // A poster card: the subject is the shot the template placed. Its width
  // sits in the band (a bleed past the frame is a layout, so the ceiling
  // is loose), and the visible part of it carries ink.
  if (a.shot) {
    const sx = Math.max(0, a.shot.x) * img.w
    const sy = Math.max(0, a.shot.y) * img.h
    const sw = Math.min(1, a.shot.x + a.shot.w) * img.w - sx
    const sh = Math.min(1, a.shot.y + a.shot.h) * img.h - sy
    const rect = { x: sx, y: sy, w: Math.max(1, sw), h: Math.max(1, sh) }
    const ink = inkCoverage(img, rect)
    if (ink < BLANK_INK) {
      out.push({
        code: 'blank',
        severity: 'error',
        asset: a.destination,
        message: `${pct(ink)} ink inside the shot: the moment shows a wallpaper, an empty canvas or a flat panel`,
        fixHint: 'pick a moment after a gesture landed (--shot-time, or --times step:<id>) and stage the set before recording',
        bbox: rect,
      })
    }
    if (a.shot.w < 0.5 || a.shot.w > 1.2) {
      out.push({
        code: 'subject',
        severity: 'error',
        asset: a.destination,
        message: `the shot is ${pct(a.shot.w)} of the width; a card sits at 60 to 92%, a bleed a little past the edge`,
        fixHint: 'the template layout places the slot; fix its place for this aspect',
        bbox: rect,
      })
    }
    for (const f of textFindings(a, img)) out.push(f)
    return out
  }

  const subject = m.card ?? { x: 0, y: 0, w: img.w, h: img.h }
  if (m.ink < BLANK_INK) {
    out.push({
      code: 'blank',
      severity: 'error',
      asset: a.destination,
      message: `${pct(m.ink)} ink inside the ${m.card ? 'card' : 'frame'}: a wallpaper, an empty canvas or a flat panel, not the product doing something`,
      fixHint:
        'pick a moment after a gesture landed (--times step:<id>) and stage the set before recording: real data, a populated state',
      bbox: subject,
    })
  }

  if (genre === 'card') {
    if (bledAll || m.widthPct === null) {
      out.push({
        code: 'subject',
        severity: 'error',
        asset: a.destination,
        message: bledAll
          ? 'the picture fills the frame on all four sides: a crop, not a card on a ground'
          : 'no card found: the frame is one flat tone',
        fixHint:
          'present the card in a look (vos deliver reads BRAND.md or --look) or render this destination from a poster template',
      })
    } else if (m.widthPct < SUBJECT_BAND.min || m.widthPct > SUBJECT_BAND.max) {
      out.push({
        code: 'subject',
        severity: 'error',
        asset: a.destination,
        message: `the card is ${pct(m.widthPct)} of the width; the references sit at ${pct(SUBJECT_BAND.min)} to ${pct(SUBJECT_BAND.max)}`,
        fixHint: 'the look places the card at 84% (frame.inset); a poster template sets its own placement',
        bbox: m.card ?? undefined,
      })
    }
    if (m.card && !bledAll) {
      const sep = m.separation ?? 0
      const shadow = m.shadow ?? 0
      if (sep < SEPARATION_L && shadow < SHADOW_PRESENT && m.edge < EDGE_PRESENT) {
        out.push({
          code: 'separation',
          severity: 'error',
          asset: a.destination,
          message: `the card and the ground are ${sep.toFixed(1)} L* apart with no shadow halo (${shadow.toFixed(1)}) and no drawn edge (${m.edge.toFixed(0)}): the card dissolves into the plate`,
          fixHint:
            'a contact shadow (frame.shadowContact) plus a hairline (frame.border with borderColor) makes a light card sit on a light ground; the plate look sets both',
          bbox: m.card,
        })
      }
    }
  }

  // A page whose own margins are flat reads its content block as the
  // "card", and a page's tiles cast halos of their own, so the picture
  // alone cannot prove a screenshot was composed. The manifest can: the
  // deliver verb records `composed` on a screenshot it rendered with the
  // cut's camera and chrome, and that is what this reads.
  if (genre === 'screenshot' && a.composed && m.card && (m.widthPct ?? 0) < 0.98) {
    out.push({
      code: 'subject',
      severity: 'error',
      asset: a.destination,
      message: `a store screenshot must be the real page full bleed; this one shows a ${pct(m.widthPct ?? 0)} card on a ground`,
      fixHint: 'drop --composed: the screenshot genre renders the page with no chrome and no padding',
      bbox: m.card,
    })
  }

  if (img.w <= 500 && (a.spec?.text === 'none' || genre === 'card')) {
    const full = edgeEnergy(img, Math.min(img.w, 400))
    const half = edgeEnergy(img, Math.min(img.w, 400) >> 1)
    const keep = full > 0 ? half / full : 1
    if (keep < HALFSIZE_KEEP) {
      out.push({
        code: 'halfsize',
        severity: 'warning',
        asset: a.destination,
        message: `at half size the tile keeps ${pct(keep)} of its edges: fine text and thin lines vanish where the store shows it small`,
        fixHint:
          'a tile is the subject large and saturated with no text (the store rule); render it from the card-on-gradient template',
      })
    }
  }

  for (const f of textFindings(a, img)) out.push(f)
  return out
}

/** The word checks: sliced, safe, contrast, and words where none are wanted. */
function textFindings(a: PictureAsset, img: Rgba): PictureFinding[] {
  const out: PictureFinding[] = []
  for (const t of a.text ?? []) {
    const box: Rect = { x: t.x * img.w, y: t.y * img.h, w: t.w * img.w, h: t.h * img.h }
    const name = t.label ? `"${t.label}"` : 'a text box'
    if (box.x < 0 || box.y < 0 || box.x + box.w > img.w + 0.5 || box.y + box.h > img.h + 0.5) {
      out.push({
        code: 'sliced',
        severity: 'error',
        asset: a.destination,
        message: `${name} crosses the frame edge: cut mid-word`,
        fixHint: 'shorten the line, or let the template recompose (headline lines at 12 to 14% of the height, inside the safe rect)',
        bbox: box,
      })
    }
    const s = a.spec?.safe
    if (s) {
      const sx = s.x * img.w
      const sy = s.y * img.h
      const sw = s.w * img.w
      const sh = s.h * img.h
      if (box.x < sx - 0.5 || box.y < sy - 0.5 || box.x + box.w > sx + sw + 0.5 || box.y + box.h > sy + sh + 0.5) {
        out.push({
          code: 'safe',
          severity: 'warning',
          asset: a.destination,
          message: `${name} sits outside the destination's safe rect (${pct(s.w)}x${pct(s.h)} at ${pct(s.x)},${pct(s.y)}): the platform's chrome or crop covers it`,
          fixHint: 'move the text inside the safe rect; the template reads channel-specs safe',
          bbox: box,
        })
      }
    }
    const rgb = t.color ? hexToRgb(t.color) : null
    if (rgb) {
      const ground = medianColour(img, box)
      const lc = apcaContrast(rgb, ground)
      const floor = t.role === 'body' ? 75 : 60
      if (lc < floor) {
        out.push({
          code: 'contrast',
          severity: 'warning',
          asset: a.destination,
          message: `${name} reads APCA Lc ${lc.toFixed(0)} on its ground; ${t.role === 'body' ? 'body' : 'a headline'} wants ${floor}`,
          fixHint: 'darken the ink or lighten the ground under the text (BRAND.md ink on bgA/bgB, never on the shot)',
          bbox: box,
        })
      }
    }
  }
  if (a.spec?.text === 'none' && (a.text?.length ?? 0) > 0) {
    out.push({
      code: 'safe',
      severity: 'warning',
      asset: a.destination,
      message: 'this destination wants no text (the picture carries it alone) and the kit put words on it',
      fixHint: 'render the tile from the card-on-gradient template with no headline',
    })
  }
  return out
}

/**
 * Duplicate groups across a kit's stills, by difference hash of the
 * subject. Cards are compared with cards (eight covers of one frame is
 * the failure); a screenshot set is compared within its own destination
 * only, because two store galleries of one story legitimately share
 * frames. Two cards on one frame is a warning (X and LinkedIn often take
 * one image); three or more is an error.
 */
export function duplicateFindings(
  stills: {
    destination: string
    hash: string
    time: number | null
    genre?: 'screenshot' | 'card'
  }[],
): PictureFinding[] {
  const groups: { destination: string; time: number | null }[][] = []
  const seen = new Set<number>()
  const comparable = (a: (typeof stills)[number], b: (typeof stills)[number]) =>
    a.genre === 'screenshot' || b.genre === 'screenshot'
      ? a.destination === b.destination
      : true
  for (let i = 0; i < stills.length; i++) {
    if (seen.has(i)) continue
    const g = [stills[i]]
    for (let j = i + 1; j < stills.length; j++) {
      if (seen.has(j)) continue
      if (!comparable(stills[i], stills[j])) continue
      if (hammingDistance(stills[i].hash, stills[j].hash) <= DUPLICATE_BITS) {
        g.push(stills[j])
        seen.add(j)
      }
    }
    if (g.length > 1) groups.push(g)
  }
  return groups.map((g) => ({
    code: 'duplicate' as const,
    severity: g.length >= 3 ? ('error' as const) : ('warning' as const),
    asset: g.map((s) => s.destination).join(', '),
    message: `${g.length} assets share one frame${g[0].time !== null ? ` (${g[0].time.toFixed(2)}s)` : ''}: ${g.map((s) => s.destination).join(', ')}`,
    fixHint:
      'a kit is many moments: let deliver pick from the step timeline, or pass --times with one step per still; a poster template composes each card differently from one shot',
  }))
}

/** One frame of a video through ffmpeg, as decoded pixels; null when unavailable. */
async function videoFrame(
  file: string,
  at: number,
  ffmpeg: string,
): Promise<Rgba | null> {
  try {
    const { stdout } = await execFileP(
      ffmpeg,
      ['-v', 'error', '-ss', at.toFixed(3), '-i', file, '-frames:v', '1', '-f', 'image2pipe', '-vcodec', 'png', '-'],
      { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 },
    )
    return decodePng(new Uint8Array(stdout))
  } catch {
    return null
  }
}

/** Is a binary on PATH? */
async function onPath(bin: string): Promise<boolean> {
  try {
    await execFileP(bin, ['-version'])
    return true
  } catch {
    return false
  }
}

/**
 * Run the picture checks over a kit's assets. Stills decode from their
 * PNGs; videos read their first and last frame through ffmpeg. Returns the
 * findings and, per asset, what was measured.
 */
export async function pictureChecks(
  assets: PictureAsset[],
): Promise<{
  findings: PictureFinding[]
  measured: { destination: string; measure: StillMeasure | null }[]
}> {
  const findings: PictureFinding[] = []
  const measured: { destination: string; measure: StillMeasure | null }[] = []
  const stills: {
    destination: string
    hash: string
    time: number | null
    genre?: 'screenshot' | 'card'
  }[] = []
  let ffmpeg: boolean | null = null

  for (const a of assets) {
    if (/\.png$/i.test(a.file)) {
      const img = decodePng(new Uint8Array(await readFile(a.file)))
      if (!img) {
        findings.push({
          code: 'unreadable',
          severity: 'info',
          asset: a.destination,
          message: `${a.path} is not an 8-bit non-interlaced PNG; the picture checks cannot read it`,
          fixHint: 'render stills through vos deliver or vos frames, which write readable PNGs',
        })
        measured.push({ destination: a.destination, measure: null })
        continue
      }
      const m = measureStill(img)
      measured.push({ destination: a.destination, measure: m })
      findings.push(...stillFindings(a, img, m))
      if (a.spec?.kind !== 'video')
        stills.push({
          destination: a.destination,
          hash: m.hash,
          time: null,
          genre: a.spec?.genre,
        })
      continue
    }
    if (/\.(mp4|webm|mov)$/i.test(a.file)) {
      if (ffmpeg === null) ffmpeg = await onPath('ffmpeg')
      if (!ffmpeg) {
        findings.push({
          code: 'firstlast',
          severity: 'info',
          asset: a.destination,
          message: 'ffmpeg is not on PATH, so the first and last frames were not read',
          fixHint: 'install ffmpeg to have the video checks run',
        })
        measured.push({ destination: a.destination, measure: null })
        continue
      }
      const seconds = a.seconds ?? 0
      const first = await videoFrame(a.file, 0, 'ffmpeg')
      const last = await videoFrame(a.file, Math.max(0, seconds - 0.1), 'ffmpeg')
      for (const [name, img] of [
        ['first', first],
        ['last', last],
      ] as const) {
        if (!img) continue
        const m = measureStill(img)
        if (name === 'first') measured.push({ destination: a.destination, measure: m })
        const subject = m.card ?? { x: 0, y: 0, w: img.w, h: img.h }
        const ink = inkCoverage(img, subject)
        if (ink < BLANK_INK) {
          findings.push({
            code: 'firstlast',
            severity: 'error',
            asset: a.destination,
            message: `the ${name} frame is ${pct(ink)} ink: a ${name === 'first' ? 'cold open on nothing' : 'clip that ends on nothing'}`,
            fixHint:
              name === 'first'
                ? 'open on the product (trim the head, or an entrance over a populated frame)'
                : 'end on a resolved state or an end card (the last frame is the poster)',
          })
        }
        if (m.bleed.length === 4 && a.spec?.genre !== 'screenshot') {
          findings.push({
            code: 'firstlast',
            severity: 'warning',
            asset: a.destination,
            message: `the ${name} frame fills the frame on all four sides: no ground, no room`,
            fixHint: 'present the cut in a look (vos deliver reads BRAND.md or --look)',
          })
        }
      }
      continue
    }
  }
  findings.push(...duplicateFindings(stills))
  const order: Record<PictureFinding['severity'], number> = { error: 0, warning: 1, info: 2 }
  findings.sort((a, b) => order[a.severity] - order[b.severity])
  return { findings, measured }
}

/** One line per finding, the way the verb prints them. */
export function formatFinding(f: PictureFinding): string {
  const where = f.bbox
    ? ` @ ${Math.round(f.bbox.x)},${Math.round(f.bbox.y)} ${Math.round(f.bbox.w)}x${Math.round(f.bbox.h)}`
    : ''
  return `${f.severity} ${f.code} ${f.asset}${where}: ${f.message}\n    fix: ${f.fixHint}`
}
