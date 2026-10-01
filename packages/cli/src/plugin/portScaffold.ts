/**
 * `vos port scaffold` — an inventory turned into a program that already
 * keeps the port grammar: every word a data key bound to a text element,
 * every colour a data key, the faces from the catalog, the knobs over them,
 * a label per scene, the score as a document track. What it cannot know is
 * the motion: each scene carries a TODO where the agent translates it, with
 * the vos-port skill's tables open.
 */
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { findFontFamily, fontFaceUrl, nearestFontWeight } from '@vosjs/shared'
import type { Inventory, InventoryText } from './portInventory'

const DESIGN_HEIGHT = 1080

/** `#rrggbb` (or `#rrggbbaa`) for a CSS colour the browser computed (pure). */
export function toHex(css: string): string {
  const s = css.trim()
  if (/^#[0-9a-f]{3,8}$/i.test(s)) {
    if (s.length === 4)
      return `#${[...s.slice(1)].map((c) => c + c).join('')}`.toLowerCase()
    return s.toLowerCase()
  }
  const m =
    /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,/\s]+([\d.]+%?))?\s*\)$/i.exec(
      s,
    )
  if (!m) return s
  const hex = (v: number) =>
    Math.round(Math.max(0, Math.min(255, v)))
      .toString(16)
      .padStart(2, '0')
  let a =
    m[4] === undefined
      ? 1
      : m[4].endsWith('%')
        ? Number(m[4].slice(0, -1)) / 100
        : Number(m[4])
  if (!Number.isFinite(a)) a = 1
  return `#${hex(+m[1])}${hex(+m[2])}${hex(+m[3])}${a < 1 ? hex(a * 255) : ''}`
}

/** A JS identifier from any label (pure), unique against `taken`. */
export function keyFor(
  label: string,
  taken: Set<string>,
  prefix = 't',
): string {
  const words = label
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .slice(0, 4)
  let base = words
    .map((w, i) =>
      i === 0 ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1).toLowerCase(),
    )
    .join('')
  if (!base || /^[0-9]/.test(base)) base = prefix + (base || '')
  let key = base
  for (let n = 2; taken.has(key); n++) key = `${base}${n}`
  taken.add(key)
  return key
}

/** A catalog face for a family the catalog lacks, by what its name says (pure). */
export function substituteFamily(family: string): string {
  const f = family.toLowerCase()
  if (/mono|code|courier/.test(f)) return 'JetBrains Mono'
  if (/serif/.test(f) && !/sans/.test(f)) return 'Source Serif 4'
  if (/condensed|compressed|black|anton|bebas|oswald/.test(f)) return 'Anton'
  return 'Inter'
}

export interface ScaffoldPlan {
  program: string
  doc: Record<string, unknown>
  report: string
  /** Files to copy beside the program: [from, to-basename]. */
  copies: [string, string][]
}

const fmtPct = (v: number) => `${Math.round(v * 10000) / 100}%`

