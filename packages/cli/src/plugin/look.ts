/**
 * `vos look <url>`: the agent's eyes before it writes a flow. A screenshot
 * and the controls on screen, each with ONE proposed selector, on the same
 * browser and the same session `vos record` would use, so a page behind a
 * login can be seen without recording it.
 *
 * Looking never spends and never destroys: a `--click` whose target reads
 * as a spend or a delete (Generate, Publish, Delete, Pay…) is refused in
 * words before it is pressed, and `--type` fills a field without pressing
 * Enter.
 *
 * A proposal is checked against the page, not guessed: every candidate is
 * counted with the selector engine the recorder itself resolves steps with
 * (`page.locator`), and it is only UNIQUE when it reaches this element and
 * no other. The ranking, the scopes and the refusal words are pure and
 * tested; the page probes are strings, because a function serialized out of
 * a bundle picks up the bundler's `__name` helper and dies in the page.
 */
import { mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { headersFor, urlSchemeProblem } from '@vosjs/render-core/record'
import type { BrowserContext, Page } from 'playwright'
import { UsageError, parseArgs, strFlag } from './args'
import { EXIT_OK, EXIT_USAGE, EXIT_WALL, createReporter } from './output'
import {
  EXPOSURE_ADVICE,
  EXPOSURE_MATCHERS_SRC,
  EXPOSURE_PROBE,
} from './exposure'
import { exposureLine } from './exposure'
import { WALL_PROBE, wallVerdict } from './wall'
import { parseHeaders } from './setup'
import { sessionDir, sessionNameVerdict, withSession } from './session'
import { launchBrowser } from '../browser'
import type { Exposure } from './exposure'
import type { WallVerdict } from './wall'

// ---------------------------------------------------------------------------
// What the page reports, and what look says about it
// ---------------------------------------------------------------------------

/** A scope an element sits in: the open dialog, or the landmark around it. */
export interface ScopeFacts {
  tag: string
  /** the explicit `role` attribute's first token, '' when none */
  role: string
  /** `aria-label`, when it has one */
  label: string | null
  testId: { attr: string; value: string } | null
}

/** One control as the page probe reads it, before a selector is chosen. */
export interface RawControl {
  /** its index in the probe's list, stamped on the element while looking */
  index: number
  tag: string
  /** explicit role, else the implicit one ('' for none) */
  role: string
  /** the accessible name, as near as the page can compute it */
  name: string
  /** visible text, whitespace collapsed */
  text: string
  ariaLabel: string | null
  testId: { attr: string; value: string } | null
  id: string | null
  /** a form control's `name` attribute */
  nameAttr: string | null
  placeholder: string | null
  /** origin + path of a link, never its query or hash */
  href: string | null
  rect: { x: number; y: number; w: number; h: number }
  disabled: boolean
  /** something else is on top of its centre (an overlay, a modal's backdrop) */
  covered: boolean
  dialog: ScopeFacts | null
  landmark: ScopeFacts | null
  /** kinds of sensitive text its words held; those words are withheld */
  redacted?: string[]
}

export type SelectorBasis =
  | 'testid'
  | 'aria-label'
  | 'role'
  | 'form'
  | 'id'
  | 'text'

export interface Candidate {
  selector: string
  basis: SelectorBasis
}

/** UNIQUE: reaches this element and no other. AMBIGUOUS: this and others. */
export type SelectorMatch = 'unique' | 'ambiguous' | 'none'

export interface LookControl {
  tag: string
  role: string
  /** the accessible name or text, trimmed to 60 characters */
  name: string
  testId: string | null
  href: string | null
  rect: { x: number; y: number; w: number; h: number }
  disabled: boolean
  inDialog: boolean
  covered: boolean
  selector: string | null
  basis: SelectorBasis | null
  match: SelectorMatch
  /** how many elements the proposed selector reaches */
  matches: number
  redacted?: string[]
}

// ---------------------------------------------------------------------------
// Pure: quoting, scopes, candidates, the choice, the refusal words
// ---------------------------------------------------------------------------

/** A double-quoted string, as both CSS and Playwright's engines read one. */
export function quote(value: string): string {
  return `"${value.replace(/\s+/g, ' ').replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

/** The longest name or text a selector is built from: past it, it is prose. */
const NAME_MAX = 80

/**
 * The CSS that reaches a dialog or a landmark: its test id, else its role or
 * tag, narrowed by its `aria-label` when it has one.
 */
export function scopeSelector(
  s: ScopeFacts,
  kind: 'dialog' | 'landmark',
): string {
  if (s.testId) return `[${s.testId.attr}=${quote(s.testId.value)}]`
  let base: string
  if (s.role) base = `[role=${quote(s.role)}]`
  else if (kind === 'dialog' && s.tag === 'dialog') base = 'dialog[open]'
  else if (kind === 'dialog') base = '[aria-modal="true"]'
  else base = s.tag
  return s.label ? `${base}[aria-label=${quote(s.label)}]` : base
}

/** An id a person wrote, not one a framework minted (`:r3:`, `radix-…`, `mui-12`). */
export function stableId(id: string | null): boolean {
  if (!id || !/^[A-Za-z][\w-]*$/.test(id)) return false
  if (/^(radix|headlessui|mui|react|ember|ext|rc|el|v)-/i.test(id)) return false
  return !/\d{2,}/.test(id)
}

/**
 * Every selector worth trying for a control, most stable first: the test
 * id; the `aria-label` (inside the open dialog it sits in); role + name; a
 * form control's own attributes; a written id; its words inside the dialog
 * or landmark around it. Never a position in the tree: a `:nth-child` chain
 * breaks the first time the page changes.
 */
export function selectorCandidates(c: RawControl): Candidate[] {
  const out: Candidate[] = []
  const add = (selector: string, basis: SelectorBasis) => {
    if (!out.some((x) => x.selector === selector)) out.push({ selector, basis })
  }
  const dialog = c.dialog ? scopeSelector(c.dialog, 'dialog') : null
  const landmark = c.landmark ? scopeSelector(c.landmark, 'landmark') : null
  const css = (sel: string) => (dialog ? `${dialog} ${sel}` : sel)
  const chain = (sel: string) => (dialog ? `${dialog} >> ${sel}` : sel)

  if (c.testId) {
    const sel = `[${c.testId.attr}=${quote(c.testId.value)}]`
    add(sel, 'testid')
    if (dialog) add(`${dialog} ${sel}`, 'testid')
  }
  if (c.ariaLabel && c.ariaLabel.length <= NAME_MAX)
    add(css(`[aria-label=${quote(c.ariaLabel)}]`), 'aria-label')
  if (c.role && c.name && c.name.length <= NAME_MAX) {
    const sel = `role=${c.role}[name=${quote(c.name)}]`
    add(chain(sel), 'role')
    if (!dialog && landmark) add(`${landmark} >> ${sel}`, 'role')
  }
  const form = /^(input|textarea|select)$/.test(c.tag)
  if (form && c.nameAttr)
    add(css(`${c.tag}[name=${quote(c.nameAttr)}]`), 'form')
  if (form && c.placeholder && c.placeholder.length <= NAME_MAX)
    add(css(`${c.tag}[placeholder=${quote(c.placeholder)}]`), 'form')
  if (stableId(c.id)) add(`#${c.id}`, 'id')
  if (!form && c.text && c.text.length <= 60) {
    const sel = `text=${quote(c.text)}`
    if (dialog) add(`${dialog} >> ${sel}`, 'text')
    else if (landmark) add(`${landmark} >> ${sel}`, 'text')
    else add(sel, 'text')
  }
  return out
}

/**
 * What a candidate reaches, judged for ONE element: the stamps of the
 * elements it matched, in page order. A selector that misses this element
 * is no proposal for it, however few it matches.
 */
export function judgeMatch(
  index: number,
  reached: (string | null)[],
): SelectorMatch | 'miss' {
  if (!reached.includes(String(index))) return 'miss'
  return reached.length === 1 ? 'unique' : 'ambiguous'
}

/**
 * The proposal: the most stable candidate that reaches this element and no
 * other; failing that, the most stable that reaches it among others (said
 * AMBIGUOUS, with the count); failing that, none.
 */
export function chooseProposal(
  index: number,
  candidates: Candidate[],
  reached: (string | null)[][],
): {
  selector: string | null
  basis: SelectorBasis | null
  match: SelectorMatch
  matches: number
} {
  let fallback: { c: Candidate; n: number } | null = null
  for (let i = 0; i < candidates.length; i++) {
    const verdict = judgeMatch(index, reached[i] ?? [])
    if (verdict === 'unique')
      return {
        selector: candidates[i].selector,
        basis: candidates[i].basis,
        match: 'unique',
        matches: 1,
      }
    if (verdict === 'ambiguous' && !fallback)
      fallback = { c: candidates[i], n: reached[i].length }
  }
  if (fallback)
    return {
      selector: fallback.c.selector,
      basis: fallback.c.basis,
      match: 'ambiguous',
      matches: fallback.n,
    }
  return { selector: null, basis: null, match: 'none', matches: 0 }
}

/**
 * Words that spend, send or destroy. A look presses nothing that says one:
 * the screenshot is not worth a generation, an email or a deleted row.
 */
export const SPEND_WORDS = [
  'generate',
  'submit',
  'publish',
  'delete',
  'remove',
  'buy',
  'pay',
  'purchase',
  'upgrade',
  'subscribe',
  'confirm',
  'send',
] as const

const SPEND = new RegExp(`\\b(${SPEND_WORDS.join('|')})\\b`, 'i')

/** The spend or delete word a control's words hold, or null. */
export function spendWord(words: (string | null | undefined)[]): string | null {
  for (const w of words) {
    const m = w ? SPEND.exec(w) : null
    if (m) return m[1].toLowerCase()
  }
  return null
}

export function refusalLine(
  selector: string,
  label: string,
  word: string,
): string {
  return `refused: --click ${selector} reaches "${label}": "${word}" spends, sends or destroys, and vos look never presses one. Look at the page before it; a flow that needs the press has it as a step in actions.json, for vos record`
}

/** A look step, in the order the flags were given. */
export type LookStep =
  | { do: 'click'; selector: string }
  | { do: 'type'; selector: string; text: string }

/** Selector engines whose name ends in `=` (`role=…`, `text=…`, `nth=0`). */
const ENGINES =
  /^(css|xpath|text|role|id|nth|visible|data-testid|data-test-id|data-test|internal:[a-z-]+)$/

/**
 * `--type <selector>=<text>`: the `=` that splits is the first one outside
 * brackets and quotes that is not an engine's own (`role=`, `text=`, `nth=`
 * at the start of the selector or after a `>>`).
 */
export function splitTypeFlag(value: string): {
  selector: string
  text: string
} {
  let depth = 0
  let inQuote: string | null = null
  let segment = 0
  for (let i = 0; i < value.length; i++) {
    const ch = value[i]
    if (inQuote) {
      if (ch === '\\') i++
      else if (ch === inQuote) inQuote = null
      continue
    }
    if (ch === '"' || ch === "'") inQuote = ch
    else if (ch === '[' || ch === '(') depth++
    else if ((ch === ']' || ch === ')') && depth > 0) depth--
    else if (ch === '>' && value[i + 1] === '>') {
      segment = i + 2
      i++
    } else if (ch === '=' && depth === 0) {
      if (ENGINES.test(value.slice(segment, i).trim())) continue
      const selector = value.slice(0, i).trim()
      if (!selector) break
      return { selector, text: value.slice(i + 1) }
    }
  }
  throw new UsageError(
    `--type expects <selector>=<text>, got "${value}" (the text follows the first = outside the selector's brackets and quotes)`,
  )
}

/** The `--click` and `--type` flags in the order they were given. */
export function lookSteps(argv: string[]): LookStep[] {
  const steps: LookStep[] = []
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--') break
    const m = /^--(click|type)(?:=(.*))?$/s.exec(arg)
    if (!m) continue
    let value = m[2]
    if (value === undefined) {
      value = argv[i + 1]
      if (value === undefined || value.startsWith('--'))
        throw new UsageError(`--${m[1]} expects a value`)
      i++
    }
    if (m[1] === 'click') {
      if (!value.trim()) throw new UsageError('--click expects a selector')
      steps.push({ do: 'click', selector: value })
    } else steps.push({ do: 'type', ...splitTypeFlag(value) })
  }
  return steps
}

