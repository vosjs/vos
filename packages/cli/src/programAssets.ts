/**
 * The files a program declares (`config.assets`), for a LOCAL run of it.
 *
 * A capture page has an origin of its own, so a manifest entry that names a
 * file beside the config (`./logo.png`) or a hosted one (`asset:<id>`)
 * cannot be fetched from inside it as written. Each is made reachable here
 * and handed to the engine as the page's `ctx.assets`:
 *
 *  - a local file is SERVED to the page from disk, under a path on the
 *    page's own origin, so a video is streamed and never inlined;
 *  - a hosted asset is downloaded once with the caller's credential into a
 *    cache directory and served the same way;
 *  - a URL is used as it is.
 *
 * A file that cannot be reached keeps its ref and is said, so the render
 * shows a missing picture with a reason instead of a silent blank.
 */
import { createHash } from 'node:crypto'
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { extname, join, resolve, sep } from 'node:path'
import { extensionFor } from './plugin/container'

/** Where served files live on a page's own origin. */
export const ASSET_ROUTE = '/__assets/'

export interface ProgramAssetsOptions {
  /**
   * The program's directory: where the manifest's paths are read, and the
   * only place they may reach. Null for a config loaded from a URL, which
   * has no directory and reads no local file.
   */
  baseDir: string | null
  /** For a hosted ref: where it lives and who may read it. */
  origin?: string
  key?: string | null
  log: (line: string) => void
  /**
   * Where hosted files are kept between runs. Default `~/.cache/vos/assets`,
   * private to the user: a shared temp directory would leave a private
   * file readable by everyone else on the machine.
   */
  cacheDir?: string
}

export interface ProgramAssets {
  /** Name → the URL (or URLs) the page reads as `ctx.assets.<name>`. */
  assets: Record<string, string | string[]>
  /** Served path (`/__assets/…`) → the file on disk behind it. */
  files: Record<string, string>
}

const UUID = '[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}'
const HOSTED_URI = new RegExp(`^asset:(${UUID})$`)
const HOSTED_FILE = new RegExp(
  `^(https?://[^/?#]+)?/api/assets/(${UUID})/file(?:[?#].*)?$`,
)

/**
 * The hosted asset id a ref names, or null: `asset:<id>`, the app-relative
 * file path, or that path on one of `homeOrigins`. The same path on any
 * other host is someone else's URL and is left a URL: reading it as a
 * hosted file would name an asset that does not exist.
 */
export function hostedAssetId(
  ref: string,
  homeOrigins: readonly string[] = [],
): string | null {
  const uri = HOSTED_URI.exec(ref)
  if (uri) return uri[1]
  const file = HOSTED_FILE.exec(ref)
  if (!file) return null
  return file[1] === undefined || homeOrigins.includes(file[1]) ? file[2] : null
}

/** A manifest name: an identifier, as the engine's schema holds it. */
const ASSET_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/

/** The type a served file wears, by extension (never by its bytes here). */
const SERVED_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.avif': 'image/avif',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.json': 'application/json',
}

export interface ServedBytes {
  status: 200 | 206 | 416
  headers: Record<string, string>
  body: Buffer
}

/**
 * A declared file as an HTTP answer, honouring `Range`. A video element
 * seeks by range and hangs forever against a server that answers only
 * 200, so both the render page's route and the preview server answer
 * through here.
 */
export function serveFile(file: string, range?: string | null): ServedBytes {
  const size = statSync(file).size
  const type =
    SERVED_TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream'
  const base = { 'content-type': type, 'accept-ranges': 'bytes' }
  const read = (start: number, end: number): Buffer => {
    const body = Buffer.alloc(Math.max(0, end - start + 1))
    const fd = openSync(file, 'r')
    try {
      readSync(fd, body, 0, body.length, start)
    } finally {
      closeSync(fd)
    }
    return body
  }
  const m = range ? /^bytes=(\d*)-(\d*)$/.exec(range.trim()) : null
  if (!m || (m[1] === '' && m[2] === '')) {
    return {
      status: 200,
      headers: { ...base, 'content-length': String(size) },
      body: read(0, size - 1),
    }
  }
  // `bytes=-N` is the last N bytes; `bytes=A-` runs to the end.
  const start = m[1] === '' ? Math.max(0, size - Number(m[2])) : Number(m[1])
  const end =
    m[1] === '' || m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1)
  if (start >= size || start > end) {
    return {
      status: 416,
      headers: { ...base, 'content-range': `bytes */${size}` },
      body: Buffer.alloc(0),
    }
  }
  return {
    status: 206,
    headers: {
      ...base,
      'content-range': `bytes ${start}-${end}/${size}`,
      'content-length': String(end - start + 1),
    },
    body: read(start, end),
  }
}

