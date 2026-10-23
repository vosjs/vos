import { describe, expect, it } from 'vitest'
import { captionOf } from '../stepCaptions'
import { scriptDrift, scriptDriftLine, scriptStepOf } from '../scriptStep'
import { zoomMarkOf } from '../beats'
import type { StepSpan } from '@vosjs/studio-core'
import type { ActionsFile } from '../actions'

// What was recorded: the script as it ran, by index.
const recorded: StepSpan[] = [
  { step: 0, id: 'arrow', do: 'drag', tStart: 1, tEnd: 2 },
  { step: 1, do: 'expect', tStart: 2, tEnd: 2.1 },
  { step: 2, id: 'labelOpen', do: 'press', tStart: 2.2, tEnd: 2.4 },
  { step: 3, do: 'type', selector: '[contenteditable]', tStart: 2.5, tEnd: 3 },
  { step: 4, do: 'press', tStart: 3.1, tEnd: 3.3 },
  { step: 5, id: 'follow', do: 'drag', tStart: 4, tEnd: 5 },
]

// The script as edited after recording: a check added at the top, an id
// and a mark on the unnamed typing, a caption on the arrow.
const edited: ActionsFile = {
  steps: [
    { do: 'expect', js: 'editor.getCurrentPageShapeIds().size', equals: 0 },
    { id: 'arrow', do: 'drag', caption: 'Arrows stay attached' },
    { do: 'expect', selector: '.tl-shape' },
    { id: 'labelOpen', do: 'press', keys: 'Enter' },
    {
      id: 'labelText',
      do: 'type',
      selector: '[contenteditable]',
      text: 'magic link',
      zoom: true,
    },
    { do: 'press', keys: 'Escape' },
    { id: 'follow', do: 'drag', zoom: true, caption: 'They follow' },
  ],
} as unknown as ActionsFile

describe('the script step a recorded step was made from', () => {
  it('finds an unnamed step by its named neighbours when a step was inserted before it', () => {
    expect(scriptStepOf(recorded[3], edited.steps, recorded)?.text).toBe(
      'magic link',
    )
    expect(scriptStepOf(recorded[1], edited.steps, recorded)?.selector).toBe(
      '.tl-shape',
    )
    expect(scriptStepOf(recorded[4], edited.steps, recorded)?.keys).toBe(
      'Escape',
    )
  })

  it('never hands an unnamed step a neighbour’s caption or mark', () => {
    // By index, recorded step 1 (an expect) would read the arrow's caption,
    // step 3 the press before it, step 4 the typing's mark.
    expect(captionOf(recorded[1], edited, undefined, recorded)).toBeNull()
    expect(zoomMarkOf(recorded[2], edited, undefined, recorded)).toBeUndefined()
    expect(zoomMarkOf(recorded[3], edited, undefined, recorded)).toBe(true)
    expect(zoomMarkOf(recorded[4], edited, undefined, recorded)).toBeUndefined()
    expect(captionOf(recorded[0], edited, undefined, recorded)).toBe(
      'Arrows stay attached',
    )
    expect(captionOf(recorded[5], edited, undefined, recorded)).toBe(
      'They follow',
    )
  })

  it('reads the step at its own index when the script was not edited', () => {
    const asRecorded = recorded.map((s) => ({ ...s }))
    expect(scriptStepOf(recorded[3], asRecorded, recorded)).toBe(asRecorded[3])
    expect(scriptStepOf(recorded[3], asRecorded)).toBe(asRecorded[3])
  })

  it('refuses a place whose verb disagrees, or which holds another recorded step', () => {
    // Nothing named to find it by, and its index now holds a press.
    const lone: StepSpan = { step: 1, do: 'type', tStart: 0, tEnd: 1 }
    expect(
      scriptStepOf(lone, [{ do: 'wait' }, { do: 'press', zoom: true }], [lone]),
    ).toBeUndefined()
    // Its index holds the recorded `follow`.
    const other: StepSpan = { step: 1, do: 'drag', tStart: 0, tEnd: 1 }
    const both = [
      other,
      { step: 2, id: 'follow', do: 'drag', tStart: 2, tEnd: 3 },
    ] as StepSpan[]
    expect(
      scriptStepOf(other, [{ do: 'wait' }, { id: 'follow', do: 'drag' }], both),
    ).toBeUndefined()
  })
})

describe('a script that no longer matches what was recorded', () => {
  it('is said with the counts and the steps that changed, never refused', () => {
    const d = scriptDrift(recorded, edited.steps)!
    expect(d).toMatchObject({ recorded: 6, inScript: 7, changed: [] })
    expect(scriptDriftLine(d)).toBe(
      'actions.json has 7 steps and the take recorded 6 (meta.steps): captions and zoom marks are matched to the recorded steps by id, then by place beside a named step, then by index (vos info shows where each lands; record again to bring them back in step)',
    )
    // The same count, a verb changed at a step matched by id.
    const same = (edited.steps as unknown as Record<string, unknown>[])
      .slice(1)
      .map((s) => (s.id === 'follow' ? { ...s, do: 'click' } : s))
    const changed = scriptDrift(recorded, same)!
    expect(changed.changed).toEqual([
      { step: 5, id: 'follow', was: 'drag', now: 'click' },
    ])
    expect(scriptDriftLine(changed)).toMatch(
      /^actions\.json no longer matches what was recorded; 1 recorded step changed \(#5 follow was drag, now click\): /,
    )
    // A script that still agrees says nothing.
    expect(
      scriptDrift(
        recorded,
        recorded.map((s) => ({
          do: s.do,
          ...(s.id ? { id: s.id } : {}),
          ...(s.selector ? { selector: s.selector } : {}),
        })),
      ),
    ).toBeNull()
  })
})
