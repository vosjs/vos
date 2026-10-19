/**
 * Where a URL the person typed may be fetched from. `vos asset import` and
 * `vos brand` follow an address from this machine, so an address on this
 * machine's own network (loopback, a private range, link-local, the cloud
 * metadata range) is refused before anything is fetched, and so is a
 * redirect that lands on one. Only a LITERAL address is judged here: a
 * name resolves at fetch time, where this check cannot see it.
 */

type Octets = [number, number, number, number]

/** Why a hostname is not fetched, or null when it may be. */
export function privateHostReason(hostname: string): string | null {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (host === 'localhost' || host.endsWith('.localhost'))
    return 'is this machine'
  const v4 = parseIPv4(host)
  if (v4) return privateIPv4Reason(v4)
  const v6 = expandIPv6(host)
  if (!v6) return null
  // An IPv4 address carried in IPv6 is judged as the IPv4 it carries.
  const carried = carriedIPv4(v6)
  if (carried) return privateIPv4Reason(carried)
  if (v6.every((w) => w === 0)) return 'is an unspecified address'
  if (v6.slice(0, 7).every((w) => w === 0) && v6[7] === 1)
    return 'is this machine'
  if ((v6[0] & 0xfe00) === 0xfc00) return 'is a private network address'
  if ((v6[0] & 0xffc0) === 0xfe80) return 'is a link-local address'
  return null
}

function privateIPv4Reason([a, b]: Octets): string | null {
  if (a === 0) return 'is an unspecified address'
  if (a === 127) return 'is this machine'
  if (a === 10) return 'is a private network address'
  if (a === 172 && b >= 16 && b <= 31) return 'is a private network address'
  if (a === 192 && b === 168) return 'is a private network address'
  if (a === 100 && b >= 64 && b <= 127) return 'is a private network address'
  if (a === 169 && b === 254) return 'is a link-local address'
  return null
}

/**
 * The four octets of an IPv4 literal in any spelling a resolver takes
 * (dotted decimal, hex, octal, fewer than four parts), or null.
 */
export function parseIPv4(host: string): Octets | null {
  if (!/^[0-9a-fx.]+$/i.test(host)) return null
  const parts = host.split('.')
  if (parts.length > 4 || parts.some((p) => p === '')) return null
  const nums: number[] = []
  for (const p of parts) {
    let n: number
    if (/^0x[0-9a-f]+$/i.test(p)) n = parseInt(p.slice(2), 16)
    else if (/^0[0-7]+$/.test(p)) n = parseInt(p, 8)
    else if (/^[0-9]+$/.test(p)) n = parseInt(p, 10)
    else return null
    nums.push(n)
  }
  // The last part fills the remaining octets, the way inet_aton reads it.
  const last = nums[nums.length - 1]
  const lead = nums.slice(0, -1)
  if (lead.some((n) => n > 255)) return null
  const fill = 4 - lead.length
  if (last >= 256 ** fill) return null
  const tail: number[] = []
  let rest = last
  for (let i = 0; i < fill; i++) {
    tail.unshift(rest % 256)
    rest = Math.floor(rest / 256)
  }
  return [...lead, ...tail] as Octets
}

/** The eight 16-bit words of an IPv6 literal, or null when it is not one. */
export function expandIPv6(host: string): number[] | null {
  if (!host.includes(':')) return null
  const zone = host.indexOf('%')
  const addr = zone >= 0 ? host.slice(0, zone) : host
  if (!/^[0-9a-f:.]+$/i.test(addr)) return null
  const halves = addr.split('::')
  if (halves.length > 2) return null
  const words = (part: string): number[] | null => {
    if (part === '') return []
    const out: number[] = []
    const groups = part.split(':')
    for (let i = 0; i < groups.length; i++) {
      const g = groups[i]
      if (g.includes('.')) {
        // A dotted IPv4 tail takes the last two words.
        if (i !== groups.length - 1) return null
        const v4 = parseIPv4(g)
        if (!v4) return null
        out.push((v4[0] << 8) | v4[1], (v4[2] << 8) | v4[3])
        continue
      }
      if (!/^[0-9a-f]{1,4}$/i.test(g)) return null
      out.push(parseInt(g, 16))
    }
    return out
  }
  const head = words(halves[0])
  const tail = halves.length === 2 ? words(halves[1]) : []
  if (!head || !tail) return null
  if (halves.length === 1) return head.length === 8 ? head : null
  const gap = 8 - head.length - tail.length
  if (gap < 1) return null
  return [...head, ...new Array<number>(gap).fill(0), ...tail]
}

/** The IPv4 an IPv6 address carries (mapped, compatible or NAT64), if any. */
function carriedIPv4(v6: number[]): Octets | null {
  const zeroLead = v6.slice(0, 5).every((w) => w === 0)
  const mapped = zeroLead && v6[5] === 0xffff
  // ::a.b.c.d (compatible), but never :: or ::1 themselves.
  const compatible = zeroLead && v6[5] === 0 && (v6[6] !== 0 || v6[7] > 1)
  const nat64 = v6[0] === 0x0064 && v6[1] === 0xff9b
  if (!mapped && !compatible && !nat64) return null
  return [v6[6] >> 8, v6[6] & 0xff, v6[7] >> 8, v6[7] & 0xff]
}

/** Why a URL is not fetched from this machine, or null when it may be. */
export function fetchRefusal(url: string): string | null {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return `${url} is not a URL`
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:')
    return `${url} is not an http(s) address, and the CLI fetches nothing else`
  const reason = privateHostReason(u.hostname)
  if (reason)
    return `${u.hostname} ${reason}, and the CLI fetches only from the public internet`
  return null
}

const MAX_HOPS = 5

/**
 * Fetch a public address, following at most five redirects and holding
 * every hop to the same rule as the first. The answer is the last hop's.
 */
export async function fetchPublic(
  url: string,
  init: RequestInit = {},
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  let at = url
  for (let hop = 0; ; hop++) {
    const refused = fetchRefusal(at)
    if (refused) throw new Error(refused)
    const res = await fetchImpl(at, { ...init, redirect: 'manual' })
    const location = res.headers.get('location')
    if (res.status < 300 || res.status > 399 || !location) return res
    if (hop >= MAX_HOPS)
      throw new Error(`${url} redirected more than ${MAX_HOPS} times`)
    at = new URL(location, at).href
  }
}
