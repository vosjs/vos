/**
 * A pasted file travels with its take. A `paste` step names a file beside
 * the script (the take keeps it as `paste-<name>`), and the script rides
 * the pushed document (`source.script`), so a take fetched from vos.so came
 * home with a script naming a file that was not there: a re-record from
 * anywhere but the recording machine refused at its first paste.
 *
 * So `vos push` sends each paste file with the take and the document lists
 * them (`source.scriptFiles`: the name the script uses → where the bytes
 * are), and `vos fetch --media` / `vos pull --media` write each one back
 * beside `actions.json` under that name. A picture (PNG, JPEG, WebP, GIF,
 * SVG) rides the same upload door as every other file the document names;
 * a text file (words, HTML, JSON, CSV) is not a kind the platform stores,
 * so it rides inside the document as a `data:` address, at most
 * `SCRIPT_TEXT_MAX_BYTES`. A drag's path needs nothing of this: the
 * recorder writes its points inline into the take's script.
 *
 * Every name is a plain file name the script itself pastes, read from the
 * take directory or below (never through a link out of it), and written
 * back only where nothing is: a file on disk is the person's.
 */
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  fileNameProblem,
  pasteTypeOf,
  scriptFiles,
} from '@vosjs/render-core/record'
import { localFile } from '../programAssets'
import { assetIdOf, downloadPlan } from './media'
import { bearerFor } from './platform'
import { writeFileSafe } from './safeWrite'
import { uploadAsset } from './uploadAsset'
import type { UploadTarget } from './uploadAsset'
import type { ProjectDoc } from '@vosjs/studio-core'

/** The most bytes a pasted TEXT file carries inside a document. */
export const SCRIPT_TEXT_MAX_BYTES = 256 * 1024

/** The files a stored script pastes, by the plain name it uses, once each. */
export function pasteNames(script: unknown): string[] {
  if (!script || typeof script !== 'object') return []
  const steps = (script as { steps?: unknown }).steps
  if (!Array.isArray(steps)) return []
  const names = scriptFiles({ steps: steps as never })
    .filter((f) => f.as === 'paste')
    .map((f) => f.name)
  return [...new Set(names)]
}

/** A refusal the person can fix in the take: exit 2, said before any upload. */
export class PasteFileRefusal extends Error {}

/** A paste file found beside the take: its bytes, or why it is not there. */
type Found =
  | { name: string; bytes: Uint8Array; type: string }
  | { name: string; missing: true }

/**
 * Read every file the take's script pastes, before anything is sent. A
 * name that is not plain, or a file that resolves outside the take
 * directory (a link out of it), is REFUSED in words: the push would carry
 * bytes from somewhere the take does not hold. A file that is not there is
 * only missing (a take fetched before paste files travelled): said, and
 * the push goes on without it.
 */
export async function readPasteFiles(
  script: unknown,
  dir: string,
): Promise<Found[]> {
  const out: Found[] = []
  for (const name of pasteNames(script)) {
    const bad = fileNameProblem(name)
    if (bad)
      throw new PasteFileRefusal(
        `actions.json pastes "${name}", which ${bad.replace(/^"[^"]*" /, '')}: a pasted file sits beside the script, in the take directory`,
      )
    if (!existsSync(join(dir, name))) {
      out.push({ name, missing: true })
      continue
    }
    const local = localFile(name, dir)
    if ('refused' in local)
      throw new PasteFileRefusal(
        `actions.json pastes ${name}, which resolves outside the take directory (${dir}), so the push would send a file the take does not hold. Copy the file into the take as ${name} (not a link) and push again`,
      )
    out.push({
      name,
      bytes: new Uint8Array(await readFile(local.file)),
      type: pasteTypeOf(name) ?? 'application/octet-stream',
    })
  }
  return out
}

/** Bytes as a `data:` address of the given type. */
const dataUrl = (type: string, bytes: Uint8Array): string =>
  `data:${type};base64,${Buffer.from(bytes).toString('base64')}`

/**
 * Send the paste files with the take and list them on the document about
 * to be pushed (`source.scriptFiles`). A picture rides the upload door; a
 * text file rides the document. A missing file is said and left out, so
 * a re-record of the fetched take names what to put back.
 */
export async function sendPasteFiles(
  doc: ProjectDoc,
  found: Found[],
  target: UploadTarget,
  log: (line: string) => void,
): Promise<void> {
  const listed: Record<string, string> = {}
  // A file the take no longer holds but the document already lists (it
  // came with a fetch, and was moved aside since) keeps its listing.
  const prior = Object.fromEntries(listedFiles(doc))
  for (const f of found) {
    if ('missing' in f && prior[f.name]) {
      listed[f.name] = prior[f.name]
      log(`  pasted file ${f.name}: not in the take, kept as listed`)
      continue
    }
    if ('missing' in f) {
      log(
        `  warning: actions.json pastes ${f.name}, which is not in the take, so it does not travel with the push: a re-record of the pushed take needs it put beside actions.json again`,
      )
      continue
    }
    if (!f.type.startsWith('image/')) {
      if (f.bytes.length > SCRIPT_TEXT_MAX_BYTES)
        throw new PasteFileRefusal(
          `actions.json pastes ${f.name} (${Math.round(f.bytes.length / 1024)} kB), and a pasted text file rides inside the document, at most ${SCRIPT_TEXT_MAX_BYTES / 1024} kB: paste less, or paste the words as text in the step`,
        )
      listed[f.name] = dataUrl(f.type, f.bytes)
      log(`  pasted file ${f.name}: carried in the document`)
      continue
    }
    let put
    try {
      put = await uploadAsset(target, f.bytes, {
        filename: f.name,
        contentType: f.type,
        contentHash: createHash('sha256').update(f.bytes).digest('hex'),
      })
    } catch (e) {
      throw new Error(
        `pasted file ${f.name} upload failed: ${e instanceof Error ? e.message : String(e)}`,
      )
    }
    listed[f.name] = put.url
    log(
      `  pasted file ${f.name} → asset ${put.id}${put.reused ? ' (reused)' : ''}`,
    )
    for (const note of put.notes) log(`  pasted file ${f.name}: ${note}`)
  }
  if (Object.keys(listed).length) doc.source.scriptFiles = listed
  else delete doc.source.scriptFiles
}

