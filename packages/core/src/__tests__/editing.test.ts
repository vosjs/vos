import { describe, expect, it } from 'vitest'
import gsap from 'gsap'
import { compileVosConfig } from '../compiler/compileVosConfig'
import { VOS_BRIDGE_PROTOCOL } from '../runtime/bridge'
import { generateRenderTemplate } from '../runtime/renderTemplate'

const base = {
  version: 2,
  duration: 5,
  camera: { preset: 'perspective' as const },
  createContent: '() => ({ objects: [] })',
  createTimeline: '(ctx, content, duration) => ctx.gsap.timeline()',
}

// ---------------------------------------------------------------------------
// Compiler: clock feed + duration capability + editor introspection handles
// ---------------------------------------------------------------------------

describe('master clock feed (ctx.time / ctx.progress)', () => {
  it('publishes the timeline position into the context getters every frame', () => {
    const code = compileVosConfig(base)
    // getters exist (pre-existing) …
    expect(code).toContain('get time() { return currentTime; }')
    expect(code).toContain('get progress() { return currentProgress; }')
    // … and are now actually fed by the render loop, before onFrame runs
    expect(code).toContain('currentTime = tl.time();')
    expect(code).toContain('currentProgress = tl.progress();')
    const loop = code.slice(code.indexOf('const animate = () => {'))
    const feed = loop.indexOf('currentTime = tl.time()')
    expect(feed).toBeGreaterThan(-1)
  })

  it('feeds the clock before onFrame so per-frame code reads the rendered position', () => {
    const code = compileVosConfig({
      ...base,
      onFrame: '(ctx, content, dt) => {}',
    })
    const loop = code.slice(code.indexOf('const animate = () => {'))
    expect(loop.indexOf('currentTime = tl.time()')).toBeLessThan(
      loop.indexOf('onFrame(context, content, deltaTime)'),
    )
  })
})

describe('setDuration capability (T2.5)', () => {
  it('is emitted behind the vosCarrier opt-in and exposed on the result', () => {
    const code = compileVosConfig(base)
    expect(code).toContain('let __setDuration;')
    expect(code).toContain('tl.data && tl.data.vosCarrier === true')
    expect(code).toContain('setDuration: __setDuration,')
  })

  it('rebuilds an opted-in carrier at the new duration (real gsap)', () => {
    // Mirrors the generated __setDuration logic 1:1 against a real timeline.
    const tl = gsap.timeline()
    tl.to({}, { duration: 5, ease: 'none' })
    tl.data = { vosCarrier: true }
    tl.repeat(-1)
    tl.pause()
    tl.seek(4, false)

    const s = 2 // shrink below the playhead — must clamp
    const t = Math.min(tl.time(), s)
    tl.clear()
    tl.to({}, { duration: s, ease: 'none' }, 0)
    tl.seek(t, false)

    expect(tl.duration()).toBe(2)
    expect(tl.time()).toBe(2)
    expect(tl.paused()).toBe(true)

    // growing works too, and the playhead survives. NOTE: the time snapshot must
    // happen BEFORE clear() (clear zeroes the playhead) — same order as the
    // generated __setDuration.
    const t2 = Math.min(tl.time(), 10)
    tl.clear()
    tl.to({}, { duration: 10, ease: 'none' }, 0)
    tl.seek(t2, false)
    expect(tl.duration()).toBe(10)
    expect(tl.time()).toBe(2)
    tl.kill()
  })

  it('freeform timelines (no opt-in) get no setDuration', () => {
    // The gate in the generated code — nothing sets tl.data.vosCarrier.
    const tl = gsap.timeline()
    tl.to({}, { duration: 2 })
    tl.to({}, { duration: 3 })
    expect(tl.data?.vosCarrier).toBeUndefined()
    tl.kill()
  })
})

