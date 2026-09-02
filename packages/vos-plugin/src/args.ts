/** Minimal argv parser — mirrors @vosjs/cli's conventions. */
export interface ParsedArgs {
  positionals: string[]
  flags: Record<string, string | true>
  /** Values of flags declared repeatable (multiFlags) — accumulated in order. */
  multi: Record<string, string[]>
}

export class UsageError extends Error {}

export function parseArgs(
  argv: string[],
  booleanFlags: ReadonlySet<string>,
  multiFlags: ReadonlySet<string> = new Set(),
): ParsedArgs {
  const positionals: string[] = []
  const flags: Record<string, string | true> = {}
  const multi: Record<string, string[]> = {}
  const put = (name: string, value: string): void => {
    if (multiFlags.has(name)) (multi[name] ??= []).push(value)
    else flags[name] = value
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--') {
      positionals.push(...argv.slice(i + 1))
      break
    }
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=')
      if (eq !== -1) {
        put(arg.slice(2, eq), arg.slice(eq + 1))
        continue
      }
      const name = arg.slice(2)
      if (booleanFlags.has(name)) {
        flags[name] = true
        continue
      }
      if (i + 1 >= argv.length || argv[i + 1].startsWith('--')) {
        throw new UsageError(`--${name} expects a value`)
      }
      put(name, argv[i + 1])
      i++
      continue
    }
    positionals.push(arg)
  }
  return { positionals, flags, multi }
}

export function numFlag(
  flags: ParsedArgs['flags'],
  name: string,
  fallback: number,
): number {
  const v = flags[name]
  if (typeof v !== 'string') return fallback
  const n = Number(v)
  if (!Number.isFinite(n))
    throw new UsageError(`--${name} expects a number, got "${v}"`)
  return n
}

/** String flag value, or undefined when absent (or boolean). */
export function strFlag(
  flags: ParsedArgs['flags'],
  name: string,
): string | undefined {
  const v = flags[name]
  return typeof v === 'string' ? v : undefined
}

export function hasFlag(flags: ParsedArgs['flags'], name: string): boolean {
  return Object.prototype.hasOwnProperty.call(flags, name)
}
