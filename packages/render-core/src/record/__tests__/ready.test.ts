import { describe, expect, it } from 'vitest'
import { READY_SETTLE_CAP_MS, readyLine, untilReady } from '../ready'
import { validateActions } from '../actions'
import { DOM_CHANGE_PROBE } from '../waits'
import type { RecorderPage } from '../driver'

/**
 * When the first page counts as ready, on a fake clock and a fake page:
 * the DOM settle after `load` by default, network idle when asked for, and
 * which `waitUntil` each mode hands the navigation.
 */
function fakeClock() {
  let t = 0
  return {
    now: () => t,
    sleep: (ms: number) => {
      t += ms
      return Promise.resolve()
    },
  }
}

const pageCounting = (changes: () => number): RecorderPage =>
  ({
    evaluate: async <T>(fn: unknown) =>
      (fn === DOM_CHANGE_PROBE ? changes() : null) as T,
  }) as unknown as RecorderPage

describe('untilReady', () => {
  it('settle: waits for load, then for the DOM to be quiet', async () => {
    const clock = fakeClock()
    const asked: string[] = []
    const { ready } = await untilReady(
      pageCounting(() => Math.min(clock.now(), 1000)),
      'dom',
      async (o) => {
        asked.push(o.waitUntil)
        return null
      },
      clock,
    )
    expect(asked).toEqual(['load'])
    expect(ready.mode).toBe('dom')
    expect(ready.capped).toBe(false)
    expect(ready.ms).toBeGreaterThanOrEqual(1800)
    expect(ready.ms).toBeLessThan(2000)
    expect(readyLine(ready)).toMatch(/settled after 1\.\d s/)
  })

  it('settle: a page that never stops changing is capped, not waited out', async () => {
    const clock = fakeClock()
    const { ready } = await untilReady(
      pageCounting(() => clock.now()),
      'dom',
      async () => null,
      clock,
    )
    expect(ready.capped).toBe(true)
    expect(ready.ms).toBeGreaterThanOrEqual(READY_SETTLE_CAP_MS)
    expect(readyLine(ready)).toMatch(/still changing/)
  })

  it('settle: a load that times out still settles and goes on', async () => {
    const clock = fakeClock()
    const { ready, response } = await untilReady(
      pageCounting(() => 0),
      'dom',
      async () => {
        throw new Error('Timeout 45000ms exceeded')
      },
      clock,
    )
    expect(response).toBeNull()
    expect(ready.capped).toBe(false)
  })

  it('networkidle: asked for, and capped when it never comes', async () => {
    const clock = fakeClock()
    const asked: string[] = []
    const { ready } = await untilReady(
      pageCounting(() => 0),
      'networkidle',
      async (o) => {
        asked.push(o.waitUntil)
        throw new Error('Timeout 45000ms exceeded')
      },
      clock,
    )
    expect(asked).toEqual(['networkidle'])
    expect(ready).toMatchObject({ mode: 'networkidle', capped: true })
    expect(readyLine(ready)).toMatch(/networkidle timeout/)
  })
})

describe('actions.json ready', () => {
  const steps = [{ do: 'wait', ms: 10 }]
  it('takes settle or networkidle, and says what else is wrong', () => {
    expect(validateActions({ ready: 'dom', steps })).toEqual([])
    expect(validateActions({ ready: 'networkidle', steps })).toEqual([])
    expect(validateActions({ ready: 'load', steps })).toEqual([
      'ready must be "dom" or "networkidle"',
    ])
  })
})