export function parseViewport(value: string | undefined): {
  width: number
  height: number
} {
  if (!value) return { width: 1280, height: 720 }
  const m = /^(\d+)x(\d+)$/i.exec(value)
  if (!m) throw new UsageError('--viewport expects WxH, like 1280x720')
  const width = Number(m[1])
  const height = Number(m[2])
  if (width < 200 || height < 200 || width > 3840 || height > 2160)
    throw new UsageError('--viewport wants a size from 200x200 to 3840x2160')
  return { width, height }
}

/** The words a control is listed by: its name, else its text, ≤60 chars. */
export function displayName(
  c: Pick<RawControl, 'name' | 'text' | 'placeholder'>,
): string {
  const words = c.name || c.text || c.placeholder || ''
  return words.length > 60 ? `${words.slice(0, 59).trimEnd()}…` : words
}

export function controlLine(c: LookControl): string {
  const what = c.role && c.role !== c.tag ? `${c.tag} (${c.role})` : c.tag
  const name = c.redacted?.length
    ? ` [${c.redacted.join(', ')} withheld]`
    : c.name
      ? ` ${JSON.stringify(c.name)}`
      : ''
  const flags = [
    c.inDialog ? 'in dialog' : '',
    c.disabled ? 'disabled' : '',
    c.covered ? 'covered' : '',
  ].filter(Boolean)
  const proposal = c.selector
    ? `${c.selector}  ${c.match === 'unique' ? 'UNIQUE' : `AMBIGUOUS (${c.matches})`}`
    : 'no stable selector (use its rect)'
  const r = c.rect
  return `  ${what}${name}${flags.length ? `  [${flags.join(', ')}]` : ''}\n      ${proposal}  @ ${r.x},${r.y} ${r.w}×${r.h}`
}

