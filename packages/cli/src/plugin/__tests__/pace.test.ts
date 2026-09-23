import { describe, expect, it } from 'vitest'
import {
  POINTER_MAX_MS,
  POINTER_MIN_MS,
  SETTLE_MS,
  askedMs,
  clockMotion,
  deadLine,
  deadTime,
  deadWarns,
  holdLeftMs,
  settleVerdict,
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
    expect(askedMs({ do: 'click' })).toBe(150) // the read after the settle, the author's
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

describe('deadTime', () => {
  // Steps in seconds, frames and events in ms, as the recorder keeps them.
  const frames = (...t: number[]) => t.map((tMs) => ({ tMs }))
  it('a hold past the reading beat under a parked cursor is dead; the read beat is not', () => {
    // A press at 1.5 s that navigates: the page changes until 1.8 s, then
    // the settled frame is held until 3.5 s. A page beat is 1.0 s, so
    // 0.7 s of that hold is dead.
    const steps = [
      {
        step: 1,
        id: 'projects',
        do: 'click',
        tStart: 1.2,
        tEnd: 3.5,
        navigated: true,
      },
    ]
    const r = deadTime(
      steps,
      frames(0, 1550, 1700, 1800),
      [
        { t: 1300, type: 'move' },
        { t: 1500, type: 'down' },
        { t: 1580, type: 'up' },
      ],
      12000,
    )
    expect(r.steps).toEqual([
      {
        step: 1,
        id: 'projects',
        do: 'click',
        settledMs: 300,
        heldMs: 1700,
        deadMs: 700,
      },
    ])
    expect(r.ms).toBe(700)
    expect(r.pct).toBe(6)
    // the same press held only a beat: nothing dead
    expect(
      deadTime(
        [{ ...steps[0], tEnd: 2.8 }],
        frames(0, 1550, 1800),
        [{ t: 1500, type: 'down' }],
        12000,
      ).ms,
    ).toBe(0)
  })

  it('a control changes less than a page, so its beat is shorter', () => {
    const step = { step: 2, do: 'click', tStart: 4, tEnd: 5.2 }
    const r = deadTime([step], frames(4100), [{ t: 4050, type: 'down' }], 10000)
    // held 1.1 s after a 50 ms settle; a control beat is 0.6 s
    expect(r.steps[0].deadMs).toBe(500)
    expect(
      deadTime(
        [{ ...step, navigated: true }],
        frames(4100),
        [{ t: 4050, type: 'down' }],
        10000,
      ).ms,
    ).toBe(100)
  })

  it('a pointer that moves, or a frame that keeps changing, is never dead', () => {
    const moving = deadTime(
      [{ step: 3, do: 'hover', tStart: 6, tEnd: 8 }],
      frames(6100),
      [{ t: 7500, type: 'move' }],
      10000,
    )
    expect(moving.ms).toBe(0)
    const playing = deadTime(
      [{ step: 3, do: 'wait', tStart: 6, tEnd: 8 }],
      frames(6100, 6600, 7100, 7600, 7950),
      [],
      10000,
    )
    expect(playing.ms).toBe(0)
  })

  it('the opening wait shows a new page, so it gets the page beat', () => {
    const r = deadTime(
      [{ step: 0, id: 'home', do: 'wait', tStart: 0, tEnd: 1.2 }],
      frames(0, 10),
      [],
      12000,
    )
    expect(r.steps[0].deadMs).toBe(190)
  })

  it('warns on the share or on one long hold, and says it in words', () => {
    const long = deadTime(
      [{ step: 1, do: 'click', tStart: 1, tEnd: 4, navigated: true }],
      frames(1100),
      [{ t: 1050, type: 'down' }],
      30000,
    )
    expect(long.longestMs).toBe(1900)
    expect(long.pct).toBe(6)
    expect(deadWarns(long)).toBe(true)
    expect(deadLine(long)).toBe(
      "dead time: 1.9 s (6 %), a still frame under a parked cursor past the reading beat: #1 click held 2.9 s after it settled, 1.9 s past the beat. Cut those steps' ms; a hold is what it takes to read what changed.",
    )
    expect(deadLine({ ms: 0, pct: 0, steps: [], longestMs: 0 })).toBe(
      'dead time: none',
    )
  })
})

describe('settleVerdict and holdLeftMs', () => {
  it('waits for a response, then for quiet, and never past the cap', () => {
    // just pressed, nothing yet: wait for the page to answer
    expect(settleVerdict({ sincePress: 100, sinceChange: null })).toBe('wait')
    // no change within the response window: the page did not change
    expect(settleVerdict({ sincePress: 400, sinceChange: null })).toBe(
      'settled',
    )
    // changing: not yet quiet
    expect(settleVerdict({ sincePress: 600, sinceChange: 100 })).toBe('wait')
    // quiet for 250 ms: settled
    expect(settleVerdict({ sincePress: 700, sinceChange: 250 })).toBe('settled')
    // a page that keeps changing settles at the cap
    expect(settleVerdict({ sincePress: 1199, sinceChange: 20 })).toBe('wait')
    expect(settleVerdict({ sincePress: 1200, sinceChange: 20 })).toBe('settled')
  })

  it('the hold runs from the last change, so the quiet already spent counts', () => {
    expect(holdLeftMs(1000, 250)).toBe(750)
    expect(holdLeftMs(200, 250)).toBe(0)
    expect(holdLeftMs(1000, null)).toBe(1000)
  })

  it("a click's ms is the author's read, in the pace report", () => {
    expect(askedMs({ do: 'click', ms: 1000 })).toBe(1000)
    expect(askedMs({ do: 'click' })).toBe(150)
  })
})
