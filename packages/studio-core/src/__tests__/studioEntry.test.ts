import { describe, expect, it } from 'vitest'
import { lowerToComposition } from '../lower/lowerToComposition'
import { STUDIO_ENTRY_ID, studioEntry } from '../lower/studioEntry'
import {
  DEFAULT_CAM_STYLE,
  DEFAULT_CURSOR_STYLE,
  DEFAULT_FRAME_STYLE,
} from '../types'
import type { ObjectClip, ProjectDoc, TextOverlayClip } from '../types'

// The shared layers (overlay clips, props) are ONE engine stack entry on
// the composed config, with its own data. The anchor's program carries none
// of their keys, the entry's code is constant across every layer edit, and
// the entry mounts where any anchor can host it.

const base: ProjectDoc = {
  source: {
    videoKey: 'blob:v',
    cursor: [],
    meta: {
      dpr: 1,
      zoom: 1,
      t0: 0,
      fps: 30,
      width: 1920,
      height: 1080,
      durationMs: 3000,
    },
  },
  segments: [],
  zoom: [],
  audio: [],
  cursor: DEFAULT_CURSOR_STYLE,
  cam: DEFAULT_CAM_STYLE,
  frame: DEFAULT_FRAME_STYLE,
  export: { resolution: '1080p', fps: 30, format: 'mp4' },
}

const text: TextOverlayClip = {
  id: 'o1',
  kind: 'text',
  text: 'Hello',
  start: 1,
  duration: 2,
  transform: { x: 0.5, y: 0.5, scale: 1, rotation: 0 },
  preset: 'title',
}

const prop: ObjectClip = {
  id: 'p1',
  asset: { kind: 'primitive', shape: 'cube' },
  transform3d: { x: 0.5, y: 0.5, z: 0, rx: 0, ry: 0, rz: 0, scale: 0.2 },
}

describe('the studio stack entry', () => {
  it('is the one entry on the composed config, and holds the layer data', () => {
    const { config, data, stack } = lowerToComposition({
      ...base,
      overlays: [text],
      objects: [prop],
    })
    const entries = config.stack as { id: string; data: unknown }[]
    expect(entries).toHaveLength(1)
    expect(entries[0].id).toBe(STUDIO_ENTRY_ID)
    expect(entries[0].data).toBe(stack[STUDIO_ENTRY_ID])
    // The layers ride the entry, never the anchor's program.
    for (const key of ['overlays', 'objects', 'overlayFonts', 'lights']) {
      expect(key in data).toBe(false)
    }
    const entryData = stack[STUDIO_ENTRY_ID]
    expect(entryData.lights).toBe(true)
    expect(Array.isArray(entryData.overlays)).toBe(true)
    expect(Array.isArray(entryData.objects)).toBe(true)
    // Absent layers stay absent (data byte parity).
    const bare = lowerToComposition(base).stack[STUDIO_ENTRY_ID]
    expect(bare).toEqual({ lights: true, audio: [] })
  })

  it('its code is constant across every layer edit', () => {
    const a = lowerToComposition(base)
    const b = lowerToComposition({ ...base, overlays: [text], objects: [prop] })
    for (const key of ['setup', 'createContent', 'onFrame'] as const) {
      const ea = (a.config.stack as Record<string, string>[])[0][key]
      const eb = (b.config.stack as Record<string, string>[])[0][key]
      expect(ea).toBe(eb)
      expect(ea.length).toBeGreaterThan(100)
    }
  })

  it('mounts on any anchor: the overlay scene, its own timeline runtime, lights only when asked', () => {
    const e = studioEntry({})
    expect(e.id).toBe(STUDIO_ENTRY_ID)
    expect(e.createContent).toContain(
      '(ctx.overlayScene || ctx.scene).add(mesh)',
    )
    expect(e.createContent).toContain('if (ctx.data && ctx.data.lights)')
    expect(e.setup).toContain('if (!globalThis.__vosTimeline)')
    expect(e.setup).toContain('ctx.data.overlays')
    // The entry never reads the anchor's card geometry or source clock.
    expect(e.onFrame).not.toContain('srcT')
    expect(e.onFrame).not.toContain('d.segments')
    expect(e.onFrame).not.toContain('d.frame')
  })

  it("the anchor's program keeps the cam bubble and drops the clip loop", () => {
    const { config } = lowerToComposition(base)
    const onFrame = config.onFrame as string
    expect(onFrame).toContain('webcam bubble')
    expect(onFrame).not.toContain('d.overlays')
    expect(onFrame).not.toContain('d.objects')
    expect(config.createContent as string).not.toContain('AmbientLight')
  })
})
