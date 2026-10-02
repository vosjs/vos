/**
 * The manifest (`config.assets`) as `ctx.assets`.
 *
 * A program that types a file's URL inside a function has hidden that file
 * from every host: nothing can serve it privately to a render page, bring
 * it along when the program is copied, or know it is still in use. Declared
 * by name instead, the file is data the host can read, and the program only
 * ever sees the URL the host resolved for the surface it is running on.
 *
 * Resolution is three rungs, nearest wins:
 *   1. `deps.assets[name]`, handed to `initVos` by the host for THIS
 *      surface (a render page's token-carrying URL, a local file server);
 *   2. the default baked here, which is the `ref` passed through the compile
 *      option `resolveAssetRef` (a host mapping its own scheme to a URL);
 *   3. the `ref` as written, when no host said anything: a URL or a path.
 *
 * Elements, objects and fonts are data, not code, so they name a file as
 * the string `"$assets.<name>"` (or `"$assets.<name>[2]"` for one of a
 * list) and it is replaced before they are built.
 */
import type { AssetDecl } from '../../types'

export type ResolveAssetRef = (ref: string, name: string) => string

function manifestOf(config: {
  assets?: unknown
}): Record<string, AssetDecl> | null {
  const assets = config.assets
  if (!assets || typeof assets !== 'object' || Array.isArray(assets))
    return null
  return Object.keys(assets).length > 0
    ? (assets as Record<string, AssetDecl>)
    : null
}

/** Does this config declare any file? */
export function hasAssets(config: { assets?: unknown }): boolean {
  return manifestOf(config) !== null
}

/**
 * Wrap a baked config literal so its `"$assets.<name>"` strings are replaced
 * at init. A program with no manifest emits the literal untouched.
 */
export function bindAssets(config: { assets?: unknown }, json: string): string {
  return hasAssets(config) ? `__vosBindAssets(${json})` : json
}

/** The default URL (or URLs) of every declared name, as the host mapped them. */
export function bakedAssetDefaults(
  config: { assets?: unknown },
  resolve?: ResolveAssetRef,
): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {}
  const manifest = manifestOf(config)
  if (!manifest) return out
  for (const [name, decl] of Object.entries(manifest)) {
    const one = (ref: string) => (resolve ? resolve(ref, name) : ref)
    out[name] = Array.isArray(decl.ref) ? decl.ref.map(one) : one(decl.ref)
  }
  return out
}

export function generateAssetsSetup(
  config: { assets?: unknown },
  resolve?: ResolveAssetRef,
): string {
  const baked = JSON.stringify(bakedAssetDefaults(config, resolve))
  const table = `
  // Declared files (config.assets) exposed as ctx.assets: each name's URL, or
  // URLs. deps.assets[name], the host's resolution for this surface, wins
  // over the default baked at compile time.
  const __vosAssets = Object.freeze(Object.assign({}, ${baked}, deps && deps.assets));`
  if (!hasAssets(config)) return table
  return `${table}
  // "$assets.<name>" (or "$assets.<name>[i]") in an element, object or font
  // declaration is replaced with the resolved URL before anything is built.
  const __vosAssetRef = new RegExp('^\\\\$assets\\\\.([A-Za-z_][A-Za-z0-9_]*)(?:\\\\[(\\\\d+)\\\\])?$');
  const __vosBindAssets = (v) => {
    if (typeof v === 'string') {
      const m = __vosAssetRef.exec(v);
      if (!m) return v;
      const found = __vosAssets[m[1]];
      const list = found == null ? [] : (Array.isArray(found) ? found : [found]);
      const url = list[m[2] != null ? Number(m[2]) : 0];
      if (url == null) {
        console.warn('[vos] "' + v + '" names no declared file: add "' + m[1] + '" to config.assets, or check its index.');
        return v;
      }
      return url;
    }
    if (Array.isArray(v)) return v.map(__vosBindAssets);
    if (v && typeof v === 'object') {
      const out = {};
      for (const k in v) out[k] = __vosBindAssets(v[k]);
      return out;
    }
    return v;
  };`
}
