import { describe, expect, it } from 'vitest'
import { base64Bytes, jpegDims } from '../recorder'
import { planFreshTake } from '../plan'
import { capReached, cappedLine, clampWait } from '../cap'
import { setupEnvNames, validateSetup } from '../setup'
import { validateActions } from '../actions'
import type { RecordingArtifact } from '@vosjs/studio-core'

/**
 * The recorder's host-free pieces (AN4): the byte helpers that replaced
 * Node's Buffer so the fleet's isolate runs them, the fresh plan that a
 * take gets wherever it was recorded, and the cap a host hands in.
 */

/** A 2x3 JPEG's SOF0 marker, hand-assembled: SOI, then a baseline frame header. */
function tinyJpegHeader(w: number, h: number): Uint8Array {
  const sof = [
    0xff,
    0xc0,
    0x00,
    0x11,
    0x08,
    (h >> 8) & 0xff,
    h & 0xff,
    (w >> 8) & 0xff,
    w & 0xff,
    0x03,
    0x01,
    0x22,
    0x00,
    0x02,
    0x11,
    0x01,
    0x03,
    0x11,
    0x01,
  ]
  return new Uint8Array([0xff, 0xd8, ...sof, 0xff, 0xd9])
}

describe('the byte helpers stand without Buffer', () => {
  it('reads a JPEG frame’s real dimensions from its SOF marker', () => {
    expect(jpegDims(tinyJpegHeader(1280, 720))).toEqual({ w: 1280, h: 720 })
    expect(jpegDims(new Uint8Array([0, 1, 2]))).toBeNull()
  })

  it('decodes base64 to the same bytes', () => {
    const bytes = tinyJpegHeader(4, 2)
    const b64 = btoa(String.fromCharCode(...bytes))
    expect([...base64Bytes(b64)]).toEqual([...bytes])
  })
})

describe('the fresh plan is one composition', () => {
  it('builds a document with the planned camera from an artifact', () => {
    const artifact: RecordingArtifact = {
      videoKey: 'recording.webm',
      cursor: [
        { t: 0, x: 100, y: 100, type: 'move' },
        { t: 900, x: 400, y: 300, type: 'move' },
        { t: 1000, x: 400, y: 300, type: 'down', button: 0 },
        { t: 1080, x: 400, y: 300, type: 'up', button: 0 },
        { t: 3000, x: 400, y: 300, type: 'move' },
      ],
      meta: {
        dpr: 1,
        zoom: 1,
        t0: 0,
        durationMs: 4000,
        width: 1280,
        height: 720,
        fps: 30,
        hasAudio: false,
        captureWidth: 1280,
        captureHeight: 720,
        captureSurface: 'tab',
        producer: 'cli',
      },
    }
    const doc = planFreshTake(artifact, 'recording.webm')
    expect(doc.source.videoKey).toBe('recording.webm')
    expect(doc.zoom.length).toBeGreaterThan(0)
    expect(doc.zoom.every((z) => z.source === 'auto')).toBe(true)
    expect(Array.isArray(doc.speed)).toBe(true)
    // Deterministic: the same artifact plans the same camera.
    expect(planFreshTake(artifact, 'recording.webm')).toEqual(doc)
  })
})

describe('the cap a host hands in', () => {
  it('stops at the cap, clamps a wait to it, and says so in words', () => {
    expect(capReached(9_999, 10)).toBe(false)
    expect(capReached(10_000, 10)).toBe(true)
    expect(clampWait(5_000, 8_000, 10)).toBe(2_000)
    expect(cappedLine(120)).toContain('2 min')
  })
})

describe('validation is the same words on both hosts', () => {
  it('names a setup that reads its env, and refuses a literal secret', () => {
    const steps = [
      { do: 'type', selector: '#password', text: { env: 'DEMO_PW' } },
      { do: 'type', selector: '#user', text: 'robin' },
    ]
    expect(validateSetup(steps)).toEqual([])
    expect(setupEnvNames(steps as never)).toEqual(['DEMO_PW'])
    expect(
      validateSetup([
        { do: 'type', selector: '#password', text: 'hunter2' },
      ])[0],
    ).toContain('committed and pushed')
    expect(validateActions({ steps: [{ do: 'wait', ms: 100 }] })).toEqual([])
  })
})
