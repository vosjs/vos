/**
 * The page's own console errors, as the recorder reports them. A page
 * under recording is someone else's, and its errors are context, never the
 * story: a third party's Content-Security-Policy violation runs to a few
 * kilobytes and repeats on every load, which buried the step lines. So the
 * log gets one line per distinct error, cut short, and a repeat is counted
 * instead of printed; the full text stays in the result (and a verbose
 * host prints every one whole).
 */

/** How much of an error a log line keeps. */
export const PAGE_ERROR_LINE_CHARS = 160

export interface PageError {
  /** the full text, whitespace as the page wrote it */
  text: string
  count: number
}

/** One line of an error: whitespace collapsed, cut to the line's length. */
export function pageErrorLine(text: string): string {
  const one = text.replace(/\s+/g, ' ').trim()
  return one.length > PAGE_ERROR_LINE_CHARS
    ? `${one.slice(0, PAGE_ERROR_LINE_CHARS - 1)}…`
    : one
}

export class PageErrorLog {
  private readonly seen = new Map<string, PageError>()

  constructor(private readonly verbose = false) {}

  /** The line to log for this error now, or null when it repeats one already said. */
  add(text: string): string | null {
    const known = this.seen.get(text)
    if (known) {
      known.count++
      return this.verbose ? `   [page error] ${text}` : null
    }
    this.seen.set(text, { text, count: 1 })
    return `   [page error] ${this.verbose ? text : pageErrorLine(text)}`
  }

  /** Every distinct error with how often it came, in the order first seen. */
  entries(): PageError[] {
    return [...this.seen.values()].map((e) => ({ ...e }))
  }

  /** The closing lines: each error that repeated, with its count. */
  repeats(): string[] {
    if (this.verbose) return []
    return [...this.seen.values()]
      .filter((e) => e.count > 1)
      .map((e) => `   [page error ×${e.count}] ${pageErrorLine(e.text)}`)
  }
}
