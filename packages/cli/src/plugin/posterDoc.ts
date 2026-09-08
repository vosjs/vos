/**
 * POSTER DOCUMENTS beside a take. A poster is a plain take document (the
 * card placed by `frame.inset`, leaned by the tilt track, the words and the
 * mark as overlay clips, a trailing hold whose start is the still) that an
 * agent or the studio wrote and pushed; `vos deliver` RENDERS the ones it
 * finds and composes nothing. Found by aspect CLASS beside the take
 * (`poster/<class>/doc.json`, or `poster/doc.json` for every class), or
 * named in LAUNCH.md (`poster: <path>`, `poster-landscape: <path>`, …). A
 * path names a doc.json, or a take directory holding one (a pulled poster
 * take renders over its own footage; a bare doc.json renders over this
 * take's).
 *
 * The picture checks read the text boxes and the shot rect FROM THE
 * DOCUMENT, by the same layout the studio and the render use: the card
 * rect from `computeCardLayout`, the text boxes from `overlayRect` with an
 * estimating measure (no canvas here; the boxes are a fraction wide at
 * worst, which the checks tolerate). Pure except `findPosterDocs`.
 */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import {
  computeCardLayout,
  docStillTime,
  migrateHostedDoc,
  overlayRect,
  resolveOverlayStyle,
} from '@vosjs/studio-core'
import { readSyncState } from './platform'
import type { TextBox } from './kitPicture'
import type { ProjectDoc } from '@vosjs/studio-core'

export type PosterClass = 'landscape' | 'square' | 'portrait' | 'tile'
export const POSTER_CLASSES: PosterClass[] = [
  'landscape',
  'square',
  'portrait',
  'tile',
]

/** A destination under this long side is a tile: the subject large, few words. */
export const TILE_MAX_PX = 700

/** The aspect class a destination's pixels ask for. */
export function posterClassFor(px: { w: number; h: number }): PosterClass {
  if (Math.max(px.w, px.h) < TILE_MAX_PX) return 'tile'
  const r = px.w / Math.max(1, px.h)
  if (r < 0.87) return 'portrait'
  if (r <= 1.15) return 'square'
  return 'landscape'
}

export interface PosterRef {
  /** The class it serves. */
  cls: PosterClass
  /** The doc.json read. */
  file: string
  /** The take directory whose footage it renders over. */
  takeDir: string
  /** True when the poster is its own take directory (pulled with its footage). */
  ownFootage: boolean
  doc: ProjectDoc
  /** The hosted vos the poster tracks (its vos.json), when it does. */
  vosId?: string
  /** Where the reference came from, for the phase note. */
  from: string
}

const ROLE_ALL = 'poster'
const roleFor = (cls: PosterClass) => `poster-${cls}`

async function readPosterAt(
  cls: PosterClass,
  path: string,
  takeDir: string,
  from: string,
): Promise<PosterRef | null> {
  let file = path
  let docDir = path
  if (existsSync(join(path, 'doc.json'))) {
    file = join(path, 'doc.json')
  } else if (!/\.json$/i.test(path) || !existsSync(path)) {
    return null
  } else {
    docDir = resolve(path, '..')
  }
  let raw: unknown
  try {
    raw = JSON.parse(await readFile(file, 'utf8'))
  } catch {
    return null
  }
  if (!raw || typeof raw !== 'object') return null
  const source = (raw as { source?: { videoKey?: unknown } }).source
  if (!source || typeof source.videoKey !== 'string') return null
  const doc = migrateHostedDoc(
    raw as Record<string, unknown>,
  ) as unknown as ProjectDoc
  const ownFootage =
    existsSync(join(docDir, 'meta.json')) &&
    existsSync(join(docDir, source.videoKey))
  const sync = readSyncState(docDir)
  return {
    cls,
    file,
    takeDir: ownFootage ? docDir : takeDir,
    ownFootage,
    doc,
    ...(sync?.vosId ? { vosId: sync.vosId } : {}),
    from,
  }
}

/**
 * The poster document per class, from LAUNCH.md's roles first (a class
 * role over the all-classes role), then the folder convention beside the
 * take. A class with none is absent; the caller says so in words.
 */
