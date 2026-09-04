/**
 * `vos judge <kit.json> --against <manifest.json>`: the kit beside its
 * references, composed as sheets an agent (or a person) judges pairwise.
 * No model runs here: for every kit asset that has a reference of its
 * role, the verb writes two sheets (the asset left and right, so order
 * cannot bias the call), a rubric in words, and a verdict slot the judge
 * fills; a summary counts the wins. The reference set is the maker's own
 * (a private fixture folder with a manifest), never redistributed.
 */
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { DESTINATIONS } from '@vosjs/studio-core'
import { decodePng } from './picture'
import { encodePng } from './shotBake'
import type { Rgba } from './picture'
import type { KitRecord } from './validateKit'

export interface ReferenceAsset {
  id: string
  file: string
  /** What a kit asset matches on: a template family, a card genre, a video's first frame. */
  role: string
  genre: 'card' | 'video' | 'context' | 'screenshot'
  layout: string
  facts?: Record<string, unknown>
  rule: string
}

export interface ReferenceManifest {
  assets: ReferenceAsset[]
}

/** The rubric every sheet carries: the eight clip rules and the poster layout facts. */
export const RUBRIC = [
  'A plate, and room on it: the subject sits at 74 to 89% of the width with headroom; nobody bleeds a window on all four sides.',
  'The window is an object: rounded corners and a shadow with weight (a soft wide one on a light plate, a tight glow on a dark one).',
  'It enters: the first frame is not a static, centred, flat window (a tilt-in, a pull-out, a rise).',
  'The camera zooms to the affordance, holds through the response, and pulls out to show the consequence.',
  'Beats are cut at stillness; no wipes.',
  'Content is staged: real data, a populated state, never an empty canvas or a wallpaper.',
  'The cursor is a character: visible, smoothed, a press on click, never drifting through dead space.',
  'The last frame is a poster: a resolved state you could ship as the still.',
  'The message has its own column or its own frame; the headline is two to six words over up to three lines at about 40% of the height; the wordmark is anchored.',
  'The poster test: would you post this frame as a still, alone?',
  'The thumbnail test: does it read at half size?',
  'Name three ways this asset acknowledges THIS product (its data, its state, its brand), not a generic window.',
]

/** Which reference roles a kit asset can be judged against. */
export function rolesFor(asset: {
  destination?: string
  source?: string
  template?: string
  path: string
}): string[] {
  if ((asset.source === 'poster' || asset.source === 'stage') && asset.template)
    return [asset.template.replace(/-stage$/, '')]
  const spec = DESTINATIONS.find((d) => d.id === asset.destination)
  if (spec?.kind === 'video') {
    const portrait = spec.px.w < spec.px.h
    return portrait ? ['feature-clip', 'site-walkthrough'] : ['feature-clip', 'site-walkthrough', 'feature-clip-dark']
  }
  if (spec?.genre === 'card') return ['window-in-scene', 'card-on-gradient', 'framed-screenshot']
  if (spec?.genre === 'screenshot') return ['framed-screenshot', 'app-session']
  return []
}

/** Box-filter resample to `w`×`h` (a clean downscale; upscales bilinearly enough for a sheet). */
export function resample(img: Rgba, w: number, h: number): Rgba {
  const out = new Uint8Array(w * h * 4)
  const sx = img.w / w
  const sy = img.h / h
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor(y * sy)
    const y1 = Math.max(y0 + 1, Math.floor((y + 1) * sy))
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor(x * sx)
      const x1 = Math.max(x0 + 1, Math.floor((x + 1) * sx))
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      let n = 0
      for (let yy = y0; yy < y1 && yy < img.h; yy++) {
        for (let xx = x0; xx < x1 && xx < img.w; xx++) {
          const o = (yy * img.w + xx) * 4
          r += img.data[o]
          g += img.data[o + 1]
          b += img.data[o + 2]
          a += img.data[o + 3]
          n++
        }
      }
      const o = (y * w + x) * 4
      out[o] = n ? r / n : 0
      out[o + 1] = n ? g / n : 0
      out[o + 2] = n ? b / n : 0
      out[o + 3] = n ? a / n : 0
    }
  }
  return { w, h, data: out }
}

/**
 * Two pictures on one sheet at a common height with a gutter, on the
 * plate ground; `left` first. A thin band under each marks its side (a
 * dark band left, a light band right) so the order can be read back
 * without type.
 */
export function composeSheet(left: Rgba, right: Rgba, height = 540, gutter = 32): Rgba {
  const lw = Math.max(1, Math.round((left.w * height) / left.h))
  const rw = Math.max(1, Math.round((right.w * height) / right.h))
  const L = resample(left, lw, height)
  const R = resample(right, rw, height)
  const margin = 24
  const band = 8
  const w = margin * 2 + lw + gutter + rw
  const h = margin * 2 + height + band + 6
  const out = new Uint8Array(w * h * 4)
  for (let i = 0; i < w * h; i++) {
    out[i * 4] = 240
    out[i * 4 + 1] = 242
    out[i * 4 + 2] = 244
    out[i * 4 + 3] = 255
  }
  const blit = (src: Rgba, x0: number, y0: number) => {
    for (let y = 0; y < src.h; y++) {
      for (let x = 0; x < src.w; x++) {
        const si = (y * src.w + x) * 4
        const a = src.data[si + 3] / 255
        const o = ((y0 + y) * w + x0 + x) * 4
        for (let c = 0; c < 3; c++) out[o + c] = Math.round(src.data[si + c] * a + out[o + c] * (1 - a))
      }
    }
  }
  blit(L, margin, margin)
  blit(R, margin + lw + gutter, margin)
  const fill = (x0: number, x1: number, y0: number, y1: number, v: number) => {
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) {
        const o = (y * w + x) * 4
        out[o] = v
        out[o + 1] = v
        out[o + 2] = v
      }
  }
  fill(margin, margin + lw, margin + height + 6, margin + height + 6 + band, 40)
  fill(margin + lw + gutter, margin + lw + gutter + rw, margin + height + 6, margin + height + 6 + band, 200)
  return { w, h, data: out }
}