/**
 * The file a manifest path names, when it is the program's to read.
 *
 * A program's functions run in a page, and whatever the page is served the
 * program can read and send anywhere. So a path is honoured only inside the
 * program's own directory (links resolved): a config from somewhere else
 * cannot name a key file or a `.env` two directories up and have a render
 * or a push carry it out. The cost is that a shared file has to be copied
 * (or the config moved up); the alternative is every config being able to
 * read the disk of whoever renders it.
 */
export function localFile(
  ref: string,
  baseDir: string | null,
): { file: string } | { refused: string } {
  if (baseDir === null) {
    return {
      refused:
        'a config loaded from a URL has no directory, so it reads no local file',
    }
  }
  const file = resolve(baseDir, ref)
  if (!existsSync(file) || !statSync(file).isFile()) {
    return { refused: 'which is not a file beside the config' }
  }
  const root = realpathSync(baseDir)
  const real = realpathSync(file)
  if (!real.startsWith(root + sep)) {
    return {
      refused: `which is outside the program's directory (${root}). A program reads only files in its own directory or below: copy the file there`,
    }
  }
  return { file: real }
}

/** A ref the page can fetch as written. */
function isUrl(ref: string): boolean {
  return /^(https?:|data:|blob:)/.test(ref)
}

function manifestOf(
  config: Record<string, unknown>,
): Record<string, { ref: string | string[] }> | null {
  const assets = config.assets
  if (!assets || typeof assets !== 'object' || Array.isArray(assets))
    return null
  return Object.keys(assets).length > 0
    ? (assets as Record<string, { ref: string | string[] }>)
    : null
}

/** Every ref of a manifest, in declaration order, with where it sits. */
export function manifestRefs(
  config: Record<string, unknown>,
): { name: string; index: number | null; ref: string }[] {
  const out: { name: string; index: number | null; ref: string }[] = []
  for (const [name, decl] of Object.entries(manifestOf(config) ?? {})) {
    // A name becomes a file name when the manifest's files come home, so
    // it is held to the engine's rule HERE, for a config that reached this
    // machine without passing a schema (a fetched document's own config).
    if (!ASSET_NAME.test(name) || !decl || typeof decl !== 'object') continue
    if (Array.isArray(decl.ref)) {
      decl.ref.forEach((ref, index) => {
        if (typeof ref === 'string') out.push({ name, index, ref })
      })
    } else if (typeof decl.ref === 'string') {
      out.push({ name, index: null, ref: decl.ref })
    }
  }
  return out
}

async function fetchHosted(
  id: string,
  opts: ProgramAssetsOptions,
): Promise<string | null> {
  const dir = opts.cacheDir ?? join(homedir(), '.cache', 'vos', 'assets')
  // A hosted file is immutable, so a finished copy is good forever. Only a
  // finished one: a download lands under `.part` and is renamed whole.
  const cached = existsSync(dir)
    ? readdirSync(dir).find(
        (f) => (f === id || f.startsWith(`${id}.`)) && !f.endsWith('.part'),
      )
    : undefined
  if (cached) return join(dir, cached)
  if (!opts.origin || !opts.key) {
    opts.log(
      `note: asset ${id} is hosted and no credential is set, so the render cannot load it (vos login, or keep the file beside the config and name its path)`,
    )
    return null
  }
  const res = await fetch(`${opts.origin}/api/assets/${id}/file`, {
    headers: { authorization: `Bearer ${opts.key}` },
  })
  if (!res.ok) {
    opts.log(
      `note: asset ${id} could not be read (${res.status}), so the render cannot load it`,
    )
    return null
  }
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  // The served type names the extension, so the page is told what it got.
  const type = (res.headers.get('content-type') ?? '').split(';')[0].trim()
  const file = join(dir, `${id}${extensionFor(type)}`)
  const partial = `${file}.part`
  try {
    writeFileSync(partial, new Uint8Array(await res.arrayBuffer()), {
      mode: 0o600,
    })
    renameSync(partial, file)
  } finally {
    rmSync(partial, { force: true })
  }
  return file
}

