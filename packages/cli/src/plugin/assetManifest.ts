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
import {
  existsSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { join, relative } from 'node:path'
import { hostedAssetId, localFile, manifestRefs } from '../programAssets'
import { downloadMedia, uploadDocRefs } from './media'
import type { DocMediaRef } from './media'
import type { UploadTarget } from './uploadAsset'

type Manifest = Record<string, { ref: string | string[] }>

const isUrl = (ref: string) => /^(https?:|data:|blob:)/.test(ref)

/** The origins whose `/api/assets/<id>/file` is a hosted file of ours. */
const homeOrigins = (origin: string) => [
  origin,
  'https://vos.so',
  'https://www.vos.so',
]

/** `assets/.hosted.json`: which hosted file each file brought home is. */
const HOME_INDEX = '.hosted.json'

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
    const hosted = hostedAssetId(ref, homeOrigins(target.origin))
    if (hosted) {
      setRef(manifest, name, index, `asset:${hosted}`)
      continue
    }
    if (isUrl(ref)) continue
    // A push uploads what the manifest names, so it holds the same line a
    // render does: only a file inside the program's own directory.
    const found = localFile(ref, dir)
    if ('refused' in found) {
      throw new Error(`${where(name, index)} names ${ref}, ${found.refused}`)
    }
    local.push({
      where: where(name, index),
      // The upload helper reads keys against the directory.
      key: relative(realpathSync(dir), found.file),
      set: (url) => {
        const id = hostedAssetId(url, homeOrigins(target.origin))
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
    .filter(({ ref }) => !isUrl(ref) && !hostedAssetId(ref, homeOrigins('')))
    .map(({ name, index }) => where(name, index))
}

/**
 * Bring a fetched program's hosted files home: each `asset:<id>` lands as
 * `assets/<name>.<ext>` beside the config (the bytes choose the extension)
 * and its entry is re-pointed at that file.
 *
 * A file already there is kept only when it IS that hosted file
 * (`assets/.hosted.json` remembers which id each one came from). Kept by
 * name alone, a second fetch after someone changed `logo` left the old
 * picture under the new manifest, and the next push stored the old one
 * again without a word.
 *
 * Returns the rewritten manifest, or null when nothing in it is hosted.
 */
export async function pullManifest(
  ctx: { origin: string; key: string | null },
  dir: string,
  config: Record<string, unknown>,
  log: (line: string) => void,
): Promise<{ assets: Manifest; files: string[] } | null> {
  const home = homeOrigins(ctx.origin)
  const hosted = manifestRefs(config).filter(({ ref }) =>
    hostedAssetId(ref, home),
  )
  if (hosted.length === 0) return null
  const manifest = cloneManifest(config)
  const indexPath = join(dir, 'assets', HOME_INDEX)
  let index: Record<string, string> = {}
  try {
    const parsed: unknown = JSON.parse(readFileSync(indexPath, 'utf8'))
    if (parsed && typeof parsed === 'object') {
      index = parsed as Record<string, string>
    }
  } catch {
    // no index yet: nothing here is known to be a hosted file
  }
  const files: string[] = []
  for (const { name, index: at, ref } of hosted) {
    const id = hostedAssetId(ref, home)!
    const stem = at === null ? name : `${name}-${at}`
    const known = Object.keys(index).find(
      (f) => f === stem || f.startsWith(`${stem}.`),
    )
    let file: string
    if (
      known &&
      index[known] === id &&
      existsSync(join(dir, 'assets', known))
    ) {
      file = `assets/${known}`
    } else {
      // A different hosted file under this name: the old copy goes first,
      // or a changed extension would leave both lying side by side.
      if (known) {
        rmSync(join(dir, 'assets', known), { force: true })
        delete index[known]
      }
      const got = await downloadMedia(ctx, `/api/assets/${id}/file`, {
        dir,
        subdir: 'assets',
        stem,
        fallbackExt: '',
        describe: `${where(name, at)} (asset ${id})`,
        notFoundHint: 'a private file needs a content key of its owner',
      })
      file = got.file
      index[file.slice('assets/'.length)] = id
      log(
        `  ${file} ← ${where(name, at)}, asset ${id} (${Math.round(got.bytes / 1024)} kB)`,
      )
    }
    files.push(file)
    setRef(manifest, name, at, `./${file}`)
  }
  writeFileSync(indexPath, JSON.stringify(index, null, 2) + '\n')
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
