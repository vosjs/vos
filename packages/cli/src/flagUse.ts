/**
 * Which of the flags a person gave did the verb actually READ?
 *
 * The parsers accept any `--name`, so a mistyped or misplaced flag used to be
 * swallowed: `vos frames <take> --at 3,5,8` wrote five evenly spread stills
 * and exited 0, because the flag is `--times` and nothing ever looked at
 * `at`. It looked like it worked.
 *
 * A declared list per verb would be the obvious guard and the wrong one here:
 * several verbs read their options through data (a name table, a helper three
 * calls down), so a list drifts, and the day it drifts it REFUSES a real flag
 * for every agent at once. Reading is the truth, so reading is what is
 * recorded: both parsers hand back their flags behind a proxy that notes each
 * name a verb asks for, and the CLI's one exit point compares that with what
 * was given. It cannot reject a flag a verb uses, by construction.
 *
 * The cost of being certain is that the verdict lands AFTER the verb ran, so
 * the message says so plainly: the command ran, without that flag.
 */

const given = new Set<string>()
const used = new Set<string>()

/** A flag bag that remembers which names were asked for. */
export function trackFlags<T extends Record<string, unknown>>(bag: T): T {
  return new Proxy(bag, {
    get(target, key, receiver) {
      if (typeof key === 'string') used.add(key)
      return Reflect.get(target, key, receiver)
    },
    has(target, key) {
      if (typeof key === 'string') used.add(key)
      return Reflect.has(target, key)
    },
    // hasOwnProperty.call(flags, name) lands here.
    getOwnPropertyDescriptor(target, key) {
      if (typeof key === 'string') used.add(key)
      return Reflect.getOwnPropertyDescriptor(target, key)
    },
    // A spread, Object.keys or JSON.stringify hands every flag onward; what
    // happens to them after that cannot be seen, so they all count as read.
    ownKeys(target) {
      for (const key of Reflect.ownKeys(target))
        if (typeof key === 'string') used.add(key)
      return Reflect.ownKeys(target)
    },
  })
}

export function noteGivenFlag(name: string): void {
  given.add(name)
}

/** Flags that were given and never read, in the order they were given. */
export function unusedFlags(): string[] {
  return [...given].filter((name) => !used.has(name) && name !== 'help')
}

export function resetFlagUse(): void {
  given.clear()
  used.clear()
}

/**
 * The `--flags` a verb documents: its `vos <verb>` line in a help text plus
 * the indented lines that continue it.
 */
export function helpFlagsFor(help: string, verb: string): string[] {
  const out = new Set<string>()
  let inVerb = false
  for (const line of help.split('\n')) {
    const head = /^\s{2}vos\s+(\S+)/.exec(line)
    if (head) inVerb = head[1] === verb
    else if (!/^\s{3,}\S/.test(line)) inVerb = false
    if (!inVerb) continue
    for (const m of line.matchAll(/--([a-z][a-z0-9-]*)/g)) out.add(m[1])
  }
  return [...out]
}

function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]
    row[0] = i
    for (let j = 1; j <= b.length; j++) {
      const keep = row[j]
      row[j] = Math.min(
        row[j] + 1,
        row[j - 1] + 1,
        prev + (a[i - 1] === b[j - 1] ? 0 : 1),
      )
      prev = keep
    }
  }
  return row[b.length]
}

/** The documented flag a mistyped one most likely meant, or null. */
export function nearestFlag(name: string, candidates: string[]): string | null {
  let best: string | null = null
  let bestScore = Infinity
  for (const c of candidates) {
    if (c === name) continue
    // A candidate that contains the name (or the reverse) is as close as a
    // one-letter slip: `--zooms` for `--at-zooms`, `--body` for `--body-px`.
    const d =
      c.includes(name) || name.includes(c) ? 1 : editDistance(name, c)
    if (d < bestScore) {
      bestScore = d
      best = c
    }
  }
  return best !== null && bestScore <= Math.max(2, Math.floor(name.length / 3))
    ? best
    : null
}

/** The sentence for a run that ignored what it was given, or null when nothing was. */
export function unusedFlagsMessage(
  verb: string,
  documented: string[],
): string | null {
  const unused = unusedFlags()
  if (!unused.length) return null
  const parts = unused.map((name) => {
    const near = nearestFlag(name, documented)
    return `--${name}${near ? ` (did you mean --${near}?)` : ''}`
  })
  const list = documented.length
    ? ` It reads: ${documented.map((f) => `--${f}`).join(' ')}.`
    : ''
  return `vos ${verb} RAN, and ignored ${parts.join(', ')}: ${unused.length > 1 ? 'they are' : 'it is'} not something this verb reads, so what it printed above was made without ${unused.length > 1 ? 'them' : 'it'}.${list}`
}
