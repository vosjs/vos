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
import type { ProjectDoc } from '@vosso/studio-core'

export const MIC_NAME = 'mic.webm'
export const CAM_NAME = 'cam.webm'

const KEYS = [
  { key: 'videoKey', file: RECORDING_NAME },
  { key: 'micKey', file: MIC_NAME },
  { key: 'camKey', file: CAM_NAME },
] as const

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
  // The take-dir markers: meta.json and cursor.json live on the doc for a
  // hosted take; write them out so loadTake() recognizes the directory.
  const metaPath = join(dir, 'meta.json')
  if (!existsSync(metaPath)) await writeJson(metaPath, doc.source.meta, true)
  const cursorPath = join(dir, 'cursor.json')
  if (!existsSync(cursorPath)) await writeJson(cursorPath, doc.source.cursor)
  await writeFile(join(dir, 'doc.json'), JSON.stringify(doc, null, 2))
  return result
}
