import { describe, expect, it } from 'vitest'
import { normalizeRuns, resolveRunColors } from '@vosjs/elements/text'
import type { TextRun as CoreTextRun } from '@vosjs/core'
import type { TextRun as EngineTextRun } from '@vosjs/elements/text'
import type { TextOverlayClip } from '../types'

/**
 * One run, three homes. `@vosjs/core` declares the run a text element's
 * config takes; `@vosjs/elements/text` declares the run its operations and
 * its layout work on; a text layer's `text` here is the second. The two
 * packages do not depend on each other, so each declares the shape, and
 * this file is where a change to one that the other did not get fails to
 * compile.
 */
type Same<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : never

const coreIsEngine: Same<CoreTextRun, EngineTextRun> = true
const layerIsEngine: Same<
  Extract<TextOverlayClip['text'], unknown[]>[number],
  EngineTextRun
> = true

describe('the run, wherever it is written', () => {
  it('is one shape in the config contract, the engine and a text layer', () => {
    expect(coreIsEngine && layerIsEngine).toBe(true)
  })

  it('carries a colour bound to data in every home, to be read where it is drawn', () => {
    const bound: CoreTextRun[] = [
      { text: 'Ship ' },
      { text: 'faster', color: { $data: 'accent' } },
    ]
    // The operations keep the binding; a painter with no data to read
    // (a layer's) paints the words in the layer's own colour.
    expect(normalizeRuns(bound)).toEqual(bound)
    expect(resolveRunColors(bound, { accent: '#e37358' })).toEqual([
      { text: 'Ship ' },
      { text: 'faster', color: '#e37358' },
    ])
    expect(resolveRunColors(bound, undefined)).toBe('Ship faster')
  })

  it('moves between an element and a layer as it is', () => {
    const fromElement: CoreTextRun[] = [
      { text: 'Ship ' },
      { text: 'faster', weight: 700, underline: true },
    ]
    const layer: Pick<TextOverlayClip, 'text'> = { text: fromElement }
    expect(normalizeRuns(layer.text)).toEqual(fromElement)
  })
})