export async function findPosterDocs(
  takeDir: string,
  launchRoles: Record<string, string> | null | undefined,
): Promise<Partial<Record<PosterClass, PosterRef>>> {
  const out: Partial<Record<PosterClass, PosterRef>> = {}
  const at = (p: string) => (isAbsolute(p) ? p : resolve(takeDir, p))
  for (const cls of POSTER_CLASSES) {
    const named = launchRoles?.[roleFor(cls)] ?? launchRoles?.[ROLE_ALL]
    const candidates: { path: string; from: string }[] = []
    if (named && !/^(none|off|no|false)$/i.test(named.trim())) {
      const role = launchRoles?.[roleFor(cls)] ? roleFor(cls) : ROLE_ALL
      candidates.push({ path: at(named.trim()), from: `LAUNCH.md ${role}` })
    }
    candidates.push({
      path: join(takeDir, 'poster', cls),
      from: `poster/${cls}`,
    })
    candidates.push({ path: join(takeDir, 'poster'), from: 'poster' })
    for (const c of candidates) {
      const ref = await readPosterAt(cls, c.path, takeDir, c.from)
      if (ref) {
        out[cls] = ref
        break
      }
    }
  }
  return out
}

/**
 * The still's OUTPUT time: the rest (where the last freeze begins), else
 * the footage's last frame (the last frame the card is on; past its clip
 * the card is gone, so the output's last frame may hold no card at all).
 */
export function posterStillTime(doc: ProjectDoc, duration: number): number {
  // One derivation with the shelf's cover and the stills export: the
  // author's still, else the document's own last freeze (the rest), else
  // the hero after the opening has entered.
  return Math.max(0, Math.min(duration, docStillTime(doc)))
}

const DESIGN_H = 1080

/** The design frame the document lays out on at the destination's aspect. */
function designFrame(px: { w: number; h: number }) {
  return {
    W: Math.max(2, Math.round((DESIGN_H * px.w) / Math.max(1, px.h))),
    H: DESIGN_H,
  }
}

/** Where the card sits, as fractions of the asset (a bleed runs past 1 or below 0). */
export function posterShotRect(
  doc: ProjectDoc,
  px: { w: number; h: number },
): { x: number; y: number; w: number; h: number } {
  const { W, H } = designFrame(px)
  const meta = doc.source.meta
  const layout = computeCardLayout(
    doc.frame,
    {
      width: meta.captureWidth ?? meta.width,
      height: meta.captureHeight ?? meta.height,
    },
    W,
    H,
  )
  const r3 = (v: number) => Math.round(v * 1000) / 1000
  return {
    x: r3(layout.cardX / W),
    y: r3(layout.cardY / H),
    w: r3(layout.cardW / W),
    h: r3(layout.cardH / H),
  }
}

/** An estimating text measure: no canvas here, so a glyph is ~0.55 em. */
function estimateWidth(text: string, font: string, letterSpacingPx = 0) {
  const m = /(\d+(?:\.\d+)?)px/.exec(font)
  const px = m ? Number(m[1]) : 32
  return text.length * (px * 0.55 + letterSpacingPx)
}

/**
 * The text boxes of the clips on screen at `time`, as fractions of the
 * asset, with the role and colour the contrast check reads.
 */
export function posterTextBoxes(
  doc: ProjectDoc,
  px: { w: number; h: number },
  time: number,
): TextBox[] {
  const { W, H } = designFrame(px)
  const out: TextBox[] = []
  for (const clip of doc.overlays ?? []) {
    if (clip.kind !== 'text') continue
    if (time < clip.start || time > clip.start + clip.duration) continue
    const rect = overlayRect(clip, estimateWidth, W, H)
    const style = resolveOverlayStyle(clip)
    const r3 = (v: number) => Math.round(v * 1000) / 1000
    out.push({
      x: r3((rect.cx - rect.w / 2) / W),
      y: r3((rect.cy - rect.h / 2) / H),
      w: r3(rect.w / W),
      h: r3(rect.h / H),
      role: clip.preset === 'title' ? 'headline' : 'body',
      label: clip.text.split('\n')[0].slice(0, 40),
      ...(/^#[0-9a-f]{6}$/i.test(style.color) ? { color: style.color } : {}),
    })
  }
  return out
}
