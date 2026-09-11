import { describe, expect, it } from 'vitest'
import { STUDIO_ENTRY_ID } from '@vosjs/studio-core'
import { storedProgramConfig } from '../program'

/**
 * What a push stores for a layered program is the COMPOSED config, the
 * studio's own save shape: a push that sent the raw config stored a program
 * whose layers the fleet never rendered.
 */
describe('storedProgramConfig', () => {
  const config = {
    version: 2,
    duration: 4,
    createContent: '(ctx) => ({ object: new ctx.THREE.Group() })',
    createTimeline: '(ctx) => ctx.gsap.timeline()',
  }

  it('is the config itself when no document rides along', () => {
    expect(storedProgramConfig(config, null)).toBe(config)
  })

  it('composes the document over the config, the studio entry included', () => {
    const doc = {
      program: { config },
      audio: [],
      overlays: [
        {
          id: 'callout',
          kind: 'html',
          start: 0,
          duration: 4,
          html: '<div>Title</div>',
          box: { width: 420, height: 132 },
          transform: { x: 0.5, y: 0.5, scale: 1, rotation: 0 },
        },
      ],
    }
    const stored = storedProgramConfig(config, doc)
    const stack = stored.stack as {
      id: string
      data: { overlays?: unknown[] }
    }[]
    expect(stack.some((e) => e.id === STUDIO_ENTRY_ID)).toBe(true)
    const entry = stack.find((e) => e.id === STUDIO_ENTRY_ID)!
    expect(entry.data.overlays).toHaveLength(1)
    // The document itself is untouched: the user's config stays raw in it.
    expect(doc.program.config).toBe(config)
  })
})
