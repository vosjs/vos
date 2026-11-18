/**
 * `vos feedback` with the network handed in: what it sends, where, that no
 * credential rides along whatever the shell holds, that `--dry-run` sends
 * nothing, and what it says when the report is refused.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { UsageError } from '../args'
import { FEEDBACK_MAX, cmdFeedback, feedbackRequest } from '../feedback'

interface Sent {
  url: string
  init: RequestInit
}

/** A fetch that records every request and answers each with one response. */
function fakeFetch(status = 201, body: unknown = { ok: true }) {
  const sent: Sent[] = []
  const fn = ((url: string | URL | Request, init?: RequestInit) => {
    sent.push({ url: String(url), init: init ?? {} })
    return Promise.resolve(
      new Response(typeof body === 'string' ? body : JSON.stringify(body), {
        status,
      }),
    )
  }) as typeof fetch
  return { fn, sent }
}

let out = ''
let err = ''
const ENV = ['VOS_ORIGIN', 'VOS_API_BASE', 'VOS_API_KEY'] as const
const saved = ENV.map((name) => process.env[name])

beforeEach(() => {
  out = ''
  err = ''
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    out += String(chunk)
    return true
  })
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    err += String(chunk)
    return true
  })
  for (const name of ENV) delete process.env[name]
})

afterEach(() => {
  vi.restoreAllMocks()
  ENV.forEach((name, i) => {
    if (saved[i] === undefined) delete process.env[name]
    else process.env[name] = saved[i]
  })
})

const events = () =>
  out
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as Record<string, unknown>)

