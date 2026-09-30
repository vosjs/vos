/**
 * What vos.so keeps of a config's knobs (`params`) and Looks (`presets`).
 *
 * A vos.so fact, so it lives in the platform client: the platform keeps at
 * most 12 knobs and 8 Looks, each within its field limits, and drops the
 * rest ONE BY ONE with a warning (it used to drop them all, silently). This
 * mirrors that rule so `vos check` says the same thing before a push does.
 */
export const MAX_PARAMS = 12
export const MAX_LOOKS = 8

const KINDS = new Set(['number', 'color', 'select', 'toggle', 'text', 'font'])

const str = (v: unknown, max: number, min = 0) =>
  typeof v === 'string' && v.length >= min && v.length <= max

/** Why one knob would be dropped, or null when vos.so keeps it. */
export function knobProblem(p: unknown): string | null {
  if (!p || typeof p !== 'object') return 'not an object'
  const k = p as Record<string, unknown>
  if (!str(k.key, 40, 1)) return 'key must be 1 to 40 characters'
  if (typeof k.kind !== 'string' || !KINDS.has(k.kind))
    return `kind must be one of ${[...KINDS].join(', ')}`
  if (k.label !== undefined && !str(k.label, 60))
    return 'label: at most 60 characters'
  if (k.hint !== undefined && !str(k.hint, 140))
    return 'hint: at most 140 characters'
  if (k.unit !== undefined && !str(k.unit, 8))
    return 'unit: at most 8 characters'
  if (k.group !== undefined && !str(k.group, 24))
    return 'group: at most 24 characters'
  if (k.options !== undefined) {
    if (!Array.isArray(k.options) || k.options.length > 12)
      return 'options: at most 12'
    if (k.options.some((o) => !str(o, 40, 1)))
      return 'options: each 1 to 40 characters'
  }
  const d = k.default
  if (
    !(
      typeof d === 'number' ||
      typeof d === 'boolean' ||
      (typeof d === 'string' && d.length <= 280)
    )
  )
    return 'default must be a number, a boolean or at most 280 characters'
  return null
}

/** Why one Look would be dropped, or null when vos.so keeps it. */
export function lookProblem(l: unknown): string | null {
  if (!l || typeof l !== 'object') return 'not an object'
  const look = l as Record<string, unknown>
  if (!str(look.name, 24, 1)) return 'name must be 1 to 24 characters'
  if (!look.values || typeof look.values !== 'object') return 'values missing'
  return null
}

/** Every knob and Look vos.so would drop, in words, in order. */
export function knobWarnings(config: Record<string, unknown>): string[] {
  const out: string[] = []
  const sort = (
    raw: unknown,
    noun: 'knob' | 'look',
    field: string,
    max: number,
    problem: (e: unknown) => string | null,
  ) => {
    if (raw === undefined) return
    if (!Array.isArray(raw)) {
      out.push(`${noun === 'knob' ? 'params' : 'presets'} is not a list`)
      return
    }
    let kept = 0
    raw.forEach((entry, i) => {
      const id =
        entry && typeof (entry as Record<string, unknown>)[field] === 'string'
          ? `${noun} "${String((entry as Record<string, unknown>)[field])}"`
          : `${noun} #${i + 1}`
      const why = problem(entry)
      if (why) out.push(`${id} would be dropped on vos.so (${why})`)
      else if (kept >= max)
        out.push(
          `${id} would be dropped on vos.so: a vos keeps at most ${max} ${noun}s${noun === 'knob' ? ' (the rest can stay bound data)' : ''}`,
        )
      else kept += 1
    })
  }
  sort(config.params, 'knob', 'key', MAX_PARAMS, knobProblem)
  sort(config.presets, 'look', 'name', MAX_LOOKS, lookProblem)
  return out
}
