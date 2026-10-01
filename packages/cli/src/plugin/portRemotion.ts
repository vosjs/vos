/**
 * `vos port inventory` for a Remotion project: the project is bundled with
 * its OWN `@remotion/bundler`, mounted in the CLI's Chrome through the window
 * protocol Remotion's renderer drives (`remotion_setBundleMode`,
 * `remotion_setFrame`, `remotion_renderReady`), and read the way a page is:
 * computed faces, sizes and colours, boxes, at a frame inside each scene.
 * Scenes are the composition's `<Sequence>` windows, named by the component
 * they hold; audio is its `<Audio>`; the palette is the colour constants the
 * source names. Without the project's dependencies it reads nothing and says
 * so, and the inventory falls back to the render.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createRequire } from 'node:module'
import { basename, extname, join } from 'node:path'
import { launchBrowser } from '../browser'
import { READ_GROUND, READ_PAGE } from './portInventory'
import type { InventoryMedia, InventoryText } from './portInventory'

export interface RemotionSequence {
  from: number
  durationInFrames: number
  /** The component the sequence holds, or its `name` prop. */
  name: string | null
}

export interface RemotionScene {
  name: string
  start: number
  duration: number
  ground?: string | null
}

/** Colour constants a source names (`export const INK = '#0B0B0F'`), pure. */
export function themeColors(sources: string[]): Record<string, string> {
  const out: Record<string, string> = {}
  const re =
    /\bconst\s+([A-Za-z_$][\w$]*)\s*(?::\s*string\s*)?=\s*['"](#[0-9a-fA-F]{3,8})['"]/g
  for (const src of sources)
    for (const m of src.matchAll(re)) {
      const key = m[1]
        .toLowerCase()
        .replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase())
      if (!(key in out)) out[key] = m[2].toLowerCase()
    }
  return out
}

/**
 * The scenes, from the composition's sequences (pure): every sequence with a
 * length, named by what it holds, in seconds; a name used twice is numbered.
 */
export function remotionScenes(
  seqs: RemotionSequence[],
  fps: number,
): RemotionScene[] {
  const seen = new Map<string, number>()
  const live = seqs.filter((s) => s.durationInFrames > 0)
  // A sequence lying over a longer one (a wipe, a flash) is a transition
  // between scenes, never a scene of its own.
  const overlaps = (a: RemotionSequence, b: RemotionSequence) =>
    a.from < b.from + b.durationInFrames && b.from < a.from + a.durationInFrames
  return live
    .filter(
      (s) =>
        !live.some(
          (o) =>
            o !== s &&
            o.durationInFrames > s.durationInFrames &&
            overlaps(o, s),
        ),
    )
    .sort((a, b) => a.from - b.from)
    .map((s, i) => {
      const base = s.name ?? `scene${i + 1}`
      const n = (seen.get(base) ?? 0) + 1
      seen.set(base, n)
      return {
        name: n > 1 ? `${base}${n}` : base,
        start: Math.round((s.from / fps) * 1000) / 1000,
        duration: Math.round((s.durationInFrames / fps) * 1000) / 1000,
      }
    })
}

/**
 * The texts of every scene, merged (pure): a text read at the same place in
 * most scenes (a HUD line, a brand mark) is one global text with no scene;
 * every other text keeps the scene it was read in, once.
 */
export function mergeSceneTexts(
  perScene: { scene: string; texts: InventoryText[] }[],
): InventoryText[] {
  const sig = (t: InventoryText) =>
    `${t.text}|${t.font.family}|${t.font.size}|${t.box ? `${Math.round(t.box.x / 8)},${Math.round(t.box.y / 8)}` : '-'}`
  const counts = new Map<string, number>()
  for (const s of perScene)
    for (const k of new Set(s.texts.map(sig)))
      counts.set(k, (counts.get(k) ?? 0) + 1)
  const global =
    perScene.length >= 3 ? Math.ceil(perScene.length / 2) : Infinity
  const out: InventoryText[] = []
  const placed = new Set<string>()
  const textPlaced = new Set<string>()
  for (const s of perScene)
    for (const t of s.texts) {
      const k = sig(t)
      const shared = (counts.get(k) ?? 0) >= global
      const id = shared ? k : `${s.scene}|${k}`
      if (placed.has(id)) continue
      // A counter (a timecode, a running number) reads differently in every
      // scene: its first reading stands for it.
      const shape = `${t.text.replace(/\d/g, '0')}|${t.font.family}|${t.box ? Math.round(t.box.y / 8) : '-'}`
      if (/\d/.test(t.text) && textPlaced.has(shape)) continue
      placed.add(id)
      textPlaced.add(shape)
      out.push({
        ...t,
        id: `${t.id}-${out.length}`,
        scene: shared ? null : s.scene,
      })
    }
  return out
}

/** The project's source files, for the colour constants (bounded). */
function sourceTexts(dir: string): string[] {
  const out: string[] = []
  const walk = (d: string, depth: number) => {
    if (depth > 4 || out.length > 200) return
    for (const name of readdirSync(d)) {
      if (name === 'node_modules' || name.startsWith('.')) continue
      const p = join(d, name)
      if (statSync(p).isDirectory()) walk(p, depth + 1)
      else if (/\.(tsx?|jsx?|mjs)$/.test(name))
        out.push(readFileSync(p, 'utf8'))
    }
  }
  const src = join(dir, 'src')
  walk(existsSync(src) ? src : dir, 0)
  return out
}

