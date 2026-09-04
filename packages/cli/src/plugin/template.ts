/**
 * A poster TEMPLATE is a program with a contract: which element carries
 * the release's shot (the slot), which params the brand and the release
 * fill, which text elements say what (and how long they may run), and how
 * the layout recomposes per aspect. The contract rides the config as
 * `config.template`; the filler here writes the slot's geometry, the text
 * and the brand into a copy per destination, and reports the text boxes it
 * placed so the picture checks can read them. Pure: no renderer here, the
 * poster page renders the filled config like any program.
 */
import type { TextBox } from './kitPicture'

export type TemplateAspect = 'landscape' | 'square' | 'portrait'

/** Where a slot goes, as fractions of the frame. */
export interface SlotPlace {
  /** Left edge, fraction of the width (may run past 1 to bleed). */
  x: number
  /** Top edge, fraction of the height. */
  y: number
  /** Width, fraction of the width (may exceed 1 - x to bleed off the right). */
  w: number
}

export interface TemplateSlot {
  /** The element id that carries it. */
  id: string
  kind: 'image'
  required?: boolean
}

export interface TemplateText {
  /** The text element id. */
  element: string
  /** The data key (and param) whose value it shows. */
  param: string
  role: 'headline' | 'body'
  maxWords?: number
  lines?: number
}

export interface TemplateLayout {
  /** Slot placements by slot id. */
  slots: Record<string, SlotPlace>
  /** Text element positions by element id, the engine's own position grammar. */
  text?: Record<string, { x: string; y: string }>
  /** Text element font sizes by element id, in design px (H=1080). */
  size?: Record<string, number>
  /** Elements hidden in this aspect (opacity 0, timeline untouched). */
  hide?: string[]
}

export interface TemplateSpec {
  family: string
  slots: TemplateSlot[]
  params: {
    required?: string[]
    /** Brand roles the template reads from BRAND.md by the same names. */
    brand?: string[]
  }
  text: TemplateText[]
  layouts: Partial<Record<TemplateAspect, TemplateLayout>> & {
    landscape: TemplateLayout
  }
}

type Config = Record<string, unknown>
type Element = Record<string, unknown> & {
  id?: string
  type?: string
  position?: { x?: string | number; y?: string | number }
  size?: { width?: number | 'auto'; height?: number | 'auto'; fit?: string }
  font?: Record<string, unknown>
  content?: unknown
  opacity?: number
}

export function templateOf(config: Config): TemplateSpec | null {
  const t = config.template
  if (!t || typeof t !== 'object') return null
  return t as TemplateSpec
}

/** Which layout an output size takes. */
export function aspectOf(size: { w: number; h: number }): TemplateAspect {
  const r = size.w / Math.max(1, size.h)
  if (r > 1.15) return 'landscape'
  if (r < 0.87) return 'portrait'
  return 'square'
}

/**
 * The contract's problems, in words: every slot names an element of its
 * kind, every text entry names a text element and a declared param, every
 * required param is declared, every layout places every slot. Empty = a
 * valid template.
 */
export function templateProblems(config: Config): string[] {
  const t = templateOf(config)
  if (!t) return ['no template block: a poster template declares config.template']
  const out: string[] = []
  const elements = (Array.isArray(config.elements) ? config.elements : []) as Element[]
  const byId = new Map(elements.filter((e) => e.id).map((e) => [e.id as string, e]))
  const params = (Array.isArray(config.params) ? config.params : []) as { key?: string }[]
  const keys = new Set(params.map((p) => p.key).filter(Boolean) as string[])
  if (!t.family) out.push('template.family is missing')
  for (const s of t.slots ?? []) {
    const el = byId.get(s.id)
    if (!el) out.push(`template.slots: no element with id "${s.id}"`)
    else if (el.type !== s.kind)
      out.push(`template.slots: "${s.id}" is a ${String(el.type)} element, the slot wants ${s.kind}`)
  }
  for (const x of t.text ?? []) {
    const el = byId.get(x.element)
    if (!el) out.push(`template.text: no element with id "${x.element}"`)
    else if (el.type !== 'text') out.push(`template.text: "${x.element}" is not a text element`)
    if (!keys.has(x.param)) out.push(`template.text: param "${x.param}" is not declared in config.params`)
    const bound = el?.content as { $data?: string } | undefined
    if (el && (!bound || typeof bound !== 'object' || bound.$data !== x.param))
      out.push(`template.text: "${x.element}" must bind its content to {$data: "${x.param}"}`)
  }
  for (const k of t.params?.required ?? []) {
    if (!keys.has(k)) out.push(`template.params.required: "${k}" is not declared in config.params`)
  }
  if (!t.layouts?.landscape) out.push('template.layouts.landscape is required')
  for (const [name, layout] of Object.entries(t.layouts ?? {})) {
    for (const s of t.slots ?? []) {
      if (!layout?.slots?.[s.id]) out.push(`template.layouts.${name}: slot "${s.id}" is not placed`)
    }
  }
  return out
}

