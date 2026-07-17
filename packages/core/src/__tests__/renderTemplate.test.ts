import { describe, expect, it } from 'vitest'
import { generateRenderTemplate } from '../runtime/renderTemplate'

const sampleCode = `export const initVos = async (container, deps) => {
  const { THREE } = deps;
  return { timeline: null, cleanup: () => {} };
};`

describe('generateRenderTemplate', () => {
  describe('DRACO path injection', () => {
    it('injects __THREE_DRACO_PATH__ script with default version', () => {
      const html = generateRenderTemplate(sampleCode, { mode: 'playback' })
      expect(html).toContain('window.__THREE_DRACO_PATH__')
      expect(html).toContain('esm.sh/three@0.183.0')
      expect(html).toContain('libs/draco/')
    })

    it('uses custom Three.js version for DRACO path', () => {
      const html = generateRenderTemplate(sampleCode, {
        mode: 'playback',
        threeVersion: '0.170.0',
      })
      expect(html).toContain('esm.sh/three@0.170.0')
      expect(html).toContain('libs/draco/')
    })

    it('injects DRACO path in capture modes too', () => {
      const html = generateRenderTemplate(sampleCode, {
        mode: 'capture-thumbnail',
        capture: { width: 800, height: 600, duration: 5, fps: 30 },
      })
      expect(html).toContain('window.__THREE_DRACO_PATH__')
    })
  })

  describe('importmap', () => {
    it('includes three and gsap in importmap with esm.sh CDN', () => {
      const html = generateRenderTemplate(sampleCode, { mode: 'playback' })
      expect(html).toContain('"three"')
      expect(html).toContain('"three/addons/"')
      expect(html).toContain('"gsap"')
      expect(html).toContain('esm.sh/three@')
      expect(html).toContain('esm.sh/gsap@')
    })

    it('does not contain unpkg.com URLs', () => {
      const html = generateRenderTemplate(sampleCode, { mode: 'playback' })
      expect(html).not.toContain('unpkg.com')
    })

    it('includes mediabunny in capture-video mode', () => {
      const html = generateRenderTemplate(sampleCode, {
        mode: 'capture-video',
        capture: { width: 1920, height: 1080, duration: 5, fps: 30 },
      })
      expect(html).toContain('"mediabunny"')
    })

    it('does not include mediabunny in playback mode', () => {
      const html = generateRenderTemplate(sampleCode, { mode: 'playback' })
      expect(html).not.toContain('"mediabunny"')
    })

    it('includes additional importmap entries when provided', () => {
      const html = generateRenderTemplate(sampleCode, {
        mode: 'playback',
        additionalImportmapEntries: {
          '@sparkjsdev/spark':
            'https://esm.sh/@sparkjsdev/spark?external=three&target=es2022',
        },
      })
      expect(html).toContain('"@sparkjsdev/spark"')
      expect(html).toContain(
        'https://esm.sh/@sparkjsdev/spark?external=three&target=es2022',
      )
    })
  })

  describe('preload hints', () => {
    it('includes preconnect to esm.sh CDN', () => {
      const html = generateRenderTemplate(sampleCode, { mode: 'playback' })
      expect(html).toContain(
        '<link rel="preconnect" href="https://esm.sh" crossorigin="anonymous">',
      )
    })

    it('includes modulepreload for three and gsap', () => {
      const html = generateRenderTemplate(sampleCode, { mode: 'playback' })
      expect(html).toMatch(
        /<link rel="modulepreload" href="https:\/\/esm\.sh\/three@[^"]+">/,
      )
      expect(html).toMatch(
        /<link rel="modulepreload" href="https:\/\/esm\.sh\/gsap@[^"]+">/,
      )
    })

    it('includes custom preload module URLs', () => {
      const html = generateRenderTemplate(sampleCode, {
        mode: 'playback',
        preloadModuleUrls: [
          'https://esm.sh/@sparkjsdev/spark?external=three&target=es2022',
        ],
      })
      expect(html).toContain(
        '<link rel="modulepreload" href="https://esm.sh/@sparkjsdev/spark?external=three&target=es2022">',
      )
    })

    it('emits every modulepreload after the importmap script', () => {
      // A modulepreload before the importmap counts as module activity and
      // makes Chromium <133 reject the map — every bare import then fails
      // with "Failed to resolve module specifier".
      const html = generateRenderTemplate(sampleCode, {
        mode: 'playback',
        preloadModuleUrls: ['https://esm.sh/extra-module'],
      })
      const mapIndex = html.indexOf('<script type="importmap">')
      expect(mapIndex).toBeGreaterThan(-1)
      const firstPreload = html.indexOf('<link rel="modulepreload"')
      expect(firstPreload).toBeGreaterThan(mapIndex)
    })
  })

  describe('mode-specific output', () => {
    it('generates valid HTML document', () => {
      const html = generateRenderTemplate(sampleCode, { mode: 'playback' })
      expect(html).toContain('<!DOCTYPE html>')
      expect(html).toContain('<html lang="en">')
      expect(html).toContain('</html>')
    })

    it('uses viewport dimensions for playback mode', () => {
      const html = generateRenderTemplate(sampleCode, { mode: 'playback' })
      expect(html).toContain('100vw')
      expect(html).toContain('100vh')
    })

    it('uses fixed dimensions for capture modes', () => {
      const html = generateRenderTemplate(sampleCode, {
        mode: 'capture-thumbnail',
        capture: { width: 800, height: 600, duration: 5, fps: 30 },
      })
      expect(html).toContain('width: 800px')
      expect(html).toContain('height: 600px')
    })

    it('includes elements block placeholder when no bundle provided', () => {
      const html = generateRenderTemplate(sampleCode, { mode: 'playback' })
      expect(html).toContain('window.__vos__')
    })
  })

  describe('capture-video: range, encoder, upload, progress', () => {
    const capture = { width: 640, height: 360, duration: 5, fps: 30 }

    it('defaults to the full frame range with local == global timestamps', () => {
      const html = generateRenderTemplate(sampleCode, {
        mode: 'capture-video',
        capture,
      })
      expect(html).toContain('const startFrame = 0;')
      expect(html).toContain('const endFrame = 150;')
      // Segment-local capture timestamps (identical to global when start=0).
      expect(html).toContain('videoSource.add((frame - startFrame) / 30, 1 / 30)')
    })

    it('captures a sub-range as an independent segment', () => {
      const html = generateRenderTemplate(sampleCode, {
        mode: 'capture-video',
        capture: { ...capture, range: { startFrame: 30, endFrame: 60 } },
      })
      expect(html).toContain('const startFrame = 30;')
      expect(html).toContain('const endFrame = 60;')
      // Frames are still evaluated at global composition time.
      expect(html).toContain('const time = frame / 30;')
    })

    it.each([
      [{ startFrame: -1, endFrame: 10 }],
      [{ startFrame: 10, endFrame: 10 }],
      [{ startFrame: 20, endFrame: 10 }],
      [{ startFrame: 0, endFrame: 151 }],
      [{ startFrame: 0.5, endFrame: 10 }],
    ])('rejects invalid range %j', (range) => {
      expect(() =>
        generateRenderTemplate(sampleCode, {
          mode: 'capture-video',
          capture: { ...capture, range },
        }),
      ).toThrow(/capture\.range/)
    })

    it('uses format-default encoder settings when not pinned', () => {
      const webm = generateRenderTemplate(sampleCode, {
        mode: 'capture-video',
        capture,
      })
      expect(webm).toContain('codec: "vp9"')
      expect(webm).toContain('bitrate: QUALITY_HIGH')
      const mp4 = generateRenderTemplate(sampleCode, {
        mode: 'capture-video',
        capture: { ...capture, format: 'mp4' as const },
      })
      expect(mp4).toContain('codec: "avc"')
    })

    it('pins explicit encoder settings verbatim', () => {
      const html = generateRenderTemplate(sampleCode, {
        mode: 'capture-video',
        capture: {
          ...capture,
          encoder: { codec: 'vp8' as const, bitrate: 5_000_000 },
        },
      })
      expect(html).toContain('codec: "vp8"')
      expect(html).toContain('bitrate: 5000000')
      expect(html).not.toContain('bitrate: QUALITY_HIGH')
    })

    it('PUTs to uploadUrl when provided, embeds base64 otherwise', () => {
      const withUpload = generateRenderTemplate(sampleCode, {
        mode: 'capture-video',
        capture: { ...capture, uploadUrl: 'https://example.com/put-here' },
      })
      expect(withUpload).toContain('"https://example.com/put-here"')
      expect(withUpload).toContain("method: 'PUT'")
      expect(withUpload).toContain('uploaded: true')

      const without = generateRenderTemplate(sampleCode, {
        mode: 'capture-video',
        capture,
      })
      expect(without).toContain('const uploadUrl = null;')
      expect(without).toContain('base64Data')
    })

    it('reports structured progress and settles videos deterministically', () => {
      const html = generateRenderTemplate(sampleCode, {
        mode: 'capture-video',
        capture,
      })
      expect(html).toContain('window.__renderProgress')
      expect(html).toContain('waitForVideosReady')
      expect(html).toContain('window.__vos__.isPaused = true')
    })
  })

  describe('Three.js version customization', () => {
    it('uses custom three version in importmap', () => {
      const html = generateRenderTemplate(sampleCode, {
        mode: 'playback',
        threeVersion: '0.170.0',
      })
      expect(html).toContain('three@0.170.0')
    })

    it('uses custom gsap version in importmap', () => {
      const html = generateRenderTemplate(sampleCode, {
        mode: 'playback',
        gsapVersion: '3.13.0',
      })
      expect(html).toContain('gsap@3.13.0')
    })
  })
})

