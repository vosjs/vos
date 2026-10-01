/**
 * `vos port inventory` — what a source piece holds, read from the piece as a
 * browser renders it, before any animation code is written.
 *
 * Every port started by reading the source by hand for its words, colours,
 * faces, media and scenes, and a port that missed one shipped a literal in a
 * function string or a face from a third-party host. The inventory is that
 * reading, done by the browser that renders the page: computed styles, not
 * guesses from CSS text. It writes nothing but `port/inventory.json` (and
 * reference stills when the source's own render sits beside it); the
 * scaffold turns it into a program.
 */
import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
} from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { findFontFamily } from '@vosjs/shared'
import { launchBrowser } from '../browser'

export type SourceEngine = 'hyperframes' | 'remotion' | 'page'

export interface InventoryText {
  id: string
  text: string
  tag: string
  /** Box in composition pixels, top-left origin; null when not laid out at the first frame. */
  box: { x: number; y: number; width: number; height: number } | null
  /** The scene element it sits in, when the piece has scenes. */
  scene?: string | null
  font: {
    family: string
    size: number
    weight: number
    style: string
    color: string
    letterSpacing: number
    transform: string
  }
}

export interface InventoryFont {
  family: string
  weights: number[]
  italic: boolean
  /** The catalog family that serves it, or null when the catalog lacks it. */
  catalog: string | null
}

export interface InventoryMedia {
  kind: 'image' | 'svg' | 'video' | 'audio'
  src: string | null
  start: number | null
  duration: number | null
  volume: number | null
  mediaStart: number | null
}

export interface Inventory {
  /** The source as given, relative to where the inventory ran ('.' for there). */
  source: string
  /** The folder holding the source page or project, absolute: what the scaffold resolves media against. */
  root?: string
  engine: SourceEngine
  width: number
  height: number
  fps: number | null
  duration: number | null
  scenes: { name: string; start: number; duration: number | null }[]
  texts: InventoryText[]
  /** CSS custom properties that hold a colour, by name, first. */
  palette: Record<string, string>
  /** Every other colour the page paints text or a background with. */
  colors: string[]
  fonts: InventoryFont[]
  media: InventoryMedia[]
  canvases: { width: number; height: number }[]
  /** CSS no element can say (blend, clip, mask, filter, 3D): a painter or an approximation. */
  gaps: string[]
  /** Proposed knobs from the source's own declared variables. */
  variables: Record<string, unknown>
  /** Quoted strings in the page's scripts, for a piece that paints its words. */
  scriptStrings: string[]
  /** The source's own render, when one sits beside it. */
  render: string | null
  /** Stills from that render, at each scene's middle or each second. */
  stills: { t: number; file: string }[]
}

/** What kind of project a path holds (pure over the files it lists). */
export function detectEngine(dir: string): SourceEngine {
  if (existsSync(join(dir, 'hyperframes.json'))) return 'hyperframes'
  const pkg = join(dir, 'package.json')
  if (existsSync(pkg)) {
    try {
      const p = JSON.parse(readFileSync(pkg, 'utf8')) as Record<string, any>
      const deps = { ...(p.dependencies ?? {}), ...(p.devDependencies ?? {}) }
      if ('remotion' in deps) return 'remotion'
      if ('hyperframes' in deps) return 'hyperframes'
      if (/hyperframes/.test(JSON.stringify(p.scripts ?? {})))
        return 'hyperframes'
    } catch {
      /* not JSON: a plain page */
    }
  }
  return 'page'
}

/** The page a source path renders (pure over the file system). */
export function sourcePage(source: string): string | null {
  if (!existsSync(source)) return null
  if (statSync(source).isFile()) return /\.html?$/i.test(source) ? source : null
  const index = join(source, 'index.html')
  return existsSync(index) ? index : null
}

/** A render beside the source: renders/, out/, or a video at the root. */
export function findRender(dir: string): string | null {
  const videos = (d: string) =>
    existsSync(d)
      ? readdirSync(d)
          .filter((f) => /\.(mp4|webm|mov)$/i.test(f))
          .map((f) => join(d, f))
      : []
  for (const d of [join(dir, 'renders'), join(dir, 'out'), dir]) {
    const found = videos(d)
    if (found.length) return found[0]
  }
  return null
}

