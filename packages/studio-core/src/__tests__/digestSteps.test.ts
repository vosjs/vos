import { describe, expect, it } from 'vitest'
import { digestSteps } from '../digest/build'
import { projectFromArtifact } from '../ingest'
import type { ProjectDoc, RecordingMeta } from '../types'

/**
 * The digest tells the script's steps: when each ran in the footage and in
 * the cut, the page it left and the words its `read` kept, so an agent
 * places a layer by the table and quotes the take instead of a replay.
 */
function doc(): ProjectDoc {
  const meta = {
    dpr: 1,
    zoom: 1,
    t0: 0,
    durationMs: 12_000,
    width: 1280,
    height: 720,
    fps: 30,
    producer: 'cli',
    steps: [
      { step: 0, do: 'wait', tStart: 0, tEnd: 1, url: 'https://x.test/' },
      {
        step: 1,
        id: 'share',
        do: 'click',
        selector: '#share',
        tStart: 1,
        tEnd: 1.4,
        url: 'https://x.test/share',
        text: 'https://x.test/s/abc123',
        navigated: true,
      },
      {
        step: 2,
        id: 'gone',
        do: 'click',
        selector: '#gone',
        tStart: 9,
        tEnd: 9.2,
        skipped: true,
      },
    ],
  } as RecordingMeta
  const d = projectFromArtifact(
    { videoKey: 'recording.webm', cursor: [], meta },
    'recording.webm',
  ).doc
  d.segments = [{ in: 0, out: 6 }]
  d.speed = [{ id: 's', in: 2, out: 6, rate: 2 }]
  return d
}

describe('digestSteps', () => {
  it('lists every step with its windows through the cut, its page and its words', () => {
    const steps = digestSteps(doc())
    expect(steps.map((s) => s.id)).toEqual([null, 'share', 'gone'])
    expect(steps[1]).toMatchObject({
      do: 'click',
      selector: '#share',
      source: { in: 1, out: 1.4 },
      output: { in: 1, out: 1.4 },
      navigated: true,
      url: 'https://x.test/share',
      text: 'https://x.test/s/abc123',
      skipped: false,
    })
    // A step past the trim has no window in the cut, and says so.
    expect(steps[2].output).toBeNull()
    expect(steps[2].skipped).toBe(true)
    expect(steps[2].text).toBeNull()
  })

  it('is empty for a human recording, which has no script', () => {
    const d = doc()
    delete d.source.meta.steps
    expect(digestSteps(d)).toEqual([])
  })
})