// ---------------------------------------------------------------------------
// The page probes (strings: see the header)
// ---------------------------------------------------------------------------

/** The most controls one look lists; the count of the rest is said. */
const CONTROL_LIMIT = 150

/**
 * The visible controls, in document order, each stamped
 * `data-vos-look="<index>"` so a candidate can be judged by WHICH elements
 * it reaches. The stamps are taken off again once the proposals are made.
 */
export const LOOK_PROBE = `(() => {
  const { kindsIn } = ${EXPOSURE_MATCHERS_SRC}
  const vw = innerWidth, vh = innerHeight
  const CONTROLS = 'button, a, [role=button], [role=tab], [role=menuitem], [role=menuitemcheckbox], [role=menuitemradio], [role=checkbox], [role=switch], [role=option], [role=radio], [role=link], input, textarea, select, [contenteditable], [data-testid], [data-test-id], [data-test], [data-cy]'
  const TEST_IDS = ['data-testid', 'data-test-id', 'data-test', 'data-cy']
  const DIALOGS = 'dialog[open], [role=dialog], [role=alertdialog], [aria-modal=true]'
  const LANDMARKS = 'nav, header, main, aside, footer, [role=navigation], [role=banner], [role=main], [role=complementary], [role=contentinfo], [role=search]'
  const squash = (s) => (s || '').replace(/\\s+/g, ' ').trim()
  const textOf = (el) => squash(typeof el.innerText === 'string' ? el.innerText : el.textContent)
  const shown = (el) => {
    const r = el.getBoundingClientRect()
    if (r.width < 2 || r.height < 2) return null
    if (el.checkVisibility && !el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return null
    const s = getComputedStyle(el)
    if (s.visibility === 'hidden' || s.display === 'none' || +s.opacity === 0) return null
    return r
  }
  const testIdOf = (el) => {
    for (const attr of TEST_IDS) { const value = el.getAttribute(attr); if (value) return { attr, value } }
    return null
  }
  const implicitRole = (el) => {
    const t = el.tagName
    if (t === 'BUTTON') return 'button'
    if (t === 'A') return el.hasAttribute('href') ? 'link' : ''
    if (t === 'TEXTAREA') return 'textbox'
    if (t === 'SELECT') return el.multiple || el.size > 1 ? 'listbox' : 'combobox'
    if (t === 'INPUT') {
      const type = (el.getAttribute('type') || 'text').toLowerCase()
      if (type === 'checkbox' || type === 'radio') return type
      if (type === 'range') return 'slider'
      if (type === 'number') return 'spinbutton'
      if (/^(button|submit|reset|image)$/.test(type)) return 'button'
      if (/^(text|email|tel|url|search)$/.test(type)) return el.hasAttribute('list') ? 'combobox' : type === 'search' ? 'searchbox' : 'textbox'
      return ''
    }
    if (el.isContentEditable && el.hasAttribute('contenteditable')) return 'textbox'
    return ''
  }
  const roleOf = (el) => (el.getAttribute('role') || '').trim().split(/\\s+/)[0] || implicitRole(el)
  const nameOf = (el) => {
    const aria = squash(el.getAttribute('aria-label'))
    if (aria) return aria
    const by = el.getAttribute('aria-labelledby')
    if (by) {
      const t = squash(by.split(/\\s+/).map((id) => document.getElementById(id)).filter(Boolean).map(textOf).join(' '))
      if (t) return t
    }
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) {
      const type = (el.getAttribute('type') || '').toLowerCase()
      if (/^(button|submit|reset)$/.test(type)) return squash(el.value) || (type === 'submit' ? 'Submit' : type === 'reset' ? 'Reset' : '')
      if (type === 'image') return squash(el.getAttribute('alt'))
      const label = el.labels ? squash([...el.labels].map(textOf).join(' ')) : ''
      return label || squash(el.getAttribute('title')) || squash(el.getAttribute('placeholder'))
    }
    const text = textOf(el)
    if (text) return text
    const img = el.querySelector('img[alt]')
    return squash(img && img.getAttribute('alt')) || squash(el.getAttribute('title'))
  }
  const scopeOf = (el) => el ? {
    tag: el.tagName.toLowerCase(),
    role: (el.getAttribute('role') || '').trim().split(/\\s+/)[0] || '',
    label: squash(el.getAttribute('aria-label')) || null,
    testId: testIdOf(el),
  } : null
  const hrefOf = (el) => {
    if (el.tagName !== 'A' || !el.hasAttribute('href')) return null
    try { const u = new URL(el.href, location.href); return u.origin === location.origin ? u.pathname : u.origin + u.pathname } catch { return null }
  }
  const out = []
  let offscreen = 0, more = 0
  for (const el of document.querySelectorAll(CONTROLS)) {
    if (el.tagName === 'INPUT' && (el.getAttribute('type') || '').toLowerCase() === 'hidden') continue
    if (el.getAttribute('contenteditable') === 'false') continue
    if (el.tagName === 'A' && !el.hasAttribute('href') && !el.getAttribute('role') && !testIdOf(el)) continue
    const r = shown(el)
    if (!r) continue
    if (r.bottom <= 0 || r.right <= 0 || r.top >= vh || r.left >= vw) { offscreen++; continue }
    if (out.length >= ${CONTROL_LIMIT}) { more++; continue }
    const dlg = el.closest(DIALOGS)
    const lm = el.closest(LANDMARKS)
    let name = nameOf(el), text = /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) ? '' : textOf(el)
    let ariaLabel = squash(el.getAttribute('aria-label')) || null
    let placeholder = squash(el.getAttribute('placeholder')) || null
    const kinds = [...new Set([...kindsIn(name), ...kindsIn(text), ...kindsIn(ariaLabel || ''), ...kindsIn(placeholder || '')])]
    if (kinds.length) { name = ''; text = ''; ariaLabel = null; placeholder = null }
    const cx = Math.min(vw - 1, Math.max(0, r.left + r.width / 2)), cy = Math.min(vh - 1, Math.max(0, r.top + r.height / 2))
    const hit = document.elementFromPoint(cx, cy)
    const covered = !!hit && !(hit === el || el.contains(hit) || (el.labels && [...el.labels].some((l) => l.contains(hit))))
    const index = out.length
    out.push({
      index,
      tag: el.tagName.toLowerCase(),
      role: roleOf(el),
      name,
      text,
      ariaLabel,
      testId: testIdOf(el),
      id: el.id || null,
      nameAttr: /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) ? el.getAttribute('name') || null : null,
      placeholder,
      href: hrefOf(el),
      rect: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
      disabled: el.matches(':disabled') || el.getAttribute('aria-disabled') === 'true',
      covered,
      dialog: dlg && shown(dlg) ? scopeOf(dlg) : null,
      landmark: lm ? scopeOf(lm) : null,
      ...(kinds.length ? { redacted: kinds } : {}),
    })
    el.setAttribute('data-vos-look', String(index))
  }
  return { controls: out, offscreen, more }
})()`