/** The entry `registerRoot` lives in: Remotion's conventional paths. */
function entryPoint(dir: string): string | null {
  for (const p of [
    'src/index.ts',
    'src/index.tsx',
    'src/index.js',
    'src/index.jsx',
    'remotion/index.ts',
    'remotion/index.tsx',
  ])
    if (existsSync(join(dir, p))) return join(dir, p)
  return null
}

const TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
}

/** The window state Remotion's renderer sets before the bundle loads. */
const INIT = `(() => {
  window.remotion_puppeteerTimeout = 30000
  window.remotion_isMainTab = true
  window.remotion_mediaCacheSizeInBytes = 100000000
  window.remotion_initialMemoryAvailable = 1000000000
  window.remotion_sampleRate = 48000
  window.process = window.process || {}
  window.process.env = window.process.env || {}
  window.process.env.NODE_ENV = 'production'
  window.remotion_envVariables = '{}'
  window.remotion_inputProps = '{}'
  window.remotion_initialFrame = 0
  window.remotion_attempt = 1
  window.remotion_audioEnabled = false
  window.remotion_videoEnabled = false
  window.remotion_logLevel = 'error'
})()`

/** The composition's sequences and audio, from React's fibers. */
const READ_TREE = `(() => {
  let fiber = null
  for (const el of document.querySelectorAll('body, body *')) {
    const k = Object.keys(el).find((k) => k.startsWith('__reactFiber$') || k.startsWith('__reactContainer$'))
    if (k) { fiber = el[k]; break }
  }
  while (fiber && fiber.return) fiber = fiber.return
  const nameOf = (t) => t && (t.displayName || t.name || (t.render && (t.render.displayName || t.render.name))) || null
  const internal = /^(Sequence|AbsoluteFill|Freeze|Loop|Series|Fragment)$|Provider|Context|Forwarding|^Inner/
  const seqs = []
  const audio = []
  const walk = (f, offset) => {
    for (let x = f; x; x = x.sibling) {
      const name = nameOf(x.elementType)
      const p = x.memoizedProps || {}
      let next = offset
      if (name === 'Sequence' && typeof p.from === 'number') {
        next = offset + p.from
        if (typeof p.durationInFrames === 'number' && isFinite(p.durationInFrames)) {
          const kids = Array.isArray(p.children) ? p.children : [p.children]
          const held = kids.map((k) => k && nameOf(k.type)).find((n) => n && !internal.test(n))
          seqs.push({ from: next, durationInFrames: p.durationInFrames, name: p.name || held || null })
        }
      }
      if (name && /Audio$/.test(name) && typeof p.src === 'string')
        audio.push({ src: p.src, from: next, volume: typeof p.volume === 'number' ? p.volume : null, startFrom: typeof p.startFrom === 'number' ? p.startFrom : (typeof p.trimBefore === 'number' ? p.trimBefore : null) })
      if (x.child) walk(x.child, next)
    }
  }
  walk(fiber, 0)
  // Nested sequences repeat their parent's window at the same offset: keep the outermost.
  const seen = new Set()
  return { seqs: seqs.filter((s) => { const k = s.from + ':' + s.durationInFrames; if (seen.has(k)) return false; seen.add(k); return true }), audio }
})()`

/**
 * Read a Remotion project, or null (with the reason logged) when its
 * dependencies are not installed or the bundle does not mount.
 */
