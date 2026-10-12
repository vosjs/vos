import { afterEach, describe, expect, it } from 'vitest'
import { STUDIO_SETUP } from '../lower/studioEntry'

/**
 * The entry's setup starts decoding a document's sounds but never holds the
 * first frame for them: playback starts on a press, so the decodes land
 * first, and one that lands later clears the scheduler's signature so the
 * next playing frame schedules it.
 */
type Ns = {
  audioBuffers?: Map<string, unknown>
  audioPending?: Set<string>
  audioSched?: { sig: string }
}

const g = globalThis as unknown as Record<string, unknown>

function setupFn() {
  return new Function(`"use strict"; return (${STUDIO_SETUP})`)() as (
    ctx: unknown,
  ) => Promise<void>
}

describe('the studio entry does not wait for sound', () => {
  const savedFetch = g.fetch
  afterEach(() => {
    delete g.window
    g.fetch = savedFetch
  })

  it('resolves while a sound is still downloading, then caches it and asks for a reschedule', async () => {
    let answer: (v: unknown) => void = () => {}
    g.fetch = () =>
      new Promise((resolve) => {
        answer = resolve
      })
    const ns: Ns = { audioSched: { sig: 'scheduled-before' } }
    g.window = {
      __vos__: ns,
      AudioContext: class {
        decodeAudioData(ab: unknown) {
          return Promise.resolve({ decoded: ab })
        }
      },
    }
    const done = await Promise.race([
      setupFn()({
        data: { audio: [{ key: 'https://example.com/score.mp3' }] },
      }).then(() => 'resolved'),
      new Promise((resolve) => setTimeout(() => resolve('blocked'), 200)),
    ])
    expect(done).toBe('resolved')
    expect(ns.audioPending?.has('https://example.com/score.mp3')).toBe(true)
    answer({ arrayBuffer: () => Promise.resolve('bytes') })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(ns.audioBuffers?.get('https://example.com/score.mp3')).toEqual({
      decoded: 'bytes',
    })
    expect(ns.audioSched?.sig).toBe('')
    expect(ns.audioPending?.has('https://example.com/score.mp3')).toBe(false)
  })
})
