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
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, isAbsolute, join, resolve } from 'node:path'

/** Where served files live on a page's own origin. */
export const ASSET_ROUTE = '/__assets/'

export interface ProgramAssetsOptions {
  /** The directory the manifest's relative refs are read against. */
  baseDir: string
  /** For a hosted ref: where it lives and who may read it. */
  origin?: string
  key?: string | null
  log: (line: string) => void
  /** Where hosted files are kept between runs (default: the OS temp dir). */
  cacheDir?: string
}

export interface ProgramAssets {
  /** Name → the URL (or URLs) the page reads as `ctx.assets.<name>`. */
  assets: Record<string, string | string[]>
  /** Served path (`/__assets/…`) → the file on disk behind it. */
  files: Record<string, string>
}

const HOSTED_REF =
  /^(?:asset:|(?:https?:\/\/[^/]+)?\/api\/assets\/)([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})(?:\/file(?:\?.*)?)?$/

/** The hosted asset id a ref names (`asset:<id>` or its file path), or null. */
export function hostedAssetId(ref: string): string | null {
  return HOSTED_REF.exec(ref)?.[1] ?? null
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
    if (Array.isArray(decl.ref)) {
      decl.ref.forEach((ref, index) => out.push({ name, index, ref }))
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
  const dir = opts.cacheDir ?? join(tmpdir(), 'vos-assets')
  const file = join(dir, id)
  if (existsSync(file) && statSync(file).size > 0) return file
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
  mkdirSync(dir, { recursive: true })
  writeFileSync(file, new Uint8Array(await res.arrayBuffer()))
  return file
}

/**
 * Make every declared file reachable for a local page. Null when the config
 * declares none, so a caller can leave the engine's defaults alone.
 */
export async function programAssets(
  config: Record<string, unknown>,
  opts: ProgramAssetsOptions,
): Promise<ProgramAssets | null> {
  const refs = manifestRefs(config)
  if (refs.length === 0) return null
  const files: Record<string, string> = {}
  const served = new Map<string, string>()
  const serve = (file: string): string => {
    const known = served.get(file)
    if (known) return known
    // The path is a digest of the file's location, so two files that share
    // a name never collide; the name stays for the type and for reading.
    const tag = createHash('sha256').update(file).digest('hex').slice(0, 10)
    const path = `${ASSET_ROUTE}${tag}/${basename(file)}`
    files[path] = file
    served.set(file, path)
    return path
  }

  const reach = async (ref: string, where: string): Promise<string> => {
    if (isUrl(ref)) return ref
    const hosted = hostedAssetId(ref)
    if (hosted) {
      const file = await fetchHosted(hosted, opts)
      return file ? serve(file) : ref
    }
    const file = isAbsolute(ref) ? ref : resolve(opts.baseDir, ref)
    if (!existsSync(file) || !statSync(file).isFile()) {
      opts.log(
        `note: ${where} names ${ref}, which is not a file beside the config, so the render cannot load it`,
      )
      return ref
    }
    return serve(file)
  }

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
    const file = isAbsolute(ref) ? ref : resolve(baseDir, ref)
    if (existsSync(file) && statSync(file).isFile()) continue
    const where = index === null ? `assets.${name}` : `assets.${name}[${index}]`
    out.push(`${where} names ${ref}, which is not a file beside the config`)
  }
  return out
}
