/**
 * `vos actions from-agent-browser <steps.jsonl>` — the agent that verified
 * the feature already walked the product in agent-browser (Vercel Labs);
 * this turns that walk into an actions.json so `vos record` replays it with
 * a synthesized cursor track, auto-zooms and cuts it. One walk, one take,
 * no second script.
 *
 * What agent-browser leaves behind, measured: no command log (a session
 * persists cookies and state, `trace` is performance events, `record` a
 * raw WebM), and a command's `--json` RESULT does not carry its arguments.
 * `scroll` answers `{scrolled:true}`, `mouse move` `{moved:true}`, `type`
 * echoes the text but not the target, `click @e27` echoes `"@e27"`, and a
 * ref is `{role, name}` in the preceding snapshot's `refs` map and nothing
 * else (no selector, no coordinates, no timestamps). So the input is the
 * RECORD agent-browser's own `batch` emits, `{command: [...], result: {…},
 * success, error}`, one per line or the batch array itself, which the
 * skill tells the agent to keep while it verifies (a shell function wraps
 * each call). Refs resolve through the last snapshot line before them.
 *
 * Every mapping is pure and every command that cannot follow is NAMED in
 * the notes, never dropped silently: a recording that skips a step the
 * agent made is a different walk.
 */
import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { validateActions } from './actions'
import { UsageError, parseArgs, strFlag } from './args'
import { EXIT_ERROR, EXIT_OK, createReporter } from './output'
import type { ActionStep, ActionsFile } from './actions'

/** One agent-browser command with its result: the `batch` record shape. */
export interface AgentBrowserRecord {
  command: string[] | string
  /** Single-command `--json` lines carry `data`; batch records carry `result`. */
  data?: unknown
  result?: unknown
  success?: boolean
  error?: string | null
}

export interface ConvertOptions {
  /** Overrides the walk's first `open`. */
  url?: string
  /** Overrides the walk's `set viewport`. */
  viewport?: { width: number; height: number }
}

export interface ConvertResult {
  actions: ActionsFile
  /** Every command that became no step, or a different step, with its line. */
  notes: string[]
  /** Commands that produced a step. */
  steps: number
  /** Reads and session verbs: nothing to replay. */
  ignored: number
  /** Actions the recorder cannot follow, or that failed in the walk. */
  skipped: number
}

/** Parse a steps.jsonl (or a batch array) into records; malformed lines are named. */
export function parseAgentBrowserLog(text: string): {
  records: AgentBrowserRecord[]
  problems: string[]
} {
  const records: AgentBrowserRecord[] = []
  const problems: string[] = []
  const trimmed = text.trim()
  if (!trimmed) return { records, problems: ['the log is empty'] }
  const push = (value: unknown, where: string): void => {
    if (Array.isArray(value)) {
      value.forEach((v, i) => push(v, `${where}[${i}]`))
      return
    }
    if (typeof value !== 'object' || value === null) {
      problems.push(`${where}: not a record`)
      return
    }
    const rec = value as Record<string, unknown>
    if (typeof rec.command !== 'string' && !Array.isArray(rec.command)) {
      problems.push(
        `${where}: no "command" — keep each call as {command:[…], …result} (the batch shape); a bare --json result does not say what ran`,
      )
      return
    }
    records.push(rec as unknown as AgentBrowserRecord)
  }
  if (trimmed.startsWith('[')) {
    try {
      push(JSON.parse(trimmed), 'batch')
    } catch (e) {
      problems.push(`not JSON: ${(e as Error).message}`)
    }
    return { records, problems }
  }
  trimmed.split('\n').forEach((line, i) => {
    const l = line.trim()
    if (!l) return
    try {
      push(JSON.parse(l), `line ${i + 1}`)
    } catch {
      problems.push(`line ${i + 1}: not JSON`)
    }
  })
  return { records, problems }
}

