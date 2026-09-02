/**
 * Config params: `config.params`
 * declares the `ctx.data` keys a program reads as its creative knobs — key,
 * kind, range, default. THE one params module, shared by the web Remix
 * panel, the API, and scripts (the knob honesty lint): edits commit by
 * baking BOTH `params[i].default` and `data[key]` into the config, so
 * saves/exports/server renders pick the values up through the existing
 * `config.data` machinery with zero new plumbing.
 *
 * The engine schema does not know `params` yet (upstream addition pending) —
 * `vosConfigJsonSchema` STRIPS unknown fields on parse, so the API re-attaches
 * validated params at the storage boundary (the platform's server-side copy;
 * change both together) and
 * this module validates defensively.
 */

import { findFontFamily, fontFaceUrl } from './fonts'

export type ParamValue = number | string | boolean

export interface ParamSpec {
  /** The ctx.data key the program reads. */
  key: string
  /** Human label; falls back to the key. */
  label?: string
  /** One sentence on what the knob changes (U3b — knobs carry meaning). */
  hint?: string
  /** Unit shown inside the number field: px, %, s, ×, °. */
  unit?: string
  /** Optional card grouping; ungrouped knobs land on the Remix card. */
  group?: string
  /** Sort order within a group (falls back to declaration order). */
  order?: number
  kind: 'number' | 'color' | 'select' | 'toggle' | 'text' | 'font'
  /** number kind */
  min?: number
  max?: number
  step?: number
  /**
   * select kind: the enumerated choices (REQUIRED, ≥2). font kind: an
   * OPTIONAL curation — the families the knob offers; absent = the whole
   * hosted catalog. Faces travel with the value: `applyParamValue` writes
   * the chosen family's hosted faces into `data.fonts`, which the engine
   * (core ≥0.17) registers at boot and on SET_DATA — no `config.fonts`
   * declaration needed, no recompile.
   */
  options?: string[]
  /** text kind: render a multiline editor (content knobs, e.g. a headline). */
  multiline?: boolean
  default: ParamValue
}

/**
 * A Look (U3b): a named set of param values — the feel-the-range layer.
 * Tap a look, then fine-tune; applying is ONE undoable multi-value commit.
 */
export interface LookPreset {
  name: string
  values: Record<string, ParamValue>
}

const KINDS = new Set(['number', 'color', 'select', 'toggle', 'text', 'font'])

/**
 * Text params carry URLs (modelUrl knobs) and bound content
 * (headline knobs) — longer than other string kinds.
 */
export const TEXT_PARAM_MAX = 280

/** Validate raw config.params defensively; invalid entries are dropped. */
export function readParams(
  config: Record<string, unknown> | null | undefined,
): ParamSpec[] {
  const raw = config?.params
  if (!Array.isArray(raw)) return []
  const out: ParamSpec[] = []
  const seen = new Set<string>()
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const p = entry as Record<string, unknown>
    const key = p.key
    const kind = p.kind
    if (typeof key !== 'string' || !key || seen.has(key)) continue
    if (typeof kind !== 'string' || !KINDS.has(kind)) continue
    const label = typeof p.label === 'string' ? p.label : undefined
    const meta = {
      hint: typeof p.hint === 'string' ? p.hint : undefined,
      unit: typeof p.unit === 'string' ? p.unit : undefined,
      group: typeof p.group === 'string' ? p.group : undefined,
      order: typeof p.order === 'number' ? p.order : undefined,
    }
    if (kind === 'number') {
      if (typeof p.default !== 'number') continue
      const min = typeof p.min === 'number' ? p.min : 0
      const max = typeof p.max === 'number' ? p.max : 1
      if (!(max > min)) continue
      out.push({
        key,
        label,
        ...meta,
        kind,
        min,
        max,
        step: typeof p.step === 'number' && p.step > 0 ? p.step : undefined,
        default: Math.min(max, Math.max(min, p.default)),
      })
    } else if (kind === 'color') {
      if (typeof p.default !== 'string' || !p.default) continue
      out.push({ key, label, ...meta, kind, default: p.default })
    } else if (kind === 'text') {
      // Empty default is meaningful (a modelUrl knob's "use the built-in").
      if (typeof p.default !== 'string' || p.default.length > TEXT_PARAM_MAX)
        continue
      out.push({
        key,
        label,
        ...meta,
        kind,
        multiline: p.multiline === true ? true : undefined,
        default: p.default,
      })
    } else if (kind === 'select' || kind === 'font') {
      const options = Array.isArray(p.options)
        ? p.options.filter((o): o is string => typeof o === 'string' && !!o)
        : []
      if (typeof p.default !== 'string') continue
      if (kind === 'font' && options.length === 0) {
        // Optionless font knob = the whole hosted catalog. The default fails
        // open like FontField does (an unknown family renders verbatim);
        // faces travel in data.fonts via applyParamValue, so no curation is
        // required for fleet honesty since engine 0.17.
        if (!p.default) continue
        out.push({ key, label, ...meta, kind, default: p.default })
      } else {
        if (options.length < 2) continue
        out.push({
          key,
          label,
          ...meta,
          kind,
          options,
          default: options.includes(p.default) ? p.default : options[0],
        })
      }
    } else {
      if (typeof p.default !== 'boolean') continue
      out.push({ key, label, ...meta, kind: 'toggle', default: p.default })
    }
    seen.add(key)
  }
  return out
}

