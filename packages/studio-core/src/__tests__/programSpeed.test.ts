import { mapTime, splitBySpeed } from '@vosjs/timeline'
import { describe, expect, it } from 'vitest'
import { anchorSourceDuration } from '../doc/studioDoc'
import { PROGRAM_RETIME, lowerProgramDoc } from '../lower/lowerStudioDoc'
import { ratedSegments } from '../lower/lowerToComposition'
import { docOutputDuration } from '../audioBeds'
import type { ProgramAnchorDoc } from '../doc/studioDoc'

// Speed spans on a program retime it on the engine. A program is
// one source span, its own length; its spans rate it the way a recording's
// rate the footage.

const program = (speed?: ProgramAnchorDoc['speed']): ProgramAnchorDoc => ({
  program: {
    config: {
      version: 2,
      duration: 10,
      createContent: '(ctx) => ({ objects: [], refs: {} })',
      createTimeline:
        "(ctx, content, duration) => { const tl = ctx.gsap.timeline(); tl.to({}, { duration, ease: 'none' }); return tl }",
      data: { hue: 200 },
    },
    tweenEdits: {},
  },
  audio: [],
  ...(speed ? { speed } : {}),
})

const span = { id: 's1', in: 4, out: 8, rate: 2 }

describe('speed on a program', () => {
  it('a bare program composes as before: no retime, its own length', () => {
    const { config, duration } = lowerProgramDoc(program())
    expect(duration).toBe(10)
    expect('retime' in config).toBe(false)
    expect(config.duration).toBe(10)
    expect((config.data as Record<string, unknown>).retime).toBeUndefined()
    expect(anchorSourceDuration(program())).toBe(10)
  })

  it('a 2× span over 4–8 s plays 8 s: the output length, retime and the data', () => {
    const doc = program([span])
    expect(docOutputDuration(doc)).toBe(8)
    const { config, duration } = lowerProgramDoc(doc)
    expect(duration).toBe(8)
    expect(config.duration).toBe(8) // the clock and the fleet's render length
    expect(config.retime).toBe(PROGRAM_RETIME)
    const data = config.data as Record<string, unknown>
    expect(data.hue).toBe(200) // the user's data untouched
    expect(data.programDuration).toBe(10)
    expect(data.retime).toEqual(splitBySpeed([{ in: 0, out: 10 }], [span]))
    expect(ratedSegments(doc)).toEqual(data.retime)
    // The wrapper hands the user's function the program's OWN length.
    expect(String(config.createTimeline)).toContain('ctx.data.programDuration')
  })

  it('the inlined retime agrees with mapTime over the rated segments', () => {
    const doc = program([span, { id: 's2', in: 9, out: 10, rate: 0.5 }])
    const rated = ratedSegments(doc)
    const retime = new Function(`return (${PROGRAM_RETIME})`)() as (
      t: number,
      data: Record<string, unknown>,
    ) => number
    const out = docOutputDuration(doc)
    for (let t = 0; t <= out + 0.5; t += 0.25) {
      const expected = mapTime(rated, Math.min(t, out))
      expect(retime(Math.min(t, out), { retime: rated })).toBeCloseTo(
        expected,
        9,
      )
    }
    // No rated segments: the identity.
    expect(retime(3.3, {})).toBe(3.3)
  })
})
