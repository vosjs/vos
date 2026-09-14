import { describe, expect, it } from 'vitest'
import {
  POINTER_MAX_MS,
  POINTER_MIN_MS,
  SETTLE_MS,
  askedMs,
  clockMotion,
  clockTyping,
  paceLine,
  paceReport,
  pointerTravelMs,
  settleMs,
} from '../pace'

/**
 * The recorder's pace: gestures driven by the clock so a slow page never
 * stretches them, settles that are data, and a report that separates what
 * the script asked, what the gestures added and what the page cost.
 */
function fakeClock() {
  let t = 0
  const clock = {
    now: () => t,
    sleep: async (ms: number) => {
      t += ms
    },
    /** what a page round trip costs: advance the clock inside `at` */
    spend: (ms: number) => {
      t += ms
    },
  }
  return clock
}

describe('pointerTravelMs and settleMs', () => {
  it('travels at a hand pace between a floor and a ceiling', () => {
    expect(pointerTravelMs(0)).toBe(POINTER_MIN_MS)
    expect(pointerTravelMs(500)).toBe(350)
    expect(pointerTravelMs(5000)).toBe(POINTER_MAX_MS)
  })
  it("a settle is the step's ms, else the verb's default, else nothing", () => {
    expect(settleMs({ do: 'click' })).toBe(SETTLE_MS.click)
    expect(settleMs({ do: 'click', ms: 600 })).toBe(600)
    expect(settleMs({ do: 'click', ms: 0 })).toBe(0)
    expect(settleMs({ do: 'wait' })).toBe(0)
  })
})

describe('clockMotion', () => {
  it('ends when the asked duration has elapsed, with the last sample at 1, whatever the round trip costs', async () => {
    const fast = fakeClock()
    const seenFast: number[] = []
    await clockMotion(
      320,
      async (u) => {
        seenFast.push(u)
        fast.spend(2)
      },
      fast,
    )
    expect(fast.now()).toBeGreaterThanOrEqual(320)
    expect(fast.now()).toBeLessThan(330)
    expect(seenFast[seenFast.length - 1]).toBe(1)
    expect(seenFast.length).toBeGreaterThan(15)

    const slow = fakeClock()
    const seenSlow: number[] = []
    const samples = await clockMotion(
      320,
      async (u) => {
        seenSlow.push(u)
        slow.spend(75) // a slider re-rendering per move
      },
      slow,
    )
    // the gesture keeps its length (to within one round trip) and loses samples
    expect(slow.now()).toBeLessThan(320 + 80)
    expect(samples).toBeLessThan(8)
    expect(seenSlow[seenSlow.length - 1]).toBe(1)
    // progress is monotonic and eased
    for (let i = 1; i < seenSlow.length; i++)
      expect(seenSlow[i]).toBeGreaterThanOrEqual(seenSlow[i - 1])
  })
})

describe('clockTyping', () => {
  it('lands each character on its due time when the field is fast, and as fast as it can when it is slow', async () => {
    const fast = fakeClock()
    const at: number[] = []
    await clockTyping(
      ['a', 'b', 'c', 'd'],
      90,
      async () => {
        at.push(fast.now())
        fast.spend(10)
      },
      fast,
    )
    expect(at).toEqual([0, 90, 180, 270])
    const slow = fakeClock()
    const atSlow: number[] = []
    await clockTyping(
      ['a', 'b', 'c'],
      90,
      async () => {
        atSlow.push(slow.now())
        slow.spend(400)
      },
      slow,
    )
    expect(atSlow).toEqual([0, 400, 800])
  })
})

describe('askedMs and paceReport', () => {
  it('reads the ask per verb and separates ask, gesture and overhead', () => {
    expect(askedMs({ do: 'wait', ms: 900 })).toBe(900)
    expect(askedMs({ do: 'hover' })).toBe(700)
    expect(askedMs({ do: 'type', text: 'abcd', delayMs: 90 })).toBe(360)
    expect(askedMs({ do: 'click' })).toBe(0)
    const r = paceReport([
      { step: 0, do: 'wait', askedMs: 900, gestureMs: 0, wallMs: 902 },
      { step: 1, do: 'hover', askedMs: 700, gestureMs: 350, wallMs: 1060 },
      { step: 2, do: 'drag', askedMs: 1300, gestureMs: 400, wallMs: 6286 },
    ])
    expect(r.askedMs).toBe(2900)
    expect(r.gestureMs).toBe(750)
    expect(r.wallMs).toBe(8248)
    expect(r.overheadMs).toBe(8248 - 2900 - 750)
    expect(r.slow.map((s) => s.step)).toEqual([2])
    expect(paceLine(r)).toContain('the script asked 2.9 s')
    expect(paceLine(r)).toContain('#2 drag 6.3 s for 1.3 s asked')
  })
})
