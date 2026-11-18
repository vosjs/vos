/**
 * `vos feedback "<message>" [--kind problem|idea] [--dry-run]`: the one way
 * a report of what broke leaves the machine.
 *
 * It is the person's to send, so it hides nothing: before anything goes it
 * prints the address and the whole body, and `--dry-run` stops there. The
 * body is three fields (the kind, the message as typed, the word "cli") and
 * nothing is added to it: no path, no file, no machine name, no version.
 * It carries NO credential, even when one is stored or VOS_API_KEY is set:
 * a report is not an act on an account, and this verb never reads the
 * credential ladder at all.
 */
import { UsageError, parseArgs, strFlag } from './args'
import { EXIT_ERROR, EXIT_OK, createReporter } from './output'
import { detailLine, platformOrigin, unreachable } from './platform'

const BOOLEAN_FLAGS = new Set(['json', 'help', 'dry-run'])

export const FEEDBACK_KINDS = ['problem', 'idea'] as const
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number]
/** The longest message a report holds. */
export const FEEDBACK_MAX = 8000

export interface FeedbackRequest {
  url: string
  /** Every header sent. There is no authorization among them, by design. */
  headers: Record<string, string>
  body: { kind: FeedbackKind; message: string; surface: 'cli' }
}

/** The request, whole: where it goes and everything it carries. Pure. */
export function feedbackRequest(
  origin: string,
  kind: FeedbackKind,
  message: string,
): FeedbackRequest {
  return {
    url: `${origin}/api/product-feedback`,
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body: { kind, message, surface: 'cli' },
  }
}

/** What will be sent and where, as a person reads it. */
export function feedbackPreview(req: FeedbackRequest): string {
  return `POST ${req.url}\n${JSON.stringify(req.body, null, 2)}\nThat is all of it: no credential and no other field is sent.`
}

const USAGE =
  'vos feedback "<what happened>" [--kind problem|idea] [--dry-run] [--origin <url>] [--json]'

export async function cmdFeedback(
  argv: string[],
  deps: { fetch?: typeof fetch } = {},
): Promise<number> {
  const { positionals, flags } = parseArgs(argv, BOOLEAN_FLAGS)
  const r = createReporter(flags.json === true)
  const dryRun = flags['dry-run'] === true
  const origin = platformOrigin({
    origin: strFlag(flags, 'origin'),
    api: strFlag(flags, 'api'),
  })
  const kind = strFlag(flags, 'kind') ?? 'problem'
  if (!FEEDBACK_KINDS.includes(kind as FeedbackKind))
    throw new UsageError(
      `--kind takes ${FEEDBACK_KINDS.join(' or ')}, not "${kind}"`,
    )
  const message = positionals.join(' ').trim()
  if (!message) throw new UsageError(`a report needs its message: ${USAGE}`)
  if (message.length > FEEDBACK_MAX)
    throw new UsageError(
      `the message is ${message.length} characters and a report holds ${FEEDBACK_MAX}: shorten it and send again. Nothing was sent.`,
    )

  const req = feedbackRequest(origin, kind as FeedbackKind, message)
  const facts = { url: req.url, body: req.body }
  if (dryRun) {
    r.done(
      { sent: false, ...facts, status: null },
      `${feedbackPreview(req)}\nNothing was sent (--dry-run).`,
    )
    return EXIT_OK
  }
  // Said BEFORE the request, so what leaves is read first.
  r.event({ event: 'sending', ...facts })
  r.log(feedbackPreview(req))

  let res: Response
  try {
    res = await (deps.fetch ?? fetch)(req.url, {
      method: 'POST',
      headers: req.headers,
      body: JSON.stringify(req.body),
    })
  } catch (e) {
    throw new Error(unreachable(origin, e))
  }
  let answer: Record<string, unknown> = {}
  try {
    answer = (await res.json()) as Record<string, unknown>
  } catch {
    // an answer that is not JSON carries no error to repeat
  }
  if (!res.ok) {
    const error =
      typeof answer.error === 'string'
        ? answer.error + detailLine(answer)
        : null
    if (r.json) r.done({ sent: false, ...facts, status: res.status, error }, '')
    else
      process.stderr.write(
        `error: ${origin} did not take the report (HTTP ${res.status})${error ? `: ${error}` : ''}\n`,
      )
    return EXIT_ERROR
  }
  r.done(
    { sent: true, ...facts, status: res.status },
    `Sent to ${origin} (HTTP ${res.status}).`,
  )
  return EXIT_OK
}