describe('vos feedback', () => {
  it('posts the three fields to the origin, and nothing else', async () => {
    const { fn, sent } = fakeFetch()
    const code = await cmdFeedback(['the recorder stopped at step 3'], {
      fetch: fn,
    })
    expect(code).toBe(0)
    expect(sent).toHaveLength(1)
    expect(sent[0].url).toBe('https://vos.so/api/product-feedback')
    expect(sent[0].init.method).toBe('POST')
    expect(JSON.parse(String(sent[0].init.body))).toEqual({
      kind: 'problem',
      message: 'the recorder stopped at step 3',
      surface: 'cli',
    })
    expect(out).toBe('Sent to https://vos.so (HTTP 201).\n')
  })

  it('says what it sends, and where, before it sends', async () => {
    const order: string[] = []
    const fn = ((url: string | URL | Request) => {
      order.push(`fetch after: ${err.includes(String(url))}`)
      return Promise.resolve(new Response('{}', { status: 200 }))
    }) as typeof fetch
    await cmdFeedback(['it broke'], { fetch: fn })
    expect(order).toEqual(['fetch after: true'])
    expect(err).toContain('POST https://vos.so/api/product-feedback')
    expect(err).toContain('"message": "it broke"')
    expect(err).toContain('no credential and no other field is sent')
  })

  it('sends no credential, even with VOS_API_KEY set', async () => {
    process.env.VOS_API_KEY = 'vos_sk_secret'
    const { fn, sent } = fakeFetch()
    await cmdFeedback(['it broke', '--json'], { fetch: fn })
    expect(new Headers(sent[0].init.headers).get('authorization')).toBeNull()
    expect(
      Object.keys(sent[0].init.headers as Record<string, string>).sort(),
    ).toEqual(['accept', 'content-type'])
    expect(JSON.stringify(sent[0])).not.toContain('vos_sk_secret')
    expect(out + err).not.toContain('vos_sk_secret')
    // The request is built with no credential to hold, by its signature.
    expect(feedbackRequest('https://vos.so', 'idea', 'x').headers).toEqual({
      accept: 'application/json',
      'content-type': 'application/json',
    })
  })

  it('--dry-run prints the request and sends nothing', async () => {
    const { fn, sent } = fakeFetch()
    const code = await cmdFeedback(['it broke', '--dry-run'], { fetch: fn })
    expect(code).toBe(0)
    expect(sent).toEqual([])
    expect(out).toContain('POST https://vos.so/api/product-feedback')
    expect(out).toContain('"kind": "problem"')
    expect(out).toContain('"message": "it broke"')
    expect(out).toContain('"surface": "cli"')
    expect(out).toContain('Nothing was sent (--dry-run).')
  })

  it('--json carries the same facts in the done event', async () => {
    const { fn } = fakeFetch(201)
    await cmdFeedback(['it broke', '--json'], { fetch: fn })
    const body = { kind: 'problem', message: 'it broke', surface: 'cli' }
    const url = 'https://vos.so/api/product-feedback'
    expect(events()).toEqual([
      { event: 'sending', url, body },
      { event: 'done', sent: true, url, body, status: 201 },
    ])
    out = ''
    await cmdFeedback(['it broke', '--json', '--dry-run'], { fetch: fn })
    expect(events()).toEqual([
      { event: 'done', sent: false, url, body, status: null },
    ])
  })

  it('--kind idea is taken, the origin follows --origin, and words join', async () => {
    const { fn, sent } = fakeFetch()
    await cmdFeedback(
      [
        'a',
        'plan',
        'flag',
        '--kind',
        'idea',
        '--origin',
        'http://localhost:6060/',
      ],
      { fetch: fn },
    )
    expect(sent[0].url).toBe('http://localhost:6060/api/product-feedback')
    expect(JSON.parse(String(sent[0].init.body))).toEqual({
      kind: 'idea',
      message: 'a plan flag',
      surface: 'cli',
    })
  })

  it('refuses another kind, an empty message and one too long, sending nothing', async () => {
    const { fn, sent } = fakeFetch()
    await expect(
      cmdFeedback(['x', '--kind', 'praise'], { fetch: fn }),
    ).rejects.toThrowError(/--kind takes problem or idea, not "praise"/)
    await expect(cmdFeedback([], { fetch: fn })).rejects.toBeInstanceOf(
      UsageError,
    )
    await expect(cmdFeedback(['   '], { fetch: fn })).rejects.toBeInstanceOf(
      UsageError,
    )
    await expect(
      cmdFeedback(['x'.repeat(FEEDBACK_MAX + 1)], { fetch: fn }),
    ).rejects.toThrowError(/8001 characters and a report holds 8000/)
    expect(sent).toEqual([])
    // Exactly the cap is sent.
    await cmdFeedback(['x'.repeat(FEEDBACK_MAX)], { fetch: fn })
    expect(sent).toHaveLength(1)
  })

  it('a refusal prints the server’s error and exits 1', async () => {
    const refused = fakeFetch(429, { error: 'Too many reports. Try later.' })
    expect(await cmdFeedback(['it broke'], { fetch: refused.fn })).toBe(1)
    expect(err).toContain(
      'error: https://vos.so did not take the report (HTTP 429): Too many reports. Try later.',
    )
    expect(out).toBe('')

    const { fn } = fakeFetch(400, { error: 'Invalid input' })
    expect(await cmdFeedback(['it broke', '--json'], { fetch: fn })).toBe(1)
    expect(events().at(-1)).toMatchObject({
      event: 'done',
      sent: false,
      status: 400,
      error: 'Invalid input',
    })
  })

  it('a refusal with no JSON body still says the status', async () => {
    const { fn } = fakeFetch(502, '<html>bad gateway</html>')
    expect(await cmdFeedback(['it broke'], { fetch: fn })).toBe(1)
    expect(err).toContain('did not take the report (HTTP 502)\n')
  })

  it('an origin that never answers is an error naming it', async () => {
    const fn = (() =>
      Promise.reject(new TypeError('fetch failed'))) as typeof fetch
    await expect(
      cmdFeedback(['it broke', '--origin', 'http://127.0.0.1:9'], {
        fetch: fn,
      }),
    ).rejects.toThrowError(/could not reach http:\/\/127\.0\.0\.1:9/)
  })
})
