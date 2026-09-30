/**
 * What the output is, decided from what the person asked for.
 *
 * Pure, so the engine verbs (a program) and the take verbs agree: a file
 * named `out.mp4` IS an mp4, an explicit `--format` that contradicts the
 * name is refused instead of writing one container under the other's name,
 * and a still named `.png` is a PNG.
 */
import { UsageError } from './args'

export type VideoFormat = 'webm' | 'mp4'
export type StillFormat = 'webp' | 'png' | 'jpeg'

function extOf(path: string | undefined): string {
  return /\.([a-z0-9]+)$/i.exec(path ?? '')?.[1]?.toLowerCase() ?? ''
}

/** The video container: the flag, else the output's name, else WebM. */
export function videoFormat(
  flag: string | undefined,
  out: string | undefined,
): VideoFormat {
  const named = extOf(out)
  const fromName: VideoFormat | null =
    named === 'mp4' ? 'mp4' : named === 'webm' ? 'webm' : null
  if (flag !== undefined) {
    if (flag !== 'webm' && flag !== 'mp4')
      throw new UsageError('--format must be webm or mp4')
    if (fromName && fromName !== flag)
      throw new UsageError(
        `--format ${flag} contradicts the output name ${out}: name it .${flag}, or drop --format and the name decides`,
      )
    return flag
  }
  return fromName ?? 'webm'
}

/** The still's encoding, from its name. The engine captures WebP. */
export function stillFormat(out: string): StillFormat {
  const ext = extOf(out)
  if (ext === 'png') return 'png'
  if (ext === 'jpg' || ext === 'jpeg') return 'jpeg'
  if (ext === 'webp' || ext === '') return 'webp'
  throw new UsageError(
    `vos still writes .webp, .png or .jpg, not .${ext}: rename ${out}`,
  )
}

/**
 * `--times 0,1.5,50%,100%`: seconds or percentages of the duration, in the
 * order given. 100% is clamped a hair inside the end, where the last frame is.
 */
export function parseTimes(raw: string, duration: number): number[] {
  const times = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const pct = /^(\d+(?:\.\d+)?)%$/.exec(s)
      const t = pct ? (Number(pct[1]) / 100) * duration : Number(s)
      if (!Number.isFinite(t) || t < 0)
        throw new UsageError(
          `--times expects seconds or percentages (0,1.5,50%), got "${s}"`,
        )
      return Math.min(t, Math.max(0, duration - 1 / 60))
    })
  if (!times.length) throw new UsageError('--times needs at least one time')
  return times
}

/** Where the still for one time of several goes: `name-1.50s.ext`. */
export function stillOutFor(out: string, time: number, many: boolean): string {
  if (!many) return out
  const m = /^(.*?)(\.[a-z0-9]+)?$/i.exec(out)
  return `${m?.[1] ?? out}-${time.toFixed(2)}s${m?.[2] ?? ''}`
}

/** Every `--set` value in argv, in order (the parser keeps only the last). */
export function setFlags(argv: string[]): string[] {
  const out: string[] = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--set' && argv[i + 1] !== undefined) out.push(argv[++i])
    else if (a.startsWith('--set=')) out.push(a.slice('--set='.length))
  }
  return out
}

/**
 * `--set data.<key>=<value>` on a PROGRAM: the knob-honesty check without a
 * second config. The value reads as JSON when it parses (numbers, booleans,
 * arrays) and as a string otherwise. Patched in memory, never written back.
 */
export function applyDataSets(
  config: Record<string, unknown>,
  sets: string[],
): Record<string, unknown> {
  if (!sets.length) return config
  const data: Record<string, unknown> = {
    ...((config.data as Record<string, unknown> | undefined) ?? {}),
  }
  for (const set of sets) {
    const eq = set.indexOf('=')
    const path = eq === -1 ? set : set.slice(0, eq)
    const m = /^data\.([A-Za-z0-9_$-]+)$/.exec(path)
    if (eq === -1 || !m)
      throw new UsageError(
        `--set on a program takes data.<key>=<value> (a knob's value), got "${set}"`,
      )
    const raw = set.slice(eq + 1)
    let value: unknown = raw
    try {
      value = JSON.parse(raw)
    } catch {
      // a bare word is a string: --set data.name=ROBIN
    }
    data[m[1]] = value
  }
  return { ...config, data }
}
