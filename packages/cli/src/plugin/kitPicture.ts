/**
 * `vos validate <kit.json> --picture`: what each cut LOOKS like, read from
 * its bytes the way the spec pass reads its size. Every finding carries a
 * code, a severity, a message written from the failure it was built on and
 * a fix hint, so an agent can self-check by name and a reader can find the
 * spot.
 *
 *   firstlast   a video whose first or last frame is blank (a cold open on
 *               nothing, a clip that ends on nothing) or bled on all four
 *               sides (no ground, no room)
 *
 * The frames come through ffmpeg when it is on PATH and are skipped, said,
 * when it is not. Pure over decoded pixels otherwise.
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { decodePng, inkCoverage, measureStill } from './picture'
import type { Rect, Rgba, StillMeasure } from './picture'

const execFileP = promisify(execFile)

export type PictureCode = 'firstlast'

export interface PictureFinding {
  code: PictureCode
  severity: 'error' | 'warning' | 'info'
  /** The asset's destination id. */
  asset: string
  message: string
  fixHint: string
  /** Where, in pixels of the asset, when the finding has a place. */
  bbox?: Rect
}

export interface PictureAsset {
  destination: string
  path: string
  file: string
  seconds?: number | null
}

/** Ink coverage under which a frame's subject is blank. */
export const BLANK_INK = 0.12

const pct = (v: number) => `${Math.round(v * 100)}%`

/** One frame of a video through ffmpeg, as decoded pixels; null when unavailable. */
async function videoFrame(
  file: string,
  at: number,
  ffmpeg: string,
): Promise<Rgba | null> {
  try {
    const { stdout } = await execFileP(
      ffmpeg,
      [
        '-v',
        'error',
        '-ss',
        at.toFixed(3),
        '-i',
        file,
        '-frames:v',
        '1',
        '-f',
        'image2pipe',
        '-vcodec',
        'png',
        '-',
      ],
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

/** The checks on one frame of a cut; pure. */
export function frameFindings(
  asset: string,
  name: 'first' | 'last',
  img: Rgba,
  m: StillMeasure,
): PictureFinding[] {
  const out: PictureFinding[] = []
  const subject = m.card ?? { x: 0, y: 0, w: img.w, h: img.h }
  const ink = inkCoverage(img, subject)
  if (ink < BLANK_INK) {
    out.push({
      code: 'firstlast',
      severity: 'error',
      asset,
      message: `the ${name} frame is ${pct(ink)} ink: a ${name === 'first' ? 'cold open on nothing' : 'clip that ends on nothing'}`,
      fixHint:
        name === 'first'
          ? 'open on the product (trim the head, or an entrance over a populated frame)'
          : 'end on a resolved state or an end card',
    })
  }
  if (m.bleed.length === 4) {
    out.push({
      code: 'firstlast',
      severity: 'warning',
      asset,
      message: `the ${name} frame fills the frame on all four sides: no ground, no room`,
      fixHint:
        'present the cut in a look (vos deliver reads BRAND.md or --look)',
    })
  }
  return out
}

/**
 * Run the picture checks over a kit's cuts: each video's first and last
 * frame through ffmpeg. Returns the findings and, per asset, what was
 * measured on its first frame.
 */
export async function pictureChecks(assets: PictureAsset[]): Promise<{
  findings: PictureFinding[]
  measured: { destination: string; measure: StillMeasure | null }[]
}> {
  const findings: PictureFinding[] = []
  const measured: { destination: string; measure: StillMeasure | null }[] = []
  let ffmpeg: boolean | null = null

  for (const a of assets) {
    if (!/\.(mp4|webm|mov)$/i.test(a.file)) continue
    if (ffmpeg === null) ffmpeg = await onPath('ffmpeg')
    if (!ffmpeg) {
      findings.push({
        code: 'firstlast',
        severity: 'info',
        asset: a.destination,
        message:
          'ffmpeg is not on PATH, so the first and last frames were not read',
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
      if (name === 'first')
        measured.push({ destination: a.destination, measure: m })
      findings.push(...frameFindings(a.destination, name, img, m))
    }
  }
  const order: Record<PictureFinding['severity'], number> = {
    error: 0,
    warning: 1,
    info: 2,
  }
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