/** Quoted strings a person would read, from script text (pure). */
export function scriptStringsOf(code: string): string[] {
  const out = new Set<string>()
  for (const m of code.matchAll(/(['"`])((?:(?!\1)[^\\\n]|\\.){2,60})\1/g)) {
    const s = m[2]
    if (!/[A-Za-z]{2}/.test(s)) continue
    if (/["'`]/.test(s)) continue // a font stack or a stretch of code between two literals
    if (/\b[a-zA-Z_$][\w$]*\s*:\s*[\w$.]+\s*,/.test(s)) continue // an object literal
    if (/^-?[\d.]+(px|%|ms|s|deg|em|rem|vh|vw)?$/.test(s)) continue // a CSS length
    if (/^[a-z]+\/[a-z0-9.+-]+$/.test(s)) continue // a MIME type
    if (
      /^(source|destination)-(over|in|out|atop)$|^(lighter|copy|xor|multiply|screen|overlay|darken|lighten|difference|exclusion)$/.test(
        s,
      )
    )
      continue // a composite op
    if (/^[A-Za-z ]{4}$/.test(s) && /^(RIFF|WAVE|fmt |data|LIST)$/.test(s))
      continue // a file chunk id
    if (
      /[(){};=<>]|\$\{|^\.?\/|https?:|\.(js|css|png|jpe?g|mp[34]|wav|woff2?)$/i.test(
        s,
      )
    )
      continue
    if (/^[a-z][a-zA-Z0-9]*$/.test(s) && !/[A-Z]{2}/.test(s)) continue // an identifier or a key
    if (/^(rgba?|hsla?)\(|^#[0-9a-f]{3,8}$/i.test(s)) continue
    out.add(s)
  }
  return [...out].slice(0, 80)
}

/**
 * Scenes a GSAP timeline reveals (pure): each scene element's start is the
 * first time a `tl.set|to|fromTo` on its id makes it visible, and every
 * `addLabel('name', t)` is a scene too. Ordered by start; each lasts until
 * the next one.
 */
export function scriptScenes(
  ids: string[],
  code: string,
  duration: number | null,
): { name: string; start: number; duration: number | null }[] {
  const found = new Map<string, number>()
  for (const id of ids) {
    const re = new RegExp(
      `\\.(?:set|to|fromTo)\\(\\s*["'\`]#${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["'\`][^)]*?(?:opacity|autoAlpha)\\s*:\\s*1[^)]*?,\\s*([\\d.]+)\\s*\\)`,
    )
    const m = re.exec(code)
    if (m) found.set(id, Number(m[1]))
    else if (!found.size && ids[0] === id) found.set(id, 0) // the first scene shows from the start
  }
  for (const m of code.matchAll(
    /addLabel\(\s*["'`]([^"'`]+)["'`]\s*,\s*([\d.]+)/g,
  )) {
    if (!found.has(m[1])) found.set(m[1], Number(m[2]))
  }
  const sorted = [...found.entries()].sort((a, b) => a[1] - b[1])
  return sorted.map(([name, start], i) => {
    const next = sorted[i + 1]?.[1] ?? duration
    return {
      name,
      start,
      duration: next == null ? null : Math.round((next - start) * 1000) / 1000,
    }
  })
}

/**
 * The faces a script paints with (pure): the first family of every font
 * stack written as a string (`'"Inter Tight", Helvetica, sans-serif'`), the
 * way a canvas page names its type.
 */
export function scriptFontFamilies(code: string): string[] {
  const out = new Set<string>()
  const generic = /,\s*(?:sans-serif|serif|monospace|cursive|system-ui)\b/
  // A canvas `font` shorthand leads with style, weight and size: drop them.
  const shorthand =
    /^(?:(?:italic|oblique|normal|bold|bolder|lighter|small-caps|\d{3})\s+)*[\d.]+(?:px|pt|em|rem|%)(?:\/[\d.]+\w*)?\s+/
  for (const m of code.matchAll(/(['"`])((?:\\.|(?!\1).)*?)\1/g)) {
    const s = m[2]
    if (!generic.test(s)) continue
    const first = s
      .replace(shorthand, '')
      .split(',')[0]
      .trim()
      .replace(/^["']|["']$/g, '')
    if (
      first &&
      !/^(sans-serif|serif|monospace|cursive|system-ui)$/.test(first)
    )
      out.add(first)
  }
  return [...out]
}

/** The catalog family for a source family, or null (pure over the catalog). */
export function catalogFamily(family: string): string | null {
  const clean = family.trim().replace(/^['"]|['"]$/g, '')
  return findFontFamily(clean)?.family ?? null
}

function probe(video: string): { fps: number | null; duration: number | null } {
  const res = spawnSync(
    'ffprobe',
    [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-show_entries',
      'stream=r_frame_rate:format=duration',
      '-of',
      'json',
      video,
    ],
    { encoding: 'utf8' },
  )
  try {
    const j = JSON.parse(res.stdout ?? '{}')
    const [n, d] = String(j.streams?.[0]?.r_frame_rate ?? '')
      .split('/')
      .map(Number)
    const fps = n && d ? Math.round((n / d) * 100) / 100 : null
    const duration = Number(j.format?.duration)
    return { fps, duration: Number.isFinite(duration) ? duration : null }
  } catch {
    return { fps: null, duration: null }
  }
}

// The page-side reader, as a string: a serialized function would carry the
// bundler's helpers into a page that has none.
const READ_PAGE = `(() => {
  const root = document.querySelector('[data-composition-id], [data-width][data-height]') || document.body
  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null }
  const canvases = [...document.querySelectorAll('canvas')].map((c) => ({ width: c.width, height: c.height }))
  const biggest = canvases.slice().sort((a, b) => b.width * b.height - a.width * a.height)[0]
  const width = num(root.dataset && root.dataset.width) || (biggest && biggest.width) || window.innerWidth
  const height = num(root.dataset && root.dataset.height) || (biggest && biggest.height) || window.innerHeight
  const rootRect = root.getBoundingClientRect()
  const sx = rootRect.width ? width / rootRect.width : 1
  const sy = rootRect.height ? height / rootRect.height : 1

  const texts = []
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  const seen = new Set()
  let n = 0
  while (walker.nextNode()) {
    const node = walker.currentNode
    const text = (node.textContent || '').replace(/\\s+/g, ' ').trim()
    const el = node.parentElement
    if (!text || !el || ['SCRIPT', 'STYLE', 'NOSCRIPT', 'TITLE'].includes(el.tagName)) continue
    if (seen.has(el)) continue
    seen.add(el)
    const cs = getComputedStyle(el)
    const r = el.getBoundingClientRect()
    const box = r.width && r.height ? {
      x: Math.round((r.left - rootRect.left) * sx), y: Math.round((r.top - rootRect.top) * sy),
      width: Math.round(r.width * sx), height: Math.round(r.height * sy) } : null
    const ls = parseFloat(cs.letterSpacing)
    el.setAttribute('data-vos-inv', String(texts.length))
    const sceneEl = el.closest('.scene, [data-scene], section[id]')
    texts.push({
      id: el.id || (el.className && typeof el.className === 'string' ? el.className.split(' ')[0] : '') || el.tagName.toLowerCase() + '-' + (n++),
      text, tag: el.tagName.toLowerCase(), box, scene: sceneEl && sceneEl.id ? sceneEl.id : null,
      font: { family: cs.fontFamily.split(',')[0].trim().replace(/^["']|["']$/g, ''),
        size: Math.round(parseFloat(cs.fontSize) * sy), weight: Number(cs.fontWeight) || 400,
        style: cs.fontStyle, color: cs.color, letterSpacing: Number.isFinite(ls) ? Math.round(ls * sy * 100) / 100 : 0,
        transform: cs.textTransform },
    })
  }

  const palette = {}
  const isColor = (v) => /^(#[0-9a-f]{3,8}|rgba?\\(|hsla?\\(|oklch\\()/i.test(v)
  const scan = (style) => { for (let i = 0; i < style.length; i++) { const p = style[i]; if (p.startsWith('--')) { const v = style.getPropertyValue(p).trim(); if (isColor(v)) palette[p.slice(2)] = v } } }
  for (const sheet of document.styleSheets) {
    let rules
    try { rules = sheet.cssRules } catch (e) { continue }
    for (const rule of rules) if (rule.style) scan(rule.style)
  }
  scan(root.style)

  const colors = new Set()
  const gaps = new Set()
  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el)
    if (cs.backgroundColor && cs.backgroundColor !== 'rgba(0, 0, 0, 0)') colors.add(cs.backgroundColor)
    if (cs.mixBlendMode && cs.mixBlendMode !== 'normal') gaps.add('mix-blend-mode: ' + cs.mixBlendMode)
    if (cs.clipPath && cs.clipPath !== 'none') gaps.add('clip-path')
    if (cs.maskImage && cs.maskImage !== 'none') gaps.add('mask')
    if (cs.overflow === 'hidden' && el.children.length && el.textContent.trim()) gaps.add('overflow: hidden (a text mask)')
    if (cs.filter && cs.filter !== 'none') gaps.add('filter: ' + cs.filter.split('(')[0])
    if (cs.backdropFilter && cs.backdropFilter !== 'none') gaps.add('backdrop-filter')
    if (cs.perspective && cs.perspective !== 'none') gaps.add('3D perspective')
    if (cs.webkitTextStrokeWidth && parseFloat(cs.webkitTextStrokeWidth) > 0) gaps.add('-webkit-text-stroke (a stroke: see the reference for its width)')
  }
  for (const t of texts) colors.add(t.font.color)

  const media = []
  const attrs = (el) => ({ start: num(el.dataset.start), duration: num(el.dataset.duration), volume: num(el.dataset.volume), mediaStart: num(el.dataset.mediaStart) })
  for (const el of document.querySelectorAll('img')) media.push({ kind: 'image', src: el.getAttribute('src'), ...attrs(el) })
  for (const el of document.querySelectorAll('svg')) if (!el.closest('svg svg')) media.push({ kind: 'svg', src: null, ...attrs(el) })
  for (const el of document.querySelectorAll('video')) media.push({ kind: 'video', src: el.getAttribute('src') || (el.querySelector('source') && el.querySelector('source').getAttribute('src')), ...attrs(el) })
  for (const el of document.querySelectorAll('audio')) media.push({ kind: 'audio', src: el.getAttribute('src') || (el.querySelector('source') && el.querySelector('source').getAttribute('src')), ...attrs(el) })

  const scenes = []
  for (const el of document.querySelectorAll('[data-start]')) {
    if (['AUDIO', 'VIDEO', 'IMG'].includes(el.tagName)) continue
    scenes.push({ name: el.id || el.dataset.compositionId || (typeof el.className === 'string' ? el.className.split(' ')[0] : '') || el.tagName.toLowerCase(), start: num(el.dataset.start) || 0, duration: num(el.dataset.duration) })
  }
  const sceneEls = [...document.querySelectorAll('.scene, [data-scene], section[id]')]
    .filter((el) => el.id)
    .map((el) => el.id)
  let variables = {}
  try { variables = JSON.parse(root.dataset.compositionVariables || '{}') } catch (e) {}
  const scriptText = [...document.querySelectorAll('script:not([src])')].map((s) => s.textContent).join('\\n')
  return {
    width, height, fps: num(root.dataset && root.dataset.fps), duration: num(root.dataset && root.dataset.duration),
    texts, palette, colors: [...colors], gaps: [...gaps], media, canvases, scenes, sceneEls, variables, scriptText,
  }
})()`

/**
 * Re-read the boxes of the texts in one scene with the piece's registered
 * timelines (HyperFrames' `window.__timelines`) seeked to that time: an
 * animated word is laid out where it SETTLES, not where it starts. Returns
 * null when the page registers no timeline.
 */
const SEEK_AND_READ = `((args) => {
  const tls = window.__timelines ? Object.values(window.__timelines) : []
  if (!tls.length) return null
  for (const tl of tls) { try { tl.pause(); tl.seek(args.t, false) } catch (e) {} }
  const root = document.querySelector('[data-composition-id], [data-width][data-height]') || document.body
  const rr = root.getBoundingClientRect()
  const sx = rr.width ? args.width / rr.width : 1
  const sy = rr.height ? args.height / rr.height : 1
  const out = {}
  for (const i of args.indices) {
    const el = document.querySelector('[data-vos-inv="' + i + '"]')
    if (!el) continue
    const r = el.getBoundingClientRect()
    if (r.width && r.height) out[i] = { x: Math.round((r.left - rr.left) * sx), y: Math.round((r.top - rr.top) * sy), width: Math.round(r.width * sx), height: Math.round(r.height * sy) }
  }
  return out
})`

/** Read a source into an inventory, with stills from its render when ffmpeg can. */
export async function readInventory(
  source: string,
  opts: { render?: string | null; outDir: string; log?: (l: string) => void },
): Promise<Inventory> {
  const abs = resolve(source)
  const dir =
    existsSync(abs) && statSync(abs).isDirectory() ? abs : dirname(abs)
  const engine = detectEngine(dir)
  const page = sourcePage(abs)
  const render = opts.render === undefined ? findRender(dir) : opts.render

  let read: any = {
    width: 1920,
    height: 1080,
    fps: null,
    duration: null,
    texts: [],
    palette: {},
    colors: [],
    gaps: [],
    media: [],
    canvases: [],
    scenes: [],
    variables: {},
    scriptText: '',
  }
  const fromRender = render ? probe(render) : { fps: null, duration: null }
  let fps: number | null = fromRender.fps
  let duration: number | null = fromRender.duration
  let settled = 0
  if (page) {
    const browser = await launchBrowser()
    try {
      const ctx = await browser.newContext({
        viewport: { width: 1920, height: 1080 },
      })
      const p = await ctx.newPage()
      // HyperFrames' runtime provides the registry a composition writes its
      // timeline into; outside it the page's own `window.__timelines[id] = tl`
      // would throw, so the registry is created first, as the runtime does.
      await p.addInitScript('window.__timelines = window.__timelines || {}')
      await p.goto(pathToFileURL(page).href, { waitUntil: 'load' })
      await p.evaluate('document.fonts && document.fonts.ready')
      await p.waitForTimeout(300)
      read = await p.evaluate(READ_PAGE)
      fps = read.fps ?? fps
      duration = read.duration ?? duration
      // A composition that reveals its scenes from a script names them there.
      const scripted = scriptScenes(
        read.sceneEls ?? [],
        read.scriptText ?? '',
        duration,
      )
      if (scripted.length > (read.scenes?.length ?? 0)) read.scenes = scripted
      // Lay each scene's words out where they settle, three quarters in.
      for (const s of read.scenes as {
        name: string
        start: number
        duration: number | null
      }[]) {
        const indices = (read.texts as InventoryText[])
          .map((t, i) => (t.scene === s.name ? i : -1))
          .filter((i) => i >= 0)
        if (!indices.length) continue
        const t = s.start + (s.duration ?? 1) * 0.75
        const boxes = (await p.evaluate(
          `${SEEK_AND_READ}(${JSON.stringify({ t, indices, width: read.width, height: read.height })})`,
        )) as Record<string, InventoryText['box']> | null
        if (!boxes) break
        for (const [i, box] of Object.entries(boxes)) {
          read.texts[Number(i)].box = box
          settled++
        }
      }
      await ctx.close()
    } finally {
      await browser.close()
    }
  } else if (engine === 'remotion') {
    opts.log?.(
      'a Remotion project: its words and colours live in its source (src/), which the agent reads; the inventory records the render and its stills',
    )
  }
  if (settled)
    opts.log?.(
      `${settled} words laid out where they settle in their scene (the piece's own timelines, seeked)`,
    )

  const families = new Map<string, InventoryFont>()
  for (const t of read.texts as InventoryText[]) {
    const f = families.get(t.font.family) ?? {
      family: t.font.family,
      weights: [],
      italic: false,
      catalog: catalogFamily(t.font.family),
    }
    if (!f.weights.includes(t.font.weight)) f.weights.push(t.font.weight)
    if (t.font.style === 'italic') f.italic = true
    families.set(t.font.family, f)
  }
  // A page that paints its words names its faces in its script.
  for (const family of scriptFontFamilies(read.scriptText ?? '')) {
    if (!families.has(family))
      families.set(family, {
        family,
        weights: [],
        italic: false,
        catalog: catalogFamily(family),
      })
  }

  const stills: Inventory['stills'] = []
  if (render && duration) {
    const has = spawnSync('ffmpeg', ['-version']).status === 0
    if (has) {
      const refDir = join(opts.outDir, 'ref')
      mkdirSync(refDir, { recursive: true })
      const times =
        read.scenes.length >= 3
          ? read.scenes.map(
              (s: { start: number; duration: number | null }) =>
                s.start + (s.duration ?? 1) / 2,
            )
          : Array.from(
              { length: Math.max(1, Math.floor(duration)) },
              (_, i) => i + 0.5,
            )
      for (const t of times.filter((t: number) => t < duration)) {
        const file = join(refDir, `src-${t.toFixed(2)}.png`)
        const ok =
          spawnSync('ffmpeg', [
            '-v',
            'error',
            '-y',
            '-ss',
            String(t),
            '-i',
            render,
            '-frames:v',
            '1',
            '-vf',
            'scale=960:-2',
            file,
          ]).status === 0
        if (ok)
          stills.push({
            t: Number(t.toFixed(2)),
            file: relative(opts.outDir, file),
          })
      }
    } else {
      opts.log?.(
        'no ffmpeg on PATH: no reference stills (install it to get them)',
      )
    }
  }

  const scriptStrings = scriptStringsOf(read.scriptText as string)
  return {
    source: relative(process.cwd(), abs) || '.',
    root: abs.endsWith('.html') ? dirname(abs) : abs,
    engine,
    width: read.width,
    height: read.height,
    fps,
    duration,
    scenes: read.scenes,
    texts: read.texts,
    palette: read.palette,
    colors: read.colors,
    fonts: [...families.values()],
    media: read.media,
    canvases: read.canvases,
    gaps: read.gaps,
    variables: read.variables,
    scriptStrings,
    render: render ? relative(process.cwd(), render) : null,
    stills,
  }
}
