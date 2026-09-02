/**
 * WebCodecs wiring guards: the WebCodecs frame provider is a render-page opt-in
 * (data.videoDecodeMode === 'webcodecs', injected by the render queue) whose
 * every seam must stay fail-open — a silently dropped gate would either hang
 * previews on the provider or quietly lose the fleet speedup. String-level
 * pins on the lowered program, the same style as the clip-tone guards; the
 * behavioral proof is scripts/verify-rf3-decode.ts (vos-plugin, real
 * browser, real take, pixel parity + speed A/B).
 */
import { describe, expect, it } from 'vitest'
import { lowerToComposition } from '../lower/lowerToComposition'
import {
  DEFAULT_CAM_STYLE,
  DEFAULT_CURSOR_STYLE,
  DEFAULT_FRAME_STYLE,
} from '../types'
import type { ProjectDoc } from '../types'

function makeDoc(): ProjectDoc {
  return {
    source: {
      videoKey: 'blob:v',
      cursor: [],
      meta: {
        dpr: 1,
        zoom: 1,
        t0: 0,
        durationMs: 20_000,
        width: 1600,
        height: 900,
        fps: 30,
      },
    },
    segments: [{ in: 0, out: 20 }],
    zoom: [],
    audio: [],
    cursor: DEFAULT_CURSOR_STYLE,
    cam: DEFAULT_CAM_STYLE,
    frame: DEFAULT_FRAME_STYLE,
    export: { resolution: '1080p', fps: 30, format: 'mp4' },
  }
}

const config = lowerToComposition(makeDoc()).config as unknown as {
  setup: string
  onFrame: string
}
const program = `${config.setup}\n${config.onFrame}`

describe('webcodecs provider wiring', () => {
  it('gates the provider on the render-page flag, never on by default', () => {
    expect(program).toContain("ctx.data.videoDecodeMode === 'webcodecs'")
    expect(program).toContain('makeWcProvider')
  })

  it('keeps every failure rung open (element path survives)', () => {
    // No VideoDecoder → null; undecodable track → null; any throw → warn.
    expect(program).toContain('if (!window.VideoDecoder) return null')
    expect(program).toContain('canDecode')
    expect(program).toContain(
      'webcodecs provider unavailable, seeks stay html5',
    )
    // Dimension mismatch refuses the provider rather than mis-cropping.
    expect(program).toContain('webcodecs dims mismatch')
  })

  it('drives the SEQUENTIAL samples walk — no timestamp feed, no CanvasSink', () => {
    // samplesAtTimestamps prefetches its timestamp iterable ahead of
    // yielding frames — a demand-driven feed deadlocks (found live). And
    // CanvasSink converts EVERY decoded source frame to a canvas — the
    // per-source-frame paint that lost 41% on the SwiftShader fleet
    // (4f1e99ab). The provider walks samples(), closes skipped samples
    // unconverted, and draws only the displayed frame.
    expect(program).toContain('sink.samples(')
    expect(program).not.toContain('.samplesAtTimestamps(')
    expect(program).not.toContain('new MB.CanvasSink(')
  })

  it('cold-seeks: iterator starts at the requested timestamp, re-seeks on jumps', () => {
    // Starting at 0 and grinding forward decoded the whole source prefix
    // before a mid-timeline chunk's first frame (639dd24c).
    expect(program).toContain('WC_JUMP')
    expect(program).toMatch(/iter = sink\.samples\(t\)/)
  })

  it('services capture seeks from the provider inside the paused branch', () => {
    expect(program).toContain('vid.__voilaWc')
    // Provider seeks register in pendingDecodes so the deterministic export
    // awaits them exactly like element seeks.
    expect(program).toMatch(/wdp = wcp\.seek\(wcT\)/)
  })

  it('draws the provider sample at the card draw site, element as fallback', () => {
    expect(program).toMatch(/wcp3 && wcp3\.draw\(c, crp, dx, dy, dw, dh\)/)
  })

  it('keeps the blob for the provider when blob-fetch runs', () => {
    expect(program).toContain('ns.videoBlobs')
  })
})