/** Plan the scaffold from an inventory (pure but for the score's duration probe). */
export function planScaffold(
  inv: Inventory,
  opts: { sourceDir: string; probeDuration?: (file: string) => number | null },
): ScaffoldPlan {
  const taken = new Set<string>(['scenes', 'bg'])
  const data: Record<string, unknown> = {}
  const report: string[] = []
  const scale = DESIGN_HEIGHT / (inv.height || DESIGN_HEIGHT)

  // ── palette: the source's own custom properties first ──
  const colorKey = new Map<string, string>()
  for (const [name, value] of Object.entries(inv.palette)) {
    const key = keyFor(name, taken, 'color')
    const hex = toHex(value)
    data[key] = hex
    if (!colorKey.has(hex)) colorKey.set(hex, key)
  }
  const colorOf = (css: string): string => {
    const hex = toHex(css)
    const known = colorKey.get(hex)
    if (known) return known
    const key = keyFor(`color ${colorKey.size + 1}`, taken, 'color')
    data[key] = hex
    colorKey.set(hex, key)
    return key
  }
  data.bg = inv.colors.length ? toHex(inv.colors[0]) : '#000000'

  // ── words: one key and one bound element each ──
  const faces = new Map<
    string,
    {
      family: string
      weights: Set<number>
      italic: boolean
      from: string | null
    }
  >()
  const faceFor = (t: InventoryText) => {
    const hit = findFontFamily(t.font.family)
    const family = hit?.family ?? substituteFamily(t.font.family)
    const face = faces.get(family) ?? {
      family,
      weights: new Set(),
      italic: false,
      from: hit ? null : t.font.family,
    }
    face.weights.add(t.font.weight)
    if (t.font.style === 'italic') face.italic = true
    faces.set(family, face)
    return family
  }
  const elements: Record<string, unknown>[] = []
  const textKeys: { key: string; size: number; label: string }[] = []
  const sceneNames = new Set(inv.scenes.map((s) => s.name))
  const sceneElements: Record<string, string[]> = {}
  for (const t of inv.texts) {
    const generic = /^(div|span|p|h[1-6]|li|a|b|i|em|strong)-\d+$/.test(t.id)
    const key = keyFor(generic ? t.text : t.id, taken)
    const words =
      t.font.transform === 'uppercase'
        ? t.text.toUpperCase()
        : t.font.transform === 'lowercase'
          ? t.text.toLowerCase()
          : t.text
    data[key] = words
    const family = faceFor(t)
    elements.push({
      id: key,
      type: 'text',
      content: { $data: key },
      position: t.box
        ? { x: fmtPct(t.box.x / inv.width), y: fmtPct(t.box.y / inv.height) }
        : 'center',
      font: {
        family,
        size: Math.round(t.font.size * scale),
        weight: t.font.weight,
        ...(t.font.style === 'italic' ? { style: 'italic' } : {}),
        color: { $data: colorOf(t.font.color) },
        ...(t.font.letterSpacing
          ? {
              letterSpacing: Math.round(t.font.letterSpacing * scale * 10) / 10,
            }
          : {}),
      },
    })
    textKeys.push({ key, size: t.font.size, label: words.slice(0, 40) })
    if (t.scene && sceneNames.has(t.scene))
      (sceneElements[t.scene] ??= []).push(key)
  }

  // ── faces: catalog URLs, substitutions said ──
  const fonts: Record<string, unknown>[] = []
  for (const face of faces.values()) {
    const entry = findFontFamily(face.family)
    if (!entry) continue
    for (const w of face.weights) {
      const weight = nearestFontWeight(entry, w)
      fonts.push({
        family: entry.family,
        weight,
        url: fontFaceUrl(entry.slug, weight),
      })
    }
    if (face.italic) {
      const italics = (entry as { italics?: number[] }).italics ?? []
      if (italics.length) {
        const weight = italics.includes(400) ? 400 : italics[0]
        fonts.push({
          family: entry.family,
          weight,
          style: 'italic',
          url: fontFaceUrl(entry.slug, weight, 'italic'),
        })
      }
    }
  }

  // Faces the source paints with outside a text node (a canvas script's font
  // stacks): declared at every hosted weight, so the painter draws with them.
  const painterFaces: string[] = []
  for (const f of inv.fonts) {
    if (!f.catalog || faces.has(f.catalog)) continue
    const entry = findFontFamily(f.catalog)
    if (!entry) continue
    for (const weight of entry.weights)
      fonts.push({
        family: entry.family,
        weight,
        url: fontFaceUrl(entry.slug, weight),
      })
    for (const weight of (entry as { italics?: number[] }).italics ?? [])
      fonts.push({
        family: entry.family,
        weight,
        style: 'italic',
        url: fontFaceUrl(entry.slug, weight, 'italic'),
      })
    painterFaces.push(entry.family)
  }
  for (const f of inv.fonts) {
    if (
      !f.catalog &&
      !faces.has(substituteFamily(f.family)) &&
      !inv.texts.some((t) => t.font.family === f.family)
    )
      report.push(
        `- **${f.family}** (named in the scripts) is not in the catalog: draw with ${substituteFamily(f.family)} and say so in the push note`,
      )
  }
  if (painterFaces.length)
    report.push(
      `- faces the scripts paint with, declared at every hosted weight for the painter: ${painterFaces.join(', ')}`,
    )

  // ── scenes ──
  data.scenes = inv.scenes.map((s) => ({
    name: s.name,
    at: s.start,
    until:
      s.duration == null
        ? null
        : Math.round((s.start + s.duration) * 1000) / 1000,
  }))
  // Which words each scene shows: until the motion is translated, a scene's
  // words are on screen exactly in its window, so the scaffold already plays
  // as the source's sequence.
  data.sceneElements = sceneElements

  // ── knobs: the palette, then the largest words, up to 12 ──
  const params: Record<string, unknown>[] = []
  const paletteKeys = [...colorKey.values()].slice(0, 6)
  for (const key of paletteKeys)
    params.push({
      key,
      label: key,
      kind: 'color',
      default: data[key],
      group: 'Colours',
    })
  for (const t of [...textKeys].sort((a, b) => b.size - a.size)) {
    if (params.length >= 12) break
    params.push({
      key: t.key,
      label: t.label,
      kind: 'text',
      default: data[t.key],
      group: 'Words',
    })
  }
  const presets = paletteKeys.length
    ? [
        {
          name: 'Original',
          values: Object.fromEntries(paletteKeys.map((k) => [k, data[k]])),
        },
      ]
    : []

  const painter = inv.canvases.length > 0 || inv.gaps.length > 0
  const duration = Math.round((inv.duration ?? 5) * 1000) / 1000
  const program = programSource({
    source: inv.source,
    duration,
    data,
    params,
    presets,
    fonts,
    elements,
    scenes: inv.scenes,
    painter,
  })

  // ── the score: a document track, the file beside the program ──
  const audio: Record<string, unknown>[] = []
  const copies: [string, string][] = []
  inv.media
    .filter((m) => m.kind === 'audio' && m.src)
    .forEach((m, i) => {
      const from = resolve(opts.sourceDir, m.src as string)
      const name = basename(from)
      if (!existsSync(from)) {
        report.push(
          `- the audio ${m.src} is not in the source folder; add it to doc.json by hand`,
        )
        return
      }
      copies.push([from, name])
      const fileDuration = opts.probeDuration?.(from) ?? m.duration ?? duration
      audio.push({
        id: `score${i ? i + 1 : ''}`,
        key: name,
        name,
        start: m.start ?? 0,
        in: m.mediaStart ?? 0,
        out: Math.min(
          fileDuration,
          (m.mediaStart ?? 0) + (m.duration ?? fileDuration),
        ),
        duration: fileDuration,
        gain: m.volume ?? 1,
        fadeIn: 0,
        fadeOut: 0,
      })
    })
  const short = Math.min(inv.width, inv.height)
  const doc: Record<string, unknown> = {
    program: {},
    audio,
    export: {
      resolution:
        short >= 2160
          ? '4k'
          : short >= 1440
            ? '2k'
            : short >= 1080
              ? '1080p'
              : '720p',
      fps: (inv.fps ?? 30) >= 50 ? 60 : 30,
      format: 'mp4',
    },
  }

  return {
    program,
    doc,
    copies,
    report: reportText(inv, {
      faces: [...faces.values()],
      elements: elements.length,
      params: params.length,
      painter,
      scores: audio.map((a) => String(a.key)),
      extra: report,
    }),
  }
}