const UNSTAMP = `(() => { for (const el of document.querySelectorAll('[data-vos-look]')) el.removeAttribute('data-vos-look') })()`

/**
 * Resolves once the DOM has held still for `quietMs`, or at `capMs`. Many
 * apps never reach network idle (a socket, a poll, analytics), so the page's
 * own stillness is the signal.
 */
export function settleScript(quietMs: number, capMs: number): string {
  return `new Promise((resolve) => {
  let last = performance.now()
  const start = last
  const mo = new MutationObserver(() => { last = performance.now() })
  mo.observe(document, { subtree: true, childList: true, attributes: true, characterData: true })
  const tick = () => {
    const now = performance.now()
    if (now - last >= ${quietMs} || now - start >= ${capMs}) {
      mo.disconnect()
      resolve(now - last >= ${quietMs})
    } else setTimeout(tick, 50)
  }
  tick()
})`
}

const QUIET_MS = 800
const SETTLE_CAP_MS = 6000
const STEP_TIMEOUT_MS = 8000

/** Load, then the DOM holding still. A navigation mid-wait starts it again. */
async function settle(page: Page): Promise<boolean> {
  const started = Date.now()
  for (let tries = 0; tries < 3; tries++) {
    await page.waitForLoadState('load', { timeout: 15000 }).catch(() => {})
    const left = Math.max(QUIET_MS, SETTLE_CAP_MS - (Date.now() - started))
    try {
      return (await page.evaluate(settleScript(QUIET_MS, left))) as boolean
    } catch {
      // The context went away under the wait: a navigation. Wait for it.
    }
  }
  return false
}