/** The listed paste files a fetched document carries, read defensively. */
function listedFiles(doc: Pick<ProjectDoc, 'source'>): [string, string][] {
  const listed = doc.source.scriptFiles
  if (!listed || typeof listed !== 'object' || Array.isArray(listed)) return []
  return Object.entries(listed).filter(
    (e): e is [string, string] => typeof e[1] === 'string',
  )
}

/** A `data:` address's bytes, or null when it is not one this reads. */
function fromDataUrl(url: string): Uint8Array | null {
  const m = /^data:[^,;]*(;base64)?,(.*)$/s.exec(url)
  if (!m) return null
  return m[1]
    ? new Uint8Array(Buffer.from(m[2], 'base64'))
    : new TextEncoder().encode(decodeURIComponent(m[2]))
}

export interface PasteFilesPulled {
  /** Written beside actions.json, with where each came from. */
  written: { file: string; url: string; bytes: number }[]
  /** Already on disk, kept. */
  kept: string[]
  /** Every hosted one now beside the take, written or kept, and its address. */
  hosted: { file: string; url: string }[]
}

/**
 * Bring a fetched take's paste files home beside its script, under the
 * names the script pastes. Only a name the document's own script pastes
 * is written, only where nothing is, only from the platform's file door
 * (with the reader's key, sent home only) or a `data:` address. Anything
 * else the list names is said and skipped: a stranger's document does not
 * choose what this machine fetches or where it lands.
 */
export async function pullPasteFiles(
  ctx: { origin: string; key: string | null },
  dir: string,
  doc: Pick<ProjectDoc, 'source'>,
  log: (line: string) => void,
): Promise<PasteFilesPulled> {
  const result: PasteFilesPulled = { written: [], kept: [], hosted: [] }
  const wanted = new Set(pasteNames(doc.source.script))
  for (const [name, url] of listedFiles(doc)) {
    if (!wanted.has(name) || fileNameProblem(name)) {
      log(
        `  skipped ${JSON.stringify(name).slice(0, 80)}: the document lists it as a pasted file, and its script pastes no file by that name`,
      )
      continue
    }
    const path = join(dir, name)
    const door = assetIdOf(url) !== null
    if (existsSync(path)) {
      result.kept.push(name)
      if (door) result.hosted.push({ file: name, url })
      continue
    }
    let bytes: Uint8Array | null = null
    if (url.startsWith('data:')) bytes = fromDataUrl(url)
    else if (door) {
      const plan = downloadPlan(ctx, url)
      const res = await fetch(plan.url, {
        headers: plan.bearer ? bearerFor(ctx.key, plan.url) : {},
      })
      if (!res.ok)
        throw new Error(
          `download of the pasted file ${name} failed (${res.status})`,
        )
      bytes = new Uint8Array(await res.arrayBuffer())
    }
    if (!bytes) {
      log(
        `  skipped ${name}: the document names it at an address that is neither a hosted file nor carried in the document`,
      )
      continue
    }
    await writeFileSafe(path, bytes)
    result.written.push({ file: name, url, bytes: bytes.length })
    if (door) result.hosted.push({ file: name, url })
    log(`  ${name} ← the pasted file (${Math.round(bytes.length / 1024)} kB)`)
  }
  return result
}

/**
 * A claimable push carries the paste files it may name: a text file inside
 * the document, a picture this take fetched and left unchanged by its
 * hosted address. Anything else is said and left out, because a claimable
 * push uploads nothing.
 */
export async function claimablePasteFiles(
  doc: ProjectDoc,
  found: Found[],
  hosted: Record<string, { ref: string; sha256: string }>,
  log: (line: string) => void,
): Promise<void> {
  const listed: Record<string, string> = {}
  for (const f of found) {
    if ('missing' in f) continue
    if (!f.type.startsWith('image/')) {
      if (f.bytes.length <= SCRIPT_TEXT_MAX_BYTES)
        listed[f.name] = dataUrl(f.type, f.bytes)
      continue
    }
    const origin = hosted[f.name]
    const sha = createHash('sha256').update(f.bytes).digest('hex')
    if (origin && origin.sha256 === sha) listed[f.name] = origin.ref
    else
      log(
        `  note: the pasted file ${f.name} is not one this take fetched, and a claimable push uploads nothing, so it does not travel: a re-record of the claimed take needs it put back`,
      )
  }
  if (Object.keys(listed).length) doc.source.scriptFiles = listed
  else delete doc.source.scriptFiles
}