/** Shell-style split for a `command` kept as one string: quotes group, backslash escapes. */
export function splitCommand(command: string): string[] {
  const out: string[] = []
  let cur = ''
  let quote: string | null = null
  let has = false
  for (let i = 0; i < command.length; i++) {
    const c = command[i]
    if (quote) {
      if (c === quote) quote = null
      else if (c === '\\' && i + 1 < command.length) cur += command[++i]
      else cur += c
      continue
    }
    if (c === '"' || c === "'") {
      quote = c
      has = true
      continue
    }
    if (c === '\\' && i + 1 < command.length) {
      cur += command[++i]
      has = true
      continue
    }
    if (/\s/.test(c)) {
      if (has) out.push(cur)
      cur = ''
      has = false
      continue
    }
    cur += c
    has = true
  }
  if (has) out.push(cur)
  return out
}

type Refs = Record<string, { role?: string; name?: string; href?: string }>

const READ_VERBS = new Set([
  'get',
  'is',
  'eval',
  'screenshot',
  'tab',
  'session',
  'close',
  'doctor',
  'cookies',
  'storage',
  'console',
  'network',
  'trace',
  'record',
  'pdf',
  'version',
  'help',
])

const quoteAttr = (s: string): string =>
  `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`

/**
 * The snapshot's `url=` is the RESOLVED absolute URL, while the DOM's href
 * attribute is usually the relative path the author wrote, and a CSS
 * attribute selector matches the attribute literally. So a link gets both
 * forms, comma-joined (one Playwright locator); a cross-origin href only
 * ever appears absolute.
 */
export function hrefSelector(href: string): string {
  try {
    const u = new URL(href)
    const relative = `${u.pathname}${u.search}${u.hash}`
    return `a[href=${quoteAttr(relative)}], a[href=${quoteAttr(href)}]`
  } catch {
    return `a[href=${quoteAttr(href)}]`
  }
}

/** A ref or CSS target → a Playwright selector the recorder's `page.locator` takes. */
function resolveTarget(
  target: string,
  refs: Refs,
): { selector: string } | { reason: string } {
  const m = /^@(e\d+)$/.exec(target)
  if (!m) return { selector: target }
  const ref = Object.hasOwn(refs, m[1]) ? refs[m[1]] : undefined
  if (!ref)
    return {
      reason: `${target} is not in the last snapshot — keep the \`snapshot -i\` line that named it before the step`,
    }
  if (ref.role === 'link' && ref.href)
    return { selector: hrefSelector(ref.href) }
  if (ref.role && ref.name)
    return { selector: `role=${ref.role}[name=${quoteAttr(ref.name)}]` }
  if (ref.role) return { selector: `role=${ref.role}` }
  return { reason: `${target} has no role or name in the snapshot` }
}

/** The `find <kind> <query>` locators → Playwright selectors. */
function findSelector(
  kind: string,
  query: string,
  flags: { name?: string; exact: boolean },
): { selector: string } | { reason: string } {
  switch (kind) {
    case 'text':
      return {
        selector: flags.exact ? `text=${quoteAttr(query)}` : `text=${query}`,
      }
    case 'role':
      return {
        selector: flags.name
          ? `role=${query}[name=${quoteAttr(flags.name)}]`
          : `role=${query}`,
      }
    case 'label':
      // Playwright's getByLabel form; the public engines have no label=.
      return {
        selector: `internal:label=${quoteAttr(query)}${flags.exact ? 's' : 'i'}`,
      }
    case 'placeholder':
      return { selector: `[placeholder=${quoteAttr(query)}]` }
    case 'alt':
      return { selector: `[alt=${quoteAttr(query)}]` }
    case 'title':
      return { selector: `[title=${quoteAttr(query)}]` }
    case 'testid':
      return { selector: `[data-testid=${quoteAttr(query)}]` }
    case 'first':
      return { selector: query }
    case 'last':
    case 'nth':
      return {
        reason: `find ${kind} is a position, not a stable selector — name the element by role, text or testid`,
      }
    default:
      return { reason: `find ${kind} is not a locator agent-browser documents` }
  }
}