export interface FillInput {
  /** The destination's pixels. */
  size: { w: number; h: number }
  /**
   * Slot sources by slot id: a URL the poster page can fetch, the image's
   * own aspect, and the transparent pad a baked shot carries on each side
   * (a fraction of the shot's width), so the CARD keeps the slot's width.
   */
  slots: Record<string, { src: string; aspect: number; pad?: number }>
  /** Data values: brand roles, the release's words. */
  values: Record<string, unknown>
}

export interface FillResult {
  config: Config
  /** Where the words landed, as fractions of the frame, for the picture checks. */
  text: TextBox[]
  /** Where each slot's CARD landed (the shot without its bake pad), fractions of the frame. */
  slots: Record<string, { x: number; y: number; w: number; h: number }>
  aspect: TemplateAspect
  /** Data keys the template requires that were not supplied. */
  missing: string[]
}

const pctOf = (v: string | number | undefined): number | null => {
  if (typeof v === 'number') return null
  if (typeof v !== 'string') return null
  const m = /^(-?\d+(?:\.\d+)?)%$/.exec(v.trim())
  return m ? Number(m[1]) / 100 : null
}

/**
 * Fill a template for one destination: the slot's geometry in design px
 * (H = 1080 space, W from the aspect), the layout's text positions and
 * sizes, the values into `data` (and each param's default, so the studio
 * shows them), the slot's src. Elements the layout hides go to opacity 0.
 * Returns the text boxes it can account for.
 */
