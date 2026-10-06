/**
 * `{$data: key}` bindings — element props resolved from the host's data
 * object at render time and re-resolved on setData (live edit, no re-init).
 *
 * A text element binds its whole `content`, or single fields of the RUNS in
 * a styled content: a run's words (`{ text: { $data: 'word' } }`), so a
 * knob keeps editing plain words while the run keeps its style, and a run's
 * `color` or `highlight`, so one knob turns the accent of every word that
 * wears it.
 *
 * Bindings live in the elements config, which is part of the compiled
 * program, so a data-only change never alters the program hash: hosts
 * classify it as SET_DATA and the element re-rasters in place. Split text
 * resolves at boot only — per-unit meshes and timeline segment bindings make
 * live content changes structural (a fresh boot always resolves correctly).
 */
import { isDataRef, resolveRunColors, toRichText } from './text/runs'
import type { RichText } from './text/runs'

export { isDataRef }
export type { DataRef } from './text/runs'

/** Bound prop → data key, for the props a text element can re-raster. */
export interface TextBindings {
  /** The whole content is one binding: its data key. */
  content?: string
  /** The content is a list of runs, and some field of one reads data. */
  runs?: true
  family?: string
  color?: string
}

const RUN_FIELDS = ['text', 'color', 'highlight'] as const

/**
 * Whether a text element's content reads anything from data: the whole of
 * it, or a run's words or colours.
 */
export function contentIsBound(content: unknown): boolean {
  if (isDataRef(content)) return true
  return (
    Array.isArray(content) &&
    content.some(
      (run) =>
        run !== null &&
        typeof run === 'object' &&
        RUN_FIELDS.some((f) => isDataRef((run as Record<string, unknown>)[f])),
    )
  )
}

/**
 * A text element's content with every binding READ from `data`: what is
 * drawn. A bound whole is its string; a bound run's words are their string
 * (empty when the key holds none); a bound colour is its string, or nothing
 * (the element's own colour) when the key holds none. Content that reads no
 * data comes back as it was written.
 */
export function resolveTextContent(
  content: unknown,
  data: Record<string, unknown> | null | undefined,
): unknown {
  if (isDataRef(content)) return String(data?.[content.$data] ?? '')
  if (!Array.isArray(content) || !contentIsBound(content)) return content
  const worded = content.map((run) =>
    run !== null && typeof run === 'object' && isDataRef(run.text)
      ? { ...run, text: String(data?.[run.text.$data] ?? '') }
      : run,
  )
  return resolveRunColors(toRichText(worded), data) satisfies RichText
}

export function extractTextBindings(config: any): TextBindings | null {
  if (config?.type !== 'text') return null
  const bindings: TextBindings = {}
  if (isDataRef(config.content)) bindings.content = config.content.$data
  else if (contentIsBound(config.content)) bindings.runs = true
  if (isDataRef(config.font?.family)) bindings.family = config.font.family.$data
  if (isDataRef(config.font?.color)) bindings.color = config.font.color.$data
  return bindings.content || bindings.runs || bindings.family || bindings.color
    ? bindings
    : null
}

/**
 * Resolve bound props into a working copy (the raw config stays untouched —
 * it is the compiled program's truth). A missing or non-string data value
 * falls back to the renderer's defaults rather than stringifying an object.
 */
export function resolveTextElement(
  config: any,
  bindings: TextBindings,
  data: Record<string, unknown> | null | undefined,
): any {
  const out = { ...config }
  if (bindings.content || bindings.runs) {
    out.content = resolveTextContent(config.content, data)
  }
  if (bindings.family || bindings.color) {
    const font = { ...(config.font ?? {}) }
    if (bindings.family) {
      const v = data?.[bindings.family]
      if (typeof v === 'string' && v) font.family = v
      else delete font.family
    }
    if (bindings.color) {
      const v = data?.[bindings.color]
      if (typeof v === 'string' && v) font.color = v
      else delete font.color
    }
    out.font = font
  }
  return out
}