/**
 * Current committed value per param: `config.data[key]` when type-compatible
 * (a previously baked edit), else the spec default.
 */
export function paramValues(
  config: Record<string, unknown> | null | undefined,
  specs: readonly ParamSpec[],
): Record<string, ParamValue> {
  const data =
    config?.data && typeof config.data === 'object'
      ? (config.data as Record<string, unknown>)
      : {}
  const out: Record<string, ParamValue> = {}
  for (const spec of specs) {
    const v = data[spec.key]
    out[spec.key] =
      typeof v === typeof spec.default ? (v as ParamValue) : spec.default
  }
  return out
}

/**
 * Validate raw `config.presets` (Looks, U3b) against the declared params:
 * a look keeps only values whose key is declared AND whose type matches the
 * spec default; looks with no surviving values are dropped. Like params,
 * looks are progressive enhancement — never a load blocker.
 */
export function readLooks(
  config: Record<string, unknown> | null | undefined,
  specs: readonly ParamSpec[],
): LookPreset[] {
  const raw = config?.presets
  if (!Array.isArray(raw) || specs.length === 0) return []
  const byKey = new Map(specs.map((s) => [s.key, s]))
  const out: LookPreset[] = []
  const seen = new Set<string>()
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const p = entry as Record<string, unknown>
    const name = p.name
    if (typeof name !== 'string' || !name || seen.has(name)) continue
    if (!p.values || typeof p.values !== 'object') continue
    const values: Record<string, ParamValue> = {}
    for (const [k, v] of Object.entries(p.values as Record<string, unknown>)) {
      const spec = byKey.get(k)
      if (!spec) continue
      if (typeof v !== typeof spec.default) continue
      values[k] = v as ParamValue
    }
    if (!Object.keys(values).length) continue
    out.push({ name, values })
    seen.add(name)
  }
  return out
}

/** Apply a set of param values to a config draft — ONE recipe, one undo. */
export function applyParamValues(
  cfg: Record<string, unknown>,
  values: Record<string, ParamValue>,
): void {
  for (const [key, value] of Object.entries(values)) {
    applyParamValue(cfg, key, value)
  }
}

/**
 * Bake a param value into a config draft (patch-store recipe body): updates
 * the matching `params[i].default` AND `data[key]` — data is what playback,
 * exports, and server renders actually read.
 */
export function applyParamValue(
  cfg: Record<string, unknown>,
  key: string,
  value: ParamValue,
): void {
  if (Array.isArray(cfg.params)) {
    for (const entry of cfg.params) {
      if (
        entry &&
        typeof entry === 'object' &&
        (entry as Record<string, unknown>).key === key
      ) {
        ;(entry as Record<string, unknown>).default = value
      }
    }
  }
  // Write IN PLACE, never replace the object: this runs inside a patch-store
  // recipe, and a replaced `data` is a patch even when nothing changed — a
  // re-commit of an equal value (a field's blur after a scrub) minted an undo
  // entry that undid nothing. An equal assignment produces no patch.
  if (!cfg.data || typeof cfg.data !== 'object') cfg.data = {}
  ;(cfg.data as Record<string, unknown>)[key] = value
  syncDataFonts(cfg)
}