export async function readRemotion(
  dir: string,
  log?: (l: string) => void,
): Promise<Record<string, unknown> | null> {
  const entry = entryPoint(dir)
  let bundler: { bundle: (o: Record<string, unknown>) => Promise<string> }
  try {
    bundler = createRequire(join(dir, 'package.json'))('@remotion/bundler')
  } catch {
    log?.(
      'a Remotion project whose dependencies are not installed: run `npm install` in it so vos can read its compositions (words, scenes, faces); reading only the render',
    )
    return null
  }
  if (!entry) {
    log?.(
      'a Remotion project with no src/index entry (registerRoot): reading only the render',
    )
    return null
  }
  const out = await bundler.bundle({ entryPoint: entry, onProgress: () => {} })
  const server = createServer((rq, rs) => {
    const path = decodeURIComponent(new URL(rq.url ?? '/', 'http://x').pathname)
    let f = join(out, path)
    if (!f.startsWith(out) || !existsSync(f) || statSync(f).isDirectory())
      f = join(out, 'index.html')
    rs.writeHead(200, {
      'content-type': TYPES[extname(f)] ?? 'application/octet-stream',
    })
    rs.end(readFileSync(f))
  }).listen(0, '127.0.0.1')
  await new Promise((r) => server.once('listening', r))
  const port = (server.address() as AddressInfo).port
  const browser = await launchBrowser()
  try {
    const ctx = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
    })
    const p = await ctx.newPage()
    await p.addInitScript(INIT)
    await p.goto(`http://127.0.0.1:${port}/index.html`)
    await p.waitForFunction(
      'typeof window.getStaticCompositions === "function"',
      null,
      { timeout: 30000 },
    )
    await p.evaluate("window.remotion_setBundleMode({ type: 'evaluation' })")
    await p.waitForFunction('window.remotion_renderReady === true', null, {
      timeout: 30000,
    })
    const comps = (await p.evaluate('window.getStaticCompositions()')) as {
      id: string
      width: number
      height: number
      fps: number
      durationInFrames: number
      defaultProps?: Record<string, unknown>
    }[]
    if (!comps.length) {
      log?.(
        'the Remotion project registers no composition: reading only the render',
      )
      return null
    }
    const c = comps[0]
    if (comps.length > 1)
      log?.(`${comps.length} compositions; reading the first, ${c.id}`)
    await p.setViewportSize({ width: c.width, height: c.height })
    await p.evaluate(
      `window.remotion_setBundleMode(${JSON.stringify({
        type: 'composition',
        compositionName: c.id,
        serializedResolvedPropsWithSchema: JSON.stringify(c.defaultProps ?? {}),
        compositionDurationInFrames: c.durationInFrames,
        compositionFps: c.fps,
        compositionHeight: c.height,
        compositionWidth: c.width,
        compositionDefaultCodec: null,
        compositionDefaultOutName: null,
        compositionDefaultVideoImageFormat: null,
        compositionDefaultPixelFormat: null,
        compositionDefaultProResProfile: null,
        compositionDefaultSampleRate: null,
      })})`,
    )
    await p.waitForFunction('window.remotion_renderReady === true', null, {
      timeout: 30000,
    })
    const seek = async (frame: number) => {
      await p.evaluate(
        `window.remotion_setFrame(${frame}, ${JSON.stringify(c.id)}, 1)`,
      )
      await p.waitForFunction('window.remotion_renderReady === true', null, {
        timeout: 30000,
      })
      await p.evaluate('document.fonts && document.fonts.ready')
    }
    await seek(0)
    const tree = (await p.evaluate(READ_TREE)) as {
      seqs: RemotionSequence[]
      audio: {
        src: string
        from: number
        volume: number | null
        startFrom: number | null
      }[]
    }
    let scenes = remotionScenes(tree.seqs, c.fps)
    const total = c.durationInFrames / c.fps
    if (!scenes.length) scenes = [{ name: c.id, start: 0, duration: total }]

    // Each scene read nine tenths in, where its words have settled and a scramble has resolved.
    const perScene: { scene: string; texts: InventoryText[] }[] = []
    let first: Record<string, any> | null = null
    const colors = new Set<string>()
    const gaps = new Set<string>()
    for (const s of scenes) {
      const frame = Math.min(
        c.durationInFrames - 1,
        Math.round((s.start + s.duration * 0.9) * c.fps),
      )
      await seek(frame)
      const read = (await p.evaluate(READ_PAGE)) as Record<string, any>
      // A word already leaving at nine tenths has no box: measure it at
      // half way, where it stood.
      const unboxed = (read.texts as InventoryText[]).filter((t) => !t.box)
      if (unboxed.length) {
        await seek(Math.round((s.start + s.duration * 0.5) * c.fps))
        const mid = (await p.evaluate(READ_PAGE)) as { texts: InventoryText[] }
        for (const t of unboxed) {
          const m = mid.texts.find(
            (x) =>
              x.box && x.text === t.text && x.font.family === t.font.family,
          )
          if (m) t.box = m.box
        }
      }
      s.ground = (await p.evaluate(READ_GROUND)) as string | null
      first ??= read
      for (const x of read.colors ?? []) colors.add(x)
      for (const g of read.gaps ?? []) gaps.add(g)
      perScene.push({ scene: s.name, texts: read.texts ?? [] })
    }

    const publicDir = join(dir, 'public')
    const media: InventoryMedia[] = tree.audio.map((a) => {
      const name = basename(a.src.split('?')[0])
      const local = existsSync(join(publicDir, name)) ? `public/${name}` : a.src
      return {
        kind: 'audio',
        src: local,
        start: Math.round((a.from / c.fps) * 1000) / 1000,
        duration: null,
        volume: a.volume,
        mediaStart:
          a.startFrom != null
            ? Math.round((a.startFrom / c.fps) * 1000) / 1000
            : null,
      }
    })
    return {
      width: c.width,
      height: c.height,
      fps: c.fps,
      duration: Math.round(total * 1000) / 1000,
      texts: mergeSceneTexts(perScene),
      palette: themeColors(sourceTexts(dir)),
      colors: [...colors],
      gaps: [...gaps],
      media,
      canvases: (first?.canvases as unknown[]) ?? [],
      scenes,
      sceneEls: [],
      variables: c.defaultProps ?? {},
      scriptText: '',
      composition: c.id,
    }
  } catch (e) {
    log?.(
      `the Remotion bundle did not mount (${e instanceof Error ? e.message.split('\n')[0] : String(e)}): reading only the render`,
    )
    return null
  } finally {
    await browser.close()
    server.close()
  }
}
