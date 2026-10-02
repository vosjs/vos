/** Output conventions — logs on stderr, results on stdout, --json NDJSON. */
export const EXIT_OK = 0
export const EXIT_ERROR = 1
export const EXIT_USAGE = 2
export const EXIT_NO_BROWSER = 3
/** The recorder met a sign-in instead of the page it was asked for. */
export const EXIT_WALL = 4

export interface Reporter {
  json: boolean
  log: (msg: string) => void
  /**
   * Something the person must hear about. Under --json it is a `warning`
   * event, because a log line is silent there and an agent driving the CLI
   * reads only events: a dropped file said only on stderr was never said.
   */
  warn: (msg: string) => void
  event: (obj: Record<string, unknown>) => void
  done: (obj: Record<string, unknown>, humanLine: string) => void
}

export function createReporter(json: boolean): Reporter {
  return {
    json,
    log: (msg) => {
      if (!json) process.stderr.write(`${msg}\n`)
    },
    warn: (msg) => {
      if (json) {
        process.stdout.write(
          `${JSON.stringify({ event: 'warning', message: msg })}\n`,
        )
      } else process.stderr.write(`warning ${msg}\n`)
    },
    event: (obj) => {
      if (json) process.stdout.write(`${JSON.stringify(obj)}\n`)
    },
    done: (obj, humanLine) => {
      if (json)
        process.stdout.write(`${JSON.stringify({ event: 'done', ...obj })}\n`)
      else process.stdout.write(`${humanLine}\n`)
    },
  }
}