export function fillTemplate(config: Config, input: FillInput): FillResult {
  const t = templateOf(config)
  if (!t) throw new Error('fillTemplate: the config carries no template block')
  const aspect = aspectOf(input.size)
  const layout = t.layouts[aspect] ?? t.layouts.landscape
  const out = structuredClone(config)
  const designH = 1080
  const designW = (designH * input.size.w) / input.size.h
  const elements = (Array.isArray(out.elements) ? out.elements : []) as Element[]
  const byId = new Map(elements.filter((e) => e.id).map((e) => [e.id as string, e]))

  // The slots: src + geometry from the layout's placement.
  const slotRects: FillResult['slots'] = {}
  for (const s of t.slots) {
    const el = byId.get(s.id)
    const place = layout.slots[s.id]
    const src = input.slots[s.id]
    if (!el || !place) continue
    if (src) el.src = src.src
    const pad = src?.pad ?? 0
    slotRects[s.id] = {
      x: place.x,
      y: place.y,
      w: place.w,
      h: (place.w * (input.size.w / input.size.h)) / (src?.aspect ?? 16 / 9),
    }
    const w = place.w * designW * (1 + 2 * pad)
    const x = place.x - place.w * pad
    const y = place.y - (place.w * pad * (input.size.w / input.size.h)) / (src?.aspect ?? 16 / 9)
    el.position = { x: `${(x * 100).toFixed(2)}%`, y: `${(y * 100).toFixed(2)}%` }
    el.anchor = 'top-left'
    el.size = { ...(el.size ?? {}), width: Math.round(w), height: 'auto' }
    if (!src && s.required) el.opacity = 0
  }

  // The words: data values (+ param defaults), positions and sizes.
  const data = (out.data && typeof out.data === 'object' ? { ...(out.data as Config) } : {}) as Config
  const params = (Array.isArray(out.params) ? out.params : []) as { key?: string; default?: unknown }[]
  const missing: string[] = []
  for (const k of [...(t.params.required ?? []), ...(t.params.brand ?? [])]) {
    if (input.values[k] === undefined || input.values[k] === null || input.values[k] === '') {
      if ((t.params.required ?? []).includes(k)) missing.push(k)
      continue
    }
    data[k] = input.values[k]
    const p = params.find((q) => q.key === k)
    if (p) p.default = input.values[k]
  }
  // Every supplied value wins over the template's own default: the
  // defaults are what a bare template shows, never what a filled one keeps.
  for (const [k, v] of Object.entries(input.values)) {
    if (v !== undefined && v !== null && v !== '') {
      data[k] = v
      const p = params.find((q) => q.key === k)
      if (p) p.default = v
    }
  }
  out.data = data

  const boxes: TextBox[] = []
  for (const x of t.text) {
    const el = byId.get(x.element)
    if (!el) continue
    const pos = layout.text?.[x.element]
    if (pos) el.position = { x: pos.x, y: pos.y }
    const size = layout.size?.[x.element]
    if (size) el.font = { ...(el.font ?? {}), size }
    if (layout.hide?.includes(x.element)) {
      el.opacity = 0
      continue
    }
    const value = data[x.param]
    if (typeof value !== 'string' || !value.trim()) continue
    const font = (el.font ?? {}) as { size?: number; lineHeight?: number; color?: unknown; align?: string }
    const px = typeof font.size === 'number' ? font.size : 40
    const lines = value.split('\n')
    const longest = Math.max(...lines.map((l) => l.length))
    const lh = typeof font.lineHeight === 'number' ? font.lineHeight : 1.15
    const boxW = longest * px * 0.56
    const boxH = lines.length * px * lh
    const ex = pctOf(el.position?.x) ?? 0
    const ey = pctOf(el.position?.y) ?? 0
    const anchor = String(el.anchor ?? 'center')
    let left = ex * designW
    let top = ey * designH
    if (anchor.includes('right')) left -= boxW
    else if (!anchor.includes('left')) left -= boxW / 2
    if (anchor.includes('bottom')) top -= boxH
    else if (!anchor.includes('top')) top -= boxH / 2
    // A bound colour resolves through data (the brand's ink), a literal stays.
    const rawColor = font.color as string | { $data?: string } | undefined
    const color =
      typeof rawColor === 'string'
        ? rawColor
        : rawColor && typeof rawColor === 'object' && typeof rawColor.$data === 'string'
          ? (data[rawColor.$data] as string | undefined)
          : undefined
    boxes.push({
      x: left / designW,
      y: top / designH,
      w: boxW / designW,
      h: boxH / designH,
      color: color && /^#[0-9a-f]{6}$/i.test(color) ? color : undefined,
      role: x.role,
      label: value.length > 24 ? `${value.slice(0, 24)}…` : value,
    })
  }
  for (const id of layout.hide ?? []) {
    const el = byId.get(id)
    if (el && !t.text.some((x) => x.element === id)) el.opacity = 0
  }
  return { config: out, text: boxes, slots: slotRects, aspect, missing }
}

/** A headline's shape against the template's own limits, in words. */
export function textLimitProblems(t: TemplateSpec, values: Record<string, unknown>): string[] {
  const out: string[] = []
  for (const x of t.text) {
    const v = values[x.param]
    if (typeof v !== 'string') continue
    const words = v.trim().split(/\s+/).filter(Boolean).length
    const lines = v.split('\n').length
    if (x.maxWords && words > x.maxWords)
      out.push(`${x.param}: ${words} words, the template holds ${x.maxWords}`)
    if (x.lines && lines > x.lines)
      out.push(`${x.param}: ${lines} lines, the template holds ${x.lines}`)
  }
  return out
}
