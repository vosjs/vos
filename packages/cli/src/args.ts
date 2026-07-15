/**
 * Minimal argv parser — positionals + `--flag value` / `--flag=value` /
 * boolean flags. Deliberately tiny: the CLI has a small, stable surface and
 * agents benefit from predictable, dependency-free parsing.
 */
export interface ParsedArgs {
  positionals: string[]
  flags: Record<string, string | true>
}

export class UsageError extends Error {}

export function parseArgs(argv: string[], booleanFlags: ReadonlySet<string>): ParsedArgs {
  const positionals: string[] = []
  const flags: Record<string, string | true> = {}
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--') {
      positionals.push(...argv.slice(i + 1))
      break
    }
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=')
      if (eq !== -1) {
        flags[arg.slice(2, eq)] = arg.slice(eq + 1)
        continue
      }
      const name = arg.slice(2)
      if (booleanFlags.has(name)) {
        flags[name] = true
        continue
      }
      const next = argv[i + 1]
      if (next === undefined || next.startsWith('--')) {
        throw new UsageError(`--${name} expects a value`)
      }
      flags[name] = next
      i++
      continue
    }
    positionals.push(arg)
  }
  return { positionals, flags }
}

export function numFlag(
  flags: ParsedArgs['flags'],
  name: string,
  fallback: number,
): number {
  const v = flags[name]
  if (v === undefined) return fallback
  const n = Number(v)
  if (!Number.isFinite(n)) throw new UsageError(`--${name} expects a number, got "${String(v)}"`)
  return n
}
