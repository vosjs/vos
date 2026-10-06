/**
 * `{$data: key}` bindings — element props resolved from the host's data
 * object at render time and re-resolved on setData (live edit, no re-init).
 *
 * A text element binds its whole `content`, or the words of single RUNS in
 * a styled content (`[{ text: { $data: 'word' }, weight: 700 }]`): the knob
 * keeps editing plain words and the run keeps its style.
 *
 * Bindings live in the elements config, which is part of the compiled
 * program, so a data-only change never alters the program hash: hosts
 * classify it as SET_DATA and the element re-rasters in place. Split text
 * resolves at boot only — per-unit meshes and timeline segment bindings make
 * live content changes structural (a fresh boot always resolves correctly).
 */
export interface DataRef {
  $data: string
}

export function isDataRef(value: unknown): value is DataRef {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { $data?: unknown }).$data === 'string' &&
    (value as { $data: string }).$data.length > 0
  )
}

/** Bound prop → data key, for the props a text element can re-raster. */
export interface TextBindings {
  content?: string
  /** Runs of a styled content whose words are bound: `[index, data key]`. */
  runs?: [number, string][]
  family?: string
  color?: string
}

/** A styled content with its bound runs' words read from `data`. */
export function resolveBoundRuns(
  content: readonly unknown[],
  runs: readonly [number, string][],
  data: Record<string, unknown> | null | undefined,
): unknown[] {
  const out = content.slice()
  for (const [index, key] of runs) {
    out[index] = {
      ...(content[index] as object),
      text: String(data?.[key] ?? ''),
    }
  }
  return out
}

export function extractTextBindings(config: any): TextBindings | null {
  if (config?.type !== 'text') return null
  const bindings: TextBindings = {}
  if (isDataRef(config.content)) bindings.content = config.content.$data
  else if (Array.isArray(config.content)) {
    const runs: [number, string][] = []
    config.content.forEach((run: any, i: number) => {
      if (isDataRef(run?.text)) runs.push([i, run.text.$data])
    })
    if (runs.length) bindings.runs = runs
  }
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
  if (bindings.content) out.content = String(data?.[bindings.content] ?? '')
  if (bindings.runs) {
    out.content = resolveBoundRuns(config.content, bindings.runs, data)
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
