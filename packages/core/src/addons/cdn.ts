/**
 * Where a page gets the engine's dependencies from.
 *
 * Every render page (the player, the capture templates) imports three, the
 * three addons, gsap, the external packages and, for a capture, mediabunny
 * and mp4box through an importmap. The modules come from ONE of two
 * sources, chosen by the host:
 *
 * - `esm.sh` (the default): a public CDN that transpiles and bundles npm
 *   packages on request. Nothing to set up, which is what an engine user
 *   wants; and a third party between the page and its code, which is what
 *   a platform does not.
 * - a MIRROR: the same pinned packages, published by the host to an origin
 *   it controls, laid out as `<base>/<name>@<version>/<file>` with the npm
 *   package's own files (`engineMirrorLayout` says which). The host passes
 *   the base (`moduleMirror` on the template) and the page names no third
 *   party.
 *
 * A mirror serves the packages' own ESM files, so it needs no build step
 * for three, gsap, spark and mediabunny (their files import `three`,
 * `three/tsl` and `three/webgpu` by bare specifier, which the importmap
 * maps too) and one for mp4box, which npm ships as CommonJS.
 */
const CDN_BASE = 'https://esm.sh'

/** The engine's pinned dependencies: the versions every host loads. */
export const DEFAULT_THREE_VERSION = '0.183.0'
export const DEFAULT_GSAP_VERSION = '3.12.5'
export const MEDIABUNNY_VERSION = '1.55.7'
export const MP4BOX_VERSION = '0.5.2'
/** The ESM file a mirror builds from mp4box's CommonJS bundle. */
export const MP4BOX_ESM_FILE = 'dist/mp4box.esm.js'
/**
 * The ONE version of @sparkjsdev/spark a compiled program loads. Pinned
 * because an unversioned CDN import is whatever the package's owner
 * published last, run with the player's origin; moved on purpose, with the
 * test that holds every external URL to a version.
 */
export const SPARK_VERSION = '2.3.1'

export function threeUrl(version: string): string {
  return `${CDN_BASE}/three@${version}?target=es2022`
}

export function threeAddonsPrefix(version: string): string {
  return `${CDN_BASE}/three@${version}&target=es2022/examples/jsm/`
}

export function gsapUrl(version: string): string {
  return `${CDN_BASE}/gsap@${version}?target=es2022`
}

export function dracoDecoderPath(version: string): string {
  return `${CDN_BASE}/three@${version}&target=es2022/examples/jsm/libs/draco/`
}

export function externalPackageUrl(
  packageName: string,
  options?: { external?: string[]; target?: string },
): string {
  const params = new URLSearchParams()
  if (options?.external?.length)
    params.set('external', options.external.join(','))
  params.set('target', options?.target ?? 'es2022')
  return `${CDN_BASE}/${packageName}?${params.toString()}`
}

export const CDN_ORIGIN = CDN_BASE

/**
 * An npm package a compiled program may import by its bare specifier (the
 * addon registry's `external` entries name one by `importSpecifier`).
 * `file` is the ESM entry a mirror serves; `esmShQuery` what esm.sh needs
 * to build it (`external=three`: the package shares the page's three).
 */
export interface ExternalPackage {
  version: string
  file: string
  esmShQuery: string
}

export const EXTERNAL_PACKAGES: Record<string, ExternalPackage> = {
  '@sparkjsdev/spark': {
    version: SPARK_VERSION,
    file: 'dist/spark.module.js',
    esmShQuery: 'external=three&target=es2022',
  },
}

export interface ModuleVersions {
  threeVersion?: string
  gsapVersion?: string
}

/** Every module a page loads from outside itself, resolved to URLs. */
export interface EngineModules {
  source: 'esm.sh' | 'mirror'
  /** The origin the page preconnects to. */
  origin: string
  three: string
  /** The `three/addons/` prefix. */
  threeAddons: string
  gsap: string
  /** The DRACO decoder directory (`DRACOLoader.setDecoderPath`). */
  draco: string
  mediabunny: string
  mp4box: string
  /** What the page preloads: three, and on a mirror its core beside it. */
  preload: string[]
  /**
   * Every bare specifier the importmap maps, with its URL: three, its
   * addons prefix, `three/tsl`, `three/webgpu`, gsap and the external
   * packages. A mirror serves the packages' own files, which import these
   * names themselves.
   */
  imports: Record<string, string>
}

const sparkEsmSh = (name: string, pkg: ExternalPackage) =>
  `${CDN_BASE}/${name}@${pkg.version}?${pkg.esmShQuery}`

