import { describe, expect, it } from 'vitest'
import {
  PAGE_ERROR_LINE_CHARS,
  PageErrorLog,
  pageErrorLine,
} from '../pageErrors'
import { DOM_CHANGE_PROBE, domSettled, pollCondition } from '../waits'
import { readMediaSource } from '../outputs'
import { deadTime } from '../pace'
import type { RecorderPage } from '../driver'

/**
 * What the recorder reads off a page without touching it: its errors said
 * briefly, its DOM settling after a reload, a condition confirmed on two
 * reads, a media element's source, and which steps dead time is about.
 * Driven on a fake clock and a fake page, so no timing decides a result.
 */

/** A fake clock: `sleep` advances `now`, nothing waits for real. */
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

describe('page errors', () => {
  it('says each distinct error once, cut short, and counts the repeats', () => {
    const long = `Refused to load the script because it violates ${'x '.repeat(2000)}`
    const log = new PageErrorLog()
    const first = log.add(long)
    expect(first).toBe(`   [page error] ${pageErrorLine(long)}`)
    expect(pageErrorLine(long)).toHaveLength(PAGE_ERROR_LINE_CHARS)
    expect(pageErrorLine(long).endsWith('…')).toBe(true)
    expect(log.add(long)).toBeNull()
    expect(log.add(long)).toBeNull()
    expect(log.add('short\n  one')).toBe('   [page error] short one')
    expect(log.repeats()).toEqual([`   [page error ×3] ${pageErrorLine(long)}`])
    expect(log.entries()).toEqual([
      { text: long, count: 3 },
      { text: 'short\n  one', count: 1 },
    ])
  })

  it('prints every error whole when verbose', () => {
    const log = new PageErrorLog(true)
    const long = 'y'.repeat(500)
    expect(log.add(long)).toBe(`   [page error] ${long}`)
    expect(log.add(long)).toBe(`   [page error] ${long}`)
    expect(log.repeats()).toEqual([])
    expect(log.entries()).toEqual([{ text: long, count: 2 }])
  })
})

/** A page whose `.pending` visibility and DOM change count follow a script. */
function scriptedPage(opts: {
  pendingVisible: () => boolean
  changes: () => number
}): RecorderPage {
  return {
    evaluate: async <T>(fn: unknown) =>
      (fn === DOM_CHANGE_PROBE ? opts.changes() : null) as T,
    locator: () => ({
      first: () => ({
        isVisible: async () => opts.pendingVisible(),
      }),
    }),
  } as unknown as RecorderPage
}

describe('after a reload', () => {
  it('a gone condition must hold on two reads in a row', async () => {
    const clock = fakeClock()
    // The list is drawn 600 ms into each look: absent, then present.
    let looks = 0
    const page = scriptedPage({
      pendingVisible: () => looks++ % 2 === 1,
      changes: () => 0,
    })
    const res = await pollCondition(
      page,
      { gone: '.pending' },
      {
        timeoutMs: 3000,
        everyMs: 500,
        ...clock,
        confirm: { reads: 2, gapMs: 500 },
      },
    )
    // Every first read said gone, every second said not: never a hold.
    expect(res.ok).toBe(false)
    // One read alone would have ended the wait on the half-drawn page.
    looks = 0
    const once = await pollCondition(
      page,
      { gone: '.pending' },
      { timeoutMs: 3000, everyMs: 500, ...clock },
    )
    expect(once.ok).toBe(true)
  })

  it('the DOM settles once it has been quiet, capped on a page that never stops', async () => {
    const clock = fakeClock()
    // Changes until 1 s, then quiet.
    const settles = await domSettled(
      scriptedPage({
        pendingVisible: () => false,
        changes: () => Math.min(clock.now(), 1000),
      }),
      clock,
    )
    expect(settles.settled).toBe(true)
    expect(settles.ms).toBeGreaterThanOrEqual(1800)
    expect(settles.ms).toBeLessThan(2000)
    const never = await domSettled(
      scriptedPage({ pendingVisible: () => false, changes: () => clock.now() }),
      { ...clock, capMs: 3000 },
    )
    expect(never).toEqual({ settled: false, ms: 3000 })
  })
})

describe('a media element’s source', () => {
  it('reads currentSrc, else src, else the attribute', () => {
    const el = (o: { currentSrc?: string; src?: string; attr?: string }) => ({
      ...o,
      getAttribute: () => o.attr ?? null,
    })
    expect(readMediaSource(el({ currentSrc: 'a', src: 'b' }))).toBe('a')
    expect(readMediaSource(el({ src: 'b', attr: 'c' }))).toBe('b')
    expect(readMediaSource(el({ attr: 'c' }))).toBe('c')
    expect(readMediaSource(el({}))).toBe('')
  })
})

describe('dead time', () => {
  it('leaves an expect, an await and a download out: their wait is the page’s', () => {
    const steps = [
      { step: 0, do: 'expect', tStart: 0, tEnd: 5 },
      { step: 1, do: 'await', tStart: 5, tEnd: 9 },
      { step: 2, do: 'download', tStart: 9, tEnd: 12 },
      { step: 3, do: 'wait', tStart: 12, tEnd: 17 },
    ]
    const dead = deadTime(steps, [{ tMs: 0 }], [], 17000)
    expect(dead.steps.map((s) => s.do)).toEqual(['wait'])
  })
})
