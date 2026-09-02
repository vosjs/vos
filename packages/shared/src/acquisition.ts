/**
 * Signup attribution (first touch), pure.
 *
 * PostHog already sees every referrer and utm param, but nothing first-party
 * survives to the `user` row, and a first touch is the one fact that can
 * never be backfilled. The seam is deliberately tiny: a write-once cookie set
 * by the web worker on the first arrival that carries a signal (an external
 * referrer or utm params — a direct visit sets nothing), read exactly once
 * when BetterAuth creates the user, then stamped as JSON on
 * `user.acquisition` and never updated.
 *
 * Everything here is pure so the platform's cookie writer and its signup
 * reader can never disagree on the format.
 */

export const FIRST_TOUCH_COOKIE = 'vosso_ft'

/** 30 days: long enough to span consider-then-signup, short enough to stay a
 *  first touch rather than a biography. */
export const FIRST_TOUCH_MAX_AGE = 60 * 60 * 24 * 30

/** Per-field cap. UTM values are short by convention; anything longer is
 *  noise or abuse and gets truncated rather than refused. */
const FIELD_MAX = 200

/** Decode guard: a cookie bigger than this is not ours. */
const RAW_MAX = 2000

export interface FirstTouch {
  /** utm_source, or the referring domain when the arrival was untagged. */
  source: string
  /** utm_medium, or 'referral' when derived from a bare referrer. */
  medium?: string
  /** utm_campaign, verbatim. */
  campaign?: string
  /** External referring domain, when there was one. */
  referrer?: string
  /** The path the visit landed on. */
  landing?: string
  /** ISO timestamp of the first touch. */
  at?: string
}

function clean(value: string | null | undefined): string | undefined {
  const v = value?.trim().slice(0, FIELD_MAX)
  return v || undefined
}

/**
 * Is the referrer an internal navigation rather than an arrival? Compares
 * registrable-host-ish: `www.vos.so` referring to `vos.so` is the same site
 * (canonicalHost 301s www onto the apex, so the second request's referrer is
 * our own www host and must not read as a referral).
 */
function sameSite(a: string, b: string): boolean {
  const strip = (h: string) => (h.startsWith('www.') ? h.slice(4) : h)
  return strip(a) === strip(b)
}

/**
 * Derive a first touch from a landing request, or null when the visit
 * carries no acquisition signal. Null is the common case and the point:
 * a direct visit gets no cookie, and an absent `user.acquisition` reads
 * honestly as "direct or before the feature", never as a guessed channel.
 */
export function firstTouchOf(input: {
  url: URL
  referer: string | null | undefined
}): FirstTouch | null {
  const { url, referer } = input
  const source = clean(url.searchParams.get('utm_source'))
  const medium = clean(url.searchParams.get('utm_medium'))
  const campaign = clean(url.searchParams.get('utm_campaign'))

  let referrerDomain: string | undefined
  if (referer) {
    try {
      const r = new URL(referer)
      if (r.hostname && !sameSite(r.hostname, url.hostname)) {
        referrerDomain = clean(r.hostname)
      }
    } catch {
      // An unparseable referrer is no signal.
    }
  }

  if (!source && !campaign && !referrerDomain) return null

  const touch: FirstTouch = {
    source: source ?? referrerDomain ?? 'unknown',
  }
  const derivedMedium =
    medium ?? (!source && referrerDomain ? 'referral' : undefined)
  if (derivedMedium) touch.medium = derivedMedium
  if (campaign) touch.campaign = campaign
  if (referrerDomain) touch.referrer = referrerDomain
  return touch
}

/** Cookie-safe encoding of a first touch. */
export function encodeFirstTouch(touch: FirstTouch): string {
  return encodeURIComponent(JSON.stringify(touch))
}

/**
 * Fail-closed parse of first-touch JSON (the shape `user.acquisition`
 * stores): anything oversized, unparseable, or missing a string `source`
 * is null.
 */
export function parseFirstTouchJson(
  raw: string | null | undefined,
): FirstTouch | null {
  if (!raw || raw.length > RAW_MAX) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return null
    const record = parsed as Record<string, unknown>
    if (typeof record.source !== 'string' || !record.source) return null
    const touch: FirstTouch = { source: record.source.slice(0, FIELD_MAX) }
    for (const key of [
      'medium',
      'campaign',
      'referrer',
      'landing',
      'at',
    ] as const) {
      const value = record[key]
      if (typeof value === 'string' && value)
        touch[key] = value.slice(0, FIELD_MAX)
    }
    return touch
  } catch {
    return null
  }
}

/**
 * Fail-closed cookie decode. The cookie arrives from the wild — a browser
 * extension or a hand-edited jar can put anything under our name.
 */
export function decodeFirstTouch(
  raw: string | null | undefined,
): FirstTouch | null {
  if (!raw || raw.length > RAW_MAX) return null
  try {
    return parseFirstTouchJson(decodeURIComponent(raw))
  } catch {
    return null
  }
}

/** Read one cookie's raw value out of a Cookie header. */
export function readCookieValue(
  header: string | null | undefined,
  name: string,
): string | undefined {
  if (!header) return undefined
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim()
  }
  return undefined
}