/** The modules from esm.sh, the default source. */
export function esmShModules(versions: ModuleVersions = {}): EngineModules {
  const three = versions.threeVersion ?? DEFAULT_THREE_VERSION
  const gsap = versions.gsapVersion ?? DEFAULT_GSAP_VERSION
  const imports: Record<string, string> = {
    three: threeUrl(three),
    'three/addons/': threeAddonsPrefix(three),
    'three/tsl': `${CDN_BASE}/three@${three}/tsl?target=es2022`,
    'three/webgpu': `${CDN_BASE}/three@${three}/webgpu?target=es2022`,
    gsap: gsapUrl(gsap),
  }
  for (const [name, pkg] of Object.entries(EXTERNAL_PACKAGES)) {
    imports[name] = sparkEsmSh(name, pkg)
  }
  return {
    source: 'esm.sh',
    origin: CDN_BASE,
    three: imports.three,
    threeAddons: imports['three/addons/'],
    gsap: imports.gsap,
    draco: dracoDecoderPath(three),
    mediabunny: `${CDN_BASE}/mediabunny@${MEDIABUNNY_VERSION}?target=es2022`,
    mp4box: `${CDN_BASE}/mp4box@${MP4BOX_VERSION}`,
    preload: [imports.three],
    imports,
  }
}

/** `<base>/<name>@<version>/<file>`, the mirror's one rule. */
export function mirrorFileUrl(
  base: string,
  name: string,
  version: string,
  file: string,
): string {
  return `${base.replace(/\/+$/, '')}/${name}@${version}/${file}`
}

/**
 * The modules from a mirror at `base`, laid out by `engineMirrorLayout`.
 * The base is an absolute URL (`https://assets.vos.so/esm`); the origin
 * the page preconnects to is derived from it.
 */
export function mirroredModules(
  base: string,
  versions: ModuleVersions = {},
): EngineModules {
  const three = versions.threeVersion ?? DEFAULT_THREE_VERSION
  const gsap = versions.gsapVersion ?? DEFAULT_GSAP_VERSION
  const at = (name: string, version: string, file: string) =>
    mirrorFileUrl(base, name, version, file)
  const imports: Record<string, string> = {
    three: at('three', three, 'build/three.module.js'),
    'three/addons/': at('three', three, 'examples/jsm/'),
    'three/tsl': at('three', three, 'build/three.tsl.js'),
    'three/webgpu': at('three', three, 'build/three.webgpu.js'),
    gsap: at('gsap', gsap, 'index.js'),
  }
  for (const [name, pkg] of Object.entries(EXTERNAL_PACKAGES)) {
    imports[name] = at(name, pkg.version, pkg.file)
  }
  let origin: string
  try {
    origin = new URL(base).origin
  } catch {
    throw new Error(
      `moduleMirror must be an absolute URL (got ${JSON.stringify(base)})`,
    )
  }
  return {
    source: 'mirror',
    origin,
    three: imports.three,
    threeAddons: imports['three/addons/'],
    gsap: imports.gsap,
    draco: at('three', three, 'examples/jsm/libs/draco/'),
    mediabunny: at(
      'mediabunny',
      MEDIABUNNY_VERSION,
      'dist/bundles/mediabunny.mjs',
    ),
    mp4box: at('mp4box', MP4BOX_VERSION, MP4BOX_ESM_FILE),
    // three.module.js is a thin re-export over three.core.js: preloading
    // only the first leaves the second to be discovered a round trip later.
    preload: [imports.three, at('three', three, 'build/three.core.js')],
    imports,
  }
}

/** The modules from the mirror when a host names one, else from esm.sh. */
export function engineModules(
  mirror: string | null | undefined,
  versions: ModuleVersions = {},
): EngineModules {
  return mirror ? mirroredModules(mirror, versions) : esmShModules(versions)
}

/**
 * A package the mirror holds: the npm package's files the engine names
 * (`files`), the directories a bare prefix may reach any file of
 * (`prefixes`), and a build the host must run where npm ships no ESM
 * (`build`: bundle the CommonJS `entry` to ESM at `out`).
 */
export interface MirrorPackage {
  name: string
  version: string
  files: string[]
  prefixes: string[]
  build?: { entry: string; out: string }
}

/** What a mirror of the engine's dependencies must hold, at these versions. */
export function engineMirrorLayout(
  versions: ModuleVersions = {},
): MirrorPackage[] {
  const three = versions.threeVersion ?? DEFAULT_THREE_VERSION
  const gsap = versions.gsapVersion ?? DEFAULT_GSAP_VERSION
  return [
    {
      name: 'three',
      version: three,
      files: [
        'build/three.module.js',
        'build/three.core.js',
        'build/three.tsl.js',
        'build/three.webgpu.js',
        'build/three.webgpu.nodes.js',
      ],
      // Every addon a program may import, with their relative imports and
      // the DRACO decoder under libs/.
      prefixes: ['examples/jsm/'],
    },
    {
      name: 'gsap',
      version: gsap,
      // index.js imports gsap-core.js and CSSPlugin.js by relative path.
      files: ['index.js', 'gsap-core.js', 'CSSPlugin.js'],
      prefixes: ['utils/'],
    },
    ...Object.entries(EXTERNAL_PACKAGES).map(([name, pkg]) => ({
      name,
      version: pkg.version,
      files: [pkg.file],
      prefixes: [],
    })),
    {
      name: 'mediabunny',
      version: MEDIABUNNY_VERSION,
      files: ['dist/bundles/mediabunny.mjs'],
      prefixes: [],
    },
    {
      name: 'mp4box',
      version: MP4BOX_VERSION,
      files: [],
      prefixes: [],
      build: { entry: 'dist/mp4box.all.js', out: MP4BOX_ESM_FILE },
    },
  ]
}