function programSource(p: {
  source: string
  duration: number
  data: Record<string, unknown>
  params: Record<string, unknown>[]
  presets: Record<string, unknown>[]
  fonts: Record<string, unknown>[]
  elements: Record<string, unknown>[]
  scenes: { name: string; start: number; duration: number | null }[]
  painter: boolean
}): string {
  const j = (v: unknown) => JSON.stringify(v, null, 2).replace(/\n/g, '\n  ')
  const sceneTodos = p.scenes.length
    ? p.scenes
        .map(
          (s) =>
            `    // TODO scene "${s.name}" (${s.start}s${s.duration ? ` to ${s.start + s.duration}s` : ''}): translate its motion onto ctx.elements.get(id).props / .segments here`,
        )
        .join('\n')
    : "    // TODO: translate the source's motion here, one block per scene (tl.addLabel above names them)"
  const painterContent = p.painter
    ? `
    // THE PAINTER (vos-port rule 6): one canvas, only for what no element can
    // say (the inventory's gaps and canvases). It reads every value from
    // ctx.data. Its plane sits above the elements; move its renderOrder
    // between two of them to paint between (SKILL.md "Layering").
    const T = ctx.THREE
    const canvas = document.createElement('canvas')
    canvas.width = ctx.resolution.width
    canvas.height = ctx.resolution.height
    const tex = new T.CanvasTexture(canvas)
    tex.colorSpace = T.SRGBColorSpace
    const plane = new T.Mesh(
      new T.PlaneGeometry(1, 1),
      new T.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false }),
    )
    plane.scale.set(ctx.resolution.width, ctx.resolution.height, 1)
    plane.renderOrder = 100.995
    plane.frustumCulled = false
    ctx.overlayScene.add(plane)
    // The starter's helpers: Remotion's interpolate, a seeded PRNG, smooth noise.
    const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v)
    const interpolate = (v, [a, b], [x, y], ease = (t) => t) =>
      x + (y - x) * ease(clamp01((v - a) / (b - a)))
    const rand = (seed) => () => {
      seed |= 0
      seed = (seed + 0x6d2b79f5) | 0
      let r = Math.imul(seed ^ (seed >>> 15), 1 | seed)
      r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296
    }
    const hash = (x, y) => {
      const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453
      return s - Math.floor(s)
    }
    const noise2 = (x, y) => {
      const xi = Math.floor(x), yi = Math.floor(y)
      const xf = x - xi, yf = y - yi
      const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf)
      const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1)
      return (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v) * 2 - 1
    }
    return { objects: [], refs: { canvas, g: canvas.getContext('2d'), tex, lib: { interpolate, rand, noise2 } } }`
    : `
    return { objects: [], refs: {} }`
  const painterFrame = p.painter
    ? `
    // Paint the procedural layer from ctx.time and ctx.data, then upload it.
    const { canvas, g, tex } = content.refs
    g.clearRect(0, 0, canvas.width, canvas.height)
    // TODO: draw what no element can (grain, a blended HUD, noise blobs, masks)
    tex.needsUpdate = true`
    : ''
  return `// Scaffolded by \`vos port scaffold\` from ${p.source}.
// Every word and colour is in \`data\`, bound to an element or read by a
// painter; the knobs sit over them. What is left is the MOTION: translate each
// scene where it says TODO, with the vos-port skill's tables open. Then:
//   npx vos build program.mjs && npx vos check config.json
//   npx vos compare . --against <the source's render>
export default {
  version: 2,
  duration: ${p.duration},
  camera: { preset: 'fullscreen' },
  fonts: ${j(p.fonts)},
  data: ${j(p.data)},
  params: ${j(p.params)},
  presets: ${j(p.presets)},
  elements: ${j(p.elements)},

  createContent(ctx) {
    ctx.scene.background = new ctx.THREE.Color(ctx.data.bg)${painterContent}
  },

  createTimeline(ctx, content, duration) {
    const tl = ctx.gsap.timeline()
    for (const s of ctx.data.scenes) {
      tl.addLabel(s.name, s.at)
      // Each scene's words show in its window; the motion replaces this.
      for (const id of ctx.data.sceneElements[s.name] || []) {
        const p = ctx.elements.get(id).props
        if (s.at > 0) {
          tl.set(p, { opacity: 0 }, 0)
          tl.set(p, { opacity: 1 }, s.at)
        }
        if (s.until != null && s.until < duration) tl.set(p, { opacity: 0 }, s.until)
      }
    }
${sceneTodos}
    tl.to({}, { duration }, 0)
    return tl
  },

  onFrame(ctx, content) {
    ctx.scene.background.set(ctx.data.bg)${painterFrame}
  },
}
`
}