export interface JudgeSheet {
  asset: string
  reference: string
  /** The two sheets: A = asset left, B = reference left. */
  sheetA: string
  sheetB: string
  rubric: string
}

export interface JudgeResult {
  sheets: JudgeSheet[]
  skipped: string[]
  outDir: string
  verdictFile: string
}

/**
 * Compose the sheets for a kit against a manifest. For each still asset
 * with a reference of its role, the two orders and the rubric; the verdict
 * file is a JSON skeleton the judge fills (`win: true|false|null` per
 * sheet, with a reason) and `count.mjs` reads.
 */
export async function judgeKit(
  kitPath: string,
  manifestPath: string,
  outDir?: string,
): Promise<JudgeResult> {
  const kit = JSON.parse(await readFile(kitPath, 'utf8')) as KitRecord & {
    assets: (KitRecord['assets'][number] & { template?: string })[]
  }
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as ReferenceManifest
  const manifestDir = dirname(resolve(manifestPath))
  const kitDir = dirname(resolve(kitPath))
  const out = resolve(outDir ?? join(kitDir, 'judge'))
  await mkdir(out, { recursive: true })
  const sheets: JudgeSheet[] = []
  const skipped: string[] = []
  const refCache = new Map<string, Rgba | null>()
  const loadRef = async (file: string) => {
    if (refCache.has(file)) return refCache.get(file) ?? null
    const p = join(manifestDir, file)
    const img = existsSync(p) ? decodePng(new Uint8Array(await readFile(p))) : null
    refCache.set(file, img)
    return img
  }
  for (const a of kit.assets) {
    if (!/\.png$/i.test(a.path)) continue
    const file = isAbsolute(a.path) && existsSync(a.path) ? a.path : join(kitDir, a.path.split('/').pop() ?? a.path)
    const img = existsSync(file) ? decodePng(new Uint8Array(await readFile(file))) : null
    if (!img) {
      skipped.push(`${a.destination ?? a.path}: unreadable`)
      continue
    }
    const roles = rolesFor({ destination: a.destination, source: a.source, template: a.template, path: a.path })
    const ref = manifest.assets.find((r) => roles.includes(r.role) && r.genre !== 'context')
    if (!ref) {
      skipped.push(`${a.destination ?? a.path}: no reference of role ${roles.join('|') || '(none)'}`)
      continue
    }
    const refImg = await loadRef(ref.file)
    if (!refImg) {
      skipped.push(`${a.destination ?? a.path}: reference ${ref.file} unreadable`)
      continue
    }
    // A still set's members share a destination: the file's own stem is the id.
    const stem = (a.path.split('/').pop() ?? a.path).replace(/\.png$/i, '')
    const id = stem.replace(/[^A-Za-z0-9_-]+/g, '-') || a.destination || 'asset'
    const nameA = `${id}--A.png`
    const nameB = `${id}--B.png`
    await writeFile(join(out, nameA), encodePng(composeSheet(img, refImg)))
    await writeFile(join(out, nameB), encodePng(composeSheet(refImg, img)))
    const rubric = [
      `# ${id} against ${ref.id} (${ref.file})`,
      '',
      `Sheet A: the kit asset LEFT (dark band), the reference RIGHT (light band). Sheet B: the reverse.`,
      `Judge each sheet on its own, both orders, and write the verdict where the two agree; a disagreement is a tie.`,
      '',
      `## The reference`,
      ref.layout,
      ...(ref.facts ? ['', '```json', JSON.stringify(ref.facts, null, 2), '```'] : []),
      '',
      `Rule: ${ref.rule}`,
      '',
      '## The rubric',
      ...RUBRIC.map((r, i) => `${i + 1}. ${r}`),
      '',
      '## Verdict',
      'In judge.json: `win` true when the kit asset is at least as good as the reference on the rules that apply to its genre, false when it is worse, null for a tie; `reasons` names the rules by number.',
      '',
    ].join('\n')
    await writeFile(join(out, `${id}.md`), rubric)
    sheets.push({ asset: id, reference: ref.id, sheetA: nameA, sheetB: nameB, rubric: `${id}.md` })
  }
  const verdictFile = join(out, 'judge.json')
  if (!existsSync(verdictFile)) {
    await writeFile(
      verdictFile,
      JSON.stringify(
        {
          kit: kitPath,
          manifest: manifestPath,
          verdicts: sheets.map((s) => ({ asset: s.asset, reference: s.reference, A: null, B: null, win: null, reasons: [] })),
        },
        null,
        2,
      ),
    )
  }
  return { sheets, skipped, outDir: out, verdictFile }
}

/**
 * The win rate: a win counts one, a tie (`win: null` with reasons) counts a
 * half, the pairwise convention; a pair with no reasons was not judged and
 * does not count. Parity with the references is 0.5.
 */
export function winRate(
  verdicts: { win: boolean | null; reasons?: number[] }[],
): { wins: number; ties: number; judged: number; rate: number | null } {
  const judgedList = verdicts.filter((v) => v.win !== null || (v.reasons?.length ?? 0) > 0)
  const wins = judgedList.filter((v) => v.win === true).length
  const ties = judgedList.filter((v) => v.win === null).length
  const judged = judgedList.length
  return { wins, ties, judged, rate: judged ? (wins + ties / 2) / judged : null }
}
