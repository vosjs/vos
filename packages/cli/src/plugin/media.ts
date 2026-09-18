import { isKeyedOverlay } from '@vosjs/studio-core'
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
import {
  mkdir,
  open,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { takeMediaFiles, writeJson } from './take'
import { MEDIA_HEAD_BYTES, extensionFor, resolveMediaType } from './container'
import type { ProjectDoc } from '@vosjs/studio-core'

/** The names the recorders write their sidecars under. */
export const MIC_NAME = 'mic.webm'
export const CAM_NAME = 'cam.webm'

/**
 * A take's own media: the stem each one lives under, and the container to
 * assume when the bytes that come back say nothing. The EXTENSION is not part
 * of the identity — a pulled recording wears whatever its hosted asset holds.
 */
const SOURCE_MEDIA = [
  { key: 'videoKey', stem: 'recording', fallbackExt: '.webm' },
  { key: 'micKey', stem: 'mic', fallbackExt: '.webm' },
  { key: 'camKey', stem: 'cam', fallbackExt: '.webm' },
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
    // An HTML layer has no key: its content IS its source, so there is no file
    // to walk, rewrite or bring home.
    if (!isKeyedOverlay(clip) || !keep(clip.key)) continue
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

// The extension↔type table and the byte sniffer live in `container.ts`; these
// stay the door every media caller already knows.
export { extensionFor, mediaContentType } from './container'

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

/** The first bytes of a file, enough for every container signature. */
export async function readMediaHead(file: string): Promise<Uint8Array> {
  const handle = await open(file, 'r')
  try {
    const buf = Buffer.alloc(MEDIA_HEAD_BYTES)
    const { bytesRead } = await handle.read(buf, 0, MEDIA_HEAD_BYTES, 0)
    return new Uint8Array(buf.subarray(0, bytesRead))
  } finally {
    await handle.close()
  }
}

interface DownloadTarget {
  dir: string
  /** Directory under the take dir, when the file is filed away. */
  subdir?: string
  /** The name without its extension — the extension is the BYTES' to choose. */
  stem: string
  /** The container to assume when the bytes say nothing. */
  fallbackExt: string
  /** What is being fetched, in words, for an error or a log line. */
  describe: string
  /** Added to a 404, where the reason is usually the credential. */
  notFoundHint?: string
}

/**
 * One media file, brought home under the name its BYTES earn.
 *
 * Streamed to a `.part` sibling first, then sniffed and renamed, so a take
 * never holds a file whose extension lies — whatever the server declared, and
 * whatever the hosted asset happened to be called. A push of a pulled take
 * re-uploads that file, so a wrong name here becomes a wrong Content-Type on
 * the asset, and a render that dies inside the video element.
 */
async function downloadMedia(
  ctx: { origin: string; key: string | null },
  url: string,
  target: DownloadTarget,
): Promise<{ file: string; bytes: number }> {
  const abs = /^https?:/.test(url) ? url : `${ctx.origin}${url}`
  const res = await fetch(abs, {
    headers: ctx.key ? { authorization: `Bearer ${ctx.key}` } : {},
  })
  if (!res.ok || !res.body) {
    throw new Error(
      `download of ${target.describe} failed (${res.status})${
        res.status === 404 && target.notFoundHint
          ? ` — ${target.notFoundHint}`
          : ''
      }`,
    )
  }
  const into = target.subdir ? join(target.dir, target.subdir) : target.dir
  const partial = join(into, `${target.stem}.part`)
  await mkdir(dirname(partial), { recursive: true })
  try {
    await pipeline(
      Readable.fromWeb(res.body as never),
      createWriteStream(partial),
    )
    const { type } = resolveMediaType({
      head: await readMediaHead(partial),
      declared: res.headers.get('content-type'),
      filename: `${target.stem}${target.fallbackExt}`,
    })
    const name = `${target.stem}${extensionFor(type) || target.fallbackExt}`
    await rename(partial, join(into, name))
    const file = target.subdir ? `${target.subdir}/${name}` : name
    return { file, bytes: (await stat(join(target.dir, file))).size }
  } finally {
    // A rename leaves nothing behind; a failed transfer must not.
    await rm(partial, { force: true })
  }
}

export async function pullMedia(
  ctx: { origin: string; key: string | null },
  dir: string,
  doc: ProjectDoc,
  log: (line: string) => void,
): Promise<MediaPullResult> {
  const result: MediaPullResult = { downloaded: [], kept: [] }
  for (const { key, stem, fallbackExt } of SOURCE_MEDIA) {
    const url = doc.source[key]
    const assetId = assetIdOf(url)
    if (!assetId) continue
    // A file already here is kept whatever container it wears, so a second
    // pull never re-fetches and never leaves two of the same footage.
    const present = takeMediaFiles(dir, stem)[0]
    if (present) {
      result.kept.push(basename(present))
      doc.source[key] = basename(present)
      continue
    }
    const got = await downloadMedia(ctx, url!, {
      dir,
      stem,
      fallbackExt,
      describe: stem,
      notFoundHint: 'a private recording needs a content key of its owner',
    })
    result.downloaded.push({ file: got.file, assetId, bytes: got.bytes })
    log(`  ${got.file} ← asset ${assetId} (${Math.round(got.bytes / 1024)} kB)`)
    doc.source[key] = got.file
  }
  // The document's other media (a poster's mark, a pasted ground): a hosted
  // asset comes home under media/<assetId>.<ext> and the key re-anchors to
  // it, so the pulled poster renders and re-pushes as a whole.
  for (const ref of docMediaRefs(doc, (k) => assetIdOf(k) !== null)) {
    const assetId = assetIdOf(ref.key)!
    const existing = existsSync(join(dir, 'media'))
      ? (await readdir(join(dir, 'media'))).find(
          (f) => f === assetId || f.startsWith(`${assetId}.`),
        )
      : undefined
    if (existing) {
      const file = `media/${existing}`
      result.kept.push(file)
      ref.set(file)
      continue
    }
    const got = await downloadMedia(ctx, ref.key, {
      dir,
      subdir: 'media',
      stem: assetId,
      // A type with no extension here (an svg served as such) keeps the bare
      // asset id, exactly as before.
      fallbackExt: '',
      describe: `${ref.where} (${ref.key})`,
    })
    result.downloaded.push({ file: got.file, assetId, bytes: got.bytes })
    log(
      `  ${got.file} ← ${ref.where}, asset ${assetId} (${Math.round(got.bytes / 1024)} kB)`,
    )
    ref.set(got.file)
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
