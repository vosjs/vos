/**
 * The device-flow loop against a real in-process HTTP server — no mocks on
 * the wire. The contract under test: the URL + code reach the reporter (the
 * agent relay), the key NEVER reaches any output path, denial/expiry throw
 * with the next step in words, and a 404 origin falls back cleanly.
 */
import { createServer } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { LoginUnsupportedError, browserLogin } from '../login'
import type { Server } from 'node:http'
import type { Reporter } from '../output'

interface Script {
  create?: { status: number; body: Record<string, unknown> }
  polls: { status: number; body: Record<string, unknown> }[]
}

let server: Server | undefined

function serve(script: Script): Promise<string> {
  let poll = 0
  server = createServer((req, res) => {
    const send = (status: number, body: Record<string, unknown>) => {
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(JSON.stringify(body))
    }
    if (req.url === '/api/cli/login' && req.method === 'POST') {
      const r = script.create ?? {
        status: 201,
        body: {
          code: 'ABCD-EFGH',
          secret: 'vos_dc_' + '1'.repeat(40),
          verifyUrl: 'http://x.test/cli/auth?code=ABCD-EFGH',
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          interval: 0,
        },
      }
      send(r.status, r.body)
      return
    }
    if (req.url === '/api/cli/login/poll' && req.method === 'POST') {
      const r = script.polls[Math.min(poll, script.polls.length - 1)]
      poll++
      send(r.status, r.body)
      return
    }
    send(404, { error: 'not found' })
  })
  return new Promise((resolve) => {
    server?.listen(0, '127.0.0.1', () => {
      const addr = server?.address()
      resolve(
        `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`,
      )
    })
  })
}

afterEach(() => {
  server?.close()
  server = undefined
})

function capture(): {
  r: Reporter
  logs: string[]
  events: Record<string, unknown>[]
} {
  const logs: string[] = []
  const events: Record<string, unknown>[] = []
  return {
    logs,
    events,
    r: {
      json: true,
      log: (m) => logs.push(m),
      event: (o) => events.push(o),
      done: (o) => events.push({ event: 'done', ...o }),
    },
  }
}

const opts = (over: Record<string, unknown> = {}) => ({
  openBrowser: false,
  sleep: () => Promise.resolve(),
  store: () => '/tmp/test-credentials',
  ...over,
})

describe('browserLogin', () => {
  it('relays URL + code, polls to ok, stores the key off every output path', async () => {
    let stored = ''
    const origin = await serve({
      polls: [
        { status: 200, body: { status: 'pending', interval: 0 } },
        {
          status: 200,
          body: {
            status: 'ok',
            key: 'vos_sk_' + 'a'.repeat(40),
            user: { name: 'Ada' },
          },
        },
      ],
    })
    const { r, logs, events } = capture()
    const result = await browserLogin(
      origin,
      r,
      opts({
        store: (key: string) => {
          stored = key
          return '/tmp/test-credentials'
        },
      }),
    )
    expect(result).toEqual({ path: '/tmp/test-credentials', user: 'Ada' })
    expect(stored).toBe('vos_sk_' + 'a'.repeat(40))
    const await_ = events.find((e) => e.event === 'login_await')
    expect(await_?.code).toBe('ABCD-EFGH')
    expect(await_?.url).toContain('/cli/auth?code=')
    // The credential never enters the reporter — agents echo this output.
    const everything = JSON.stringify([logs, events])
    expect(everything).not.toContain('vos_sk_')
    expect(everything).not.toContain('vos_dc_')
  })

  it('a denied approval throws with the denial stated plainly', async () => {
    const origin = await serve({
      polls: [
        {
          status: 403,
          body: { status: 'denied', error: 'The sign-in was denied' },
        },
      ],
    })
    const { r } = capture()
    await expect(browserLogin(origin, r, opts())).rejects.toThrow(/denied/)
  })

  it('an expired request throws the server sentence (run vos login again)', async () => {
    const origin = await serve({
      polls: [
        {
          status: 410,
          body: {
            status: 'expired',
            error: 'This login request expired — run `vos login` again',
          },
        },
      ],
    })
    const { r } = capture()
    await expect(browserLogin(origin, r, opts())).rejects.toThrow(/expired/)
  })

  it('key_limit keeps polling (a revoke resumes it) and says the fix once', async () => {
    const origin = await serve({
      polls: [
        {
          status: 429,
          body: {
            status: 'key_limit',
            error: 'Key limit reached (10 active)',
            hint: 'Revoke a key at https://vos.so/app/api, then keep this `vos login` running — it retries on its own.',
          },
        },
        {
          status: 429,
          body: {
            status: 'key_limit',
            error: 'Key limit reached (10 active)',
            hint: 'Revoke a key at https://vos.so/app/api, then keep this `vos login` running — it retries on its own.',
          },
        },
        {
          status: 200,
          body: { status: 'ok', key: 'vos_sk_x', user: { name: '' } },
        },
      ],
    })
    const { r, logs } = capture()
    const result = await browserLogin(origin, r, opts())
    expect(result.user).toBe('')
    expect(logs.filter((l) => l.includes('Key limit')).length).toBe(1)
  })

  it('a 404 origin (older server) raises LoginUnsupportedError for the paste fallback', async () => {
    const origin = await serve({
      create: { status: 404, body: { error: 'not found' } },
      polls: [],
    })
    const { r } = capture()
    await expect(browserLogin(origin, r, opts())).rejects.toBeInstanceOf(
      LoginUnsupportedError,
    )
  })

  it('gives up honestly when the request clock runs out', async () => {
    const origin = await serve({
      create: {
        status: 201,
        body: {
          code: 'ABCD-EFGH',
          secret: 'vos_dc_' + '1'.repeat(40),
          verifyUrl: 'http://x.test/cli/auth?code=ABCD-EFGH',
          expiresAt: new Date(Date.now() - 1000).toISOString(),
          interval: 0,
        },
      },
      polls: [],
    })
    const { r } = capture()
    await expect(browserLogin(origin, r, opts())).rejects.toThrow(
      /no approval|vos login/,
    )
  })
})
