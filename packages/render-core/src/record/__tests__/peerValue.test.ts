import { describe, expect, it, vi } from 'vitest'
import { PEER_VALUE_MAX, StepSignals, peerValue, runPeer } from '../peers'
import type { RecorderPage } from '../driver'

/**
 * A peer's `expect` keeps what its check answered, the way the take's own
 * steps keep theirs: a check that reads the app's state (its value) says
 * what the peer saw at that moment, which no frame of the take can, since
 * the peer's page is never filmed.
 */
const answered = vi.hoisted(() => ({ value: undefined as unknown }))
vi.mock('../waits', async (actual) => {
  const real = await actual<typeof import('../waits')>()
  return {
    ...real,
    pollCondition: async () => ({
      ok: true,
      last:
        answered.value === undefined
          ? { holds: true }
          : { holds: true, value: answered.value },
    }),
  }
})

const run = async () => {
  const signals = new StepSignals([])
  signals.begin()
  const page = {} as unknown as RecorderPage
  let now = 0
  return runPeer(
    { id: 'bob', steps: [{ do: 'expect', text: 'Ada is here' }] },
    page,
    signals,
    {
      clock: {
        now: () => now,
        sleep: async (ms) => {
          now += ms
        },
      },
      footageMs: () => now,
      log: () => {},
    },
  )
}

describe('a peer expect keeps its value', () => {
  it('records what the check answered on the peer step', async () => {
    answered.value = { shapes: 3825, selected: 2075 }
    const r = await run()
    expect(r.steps).toHaveLength(1)
    expect(r.steps[0]).toMatchObject({
      do: 'expect',
      value: { shapes: 3825, selected: 2075 },
    })
    expect(r.steps[0].skipped).toBeUndefined()
  })

  it('keeps no value for a check that only holds', async () => {
    answered.value = undefined
    const r = await run()
    expect('value' in r.steps[0]).toBe(false)
  })

  it('cuts a value too long to keep, as a take step does', () => {
    const big = 'x'.repeat(PEER_VALUE_MAX * 2)
    const kept = peerValue({ holds: true, value: big } as never) as string
    expect(typeof kept).toBe('string')
    expect(kept.length).toBe(PEER_VALUE_MAX)
    expect(kept.endsWith('…')).toBe(true)
    expect(peerValue({ holds: true, value: 0 } as never)).toBe(0)
    expect(peerValue({ holds: false })).toBeUndefined()
  })
})