/** Pull `--flag value` and `--bool` pairs out of a command's tail. */
function takeFlags(
  args: string[],
  valued: ReadonlySet<string>,
): { positionals: string[]; flags: Record<string, string | true> } {
  const positionals: string[] = []
  const flags: Record<string, string | true> = {}
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a.startsWith('--')) {
      const name = a.slice(2)
      if (valued.has(name) && i + 1 < args.length) flags[name] = args[++i]
      else flags[name] = true
      continue
    }
    if (a.startsWith('-') && a.length === 2) {
      // agent-browser's short flags: -i (interactive refs), -u (urls), -s <sel>
      if (a === '-s' && i + 1 < args.length) flags.selector = args[++i]
      else flags[a.slice(1)] = true
      continue
    }
    positionals.push(a)
  }
  return { positionals, flags }
}

/** `[ref=e27, url=https://…]` markers in a snapshot's text tree → href per ref. */
function snapshotHrefs(snapshot: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const m of snapshot.matchAll(/\[([^\]]*?\bref=(e\d+)[^\]]*?)\]/g)) {
    const url = /\burl=([^,\]\s]+)/.exec(m[1])?.[1]
    if (url) out[m[2]] = url
  }
  return out
}

/** The walk, as steps the recorder can replay. Pure. */
export function convertAgentBrowser(
  records: AgentBrowserRecord[],
  opts: ConvertOptions = {},
): ConvertResult {
  const steps: ActionStep[] = []
  const notes: string[] = []
  let url: string | undefined
  let viewport: ActionsFile['viewport']
  let refs: Refs = {}
  let lastTarget: string | null = null
  let ignored = 0
  let skipped = 0
  let fillNoted = false

  const skip = (n: number, reason: string): void => {
    skipped++
    notes.push(`line ${n}: skipped — ${reason}`)
  }
  const emit = (n: number, step: ActionStep): void => {
    steps.push({ ...step, id: `ab${n}` })
  }

  records.forEach((rec, i) => {
    const n = i + 1
    const argv = Array.isArray(rec.command)
      ? rec.command
      : splitCommand(rec.command)
    const [verb, ...args] = argv
    const payload = (rec.data ?? rec.result ?? null) as Record<
      string,
      unknown
    > | null
    if (!verb) {
      skip(n, 'an empty command')
      return
    }
    if (rec.success === false) {
      skip(
        n,
        `\`${argv.join(' ')}\` failed in the walk${rec.error ? ` (${rec.error})` : ''}`,
      )
      return
    }
    switch (verb) {
      case 'open': {
        const target = args.find((a) => !a.startsWith('-'))
        if (!target) {
          skip(n, 'open without a URL')
          return
        }
        if (!url) {
          url = target
          ignored++
          return
        }
        skip(
          n,
          `a second open (${target}) — actions.json records ONE page; reach it by clicking, or split the walk`,
        )
        return
      }
      case 'snapshot': {
        const map = (payload?.refs ?? {}) as Record<
          string,
          { role?: string; name?: string }
        >
        const hrefs =
          typeof payload?.snapshot === 'string'
            ? snapshotHrefs(payload.snapshot)
            : {}
        refs = {}
        for (const [id, r] of Object.entries(map))
          refs[id] = { ...r, href: hrefs[id] }
        ignored++
        return
      }
      case 'set': {
        if (args[0] === 'viewport') {
          const w = Number(args[1])
          const h = Number(args[2])
          if (Number.isFinite(w) && Number.isFinite(h)) {
            viewport = { width: w, height: h }
            if (args[3] && Number(args[3]) !== 1)
              notes.push(
                `line ${n}: viewport scale ${args[3]} ignored — the recorder captures at the viewport's CSS size`,
              )
            ignored++
            return
          }
        }
        skip(n, `\`set ${args.join(' ')}\` has no recording equivalent`)
        return
      }
      case 'click':
      case 'hover': {
        const target = args.find((a) => !a.startsWith('-'))
        if (!target) {
          skip(n, `${verb} without a target`)
          return
        }
        const r = resolveTarget(target, refs)
        if ('reason' in r) {
          skip(n, r.reason)
          return
        }
        lastTarget = r.selector
        emit(
          n,
          verb === 'click'
            ? { do: 'click', selector: r.selector }
            : { do: 'hover', selector: r.selector },
        )
        return
      }
      case 'fill':
      case 'type': {
        const [target, ...textParts] = args
        if (!target || textParts.length === 0) {
          skip(n, `${verb} needs a target and text`)
          return
        }
        const r = resolveTarget(target, refs)
        if ('reason' in r) {
          skip(n, r.reason)
          return
        }
        if (verb === 'fill' && !fillNoted) {
          fillNoted = true
          notes.push(
            `line ${n}: fill became type — the recorder types into the field as it is; an empty field reads the same, a prefilled one does not`,
          )
        }
        lastTarget = r.selector
        emit(n, { do: 'type', selector: r.selector, text: textParts.join(' ') })
        return
      }
      case 'keyboard': {
        const [mode, ...textParts] = args
        if ((mode === 'type' || mode === 'inserttext') && textParts.length) {
          if (!lastTarget) {
            skip(
              n,
              'keyboard type before any click or fill — the recorder needs a field to type into',
            )
            return
          }
          emit(n, {
            do: 'type',
            selector: lastTarget,
            text: textParts.join(' '),
          })
          return
        }
        skip(n, `\`keyboard ${args.join(' ')}\` has no recording equivalent`)
        return
      }
      case 'press':
      case 'key': {
        const key = args.at(0)
        if (key === 'Enter' && lastTarget) {
          // `focus: false`: agent-browser's press goes to whatever is focused
          // and never clicks, so neither does this. A type step that clicks
          // rings a click effect in the middle of a field the walk had already
          // filled — a bloom on empty space beside the text.
          emit(n, {
            do: 'type',
            selector: lastTarget,
            text: '\n',
            focus: false,
          })
          notes.push(
            `line ${n}: press Enter became a newline typed into the last field`,
          )
          return
        }
        skip(
          n,
          `press ${key ?? ''} — actions.json has no key verb; a shortcut's effect needs a click on the control that does it`,
        )
        return
      }
      case 'scroll': {
        const { positionals, flags } = takeFlags(args, new Set(['selector']))
        const dir = positionals.at(0) ?? 'down'
        const amountArg = positionals.at(1)
        const amount = amountArg !== undefined ? Number(amountArg) : 300
        if (!Number.isFinite(amount)) {
          skip(n, `scroll amount ${amountArg} is not a number`)
          return
        }
        if (dir === 'left' || dir === 'right') {
          skip(n, 'horizontal scroll has no recording equivalent')
          return
        }
        if (flags.selector)
          notes.push(
            `line ${n}: scroll --selector ${String(flags.selector)} became a page scroll`,
          )
        emit(n, { do: 'scroll', dy: dir === 'up' ? -amount : amount })
        return
      }
      case 'mouse': {
        const [mode, xs, ys] = args
        if (mode === 'move') {
          const x = Number(xs)
          const y = Number(ys)
          if (Number.isFinite(x) && Number.isFinite(y)) {
            emit(n, { do: 'move', x, y })
            return
          }
        }
        skip(
          n,
          `\`mouse ${args.join(' ')}\` — only mouse move maps; a click by coordinates needs a selector`,
        )
        return
      }
      case 'wait': {
        const first = args.at(0)
        if (
          first !== undefined &&
          !first.startsWith('-') &&
          /^\d+$/.test(first)
        ) {
          emit(n, { do: 'wait', ms: Number(first) })
          return
        }
        emit(n, { do: 'wait', ms: 500 })
        notes.push(
          `line ${n}: \`wait ${args.join(' ')}\` became 500 ms — the recorder waits for the page itself`,
        )
        return
      }
      case 'find': {
        const { positionals, flags } = takeFlags(args, new Set(['name']))
        const kind = positionals.at(0)
        const query = positionals.at(1)
        const action = positionals.at(2) ?? 'click'
        const rest = positionals.slice(3)
        if (!kind || query === undefined) {
          skip(n, 'find needs a locator and a query')
          return
        }
        const r = findSelector(kind, query, {
          name: typeof flags.name === 'string' ? flags.name : undefined,
          exact: flags.exact === true,
        })
        if ('reason' in r) {
          skip(n, r.reason)
          return
        }
        switch (action) {
          case 'click':
          case 'check':
            lastTarget = r.selector
            emit(n, { do: 'click', selector: r.selector })
            return
          case 'hover':
            lastTarget = r.selector
            emit(n, { do: 'hover', selector: r.selector })
            return
          case 'fill':
            if (!rest.length) {
              skip(n, 'find … fill without text')
              return
            }
            lastTarget = r.selector
            emit(n, { do: 'type', selector: r.selector, text: rest.join(' ') })
            return
          case 'text':
            ignored++
            return
          default:
            skip(n, `find … ${action} has no recording equivalent`)
            return
        }
      }
      case 'drag':
        skip(
          n,
          'drag needs the end point in px — `get box` the target and write a drag step by hand',
        )
        return
      case 'batch':
        skip(
          n,
          'a batch line inside the log — keep the batch OUTPUT (its array) instead',
        )
        return
      default:
        if (READ_VERBS.has(verb)) {
          ignored++
          return
        }
        skip(n, `\`${argv.join(' ')}\` has no recording equivalent`)
    }
  })

  const actions: ActionsFile = {
    ...((opts.url ?? url) ? { url: opts.url ?? url } : {}),
    ...((opts.viewport ?? viewport)
      ? { viewport: opts.viewport ?? viewport }
      : {}),
    steps,
  }
  return { actions, notes, steps: steps.length, ignored, skipped }
}

