import { describe, expect, it } from 'vitest'
import { buildAudioMixPage } from '../audioMixPage'

describe('buildAudioMixPage', () => {
  const page = buildAudioMixPage({
    data: { hasAudio: true, videoSrc: 'https://x/rec.mp4' },
    duration: 60,
    uploadUrl: 'https://x/api/render/ingest/j1?token=t&part=audio',
  })

  it('installs the stream-splice seam BEFORE the producer consumes it', () => {
    const seamAt = page.indexOf('window.__vosStreamSplice__ =')
    const producerAt = page.indexOf('window.__vosAudioProducer__ =')
    expect(seamAt).toBeGreaterThan(-1)
    expect(producerAt).toBeGreaterThan(seamAt)
  })

  it('encodes Opus (the fleet has no AAC encoder) and uploads the part', () => {
    expect(page).toContain("codec: 'opus'")
    expect(page).toContain('audio/webm')
    expect(page).toContain('part=audio')
  })

  it('carries the finalize-page stage contract with heap stamps', () => {
    // Worker polling reads __finalizeStage; renderPolicy.finalizeDeathStage
    // parses the first space-delimited token, so the heap sample must ride
    // AFTER the stage name.
    expect(page).toContain('__finalizeStage')
    expect(page).toContain("s + ' heap='")
    expect(page).toContain('__renderComplete')
  })

  it('bounds the splice at the requested duration (the duration trim + the memory cap)', () => {
    expect(page).toContain('maxSeconds')
    expect(page).toContain('"duration":60')
  })

  it('lands a duration-true silent track when nothing decodes, never "no buffer"', () => {
    // A null mix used to report failure, routing finalize onto the browser
    // concat fallback — whose in-page producer faces the same decode
    // failures and whose page-memory concat is the deterministic OOM death
    // (job cdf6e026, concat-part-10). Silence keeps the worker mux path.
    expect(page).toContain('landing a silent track')
    expect(page).not.toContain('audio mix produced no buffer')
  })
})