/**
 * The faces an HTML layer brings (`fonts` on the document, lowered into the
 * studio entry as `html.faces`), as refs a caller can re-point. The page
 * fetches each `url` itself, so a path is resolved against the page.
 */
function htmlFaceRefs(
  config: Record<string, unknown>,
): { where: string; url: string; set: (next: string) => void }[] {
  const out: { where: string; url: string; set: (next: string) => void }[] = []
  const stack = Array.isArray(config.stack) ? config.stack : []
  for (const entry of stack as Record<string, unknown>[]) {
    const data = entry?.data as Record<string, unknown> | undefined
    const overlays = Array.isArray(data?.overlays) ? data.overlays : []
    for (const clip of overlays as Record<string, unknown>[]) {
      const html = clip?.html as Record<string, unknown> | undefined
      const faces = Array.isArray(html?.faces) ? html.faces : []
      for (const face of faces as Record<string, unknown>[]) {
        if (typeof face?.url !== 'string' || !face.url) continue
        out.push({
          where: `overlay ${String(clip.id)} font ${String(face.family)}`,
          url: face.url,
          set: (next) => {
            face.url = next
          },
        })
      }
    }
  }
  return out
}

/**
 * Make every declared file reachable for a local page: the manifest's, and
 * the faces an HTML layer brings from beside its document (re-pointed in
 * place, since the page fetches a face by its url). Null when there is
 * none, so a caller can leave the engine's defaults alone.
 */
export async function programAssets(
  config: Record<string, unknown>,
  opts: ProgramAssetsOptions,
): Promise<ProgramAssets | null> {
  const refs = manifestRefs(config)
  const faces = htmlFaceRefs(config).filter(
    (f) =>
      !isUrl(f.url) || hostedAssetId(f.url, opts.origin ? [opts.origin] : []),
  )
  if (refs.length === 0 && faces.length === 0) return null
  const files: Record<string, string> = {}
  const served = new Map<string, string>()
  const serve = (file: string): string => {
    const known = served.get(file)
    if (known) return known
    // The path is a digest of the file's location plus its extension, and
    // never its name: a space or an accent in a name is percent-encoded in
    // the URL the page asks for and would miss a table keyed by the name.
    const tag = createHash('sha256').update(file).digest('hex').slice(0, 16)
    const ext = extname(file)
    const path = `${ASSET_ROUTE}${tag}${/^\.[A-Za-z0-9]+$/.test(ext) ? ext.toLowerCase() : ''}`
    files[path] = file
    served.set(file, path)
    return path
  }

  const reach = async (ref: string, where: string): Promise<string> => {
    // A hosted file first, in any spelling: its absolute URL is a URL too,
    // but a private one answers only to the key, never to the page.
    const hosted = hostedAssetId(ref, opts.origin ? [opts.origin] : [])
    if (hosted) {
      const file = await fetchHosted(hosted, opts)
      return file ? serve(file) : ref
    }
    if (isUrl(ref)) return ref
    const local = localFile(ref, opts.baseDir)
    if ('refused' in local) {
      opts.log(
        `note: ${where} names ${ref}, ${local.refused}, so the render cannot load it`,
      )
      return ref
    }
    return serve(local.file)
  }

  for (const face of faces) face.set(await reach(face.url, face.where))

  const assets: Record<string, string | string[]> = {}
  for (const { name, index, ref } of refs) {
    const url = await reach(
      ref,
      index === null ? `assets.${name}` : `assets.${name}[${index}]`,
    )
    if (index === null) assets[name] = url
    else {
      const list = (assets[name] ??= []) as string[]
      list[index] = url
    }
  }
  return { assets, files }
}

/**
 * The manifest entries that name a file which is not there, for a check
 * that knows where the config lives. Hosted refs and URLs are not files.
 */
export function missingManifestFiles(
  config: Record<string, unknown>,
  baseDir: string,
): string[] {
  const out: string[] = []
  for (const { name, index, ref } of manifestRefs(config)) {
    if (isUrl(ref) || hostedAssetId(ref)) continue
    const local = localFile(ref, baseDir)
    if ('file' in local) continue
    const where = index === null ? `assets.${name}` : `assets.${name}[${index}]`
    out.push(`${where} names ${ref}, ${local.refused}`)
  }
  return out
}
