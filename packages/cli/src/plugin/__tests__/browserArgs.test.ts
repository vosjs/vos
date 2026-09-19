import { describe, expect, it } from 'vitest'
import { parseArgs } from '../args'
import { MULTI_FLAGS, takeBrowserArgs } from '../run'

describe('--browser-arg', () => {
  // A flag bag holds one value per name, so the second switch used to
  // overwrite the first: the pair that grants a fake microphone reached
  // Chromium as its last half, and the take recorded a denied permission.
  it('keeps every switch it is given, in order', () => {
    const { multi } = parseArgs(
      [
        '--actions',
        'a.json',
        '--browser-arg=--use-fake-ui-for-media-stream',
        '--browser-arg=--use-fake-device-for-media-stream',
      ],
      new Set(['json']),
      MULTI_FLAGS,
    )
    expect(takeBrowserArgs(multi)).toEqual([
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
    ])
  })

  it('is empty when none is given', () => {
    const { multi } = parseArgs(['--actions', 'a.json'], new Set(), MULTI_FLAGS)
    expect(takeBrowserArgs(multi)).toEqual([])
  })
})