// ---------------------------------------------------------------------------
// Looking
// ---------------------------------------------------------------------------

export class LookRefusal extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LookRefusal'
  }
}

export interface LookResult {
  url: string
  landed: string
  screenshot: string
  viewport: { width: number; height: number }
  controls: LookControl[]
  /** visible controls outside the viewport (scroll to see them) */
  offscreen: number
  /** controls past the listing's limit */
  more: number
  exposures: Exposure[]
  wall: WallVerdict | null
  /** steps that ran before the look; none when a hard wall stopped them */
  steps: { do: LookStep['do']; selector: string; note?: string }[]
  /** false when the page never held still and was looked at anyway */
  settled: boolean
}

export interface LookOpts {
  steps?: LookStep[]
  /** extra ms after the last settle, for a page that animates in */
  waitMs?: number
  /** where look.png goes */
  outDir: string
  log?: (line: string) => void
}

const place = (u: string): string => {
  try {
    const x = new URL(u)
    return `${x.origin}${x.pathname}`
  } catch {
    return u
  }
}

/**
 * Open `url` in `page`, judge the wall, run the steps, and look: the
 * screenshot, the exposure scan, the inventory and a proposal per control.
 * A hard wall stops the steps but not the look, since the sign-in page is
 * what the agent must script past next.
 */
