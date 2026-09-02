/** Output conventions — logs on stderr, results on stdout, --json NDJSON. */
export const EXIT_OK = 0
export const EXIT_ERROR = 1
export const EXIT_USAGE = 2
export const EXIT_NO_BROWSER = 3

export interface Reporter {
  json: boolean
  log: (msg: string) => void
  event: (obj: Record<string, unknown>) => void
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
      if (json)
        process.stdout.write(`${JSON.stringify({ event: 'done', ...obj })}\n`)
      else process.stdout.write(`${humanLine}\n`)
    },
  }
}