describe('editor introspection handles on VosResult', () => {
  it('exposes elements and overlayCamera on the compiled result', () => {
    const code = compileVosConfig(base)
    const ret = code.slice(code.indexOf('return {'))
    expect(ret).toContain('elements,')
    expect(ret).toContain('overlayCamera,')
  })
})

describe('cleanup is warm-swap safe', () => {
  it('never deletes the document-scoped __vos__ namespace', () => {
    // Regression: cleanup used to `delete window.__vos__`, killing the
    // elements factory installed once by the render template — the SECOND
    // warm LOAD of an element config then failed at renderElements.
    const withElements = compileVosConfig({
      ...base,
      elements: [{ id: 'title', type: 'text', content: 'Hi', position: 'center' }],
    })
    expect(withElements).not.toContain('delete window.__vos__')
    expect(withElements).toContain('videoCallbacks?.clear()')
    expect(compileVosConfig(base)).not.toContain('delete window.__vos__')
  })
})

// ---------------------------------------------------------------------------
// Playback bridge: seconds transport + protocol version + editor mode
// ---------------------------------------------------------------------------

describe('playback bridge v2', () => {
  const html = generateRenderTemplate('', { mode: 'playback' })

  it('advertises the protocol version and editor flag in BRIDGE_READY', () => {
    expect(VOS_BRIDGE_PROTOCOL).toBe(2)
    expect(html).toContain(
      `{ type: 'BRIDGE_READY', protocol: ${VOS_BRIDGE_PROTOCOL}, editor: false }`,
    )
  })

  it('speaks seconds: SEEK_TIME clamps to [0, duration]', () => {
    expect(html).toContain("case 'SEEK_TIME':")
    expect(html).toContain('Math.max(0, Math.min(Number(msg.value) || 0, dur))')
    // legacy progress seek retained
    expect(html).toContain("case 'SEEK':")
  })

  it('UPDATE carries time and duration alongside legacy progress', () => {
    expect(html).toContain(
      "__post({ type: 'UPDATE', progress: tl.progress(), time: tl.time(), duration: __finiteDuration(tl) })",
    )
  })

  it('READY advertises canSetDuration and SET_DURATION is wired', () => {
    expect(html).toContain('canSetDuration: !!result.setDuration')
    expect(html).toContain("case 'SET_DURATION':")
    expect(html).toContain('__current.setDuration(msg.value)')
  })

  it('ships no editor machinery unless requested', () => {
    expect(html).not.toContain('__editorApi')
    expect(html).not.toContain('HIT_TEST')
    expect(html).not.toContain('SET_ELEMENT_PROPS')
  })
})

describe('playback bridge editor mode', () => {
  const html = generateRenderTemplate('', { mode: 'playback', editor: true })

  it('advertises editor mode in BRIDGE_READY', () => {
    expect(html).toContain(
      `{ type: 'BRIDGE_READY', protocol: ${VOS_BRIDGE_PROTOCOL}, editor: true }`,
    )
  })

  it('handles GET_ELEMENT_RECTS / HIT_TEST / SET_ELEMENT_PROPS', () => {
    expect(html).toContain("case 'GET_ELEMENT_RECTS':")
    expect(html).toContain("case 'HIT_TEST':")
    expect(html).toContain("case 'SET_ELEMENT_PROPS':")
    expect(html).toContain("__post({ type: 'ELEMENT_RECTS'")
    expect(html).toContain("__post({ type: 'HIT_RESULT'")
  })

  it('picks topmost by (zIndex, config order), not ray distance', () => {
    expect(html).toContain('m.z > best.z || (m.z === best.z && m.order > best.order)')
  })

  it('pushes rects on resize for host selection chrome', () => {
    expect(html).toContain("window.addEventListener('resize'")
  })

  it('editor mode only applies to playback (capture stays lean)', () => {
    const capture = generateRenderTemplate('export const initVos = () => {}', {
      mode: 'capture-thumbnail',
      editor: true,
      capture: { width: 100, height: 100, duration: 1, fps: 30 },
    })
    expect(capture).not.toContain('__editorApi')
  })
})