export async function lookAt(
  page: Page,
  url: string,
  opts: LookOpts,
): Promise<LookResult> {
  const log = opts.log ?? (() => {})
  log(`goto ${place(url)}`)
  const response = await page
    .goto(url, { waitUntil: 'load', timeout: 45000 })
    .catch((e: unknown) => {
      // A load that never fired still left a page to look at; a refused
      // connection did not.
      if (e instanceof Error && /net::ERR_/.test(e.message))
        throw new Error(
          `could not open ${place(url)}: ${e.message.split('\n')[0]}`,
        )
      log('   (the load event never fired; looking anyway)')
      return null
    })
  let settled = await settle(page)

  const seen = (await page.evaluate(WALL_PROBE).catch(() => null)) as {
    passwordFields: number
    newPasswordField: boolean
    oneTimeCodeField: boolean
  } | null
  const wall = wallVerdict({
    askedUrl: url,
    landedUrl: page.url(),
    ...(response ? { status: response.status() } : {}),
    passwordFields: seen?.passwordFields ?? 0,
    newPasswordField: seen?.newPasswordField ?? false,
    oneTimeCodeField: seen?.oneTimeCodeField ?? false,
  })

  const ran: LookResult['steps'] = []
  if (!wall || wall.level === 'soft') {
    for (const step of opts.steps ?? []) {
      const all = page.locator(step.selector)
      const target = all.first()
      try {
        await target.waitFor({ state: 'visible', timeout: STEP_TIMEOUT_MS })
      } catch {
        throw new UsageError(
          `--${step.do} ${step.selector}: no visible element matches it after ${STEP_TIMEOUT_MS / 1000} s. Look without the step and take a selector from the list`,
        )
      }
      const count = await all.count()
      const note = count > 1 ? `the first of ${count} matches` : undefined
      if (step.do === 'click') {
        // The words it is known by, read before anything is pressed. An
        // inline arrow with no named helper inside, so no \`__name\` rides in.
        const words = await target
          .evaluate((el) =>
            [
              el.getAttribute('aria-label'),
              (el as HTMLElement).innerText || el.textContent,
              (el as HTMLInputElement).value,
              el.getAttribute('title'),
              el.getAttribute('alt'),
            ].map((s) =>
              typeof s === 'string' ? s.replace(/\s+/g, ' ').trim() : '',
            ),
          )
          .catch(() => [] as string[])
        const word = spendWord(words)
        if (word) {
          const label = words.find((w) => w && SPEND.test(w)) ?? word
          throw new LookRefusal(
            refusalLine(step.selector, label.slice(0, 60), word),
          )
        }
        log(`click ${step.selector}${note ? ` (${note})` : ''}`)
        await target.click({ timeout: STEP_TIMEOUT_MS })
      } else {
        // The text is never logged: it may be a password.
        log(
          `type ${step.text.length} chars into ${step.selector}${note ? ` (${note})` : ''}`,
        )
        await target.fill(step.text, { timeout: STEP_TIMEOUT_MS })
      }
      ran.push({
        do: step.do,
        selector: step.selector,
        ...(note ? { note } : {}),
      })
      settled = await settle(page)
    }
  }
  if (opts.waitMs && opts.waitMs > 0) await page.waitForTimeout(opts.waitMs)

  await mkdir(opts.outDir, { recursive: true })
  const screenshot = join(opts.outDir, 'look.png')
  await page.screenshot({ path: screenshot })

  const scan = (await page.evaluate(EXPOSURE_PROBE).catch(() => null)) as {
    exposures?: Omit<Exposure, 'step' | 'seen'>[]
  } | null
  const step = ran.length ? ran.length - 1 : -1
  const exposures: Exposure[] = (scan?.exposures ?? []).map((e) => ({
    step,
    ...e,
    seen: 1,
  }))

  const probe = (await page.evaluate(LOOK_PROBE)) as {
    controls: RawControl[]
    offscreen: number
    more: number
  }
  const controls: LookControl[] = []
  try {
    for (const raw of probe.controls) {
      const candidates = selectorCandidates(raw)
      const reached: (string | null)[][] = []
      for (const c of candidates) {
        const stamps = (await page
          .locator(c.selector)
          .evaluateAll((els) =>
            els.map((el) => el.getAttribute('data-vos-look')),
          )
          .catch(() => [])) as (string | null)[]
        reached.push(stamps)
        // The first unique one is the answer; the rest need not be counted.
        if (judgeMatch(raw.index, stamps) === 'unique') break
      }
      const proposal = chooseProposal(raw.index, candidates, reached)
      controls.push({
        tag: raw.tag,
        role: raw.role,
        name: displayName(raw),
        testId: raw.testId?.value ?? null,
        href: raw.href,
        rect: raw.rect,
        disabled: raw.disabled,
        inDialog: raw.dialog !== null,
        covered: raw.covered,
        ...proposal,
        ...(raw.redacted ? { redacted: raw.redacted } : {}),
      })
    }
  } finally {
    await page.evaluate(UNSTAMP).catch(() => {})
  }
  return {
    url: place(url),
    landed: place(page.url()),
    screenshot,
    viewport: page.viewportSize() ?? { width: 0, height: 0 },
    controls,
    offscreen: probe.offscreen,
    more: probe.more,
    exposures,
    wall,
    steps: ran,
    settled,
  }
}

