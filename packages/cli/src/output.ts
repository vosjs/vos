/**
 * Output conventions (agent-safe by construction):
 * - logs/progress → stderr (human readable)
 * - results → stdout; with --json, NDJSON events (`{"event":"phase"...}` then
 *   `{"event":"done"...}`) so scripts and agents never parse prose
 * - exit codes: 0 ok · 1 failure · 2 usage · 3 browser unavailable
 */
export const EXIT_OK = 0
export const EXIT_ERROR = 1
export const EXIT_USAGE = 2
export const EXIT_NO_BROWSER = 3

export interface Reporter {
  json: boolean
  /** Human log line (stderr; suppressed in --json mode). */
  log: (msg: string) => void
  /** Machine event (stdout NDJSON in --json mode; no-op otherwise). */
  event: (obj: Record<string, unknown>) => void
  /** Final result: NDJSON `done` event in --json mode, plain line otherwise. */
  done: (obj: Record<string, unknown>, humanLine: string) => void
}

export function createReporter(json: boolean): Reporter {
  return {
    json,
    log: (msg) => {
      if (!json) process.stderr.write(`${msg}\n`)
    },
    event: (obj) => {
      if (json) process.stdout.write(`${JSON.stringify(obj)}\n`)
    },
    done: (obj, humanLine) => {
      if (json) process.stdout.write(`${JSON.stringify({ event: 'done', ...obj })}\n`)
      else process.stdout.write(`${humanLine}\n`)
    },
  }
}
