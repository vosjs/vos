/**
 * What a signed-in take SHOWS. Getting past the login is half the problem;
 * the other half is that the account's own data is now in the frame: an
 * email address in the header, a key on a settings page, a card number.
 * Asking nicely does not hold this line (a person asked to sign in with a
 * demo account signs in as themselves, because it is the account they have),
 * so the recorder looks.
 *
 * Two pieces, both run IN the page:
 *
 * - the EXPOSURE scan reads the text that is visible in the viewport after
 *   each step and reports the KIND of thing it saw and where. Never the
 *   string itself: a report that quotes the secret is a second leak.
 * - a MASK hides a selector before the first frame is captured and keeps it
 *   hidden across navigations and re-renders, so the real value is never in
 *   a frame, never in the recording, never pushed. `as: 'text'` swaps the
 *   words (a product reads better than a redaction); `as: 'blur'` blurs.
 *
 * The matchers are ONE plain-JavaScript source string, evaluated in the page
 * and, by the tests, in Node: a function serialized out of a bundle picks up
 * the bundler's `__name` helper and dies in the page, and two copies of a
 * regex drift.
 */
import type { RecordingMeta } from '@vosjs/studio-core'

export type ExposureKind = 'email' | 'key' | 'card' | 'card-tail'
export type Exposure = NonNullable<RecordingMeta['exposures']>[number]
export type MaskReport = NonNullable<RecordingMeta['masks']>[number]

export interface MaskRule {
  selector: string
  /** `blur` (default) blurs the element; `text` swaps its words for `text`. */
  as?: 'blur' | 'text'
  text?: string
}

/**
 * `kindsIn(text)` → the kinds of sensitive-looking strings in `text`.
 *
 * - email: any address, EXCEPT one on a domain that can reach no one
 *   (example.com/.org/.net, and the reserved .test/.example/.invalid/
 *   .localhost TLDs), which is what demo data should use.
 * - key: the prefixes of keys people actually paste into dashboards, and a
 *   JWT's three base64url parts.
 * - card: 13 to 19 digits that pass the Luhn check, so an order number or a
 *   phone number is not a card.
 * - card-tail: a masked number's visible tail (•••• 4242).
 */
export const EXPOSURE_MATCHERS_SRC = `(() => {
  const EMAIL = /[A-Za-z0-9._%+-]+@((?:[A-Za-z0-9-]+\\.)+[A-Za-z]{2,})/g
  const SAFE_HOST = /(^|\\.)example\\.(com|org|net)$|\\.(test|example|invalid|localhost)$/i
  const KEY = new RegExp([
    '\\\\b[srp]k_(?:live|test)_[A-Za-z0-9]{8,}',
    '\\\\bgh[pousr]_[A-Za-z0-9]{20,}',
    '\\\\bgithub_pat_[A-Za-z0-9_]{20,}',
    '\\\\bxox[abprs]-[A-Za-z0-9-]{10,}',
    '\\\\bAKIA[0-9A-Z]{16}\\\\b',
    '\\\\bAIza[0-9A-Za-z_-]{30,}',
    '\\\\bvos_(?:sk|rg|ho)_[A-Za-z0-9]{8,}',
    '\\\\beyJ[A-Za-z0-9_-]{8,}\\\\.eyJ[A-Za-z0-9_-]{8,}\\\\.[A-Za-z0-9_-]{8,}',
  ].join('|'))
  const CARD = /(?:^|[^0-9])((?:[0-9][ -]?){12,18}[0-9])(?![0-9])/g
  const TAIL = /[\\u2022\\u00b7*xX]{2,}[ -]?[0-9]{4}(?![0-9])/
  const luhn = (digits) => {
    let sum = 0, alt = false
    for (let i = digits.length - 1; i >= 0; i--) {
      let d = digits.charCodeAt(i) - 48
      if (alt) { d *= 2; if (d > 9) d -= 9 }
      sum += d; alt = !alt
    }
    return sum % 10 === 0
  }
  const kindsIn = (text) => {
    const kinds = []
    if (!text || text.length < 6) return kinds
    EMAIL.lastIndex = 0
    for (let m; (m = EMAIL.exec(text)); ) {
      if (!SAFE_HOST.test(m[1])) { kinds.push('email'); break }
    }
    if (KEY.test(text)) kinds.push('key')
    CARD.lastIndex = 0
    for (let m; (m = CARD.exec(text)); ) {
      const digits = m[1].replace(/[ -]/g, '')
      if (digits.length >= 13 && digits.length <= 19 && !/^0+$/.test(digits) && luhn(digits)) { kinds.push('card'); break }
    }
    if (TAIL.test(text)) kinds.push('card-tail')
    return kinds
  }
  return { kindsIn }
})()`