describe('capture-video: data injection and audio producer', () => {
  const capture = { width: 640, height: 360, duration: 5, fps: 30 }

  it('injects capture.data as deps.data (video and thumbnail modes)', () => {
    const video = generateRenderTemplate(sampleCode, {
      mode: 'capture-video',
      capture: { ...capture, data: { videoSrc: 'x.webm', micGain: 0.8 } },
    })
    expect(video).toContain('"videoSrc":"x.webm"')
    expect(video).toContain('if (__captureData != null) deps.data = __captureData;')

    const thumb = generateRenderTemplate(sampleCode, {
      mode: 'capture-thumbnail',
      capture: { ...capture, data: { videoSrc: 'x.webm' } },
    })
    expect(thumb).toContain('"videoSrc":"x.webm"')
    expect(thumb).toContain('deps.data = __captureData')
  })

  it('defaults to null data (compositions fall back to baked config data)', () => {
    const html = generateRenderTemplate(sampleCode, {
      mode: 'capture-video',
      capture,
    })
    expect(html).toContain('const __captureData = null;')
  })

  it('embeds the audio producer and muxes its buffer when provided', () => {
    const html = generateRenderTemplate(sampleCode, {
      mode: 'capture-video',
      capture: {
        ...capture,
        audioProducerCode:
          'window.__vosAudioProducer__ = async () => null // host mixer',
      },
    })
    expect(html).toContain('window.__vosAudioProducer__ = async () => null')
    expect(html).toContain('AudioBufferSource')
    expect(html).toContain('addAudioTrack')
  })

  it('prefers AAC for mp4 with an Opus fallback, Opus for webm', () => {
    const mp4 = generateRenderTemplate(sampleCode, {
      mode: 'capture-video',
      capture: {
        ...capture,
        format: 'mp4' as const,
        audioProducerCode: 'window.__vosAudioProducer__ = async () => null',
      },
    })
    expect(mp4).toContain('const preferred = "aac"')
    expect(mp4).toContain('canEncodeAudio')
    const webm = generateRenderTemplate(sampleCode, {
      mode: 'capture-video',
      capture: {
        ...capture,
        audioProducerCode: 'window.__vosAudioProducer__ = async () => null',
      },
    })
    expect(webm).toContain('const preferred = "opus"')
  })

  it('emits no audio plumbing without a producer', () => {
    const html = generateRenderTemplate(sampleCode, {
      mode: 'capture-video',
      capture,
    })
    expect(html).not.toContain('__vosAudioProducer__')
    expect(html).not.toContain('addAudioTrack')
  })
})