/** Hosted faces for a catalog family — one entry per weight (weights are
 * files, not synthesis). Unknown families contribute nothing (fail-open:
 * the renderer falls back to the preset stack, like FontField). */
function facesFor(
  family: string,
): { family: string; url: string; weight: number }[] {
  const entry = findFontFamily(family)
  if (!entry) return []
  return entry.weights.map((w) => ({
    family: entry.family,
    weight: w,
    url: fontFaceUrl(entry.slug, w),
  }))
}

/**
 * Faces travel with the value: rebuild `data.fonts` from EVERY font-kind
 * knob's current value — the engine (core ≥0.17) registers them at boot and
 * on SET_DATA, so a font knob needs no `config.fonts` declaration and no
 * recompile. Rebuilding (not appending) prunes families no knob points at
 * any more; deterministic, so probes and saves agree byte-for-byte. Only
 * configs WITH font knobs get a `data.fonts` key.
 */
function syncDataFonts(cfg: Record<string, unknown>): void {
  const specs = Array.isArray(cfg.params) ? cfg.params : []
  const fontSpecs = specs.filter(
    (p): p is Record<string, unknown> =>
      !!p && typeof p === 'object' && (p as { kind?: unknown }).kind === 'font',
  )
  if (!fontSpecs.length) return
  const data = cfg.data as Record<string, unknown>
  const faces: { family: string; url: string; weight: number }[] = []
  const seen = new Set<string>()
  for (const spec of fontSpecs) {
    const specKey = spec.key
    const dataValue = typeof specKey === 'string' ? data[specKey] : undefined
    const v =
      typeof dataValue === 'string'
        ? dataValue
        : typeof spec.default === 'string'
          ? spec.default
          : ''
    for (const face of facesFor(v)) {
      const id = `${face.family}|${face.weight}`
      if (seen.has(id)) continue
      seen.add(id)
      faces.push(face)
    }
  }
  cfg.data = { ...data, fonts: faces }
}

// ---------------------------------------------------------------------------
// {$data} element bindings: the engine resolves `{$data: key}` refs on
// text `content` / `font.family` / `font.color` from ctx.data and re-rasters
// on SET_DATA — which is what gives text/font knobs something to bind.
// ---------------------------------------------------------------------------

function refKey(v: unknown): string | null {
  if (
    v &&
    typeof v === 'object' &&
    typeof (v as { $data?: unknown }).$data === 'string' &&
    (v as { $data: string }).$data
  )
    return (v as { $data: string }).$data
  return null
}

export interface BoundElementProp {
  /** The ctx.data key the prop is bound to. */
  key: string
  elementId: string
  prop: 'content' | 'family' | 'color'
  /** Split text resolves bindings at boot only — a change is structural. */
  split: boolean
}

/** Enumerate `{$data}`-bound text element props declared in a config. */
export function readBindings(
  config: Record<string, unknown> | null | undefined,
): BoundElementProp[] {
  const elements = Array.isArray(config?.elements) ? config.elements : []
  const out: BoundElementProp[] = []
  elements.forEach((el, index) => {
    if (!el || typeof el !== 'object') return
    const e = el as Record<string, any>
    if (e.type !== 'text') return
    const elementId = typeof e.id === 'string' ? e.id : `element_${index}`
    const split = !!e.split
    const content = refKey(e.content)
    if (content) out.push({ key: content, elementId, prop: 'content', split })
    const family = refKey(e.font?.family)
    if (family) out.push({ key: family, elementId, prop: 'family', split })
    const color = refKey(e.font?.color)
    if (color) out.push({ key: color, elementId, prop: 'color', split })
  })
  return out
}

/**
 * Data keys whose change is STRUCTURAL: bound into split text, which the
 * engine resolves at boot only (per-unit meshes + timeline segment bindings).
 * Hosts must fold these keys' VALUES into the held-program identity so a
 * change costs one warm LOAD instead of leaving stale glyphs on screen.
 */
export function structuralDataKeys(
  config: Record<string, unknown> | null | undefined,
): string[] {
  return [
    ...new Set(
      readBindings(config)
        .filter((b) => b.split)
        .map((b) => b.key),
    ),
  ]
}