// ---------------------------------------------------------------------------
// The verb
// ---------------------------------------------------------------------------

const USAGE =
  'vos look <url> [--session <name> | --storage-state <file>] [--viewport WxH] [--headed] [--click <selector>]... [--type <selector>=<text>]... [--wait <ms>] [--out <dir>] [--json]'

/** The human report: the picture, the controls, what the frame exposes. */
export function lookReport(r: LookResult): string {
  const inDialog = r.controls.filter((c) => c.inDialog).length
  const head = `Looked at ${r.landed} (${r.viewport.width}×${r.viewport.height}): ${r.screenshot}${r.settled ? '' : '\n  note: the page never held still for 0.8 s; looked at it as it was'}`
  const steps = r.steps.length
    ? `\n  after ${r.steps.map((s) => `${s.do} ${s.selector}${s.note ? ` (${s.note})` : ''}`).join(', then ')}`
    : ''
  const wall = r.wall
    ? `\n  ${r.wall.level === 'hard' ? 'WALL' : 'WARNING'}: ${r.wall.message}${r.wall.level === 'hard' ? '\n  The steps did not run; this is the page in front of the one asked for.' : ''}`
    : ''
  const count = `\n  ${r.controls.length} control${r.controls.length === 1 ? '' : 's'} in view${inDialog ? ` (${inDialog} in an open dialog)` : ''}${r.offscreen ? `, ${r.offscreen} more outside it (scroll, or a taller --viewport)` : ''}${r.more ? `, ${r.more} past the listing's limit` : ''}:`
  const list = r.controls.map(controlLine).join('\n')
  const exposed = r.exposures.length
    ? `\n  EXPOSED in the frame (${r.exposures.length}):\n${r.exposures.map((e) => `    - ${exposureLine(e)}`).join('\n')}\n  ${EXPOSURE_ADVICE}`
    : ''
  const next = `\n  Take a UNIQUE selector into actions.json as it is; an AMBIGUOUS one reaches several and the recorder takes the first. Then rehearse: vos record --actions actions.json --dry-run`
  return `${head}${steps}${wall}${count}\n${list}${exposed}${next}`
}

