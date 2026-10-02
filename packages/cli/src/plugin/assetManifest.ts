/**
 * A program's declared files (`config.assets`) crossing to and from vos.so.
 *
 * On disk a manifest names files beside the config (`./logo.png`), so a
 * program renders offline and reads like the repository it lives in. On the
 * platform a manifest names hosted assets (`asset:<id>`), the one spelling
 * the platform resolves for every surface: a private file reaches a render
 * page, a remix brings its files along, and a file a program still plays is
 * never collected. A push is the crossing one way, `vos fetch --media` the
 * other; neither rewrites the other side's spelling in place.
 */
import { existsSync, readdirSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { hostedAssetId, manifestRefs } from '../programAssets'
import { downloadMedia, uploadDocRefs } from './media'
import type { DocMediaRef } from './media'
import type { UploadTarget } from './uploadAsset'

type Manifest = Record<string, { ref: string | string[] }>

const isUrl = (ref: string) => /^(https?:|data:|blob:)/.test(ref)

/** A deep copy of the manifest, so a caller's rewrite never reaches disk. */
function cloneManifest(config: Record<string, unknown>): Manifest {
  return JSON.parse(JSON.stringify(config.assets ?? {})) as Manifest
}

function setRef(
  manifest: Manifest,
  name: string,
  index: number | null,
  next: string,
): void {
  const decl = manifest[name]
  if (index === null) decl.ref = next
  else (decl.ref as string[])[index] = next
}

const where = (name: string, index: number | null) =>
  index === null ? `assets.${name}` : `assets.${name}[${index}]`

/**
 * Upload the manifest's local files and point every entry at its hosted
 * asset as `asset:<id>`; a hosted file spelled as a URL takes the same
 * spelling. `config.assets` is REPLACED on the object (the file on disk is
 * untouched), so everything composed from it afterwards carries the hosted
 * refs. Uploads are content-addressed: a re-push sends nothing.
 */
export async function uploadManifest(
  config: Record<string, unknown>,
  dir: string,
  target: UploadTarget,
  log: (line: string) => void,
): Promise<{ uploaded: number }> {
  const refs = manifestRefs(config)
  if (refs.length === 0) return { uploaded: 0 }
  const manifest = cloneManifest(config)
  const local: DocMediaRef[] = []
  for (const { name, index, ref } of refs) {
    const hosted = hostedAssetId(ref)
    if (hosted) {
      setRef(manifest, name, index, `asset:${hosted}`)
      continue
    }
    if (isUrl(ref)) continue
    const file = isAbsolute(ref) ? ref : resolve(dir, ref)
    local.push({
      where: where(name, index),
      // The upload helper reads keys against the directory.
      key: relative(dir, file),
      set: (url) => {
        const id = hostedAssetId(url)
        setRef(manifest, name, index, id ? `asset:${id}` : url)
      },
    })
  }
  await uploadDocRefs(local, dir, target, log)
  config.assets = manifest
  return { uploaded: local.length }
}

/** The manifest entries that are still files on this machine. */
export function localManifestRefs(config: Record<string, unknown>): string[] {
  return manifestRefs(config)
    .filter(({ ref }) => !isUrl(ref) && !hostedAssetId(ref))
    .map(({ name, index }) => where(name, index))
}

/**
 * Bring a fetched program's hosted files home: each `asset:<id>` lands as
 * `assets/<name>.<ext>` beside the config (the bytes choose the extension)
 * and its entry is re-pointed at that file. A file already there is kept.
 * Returns the rewritten manifest, or null when nothing in it is hosted.
 */
export async function pullManifest(
  ctx: { origin: string; key: string | null },
  dir: string,
  config: Record<string, unknown>,
  log: (line: string) => void,
): Promise<{ assets: Manifest; files: string[] } | null> {
  const hosted = manifestRefs(config).filter(({ ref }) => hostedAssetId(ref))
  if (hosted.length === 0) return null
  const manifest = cloneManifest(config)
  const files: string[] = []
  for (const { name, index, ref } of hosted) {
    const id = hostedAssetId(ref)!
    const stem = index === null ? name : `${name}-${index}`
    const present = existsSync(join(dir, 'assets'))
      ? readdirSync(join(dir, 'assets')).find(
          (f) => f === stem || f.startsWith(`${stem}.`),
        )
      : undefined
    let file: string
    if (present) {
      file = `assets/${present}`
    } else {
      const got = await downloadMedia(ctx, `/api/assets/${id}/file`, {
        dir,
        subdir: 'assets',
        stem,
        fallbackExt: '',
        describe: `${where(name, index)} (asset ${id})`,
        notFoundHint: 'a private file needs a content key of its owner',
      })
      file = got.file
      log(
        `  ${file} ← ${where(name, index)}, asset ${id} (${Math.round(got.bytes / 1024)} kB)`,
      )
    }
    files.push(file)
    setRef(manifest, name, index, `./${file}`)
  }
  return { assets: manifest, files }
}

const HOSTED_FILE_LITERAL =
  /(?:asset:|\/api\/assets\/)([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})/g
const FUNCTION_FIELDS = ['setup', 'createContent', 'createTimeline', 'onFrame']

/**
 * A hosted file named inside a function instead of in the manifest. The
 * platform cannot give a string in code a URL per surface, so the file does
 * not reach a render of a private program and does not follow a remix.
 * One line per function and file, in words that say the fix.
 */
export function hostedLiteralWarnings(
  config: Record<string, unknown>,
): string[] {
  const out: string[] = []
  const scan = (label: string, src: unknown) => {
    if (typeof src !== 'string') return
    const seen = new Set<string>()
    for (const m of src.matchAll(HOSTED_FILE_LITERAL)) {
      if (seen.has(m[1])) continue
      seen.add(m[1])
      out.push(
        `${label} names hosted file ${m[1]} in code. Declare it instead: "assets": { "name": { "ref": "asset:${m[1]}" } }, and read ctx.assets.name, so it loads on every render and follows a remix`,
      )
    }
  }
  for (const field of FUNCTION_FIELDS) scan(field, config[field])
  const stack = Array.isArray(config.stack) ? config.stack : []
  for (const entry of stack as Record<string, unknown>[]) {
    for (const field of ['setup', 'createContent', 'onFrame']) {
      scan(`stack.${String(entry.id)}.${field}`, entry[field])
    }
  }
  return out
}