/**
 * The scan: visible text in the viewport, plus the values of text inputs.
 * Skips anything inside a masked element, password fields, and text the eye
 * cannot see. Reports kind + a selector-ish name for the element + its rect.
 */
export const EXPOSURE_PROBE = `(() => {
  const { kindsIn } = ${EXPOSURE_MATCHERS_SRC}
  const vw = innerWidth, vh = innerHeight
  // A selector that reaches THIS element and no other, so it can be pasted
  // into "mask" as it is: climb until the path is unique, and say which
  // sibling wherever a tag-and-class alone would match several.
  const segment = (el) => {
    const tid = el.getAttribute('data-testid')
    if (tid) return el.tagName.toLowerCase() + '[data-testid="' + tid + '"]'
    if (el.id && /^[A-Za-z_][\\w-]*$/.test(el.id)) return el.tagName.toLowerCase() + '#' + el.id
    const cls = [...el.classList].filter((c) => /^[A-Za-z_-][\\w-]*$/.test(c)).slice(0, 2)
    let seg = el.tagName.toLowerCase() + (cls.length ? '.' + cls.join('.') : '')
    const p = el.parentElement
    if (p && [...p.children].filter((c) => c.matches(seg)).length > 1)
      seg += ':nth-child(' + ([...p.children].indexOf(el) + 1) + ')'
    return seg
  }
  const name = (el) => {
    const parts = []
    for (let cur = el; cur && cur !== document.body && cur !== document.documentElement; cur = cur.parentElement) {
      parts.unshift(segment(cur))
      let n = 2
      try { n = document.querySelectorAll(parts.join(' > ')).length } catch {}
      // a bare tag is unique HERE and nowhere else: give it its parent too
      const bare = parts.length === 1 && !/[#.\\[]/.test(parts[0])
      if ((n === 1 && !bare) || parts.length >= 5) break
    }
    return parts.join(' > ')
  }
  const seen = (el) => {
    if (el.closest('[data-vos-masked]')) return null
    const r = el.getBoundingClientRect()
    if (r.width < 2 || r.height < 2) return null
    if (r.bottom <= 0 || r.right <= 0 || r.top >= vh || r.left >= vw) return null
    const s = getComputedStyle(el)
    if (s.visibility === 'hidden' || s.display === 'none' || +s.opacity === 0) return null
    return r
  }
  const out = [], keys = new Set()
  const add = (el, text) => {
    const kinds = kindsIn(text)
    if (!kinds.length) return
    const r = seen(el)
    if (!r) return
    const selector = name(el)
    for (const kind of kinds) {
      const k = kind + '|' + selector
      if (keys.has(k) || out.length >= 40) continue
      keys.add(k)
      out.push({ kind, selector, rect: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) } })
    }
  }
  const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT)
  for (let n; (n = walker.nextNode()); ) {
    const el = n.parentElement
    if (!el || /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE)$/.test(el.tagName)) continue
    add(el, n.nodeValue)
  }
  for (const el of document.querySelectorAll('input, textarea')) {
    if (/^(password|hidden|file|checkbox|radio)$/.test(el.type)) continue
    add(el, el.value)
  }
  const hits = {}
  for (const [sel, n] of Object.entries(window.__vosMaskHits || {})) hits[sel] = n
  return { exposures: out, maskHits: hits }
})()`

/**
 * The mask, as an init script: it runs at document start on EVERY navigation,
 * so a masked value is hidden before the page's first paint, and a
 * MutationObserver re-applies it after a client-side re-render. A form
 * control is blurred even when `as: 'text'` was asked for: writing into an
 * input would change what the app submits.
 */