function reportText(
  inv: Inventory,
  r: {
    faces: { family: string; from: string | null; italic: boolean }[]
    elements: number
    params: number
    painter: boolean
    scores: string[]
    extra: string[]
  },
): string {
  const lines = [
    `# Port report: ${inv.source}`,
    '',
    `${inv.engine} piece, ${inv.width}×${inv.height}${inv.fps ? ` at ${inv.fps} fps` : ''}, ${inv.duration ?? '?'} s. ` +
      `A program has no size of its own: render it with \`--width ${inv.width} --height ${inv.height}\`.`,
    '',
    '## Placed',
    '',
    `- ${r.elements} words as bound text elements, ${Object.keys(inv.palette).length} palette colours from the source's custom properties, ${r.params} knobs.`,
    `- ${inv.scenes.length} scenes as labels${inv.scenes.length ? '' : ' (none declared: name them as you translate)'}.`,
    ...(r.scores.length
      ? [
          `- the score as a doc.json track (${r.scores.join(', ')}, copied beside the program; vos push uploads it).`,
        ]
      : []),
    '',
    '## Faces',
    '',
    ...r.faces.map((f) =>
      f.from
        ? `- **${f.from}** is not in the catalog: substituted with ${f.family}. Say so in the push note.`
        : `- ${f.family}${f.italic ? ' (italic)' : ''}: from the catalog.`,
    ),
    '',
    '## Needs a painter or an approximation',
    '',
    ...(inv.canvases.length
      ? [
          `- ${inv.canvases.length} canvas${inv.canvases.length === 1 ? '' : 'es'}: the source paints pixels; port those parts as the painter, with their values in data.`,
        ]
      : []),
    ...inv.gaps.map((g) => `- ${g}`),
    ...(r.painter ? [] : ['- nothing: every visible part is an element.']),
    ...(inv.scriptStrings.length && inv.canvases.length
      ? [
          '',
          '## Words the scripts paint',
          '',
          'The page draws these on its canvas, so no text node holds them. Each one a person reads becomes a data key and a bound element:',
          '',
          ...inv.scriptStrings
            .slice(0, 40)
            .map((s) => `- ${JSON.stringify(s)}`),
        ]
      : []),
    ...(inv.media.some((m) => m.kind === 'image' || m.kind === 'video')
      ? [
          '',
          '## Images and video',
          '',
          'Not placed: upload each with `vos asset upload` and add an image or video element over its hosted URL.',
          '',
          ...inv.media
            .filter((m) => m.kind === 'image' || m.kind === 'video')
            .map((m) => `- ${m.kind} ${m.src ?? '(inline)'}`),
        ]
      : []),
    ...(r.extra.length ? ['', '## Also', '', ...r.extra] : []),
    '',
    '## Reference',
    '',
    inv.render
      ? `The source's render: ${inv.render}. Stills in port/ref/. Check every scene: \`npx vos compare . --against ${inv.render}\`.`
      : 'No render of the source was found: render it with its own tool and pass it to `vos compare --against`.',
    '',
  ]
  return lines.join('\n')
}

/** Write a scaffold to `outDir` (the program, its document, the report, the score). */
export function writeScaffold(plan: ScaffoldPlan, outDir: string): void {
  mkdirSync(outDir, { recursive: true })
  writeFileSync(join(outDir, 'program.mjs'), plan.program)
  writeFileSync(
    join(outDir, 'doc.json'),
    JSON.stringify(plan.doc, null, 2) + '\n',
  )
  writeFileSync(join(dirname(outDir), 'REPORT.md'), plan.report)
  for (const [from, name] of plan.copies) copyFileSync(from, join(outDir, name))
}

export function probeAudioDuration(file: string): number | null {
  const res = spawnSync(
    'ffprobe',
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file],
    { encoding: 'utf8' },
  )
  const d = Number((res.stdout ?? '').trim())
  return Number.isFinite(d) && d > 0 ? Math.round(d * 1000) / 1000 : null
}
