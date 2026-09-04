import { describe, expect, it } from 'vitest'
import {
  STEP_SETTLE_SECONDS,
  momentCandidates,
  pickMoments,
  resolveStepTime,
} from '../moments'
import type { ProjectDoc, StepSpan } from '@vosjs/studio-core'

function doc(steps: StepSpan[] | undefined, zoom: ProjectDoc['zoom'] = []): ProjectDoc {
  return {
    source: {
      videoKey: 'blob:recording',
      cursor: [],
      meta: {
        dpr: 1,
        zoom: 1,
        t0: 0,
        durationMs: 20000,
        width: 1280,
        height: 720,
        fps: 30,
        steps,
      },
    },
    segments: [{ in: 2, out: 18 }],
    zoom,
    audio: [],
    cursor: { visible: true, smoothing: 0.5, size: 1, clickFx: { style: 'ripple' } },
    cam: {},
    frame: {
      background: '#111',
      padding: 48,
      radius: 12,
      shadow: 0.4,
      border: 0,
      aspectRatio: 'native',
      browserBar: { kind: 'none', url: '', showUrl: true, showControls: true, height: 44 },
    },
    export: { resolution: '1080p', fps: 30, format: 'mp4' },
  }
}

const STEPS: StepSpan[] = [
  { step: 0, id: 'settle', do: 'wait', tStart: 0, tEnd: 0.9 },
  { step: 1, id: 'hover-a', do: 'hover', tStart: 0.9, tEnd: 2.6 },
  { step: 2, id: 'open', do: 'click', tStart: 2.6, tEnd: 4.1 },
  { step: 3, do: 'hover', tStart: 4.1, tEnd: 6.0, skipped: true },
  { step: 4, id: 'scroll', do: 'scroll', tStart: 6.0, tEnd: 7.2 },
  { step: 5, id: 'late', do: 'click', tStart: 18.5, tEnd: 19.2 },
]

describe('momentCandidates', () => {
  it('steps first, at gesture end plus the settle, mapped through the cut', () => {
    const { candidates } = momentCandidates(doc(STEPS), 16)
    const steps = candidates.filter((c) => c.source === 'step')
    expect(steps.map((c) => c.step)).toEqual(['hover-a', 'open', 'scroll'])
    // hover-a ends at 2.6 s source; the cut starts at 2 s → 0.6 + settle.
    expect(steps[0].time).toBeCloseTo(0.6 + STEP_SETTLE_SECONDS, 6)
  })

  it('waits and skipped steps are not moments; a step past the cut drops', () => {
    const { candidates } = momentCandidates(doc(STEPS), 16)
    expect(candidates.some((c) => c.step === 'settle')).toBe(false)
    expect(candidates.some((c) => c.step === 3)).toBe(false)
    expect(candidates.some((c) => c.step === 'late')).toBe(false)
  })

  it('zoom apexes follow the steps and the spread only fills an empty list', () => {
    const z = [{ id: 'z', in: 8, out: 12, level: 1.8, cx: 0.5, cy: 0.5 }]
    const withSteps = momentCandidates(doc(STEPS, z), 16).candidates
    expect(withSteps.map((c) => c.source)).toEqual(['step', 'step', 'step', 'zoom'])
    expect(withSteps[3].time).toBeCloseTo(8, 6) // (6 + 10) / 2 in output time
    const bare = momentCandidates(doc(undefined), 16).candidates
    expect(bare.map((c) => c.source)).toEqual(['spread', 'spread', 'spread', 'spread', 'spread'])
    expect(bare[0].time).toBeCloseTo(1.6, 6)
  })

  it('a trimmed apex is counted, not silently lost', () => {
    const z = [{ id: 'z', in: 0.2, out: 1.5, level: 1.8, cx: 0.5, cy: 0.5 }]
    expect(momentCandidates(doc(undefined, z), 16).dropped).toBe(1)
  })
})

describe('resolveStepTime', () => {
  it('reads step:<id>, step:<index> and an offset', () => {
    const d = doc(STEPS)
    expect(resolveStepTime(d, 'step:open')).toBeCloseTo(4.1 - 2 + STEP_SETTLE_SECONDS, 6)
    expect(resolveStepTime(d, 'step:2')).toBeCloseTo(4.1 - 2 + STEP_SETTLE_SECONDS, 6)
    expect(resolveStepTime(d, 'step:open+1.5')).toBeCloseTo(4.1 - 2 + 1.5, 6)
    expect(resolveStepTime(d, 'step:open-0.5')).toBeCloseTo(4.1 - 2 - 0.5, 6)
    expect(resolveStepTime(d, '3.5')).toBeNull()
  })

  it('an unknown or trimmed step is refused in words', () => {
    expect(() => resolveStepTime(doc(STEPS), 'step:nope')).toThrow(/no step "nope".*hover-a/)
    expect(() => resolveStepTime(doc(STEPS), 'step:late')).toThrow(/outside the cut/)
    expect(() => resolveStepTime(doc(undefined), 'step:open')).toThrow(/carries none/)
  })
})

describe('pickMoments', () => {
  it('drops blanks against the take\'s own median and collapses one frame at two times', () => {
    const pick = pickMoments([
      { time: 1, ink: 0.31, hash: 'aaaaaaaaaaaaaaaa' },
      { time: 2, ink: 0.04, hash: '1111111111111111' },
      { time: 3, ink: 0.3, hash: 'aaaaaaaaaaaaaaab' },
      { time: 4, ink: 0.28, hash: '5555555555555555' },
    ])
    expect(pick.times).toEqual([1, 4])
    expect(pick.dropped[0]).toMatch(/blank at 2.00s: 4% ink, the take's median is 30%/)
    expect(pick.dropped[1]).toMatch(/3.00s is the same frame as 1.00s/)
  })

  it('keeps the least empty candidate when every one is blank, and says so', () => {
    const pick = pickMoments([
      { time: 1, ink: 0.01, hash: 'aaaaaaaaaaaaaaaa' },
      { time: 2, ink: 0.03, hash: '1111111111111111' },
    ])
    expect(pick.times).toEqual([2])
    expect(pick.dropped.at(-1)).toMatch(/every candidate is under the blank floor; kept 2.00s/)
  })
})