export async function cmdLook(argv: string[]): Promise<number> {
  const steps = lookSteps(argv)
  const { positionals, flags, multi } = parseArgs(
    argv,
    new Set(['json', 'headed']),
    new Set(['click', 'type', 'header', 'browser-arg']),
  )
  // Read here so the flag check knows they were used; the order is lookSteps'.
  void multi.click
  void multi.type
  const url = positionals[0]
  if (!url) throw new UsageError(USAGE)
  const scheme = urlSchemeProblem(url)
  if (scheme) throw new UsageError(scheme)
  const r = createReporter(flags.json === true)
  const viewport = parseViewport(strFlag(flags, 'viewport'))
  const outDir = resolve(strFlag(flags, 'out') ?? 'look')
  const headed = flags.headed === true
  const waitRaw = strFlag(flags, 'wait')
  const waitMs = waitRaw === undefined ? 0 : Number(waitRaw)
  if (!Number.isFinite(waitMs) || waitMs < 0 || waitMs > 60000)
    throw new UsageError('--wait expects milliseconds, 0 to 60000')

  const storageRaw = strFlag(flags, 'storage-state')
  const storageState = storageRaw ? resolve(storageRaw) : undefined
  if (storageState && !existsSync(storageState))
    throw new UsageError(`--storage-state: no such file: ${storageState}`)
  const sessionName = strFlag(flags, 'session')
  if (sessionName) {
    const bad = sessionNameVerdict(sessionName)
    if (bad) throw new UsageError(bad)
    if (storageState)
      throw new UsageError(
        '--session and --storage-state are two doors to one page: a persistent profile cannot take a storage state. Pass one',
      )
    if (!existsSync(sessionDir(sessionName)))
      throw new UsageError(
        `no session "${sessionName}". Make one: vos session open <url> --name ${sessionName} (a Chrome window opens; sign in and close it)`,
      )
  }
  let headers: Record<string, string>
  try {
    headers = parseHeaders(multi.header as string[] | undefined)
  } catch (e) {
    throw new UsageError(e instanceof Error ? e.message : String(e))
  }
  const browserArgs = (
    (multi['browser-arg'] as string[] | undefined) ?? []
  ).filter(Boolean)

  const inContext = async (ctx: BrowserContext): Promise<LookResult> => {
    if (Object.keys(headers).length)
      await ctx.route('**/*', async (route) => {
        const req = route.request()
        const scoped = headersFor(req.url(), url, headers)
        await route.continue(
          scoped ? { headers: { ...req.headers(), ...scoped } } : undefined,
        )
      })
    const page = ctx.pages()[0] ?? (await ctx.newPage())
    await page.setViewportSize(viewport)
    return lookAt(page, url, { steps, waitMs, outDir, log: r.log })
  }

  let result: LookResult
  try {
    if (sessionName) {
      result = await withSession(sessionName, inContext, {
        headless: !headed,
        viewport,
      })
    } else {
      const browser = await launchBrowser(browserArgs, { headless: !headed })
      try {
        const ctx = await browser.newContext({
          viewport,
          deviceScaleFactor: 1,
          ...(storageState ? { storageState } : {}),
        })
        result = await inContext(ctx)
      } finally {
        await browser.close()
      }
    }
  } catch (e) {
    if (e instanceof LookRefusal) {
      r.done({ ok: false, refused: true, error: e.message }, e.message)
      return EXIT_USAGE
    }
    throw e
  }

  r.done(
    { ok: !result.wall || result.wall.level === 'soft', ...result },
    lookReport(result),
  )
  return result.wall?.level === 'hard' ? EXIT_WALL : EXIT_OK
}