/** `vos actions from-agent-browser <steps.jsonl> [--out actions.json] [--url u] [--viewport WxH] [--json]` */
export async function cmdActions(argv: string[]): Promise<number> {
  const { positionals, flags } = parseArgs(argv, new Set(['json']))
  const [sub, input] = positionals
  if (sub !== 'from-agent-browser' || !input) {
    throw new UsageError(
      'vos actions from-agent-browser <steps.jsonl> [--out actions.json] [--url <url>] [--viewport WxH] [--json]',
    )
  }
  const r = createReporter(flags.json === true)
  const out = resolve(strFlag(flags, 'out') ?? 'actions.json')
  const viewportFlag = strFlag(flags, 'viewport')
  let viewport: ConvertOptions['viewport']
  if (viewportFlag) {
    const m = /^(\d+)x(\d+)$/.exec(viewportFlag)
    if (!m) throw new UsageError('--viewport expects WxH, e.g. 1280x720')
    viewport = { width: Number(m[1]), height: Number(m[2]) }
  }
  const { readFile } = await import('node:fs/promises')
  const text = await readFile(resolve(input), 'utf8')
  const { records, problems } = parseAgentBrowserLog(text)
  for (const p of problems) r.log(`  ${p}`)
  const result = convertAgentBrowser(records, {
    url: strFlag(flags, 'url'),
    viewport,
  })
  const errors = validateActions(result.actions)
  if (errors.length) {
    r.done(
      { ok: false, errors, ...summary(result) },
      `${input}: no actions file written\n  ${errors.join('\n  ')}\n  ${result.notes.join('\n  ')}`,
    )
    return EXIT_ERROR
  }
  await writeFile(out, `${JSON.stringify(result.actions, null, 2)}\n`)
  r.done(
    { ok: true, out, url: result.actions.url ?? null, ...summary(result) },
    `Wrote ${out}: ${result.steps} step${result.steps === 1 ? '' : 's'} from ${records.length} record${records.length === 1 ? '' : 's'} (${result.ignored} read/session, ${result.skipped} skipped)` +
      (result.notes.length ? `\n  ${result.notes.join('\n  ')}` : '') +
      `\nThen: vos record --actions ${out} --out take --strict`,
  )
  return EXIT_OK
}

function summary(result: ConvertResult): {
  steps: number
  ignored: number
  skipped: number
  notes: string[]
} {
  return {
    steps: result.steps,
    ignored: result.ignored,
    skipped: result.skipped,
    notes: result.notes,
  }
}
