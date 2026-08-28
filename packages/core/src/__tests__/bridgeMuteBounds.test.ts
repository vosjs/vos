import { describe, expect, it } from 'vitest'
import { compileVosConfig } from '../compiler/compileVosConfig'
import { generateRenderTemplate } from '../runtime/renderTemplate'
import { VOS_BRIDGE_PROTOCOL } from '../runtime/bridge'

// Protocol 6: SET_MUTED (playback) and OBJECT_BOUNDS → OBJECT_RECT (editor).

const sample =
  'export const initVos = async () => ({ timeline: null, cleanup: () => {} })'

describe('SET_MUTED', () => {
  it('is a playback command that reaches every media element', () => {
    expect(VOS_BRIDGE_PROTOCOL).toBe(7)
    const html = generateRenderTemplate(sample, { mode: 'playback' })
    expect(html).toContain("case 'SET_MUTED':")
    expect(html).toContain('window.__vos__.setGlobalMuted(!!msg.muted)')
    // A program with no elements has no switch to flip; the flag is still
    // kept so a later LOAD with elements picks it up.
    expect(html).toContain('window.__vos__.isMuted = !!msg.muted')
  })

  it('the compiled program installs the switch beside the global pause', () => {
    const code = compileVosConfig({
      version: 2,
      duration: 3,
      camera: { preset: 'perspective' },
      elements: [{ id: 'a', type: 'audio', src: 'x.mp3' }],
      createContent: '() => ({ objects: [] })',
      createTimeline: '(ctx, content, duration) => ctx.gsap.timeline()',
    })
    expect(code).toContain('window.__vos__.setGlobalPaused = (paused) => {')
    expect(code).toContain('window.__vos__.setGlobalMuted = (muted) => {')
    // Document-scoped like isPaused: a warm LOAD keeps the host's mute.
    expect(code).toContain(
      'window.__vos__.isMuted = window.__vos__.isMuted ?? false;',
    )
  })
})

describe('OBJECT_BOUNDS', () => {
  it("answers with the object's projected world box in editor mode only", () => {
    const editor = generateRenderTemplate(sample, {
      mode: 'playback',
      editor: true,
    })
    expect(editor).toContain("case 'OBJECT_BOUNDS':")
    expect(editor).toContain("type: 'OBJECT_RECT'")
    expect(editor).toContain('box3.setFromObject(inst.root)')
    expect(editor).toContain('v3.project(cam)')
    const player = generateRenderTemplate(sample, { mode: 'playback' })
    expect(player).not.toContain("case 'OBJECT_BOUNDS':")
  })
})
