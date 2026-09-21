/**
 * The wall check: did the recorder land where it was asked, or in front of
 * a sign-in? A take of a product behind a login, recorded without a session,
 * used to succeed: the footage was the login page (or wherever the site
 * sends a stranger), and the only symptom was a skipped selector. This says
 * it in words, before a frame is captured and before a re-record clears the
 * footage it would have replaced.
 *
 * Pure: the recorder gathers the evidence, this decides. A heuristic is
 * acceptable because both failure directions are cheap: a false refusal
 * costs one flag (`--allow-wall`), a false pass costs what every such take
 * cost before.
 */

/** What the recorder saw once the first navigation settled. */
export interface Arrival {
  askedUrl: string
  landedUrl: string
  /** HTTP status of the main document, when the navigation produced one. */
  status?: number
  /** `input[type=password]` fields that are visible on the page. */
  passwordFields: number
  /** A password field marked `autocomplete="new-password"` (a settings or sign-up form). */
  newPasswordField: boolean
  /** A visible one-time-code field (`autocomplete="one-time-code"`). */
  oneTimeCodeField: boolean
}

export type WallKind =
  /** the asked URL answered 401 or 403 */
  | 'status'
  /** landed on an identity provider's host */
  | 'idp'
  /** landed on a sign-in form or a sign-in path */
  | 'signin'
  /** sent somewhere else, with no sign-in in sight (a site that shows strangers a public page) */
  | 'redirect'

export interface WallVerdict {
  kind: WallKind
  /**
   * `hard` is refused always; `soft` is refused under `--strict` and said as
   * a warning otherwise, because a redirect alone is not proof of a wall.
   */
  level: 'hard' | 'soft'
  /** origin + path, never the query or hash (they can carry tokens). */
  asked: string
  landed: string
  message: string
}

/** Hosts that only ever mean "sign in". Suffix match on the label boundary. */
const IDP_HOSTS = [
  'accounts.google.com',
  'login.microsoftonline.com',
  'login.live.com',
  'appleid.apple.com',
  'auth0.com',
  'okta.com',
  'onelogin.com',
  'clerk.accounts.dev',
  'accounts.dev',
  'b2clogin.com',
  'amazoncognito.com',
  'workos.com',
  'stytch.com',
]

/** Path segments that name a sign-in surface. Whole segments, never substrings. */
const SIGNIN_SEGMENTS = new Set([
  'login',
  'log-in',
  'signin',
  'sign-in',
  'sign_in',
  'sso',
  'auth',
  'authenticate',
  'authorize',
  'oauth',
  'oauth2',
  'saml',
])

function parse(url: string): URL | null {
  try {
    return new URL(url)
  } catch {
    return null
  }
}

const bareHost = (h: string) => h.replace(/^www\./, '').toLowerCase()
const trimSlash = (p: string) => (p.length > 1 ? p.replace(/\/+$/, '') : p)
const place = (u: URL) => `${u.origin}${trimSlash(u.pathname)}`

export function isIdpHost(host: string): boolean {
  const h = host.toLowerCase()
  if (h.startsWith('clerk.')) return true
  return IDP_HOSTS.some((idp) => h === idp || h.endsWith(`.${idp}`))
}

export function isSignInPath(pathname: string): boolean {
  const segs = pathname.toLowerCase().split('/').filter(Boolean)
  return segs.some((s) => SIGNIN_SEGMENTS.has(s))
}

/**
 * Sent AWAY, as opposed to sent deeper. `/` → `/en`, `/docs` → `/docs/start`
 * and `/pricing` → `/en/pricing` are a site arranging itself; `/dashboard` →
 * `/gallery` is a site declining to show the page. `www.` and the apex are
 * one host.
 */
export function redirectedAway(asked: URL, landed: URL): boolean {
  if (bareHost(asked.hostname) !== bareHost(landed.hostname)) return true
  const a = trimSlash(asked.pathname).toLowerCase()
  const l = trimSlash(landed.pathname).toLowerCase()
  if (a === l || a === '/') return false
  if (l.startsWith(`${a}/`)) return false
  if (l.endsWith(a)) return false
  return true
}

const LADDER =
  'Walk the session ladder (mint a session from the test auth the project already has, or pass --storage-state): https://vos.so/llms-full.txt, "Sessions". A take OF this page is --allow-wall.'

export function wallVerdict(a: Arrival): WallVerdict | null {
  const asked = parse(a.askedUrl)
  const landed = parse(a.landedUrl)
  // A file: or data: take, or a URL we cannot read, has no wall to speak of.
  if (!asked || !landed) return null
  if (!/^https?:$/.test(asked.protocol)) return null

  const away = redirectedAway(asked, landed)
  const where = { asked: place(asked), landed: place(landed) }
  const host = bareHost(asked.hostname)

  if (a.status === 401 || a.status === 403) {
    return {
      kind: 'status',
      level: 'hard',
      ...where,
      message: `asked for ${asked.pathname}, answered ${a.status}: no session for ${host}. ${LADDER}`,
    }
  }

  // Someone who ASKED for the sign-in page and got it wants that take.
  const askedForSignIn =
    isSignInPath(asked.pathname) || isIdpHost(asked.hostname)
  if (askedForSignIn && !away) return null

  if (away && isIdpHost(landed.hostname) && !isIdpHost(asked.hostname)) {
    return {
      kind: 'idp',
      level: 'hard',
      ...where,
      message: `asked for ${asked.pathname}, landed on ${landed.hostname}: no session for ${host}. ${LADDER}`,
    }
  }

  // One password field that is not a new-password field is a sign-in form.
  // Two, or a new-password one, is a settings page or a sign-up.
  const signInForm =
    (a.passwordFields === 1 && !a.newPasswordField) || a.oneTimeCodeField
  if (
    (away && isSignInPath(landed.pathname)) ||
    (signInForm && !askedForSignIn)
  ) {
    const seen = away
      ? `landed on ${landed.pathname}`
      : 'the page is a sign-in form'
    return {
      kind: 'signin',
      level: 'hard',
      ...where,
      message: `asked for ${asked.pathname}, ${seen}: no session for ${host}. ${LADDER}`,
    }
  }

  if (away) {
    return {
      kind: 'redirect',
      level: 'soft',
      ...where,
      message: `asked for ${asked.pathname}, landed on ${landed.pathname}: the site sent the recorder elsewhere, which is what a page behind a login does to a stranger. If that is the page you meant, record it by its own URL. ${LADDER}`,
    }
  }
  return null
}

/** A take refused at the wall. Carries the verdict for `--json`. */
export class WallError extends Error {
  constructor(public verdict: WallVerdict) {
    super(verdict.message)
    this.name = 'WallError'
  }
}

/**
 * Evidence gathered in the page. A STRING, never a function: a serialized
 * function picks up the bundler's `__name` helper and dies in the page.
 */
export const WALL_PROBE = `(() => {
  const shown = (el) => {
    const r = el.getBoundingClientRect()
    if (r.width < 2 || r.height < 2) return false
    const s = getComputedStyle(el)
    return s.visibility !== 'hidden' && s.display !== 'none'
  }
  const pw = [...document.querySelectorAll('input[type="password"]')].filter(shown)
  const otp = [...document.querySelectorAll('input[autocomplete="one-time-code"]')].filter(shown)
  return {
    passwordFields: pw.length,
    newPasswordField: pw.some((el) => (el.getAttribute('autocomplete') || '').includes('new-password')),
    oneTimeCodeField: otp.length > 0,
  }
})()`