export function maskInitScript(masks: MaskRule[]): string {
  const rules = masks.map((m) => ({
    selector: m.selector,
    as: m.as === 'text' ? 'text' : 'blur',
    text: m.text ?? '',
  }))
  return `(() => {
  const RULES = ${JSON.stringify(rules)}
  const hits = (window.__vosMaskHits = window.__vosMaskHits || {})
  for (const r of RULES) hits[r.selector] = hits[r.selector] || 0
  const css = RULES.map((r) => r.selector + '[data-vos-masked="blur"]{filter:blur(7px) !important;user-select:none !important}').join('\\n')
  const paint = () => {
    const root = document.head || document.documentElement
    if (!root || document.getElementById('__vos-mask-style')) return
    const style = document.createElement('style')
    style.id = '__vos-mask-style'
    style.textContent = css
    root.appendChild(style)
  }
  const apply = () => {
    paint()
    for (const r of RULES) {
      let found
      try { found = document.querySelectorAll(r.selector) } catch { continue }
      if (found.length > hits[r.selector]) hits[r.selector] = found.length
      for (const el of found) {
        const form = /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)
        const mode = r.as === 'text' && !form ? 'text' : 'blur'
        if (el.getAttribute('data-vos-masked') !== mode) el.setAttribute('data-vos-masked', mode)
        if (mode !== 'text') continue
        const texts = []
        const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
        for (let n; (n = w.nextNode()); ) texts.push(n)
        if (!texts.length) { if (el.textContent !== r.text) el.textContent = r.text; continue }
        texts.forEach((n, i) => { const want = i === 0 ? r.text : ''; if (n.nodeValue !== want) n.nodeValue = want })
      }
    }
  }
  new MutationObserver(apply).observe(document, { childList: true, subtree: true, characterData: true })
  document.addEventListener('DOMContentLoaded', apply)
  apply()
})()`
}

/**
 * Accumulates scans across a take: an exposure is reported ONCE, at the
 * first step it was seen, with how many scans saw it.
 */
export class ExposureLog {
  private byKey = new Map<string, Exposure>()
  private maskHits = new Map<string, number>()

  constructor(masks: MaskRule[] = []) {
    for (const m of masks) this.maskHits.set(m.selector, 0)
  }

  add(
    step: number,
    scan: {
      exposures?: Omit<Exposure, 'step' | 'seen'>[]
      maskHits?: Record<string, number>
    } | null,
  ): void {
    if (!scan) return
    for (const e of scan.exposures ?? []) {
      const key = `${e.kind}|${e.selector}`
      const had = this.byKey.get(key)
      if (had) had.seen += 1
      else this.byKey.set(key, { step, ...e, seen: 1 })
    }
    for (const [sel, n] of Object.entries(scan.maskHits ?? {})) {
      if (n > (this.maskHits.get(sel) ?? 0)) this.maskHits.set(sel, n)
    }
  }

  exposures(): Exposure[] {
    return [...this.byKey.values()]
  }

  masks(rules: MaskRule[]): MaskReport[] {
    return rules.map((m) => ({
      selector: m.selector,
      as: m.as === 'text' ? 'text' : 'blur',
      hits: this.maskHits.get(m.selector) ?? 0,
    }))
  }
}

const KIND_WORDS: Record<ExposureKind, string> = {
  email: 'an email address',
  key: 'something shaped like an API key or token',
  card: 'a card number',
  'card-tail': "a card's last digits",
}

/** One exposure, in words. `step` -1 is the page as it opened. */
export function exposureLine(e: Exposure): string {
  const when = e.step < 0 ? 'as the page opened' : `at step #${e.step}`
  return `${KIND_WORDS[e.kind]} in ${e.selector} (${when}, ${e.rect.x},${e.rect.y} ${e.rect.w}×${e.rect.h})`
}

export const EXPOSURE_ADVICE =
  'The recording shows these. Record from a demo account, or hide them before the camera rolls with "mask" in actions.json: { "selector": "…", "as": "text", "text": "demo@acme.test" } swaps the words, "as": "blur" blurs. Then re-record.'
