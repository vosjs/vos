import { inflateRawSync } from 'node:zlib'
import type { ZipEntry } from '@vosjs/studio-core'

/**
 * A trace zip's entry inflated under a budget. A zip declares each entry's
 * size, but the declaration is the file's word: a small archive can inflate
 * to anything, and a trace read with no ceiling would take the machine's
 * memory with it. So an entry is held to a cap, the archive to a total,
 * and the inflater itself stops at the ceiling rather than trusting the
 * declared size.
 */
export const TRACE_ENTRY_MAX_BYTES = 64 * 1024 * 1024
export const TRACE_TOTAL_MAX_BYTES = 256 * 1024 * 1024

export interface InflateBudget {
  /** The most one entry may inflate to. */
  entry: number
  /** The most every entry together may inflate to. */
  total: number
  /** What the entries read so far took; advanced by each read. */
  used: number
}

export function traceBudget(
  caps: Partial<Pick<InflateBudget, 'entry' | 'total'>> = {},
): InflateBudget {
  return {
    entry: caps.entry ?? TRACE_ENTRY_MAX_BYTES,
    total: caps.total ?? TRACE_TOTAL_MAX_BYTES,
    used: 0,
  }
}

const mib = (n: number) =>
  `${(n / (1024 * 1024)).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MiB`

/** The entry's bytes, stored or inflated, within the budget. */
export function inflateEntry(
  raw: Uint8Array,
  entry: Pick<ZipEntry, 'name' | 'method' | 'size'>,
  budget: InflateBudget,
): Uint8Array {
  const room = Math.min(budget.entry, budget.total - budget.used)
  const over = (bytes: string) =>
    new Error(
      `${entry.name} inflates to ${bytes}, past the ${mib(budget.entry)} an entry may take (${mib(budget.total)} for the whole trace); this is not a trace the recorder reads`,
    )
  if (entry.size > room) throw over(mib(entry.size))
  let out: Uint8Array
  if (entry.method === 8) {
    try {
      out = new Uint8Array(inflateRawSync(raw, { maxOutputLength: room + 1 }))
    } catch (e) {
      if ((e as { code?: string }).code === 'ERR_BUFFER_TOO_LARGE')
        throw over(`more than ${mib(room)}`)
      throw e
    }
  } else {
    out = raw
  }
  if (out.length > room) throw over(mib(out.length))
  budget.used += out.length
  return out
}
