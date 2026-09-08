/**
 * A hosted take comes home: download the recording (and the
 * mic/cam sidecars when the doc carries them) beside a pulled doc.json, and
 * re-anchor the doc's keys to the local files, so `vos digest`, `frames` and
 * `render` run on a pulled take exactly as on a local one. Also writes the
 * take-dir markers (meta.json, cursor.json) from the doc when absent, so the
 * directory IS a take directory to every other verb.
 *
 * Same consent shape as the upload direction: nothing moves without the verb
 * the user ran (`--media`). A file already on disk is kept, never re-fetched.
 */
import { createWriteStream, existsSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { RECORDING_NAME, writeJson } from './take'
import type { ProjectDoc } from '@vosjs/studio-core'

export const MIC_NAME = 'mic.webm'
export const CAM_NAME = 'cam.webm'

const KEYS = [
  { key: 'videoKey', file: RECORDING_NAME },
  { key: 'micKey', file: MIC_NAME },
  { key: 'camKey', file: CAM_NAME },
] as const

/** A take-relative media key: neither a URL, a blob, nor a hosted asset path. */
export function isTakeRelativeKey(key: string | undefined): key is string {
  // `media:<id>` names a document media (a layer that shows one); the media
  // itself rides the recording door, so the reference is never a file.
  return (
    !!key &&
    !/^(https?:|blob:|data:|media:|\/\/)/.test(key) &&
    !key.startsWith('/api/')
  )
}

/** The file a take-relative key names, under the take directory. */
export const takeRelativeFile = (key: string): string => key.replace(/^\/+/, '')

export interface DocMediaRef {
  /** Where the key lives, in words (for a log line). */
  where: string
  key: string
  /** Replace the key in the document. */
  set: (next: string) => void
}

/**
 * Every media key a document carries beside its recording, mic and cam:
 * image and video overlay clips (a poster's mark), the end card's mark, a
 * background image or loop. The recording's own keys are `KEYS` and
 * handled by their own path. A push rehosts these; a pull brings them home.
 */
export function docMediaRefs(
  doc: ProjectDoc,
  keep: (key: string | undefined) => boolean = isTakeRelativeKey,
): DocMediaRef[] {
  const out: DocMediaRef[] = []
  // The take's OTHER media (concat): each recording, and its sidecars,
  // rides the recording door like the primary's; a pull brings them home.
  for (const m of doc.media ?? []) {
    if (keep(m.videoKey))
      out.push({
        where: `media ${m.id}`,
        key: m.videoKey,
        set: (next) => {
          m.videoKey = next
        },
      })
    const mic = m.micKey
    if (mic && keep(mic))
      out.push({
        where: `media ${m.id} mic`,
        key: mic,
        set: (next) => {
          m.micKey = next
        },
      })
    const cam = m.camKey
    if (cam && keep(cam))
      out.push({
        where: `media ${m.id} cam`,
        key: cam,
        set: (next) => {
          m.camKey = next
        },
      })
  }
  for (const clip of doc.overlays ?? []) {
    if (clip.kind === 'text' || !keep(clip.key)) continue
    out.push({
      where: `overlay ${clip.id}`,
      key: clip.key,
      set: (next) => {
        clip.key = next
      },
    })
  }
  const mark = doc.endCard?.mark
  if (mark && keep(mark.key))
    out.push({
      where: 'end card mark',
      key: mark.key,
      set: (next) => {
        mark.key = next
      },
    })
  const bg = doc.frame.backgroundMedia
  if (bg && keep(bg.key))
    out.push({
      where: 'background',
      key: bg.key,
      set: (next) => {
        bg.key = next
      },
    })
  return out
}

/** The content type a take-relative media file uploads as, by extension. */
export function mediaContentType(file: string): string {
  const ext = (/\.([a-z0-9]+)$/i.exec(file)?.[1] ?? '').toLowerCase()
  const types: Record<string, string> = {
    svg: 'image/svg+xml',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
    gif: 'image/gif',
    avif: 'image/avif',
    webm: 'video/webm',
    mp4: 'video/mp4',
    mov: 'video/quicktime',
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    ogg: 'audio/ogg',
    m4a: 'audio/mp4',
  }
  return types[ext] ?? 'application/octet-stream'
}

/** The extension a downloaded media file takes, from its content type. */
export function extensionFor(contentType: string): string {
  const t = contentType.split(';')[0].trim().toLowerCase()
  const exts: Record<string, string> = {
    'image/svg+xml': '.svg',
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/webp': '.webp',
    'image/gif': '.gif',
    'image/avif': '.avif',
    'video/webm': '.webm',
    'video/mp4': '.mp4',
    'video/quicktime': '.mov',
    'audio/mpeg': '.mp3',
    'audio/wav': '.wav',
    'audio/ogg': '.ogg',
    'audio/mp4': '.m4a',
  }
  return exts[t] ?? ''
}

/** An asset file URL (relative `/api/assets/{id}/file` or absolute). */
export function assetIdOf(url: string | undefined): string | null {
  if (!url) return null
  const m = /\/api\/assets\/([A-Za-z0-9_-]+)\/file/.exec(url)
  return m ? m[1] : null
}

export interface MediaPullResult {
  downloaded: { file: string; assetId: string; bytes: number }[]
  kept: string[]
}

export async function pullMedia(
  ctx: { origin: string; key: string | null },
  dir: string,
  doc: ProjectDoc,
  log: (line: string) => void,
): Promise<MediaPullResult> {
  const result: MediaPullResult = { downloaded: [], kept: [] }
  for (const { key, file } of KEYS) {
    const url = doc.source[key]
    const assetId = assetIdOf(url)
    if (!assetId) continue
    const target = join(dir, file)
    if (existsSync(target)) {
      result.kept.push(file)
    } else {
      const abs = /^https?:/.test(url!) ? url! : `${ctx.origin}${url}`
      const res = await fetch(abs, {
        headers: ctx.key ? { authorization: `Bearer ${ctx.key}` } : {},
      })
      if (!res.ok || !res.body) {
        throw new Error(
          `download of ${file} failed (${res.status})${
            res.status === 404
              ? ' — a private recording needs a content key of its owner'
              : ''
          }`,
        )
      }
      await pipeline(
        Readable.fromWeb(res.body as never),
        createWriteStream(target),
      )
      const bytes = (
        await import('node:fs/promises').then((fs) => fs.stat(target))
      ).size
      result.downloaded.push({ file, assetId, bytes })
      log(`  ${file} ← asset ${assetId} (${Math.round(bytes / 1024)} kB)`)
    }
    doc.source[key] = file
  }
  // The document's other media (a poster's mark, a pasted ground): a hosted
  // asset comes home under media/<assetId>.<ext> and the key re-anchors to
  // it, so the pulled poster renders and re-pushes as a whole.
  for (const ref of docMediaRefs(doc, (k) => assetIdOf(k) !== null)) {
    const assetId = assetIdOf(ref.key)!
    const abs = /^https?:/.test(ref.key) ? ref.key : `${ctx.origin}${ref.key}`
    const existing = existsSync(join(dir, 'media'))
      ? (
          await import('node:fs/promises').then((fs) =>
            fs.readdir(join(dir, 'media')),
          )
        ).find((f) => f.startsWith(`${assetId}.`))
      : undefined
    let file: string
    if (existing) {
      file = `media/${existing}`
      result.kept.push(file)
    } else {
      const res = await fetch(abs, {
        headers: ctx.key ? { authorization: `Bearer ${ctx.key}` } : {},
      })
      if (!res.ok || !res.body) {
        throw new Error(
          `download of ${ref.where} (${ref.key}) failed (${res.status})`,
        )
      }
      const ext = extensionFor(res.headers.get('content-type') ?? '')
      file = `media/${assetId}${ext}`
      const target = join(dir, file)
      await import('node:fs/promises').then((fs) =>
        fs.mkdir(join(dir, 'media'), { recursive: true }),
      )
      await pipeline(
        Readable.fromWeb(res.body as never),
        createWriteStream(target),
      )
      const bytes = (
        await import('node:fs/promises').then((fs) => fs.stat(target))
      ).size
      result.downloaded.push({ file, assetId, bytes })
      log(
        `  ${file} ← ${ref.where}, asset ${assetId} (${Math.round(bytes / 1024)} kB)`,
      )
    }
    ref.set(file)
  }
  // The take-dir markers: meta.json and cursor.json live on the doc for a
  // hosted take; write them out so loadTake() recognizes the directory.
  const metaPath = join(dir, 'meta.json')
  if (!existsSync(metaPath)) await writeJson(metaPath, doc.source.meta, true)
  const cursorPath = join(dir, 'cursor.json')
  if (!existsSync(cursorPath)) await writeJson(cursorPath, doc.source.cursor)
  await writeFile(join(dir, 'doc.json'), JSON.stringify(doc, null, 2))
  return result
}
