import { describe, expect, it } from 'vitest'
import { esmShModules } from '@vosjs/core/addons'
import { lowerToComposition } from '../lower/lowerToComposition'
import {
  DEFAULT_CAM_STYLE,
  DEFAULT_CURSOR_STYLE,
  DEFAULT_FRAME_STYLE,
} from '../types'
import type { ProjectDoc } from '../types'

/**
 * The lowered composition imports mediabunny on its own (the WebCodecs
 * frame provider on a capture page). It reads the URL from the page
 * (`window.__vos__.modules.mediabunny`, which the engine's render template
 * sets from the host's module source) and falls back to esm.sh at the
 * version the engine pins, so a composition captured on a page that says
 * nothing loads the same mediabunny the engine's own pages do.
 */
describe('the composition reads its mediabunny from the page', () => {
  it('names the page first and the engine pin as the fallback', () => {
    const doc: ProjectDoc = {
      source: {
        videoKey: 'opfs:recording-1',
        cursor: [],
        meta: {
          dpr: 1,
          zoom: 1,
          t0: 0,
          durationMs: 2000,
          width: 1280,
          height: 720,
          fps: 30,
        },
      },
      segments: [{ in: 0, out: 2 }],
      zoom: [],
      audio: [],
      cursor: DEFAULT_CURSOR_STYLE,
      cam: DEFAULT_CAM_STYLE,
      frame: DEFAULT_FRAME_STYLE,
      export: { resolution: '1080p', fps: 30, format: 'mp4' },
    }
    const { config } = lowerToComposition(doc)
    const code = JSON.stringify(config)
    expect(code).toContain('window.__vos__.modules.mediabunny')
    expect(code).toContain(esmShModules().mediabunny)
  })
})
