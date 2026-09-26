import { afterEach, describe, expect, it, vi } from 'vitest'
import { hostedEnv, isWallError, recordHosted } from '../hostedRecord'
import type { ActionsFile } from '../actions'

const actions: ActionsFile = {
  url: 'https://example.com/',
  viewport: { width: 1280, height: 720 },
  setup: [
    { do: 'type', selector: '#email', text: { env: 'DEMO_EMAIL' } },
    { do: 'type', selector: '#pw', text: { env: 'DEMO_PASSWORD' } },
  ],
  steps: [{ do: 'wait', ms: 500 }],
} as unknown as ActionsFile

describe('hostedEnv', () => {
  it('takes every env name the setup reads from the shell, and names the missing', () => {
    const { env, missing } = hostedEnv(actions, {
      DEMO_EMAIL: 'robin@example.com',
      DEMO_PASSWORD: '',
      UNRELATED: 'x',
    })
    expect(env).toEqual({ DEMO_EMAIL: 'robin@example.com' })
    expect(missing).toEqual(['DEMO_PASSWORD'])
  })

  it('sends nothing for a script with no setup', () => {
    expect(hostedEnv({ ...actions, setup: undefined }, { A: 'b' })).toEqual({
      env: {},
      missing: [],
    })
  })
})

describe('isWallError', () => {
  it('tells the fleet refusal for a sign-in apart from every other failure', () => {
    expect(
      isWallError('The page is behind a sign-in (signin, landed on …)'),
    ).toBe(true)
    expect(
      isWallError(
        '[render] The page is behind a sign-in (status, landed on …)',
      ),
    ).toBe(true)
    expect(isWallError('The encoded recording is missing')).toBe(false)
    expect(isWallError(null)).toBe(false)
  })
})

describe('recordHosted', () => {
  afterEach(() => vi.unstubAllGlobals())

  function stubFetch(responses: Array<{ status: number; body: unknown }>) {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = []
    let i = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, init })
        const r = responses[Math.min(i++, responses.length - 1)]
        return new Response(JSON.stringify(r.body), { status: r.status })
      }),
    )
    return calls
  }

  it('posts the script with env and headers, polls, and reports the landed vos', async () => {
    const calls = stubFetch([
      {
        status: 202,
        body: {
          job: { id: 'job-1', vosId: 'vos-1' },
          vos: { studio: 'https://vos.so/studio?vos=vos-1' },
          cap: { seconds: 600 },
        },
      },
      {
        status: 200,
        body: { job: { id: 'job-1', status: 'rendering', vosId: 'vos-1' } },
      },
      {
        status: 200,
        body: {
          job: {
            id: 'job-1',
            status: 'completed',
            vosId: 'vos-1',
            versionId: 'v-1',
            error: null,
            telemetry: { durationMs: 4200 },
          },
        },
      },
    ])
    const log: string[] = []
    const out = await recordHosted({
      origin: 'https://vos.so',
      key: 'vos_k',
      url: 'https://example.com/',
      actions,
      headers: { 'x-vercel-protection-bypass': 'tok' },
      env: { DEMO_EMAIL: 'a', DEMO_PASSWORD: 'b' },
      log: (l) => log.push(l),
      sleep: async () => {},
    })
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.vosId).toBe('vos-1')
    expect(out.studio).toBe('https://vos.so/studio?vos=vos-1')
    expect(out.job.telemetry).toEqual({ durationMs: 4200 })

    expect(calls[0].url).toBe('https://vos.so/api/record/jobs')
    const sent = JSON.parse(String(calls[0].init?.body))
    expect(sent.env).toEqual({ DEMO_EMAIL: 'a', DEMO_PASSWORD: 'b' })
    expect(sent.headers).toEqual({ 'x-vercel-protection-bypass': 'tok' })
    expect(sent.viewport).toEqual({ width: 1280, height: 720 })
    expect(
      (calls[0].init?.headers as Record<string, string>).authorization,
    ).toBe('Bearer vos_k')
    expect(calls[1].url).toBe('https://vos.so/api/record/jobs/job-1')
    expect(log.some((l) => l.includes('rendering'))).toBe(true)
  })

  it('reports a wall refusal as a wall, with the fleet line', async () => {
    stubFetch([
      { status: 202, body: { job: { id: 'job-2', vosId: 'vos-2' } } },
      {
        status: 200,
        body: {
          job: {
            id: 'job-2',
            status: 'failed',
            vosId: 'vos-2',
            error:
              "The page is behind a sign-in (signin). A hosted recording cannot carry a person's session…",
          },
        },
      },
    ])
    const out = await recordHosted({
      origin: 'https://vos.so',
      key: 'vos_k',
      url: 'https://app.example.com/',
      actions,
      headers: {},
      env: {},
      log: () => {},
      sleep: async () => {},
    })
    expect(out.ok).toBe(false)
    if (out.ok) return
    expect(out.wall).toBe(true)
    expect(out.error).toMatch(/behind a sign-in/)
    expect(out.vosId).toBe('vos-2')
  })

  it('surfaces a refused POST in words, never as a job', async () => {
    stubFetch([
      {
        status: 400,
        body: {
          error: 'vos record cannot reach a private network (localhost)',
        },
      },
    ])
    const out = await recordHosted({
      origin: 'https://vos.so',
      key: 'vos_k',
      url: 'http://localhost:3000/',
      actions,
      headers: {},
      env: {},
      log: () => {},
      sleep: async () => {},
    })
    expect(out.ok).toBe(false)
    if (out.ok) return
    expect(out.wall).toBe(false)
    expect(out.error).toMatch(/400: vos record cannot reach a private network/)
    expect(out.jobId).toBeNull()
  })
})
