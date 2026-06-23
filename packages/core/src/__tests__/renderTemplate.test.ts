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
