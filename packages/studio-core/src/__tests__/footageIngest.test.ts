import { describe, expect, it } from 'vitest'
import { withBackdrop } from '../backdrop'
import { projectFromArtifact } from '../ingest'
import { BASE_FRAME_STYLE, FOOTAGE_FRAME_STYLE } from '../types'
import type { RecordingArtifact } from '../types'

// Finished footage (a render from another tool, a film) is already the
// picture: it opens with nothing around it, no drawn cursor or webcam, at
// its own frame rate. A screen recording keeps the card it always had.

function artifact(fps: number): RecordingArtifact {
  return {
    videoBlob: new Blob(),
    cursor: [],
    meta: {
      dpr: 1,
      zoom: 1,
      t0: 0,
      durationMs: 15000,
      width: 1920,
      height: 1080,
      fps,
      producer: 'ingest',
    },
  } as unknown as RecordingArtifact
}

describe('ingesting finished footage', () => {
  it('opens bare, whatever frame the host hands it', () => {
    const { doc } = projectFromArtifact(artifact(30), 'reel.mp4', {
      frame: withBackdrop(BASE_FRAME_STYLE, {
        key: 'https://example.test/loop.webm',
        poster: 'https://example.test/loop.webp',
        duration: 8,
        ground: '#222',
      }),
      footage: true,
    })
    expect(doc.frame.padding).toBe(0)
    expect(doc.frame.radius).toBe(0)
    expect(doc.frame.shadow).toBe(0)
    expect(doc.frame.border).toBe(0)
    expect(doc.frame.browserBar.kind).toBe('none')
    expect(doc.frame.backgroundMedia).toBeUndefined()
    expect(doc.frame.camera).toBeUndefined()
    expect(doc.cursor.visible).toBe(false)
    expect(doc.cam.visible).toBe(false)
    expect(doc.export?.fps).toBe(30)
    expect(doc.frame).toEqual(FOOTAGE_FRAME_STYLE)
  })

  it('exports at the footage rate: 60 only when the footage is faster than 30', () => {
    const fast = projectFromArtifact(artifact(60), 'r.mp4', { footage: true })
    expect(fast.doc.export?.fps).toBe(60)
  })

  it('leaves a screen recording as it was', () => {
    const { doc } = projectFromArtifact(artifact(30), 'take.webm')
    expect(doc.frame.padding).toBe(BASE_FRAME_STYLE.padding)
    expect(doc.cursor.visible).toBe(true)
    expect(doc.export?.fps).toBe(60)
  })
})
