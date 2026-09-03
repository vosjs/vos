import { describe, expect, it } from 'vitest'
import {
  capReached,
  cappedLine,
  clampWait,
  defaultMaxDurationSeconds,
  hostedRecordingCap,
  parseHostedCap,
} from '../recordingCap'

describe('recording cap', () => {
  it('defaults --max-duration to the free plan cap', () => {
    expect(defaultMaxDurationSeconds()).toBe(1800)
  })

  it('stops exactly at the cap', () => {
    expect(capReached(9_999, 10)).toBe(false)
    expect(capReached(10_000, 10)).toBe(true)
  })

  it('never sleeps a wait step past the cap', () => {
    expect(clampWait(5_000, 0, 10)).toBe(5_000)
    expect(clampWait(5_000, 8_000, 10)).toBe(2_000)
    expect(clampWait(5_000, 12_000, 10)).toBe(0)
  })

  it('prints the cap in words with the flag that set it', () => {
    expect(cappedLine(1800)).toBe(
      'stopped at 30 min (--max-duration 1800); the remaining steps did not run',
    )
  })
})

// The live cap makes the built-in number a fallback, never the truth.
describe('hostedRecordingCap', () => {
  const ok = (cap: unknown) =>
    (async () => ({
      ok: true,
      json: async () => ({
        plan: 'free',
        limits: { recordingMaxSeconds: cap },
      }),
    })) as unknown as typeof fetch

  it('reads limits.recordingMaxSeconds from GET /api/limits', async () => {
    const calls: unknown[] = []
    const f = (async (...args: unknown[]) => {
      calls.push(args)
      return {
        ok: true,
        json: async () => ({ limits: { recordingMaxSeconds: 3600 } }),
      }
    }) as unknown as typeof fetch
    expect(await hostedRecordingCap('https://vos.test/', 'vos_k', f)).toBe(3600)
    expect(calls[0]?.[0 as never]).toBe('https://vos.test/api/limits')
    expect(
      (calls[0] as [string, { headers?: Record<string, string> }])[1].headers,
    ).toEqual({ authorization: 'Bearer vos_k' })
  })

  it('refuses a shape that is not a limits table', async () => {
    expect(await hostedRecordingCap('https://vos.test', null, ok(0))).toBeNull()
    expect(
      await hostedRecordingCap('https://vos.test', null, ok('1800')),
    ).toBeNull()
    expect(parseHostedCap({ limits: { recordingMaxSeconds: 1.5 } })).toBeNull()
  })

  it('is null on a refusal or when the origin is down, never a throw', async () => {
    const refused = (async () => ({
      ok: false,
      json: async () => ({}),
    })) as unknown as typeof fetch
    expect(
      await hostedRecordingCap('https://vos.test', null, refused),
    ).toBeNull()
    const down = (async () => {
      throw new Error('offline')
    }) as unknown as typeof fetch
    expect(await hostedRecordingCap('https://vos.test', null, down)).toBeNull()
  })
})
