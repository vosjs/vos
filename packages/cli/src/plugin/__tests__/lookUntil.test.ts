import { describe, expect, it } from 'vitest'
import { untilProblem, walkedSteps } from '../look'
import type { ActionsFile } from '../actions'

const steps: ActionsFile['steps'] = [
  { do: 'click', selector: '#create', id: 'open-create' },
  { do: 'type', selector: '#name', text: 'CI deploy' },
  { do: 'click', selector: '#make', id: 'create' },
]

describe('vos look --actions … --until: what it refuses, in words', () => {
  it('takes a script and a step id that the script has', () => {
    expect(
      untilProblem({ actions: 'a.json', until: 'create', clicks: 0 }, steps),
    ).toBeNull()
    expect(untilProblem({ clicks: 2 })).toBeNull()
  })

  it('needs the script for --until, and --until for the script', () => {
    expect(untilProblem({ until: 'create', clicks: 0 })).toContain(
      'pass the script with --actions',
    )
    expect(untilProblem({ actions: 'a.json', clicks: 0 })).toContain(
      '--actions needs --until <step id>',
    )
  })

  it('walks by the script or by hand, never both', () => {
    expect(
      untilProblem({ actions: 'a.json', until: 'create', clicks: 1 }),
    ).toContain('Pass one')
  })

  it('names the ids a script has when the one asked for is not there', () => {
    expect(
      untilProblem({ actions: 'a.json', until: 'copy', clicks: 0 }, steps),
    ).toBe(
      '--until copy: no step in a.json has that id. Its ids: open-create, create',
    )
    expect(
      untilProblem({ actions: 'a.json', until: 'copy', clicks: 0 }, [
        { do: 'wait', ms: 500 },
      ]),
    ).toContain('Its steps have no ids')
  })
})

describe('the steps a walk ran, as the look reports them', () => {
  it('names each by its id, and says what a guard held back or the page did not answer', () => {
    expect(
      walkedSteps([
        {
          step: 0,
          id: 'open-create',
          do: 'click',
          selector: '#create',
          tStart: 0,
          tEnd: 1,
        },
        {
          step: 1,
          do: 'click',
          selector: '#missing',
          tStart: 1,
          tEnd: 9,
          skipped: true,
          reason: 'NOT FOUND',
        },
        {
          step: 2,
          id: 'generate',
          do: 'click',
          selector: '#generate',
          tStart: 9,
          tEnd: 10,
          guard: 'spend',
        },
      ]),
    ).toEqual([
      { do: 'click (open-create)', selector: '#create' },
      { do: 'click', selector: '#missing', note: 'SKIPPED: NOT FOUND' },
      {
        do: 'click (generate)',
        selector: '#generate',
        note: 'guarded (spend), hovered, not pressed',
      },
    ])
  })
})
