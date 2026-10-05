/**
 * The files a program names OUTSIDE its manifest, made to cross too.
 *
 * A push used to carry two kinds of local file: the ones `config.assets`
 * declares and the ones a program document's layers key. A picture an
 * element names as `src`, a face in `config.fonts`, a path in `config.data`
 * went up as written, so every hosted page resolved it against its own
 * address and loaded that page instead of the file, with no word said.
 *
 * Now each is carried. An element's file and a font's file are LIFTED into
 * the manifest (the element then names `"$assets.<name>"`), so the one
 * manifest upload carries them and every surface resolves them the way it
 * resolves any declared file. A path in `data` is uploaded and rewritten to
 * the hosted file's path, which the platform already resolves per surface.
 * A path typed inside a function cannot be rewritten; it is said, with the
 * fix. Only the in-memory config changes; the files on disk keep their
 * paths.
 */
import { basename, extname, relative } from 'node:path'
import { existsSync, realpathSync } from 'node:fs'
import { localFile } from '../programAssets'
import type { DocMediaRef } from './media'

/**
 * A file on this machine, rather than something a hosted page loads as
 * written (a URL, a hosted file, a binding resolved later). A path that
 * starts with `/` is an app path on a hosted page, unless it names a file
 * on this disk, which is what an agent writing an absolute path meant.
 * Inline SVG markup is the picture itself, never a name.
 */
function isLocalName(value: string): boolean {
  if (/^(https?:|data:|blob:|asset:|media:)/.test(value)) return false
  if (value.startsWith('$')) return false
  if (value.startsWith('<svg') || value.startsWith('<?xml')) return false
  if (value.startsWith('/')) return existsSync(value)
  return true
}

/** The kinds of file a program draws with, by extension. */
const FILE_EXT =
  /\.(png|jpe?g|webp|gif|avif|svg|mp4|webm|mov|mp3|m4a|ogg|wav|flac|aac|glb|gltf|woff2?|ttf|otf|hdr|exr)$/i

type Manifest = Record<string, { ref: string | string[]; kind?: string }>

/** A manifest name from a file name: an identifier, unique in the manifest. */
function manifestName(file: string, taken: Set<string>): string {
  const stem =
    basename(file, extname(file))
      .replace(/[^A-Za-z0-9_]/g, '_')
      .replace(/^(?=[0-9])/, '_') || 'file'
  let name = stem
  for (let n = 2; taken.has(name); n++) name = `${stem}_${n}`
  taken.add(name)
  return name
}

/**
 * Lift the local files an element (`src`) or a font (`url`) names into the
 * manifest, and point them at it. Returns where each came from. A path that
 * leaves the program's directory is refused the way the manifest refuses
 * it; a path naming no file is left as is (the platform says so).
 */
export function liftNamedFiles(
  config: Record<string, unknown>,
  dir: string,
): string[] {
  const manifest = (config.assets ?? {}) as Manifest
  const taken = new Set(Object.keys(manifest))
  const lifted: string[] = []
  const lift = (where: string, value: unknown, kind?: string) => {
    if (typeof value !== 'string' || !value || !isLocalName(value)) return null
    const found = localFile(value, dir)
    if ('refused' in found) {
      if (found.refused.startsWith('which is outside')) {
        throw new Error(`${where} names ${value}, ${found.refused}`)
      }
      return null
    }
    const name = manifestName(value, taken)
    manifest[name] = kind ? { ref: value, kind } : { ref: value }
    lifted.push(`${where} → assets.${name}`)
    return `$assets.${name}`
  }
  const elements = Array.isArray(config.elements) ? config.elements : []
  elements.forEach((el, i) => {
    const e = el as Record<string, unknown>
    if (!e || e.type === 'text') return
    const next = lift(`elements[${i}].src`, e.src)
    if (next) e.src = next
  })
  const fonts = Array.isArray(config.fonts) ? config.fonts : []
  fonts.forEach((f, i) => {
    const font = f as Record<string, unknown>
    const next = lift(`fonts[${i}].url`, font?.url, 'font')
    if (next) font.url = next
  })
  if (lifted.length) config.assets = manifest
  return lifted
}

/**
 * The local files `config.data` names, as refs an uploader rewrites to the
 * hosted file's path. Only a string that IS a file beside the config with a
 * media extension: a word in `data` is text, not a path.
 */
export function localDataRefs(
  config: Record<string, unknown>,
  dir: string,
): DocMediaRef[] {
  const refs: DocMediaRef[] = []
  const root = realpathSync(dir)
  const walk = (value: unknown, where: string, set: (v: string) => void) => {
    if (typeof value === 'string') {
      if (!isLocalName(value) || !FILE_EXT.test(value)) return
      const found = localFile(value, dir)
      if ('refused' in found) return
      refs.push({ where, key: relative(root, found.file), set })
      return
    }
    if (Array.isArray(value)) {
      value.forEach((v, i) =>
        walk(v, `${where}[${i}]`, (next) => {
          value[i] = next
        }),
      )
      return
    }
    if (value && typeof value === 'object') {
      const obj = value as Record<string, unknown>
      for (const k of Object.keys(obj)) {
        walk(obj[k], `${where}.${k}`, (next) => {
          obj[k] = next
        })
      }
    }
  }
  walk(config.data, 'data', () => {})
  return refs
}

const FUNCTION_FIELDS = ['setup', 'createContent', 'createTimeline', 'onFrame']
const QUOTED = /(['"`])([^'"`\n]{1,200}?)\1/g

/**
 * A local file typed inside a function. Nothing can rewrite a string in
 * code, so no push carries it: one line per file, with the fix.
 */
export function codeFileWarnings(
  config: Record<string, unknown>,
  dir: string,
): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const scan = (label: string, src: unknown) => {
    if (typeof src !== 'string') return
    for (const m of src.matchAll(QUOTED)) {
      const value = m[2]
      if (seen.has(value) || !isLocalName(value) || !FILE_EXT.test(value)) {
        continue
      }
      if ('refused' in localFile(value, dir)) continue
      seen.add(value)
      out.push(
        `${label} names ${value} in code, which no push can carry. Declare it: "assets": { "name": { "ref": "${value}" } }, and read ctx.assets.name`,
      )
    }
  }
  for (const field of FUNCTION_FIELDS) scan(field, config[field])
  return out
}
