import { describe, expect, it, vi } from 'vitest'
import { produce } from 'immer'
import { createEditorBridgeClient } from '../editorBridge'
import {
  cssDeltaToDesign,
  elementConfigId,
  nudgeElementRecipe,
  propsForRectCenter,
} from '../elementEdit'

describe('createEditorBridgeClient', () => {
  it('correlates HIT_TEST / GET_ELEMENT_RECTS by requestId, out of order', async () => {
    const posted: any[] = []
    const client = createEditorBridgeClient((m) => posted.push(m))

    const hit = client.hitTest(10, 20)
    const rects = client.getElementRects()
    expect(posted).toEqual([
      { type: 'HIT_TEST', x: 10, y: 20, requestId: 1 },
      { type: 'GET_ELEMENT_RECTS', requestId: 2 },
    ])

    // answer out of order
    expect(
      client.handleEvent({ type: 'ELEMENT_RECTS', requestId: 2, rects: [{ id: 'a', x: 0, y: 0, width: 10, height: 10, visible: true }] }),
    ).toBe(true)
    expect(client.handleEvent({ type: 'HIT_RESULT', requestId: 1, id: 'title' })).toBe(true)

    expect(await hit).toBe('title')
    expect((await rects).map((r) => r.id)).toEqual(['a'])
  })

  it('resolves with fallbacks on timeout (player not in editor mode)', async () => {
    vi.useFakeTimers()
    const client = createEditorBridgeClient(() => {}, { timeoutMs: 50 })
    const hit = client.hitTest(0, 0)
    const rects = client.getElementRects()
    vi.advanceTimersByTime(60)
    expect(await hit).toBeNull()
    expect(await rects).toEqual([])
    vi.useRealTimers()
  })

  it('reset() settles everything outstanding (iframe reload)', async () => {
    const client = createEditorBridgeClient(() => {})
    const hit = client.hitTest(0, 0)
    client.reset()
    expect(await hit).toBeNull()
  })

  it('pushes resize rect updates to subscribers and ignores unrelated messages', () => {
    const client = createEditorBridgeClient(() => {})
    const seen: unknown[] = []
    const unsub = client.onRects((r) => seen.push(r))
    expect(client.handleEvent({ type: 'ELEMENT_RECTS', requestId: null, rects: [] })).toBe(true)
    expect(client.handleEvent({ type: 'UPDATE', progress: 0.5 })).toBe(false)
    expect(client.handleEvent({ type: 'READY', duration: 3 })).toBe(false)
    expect(seen).toHaveLength(1)
    unsub()
  })

  it('setElementProps posts the ephemeral override verbatim', () => {
    const posted: any[] = []
    const client = createEditorBridgeClient((m) => posted.push(m))
    client.setElementProps('title', { x: 12, y: -4 })
    expect(posted).toEqual([{ type: 'SET_ELEMENT_PROPS', id: 'title', props: { x: 12, y: -4 } }])
  })
})

describe('element edit commit helpers', () => {
  const config = {
    version: 2,
    elements: [
      { id: 'title', type: 'text', content: 'Hi', position: 'center' },
      { type: 'image', src: 'x.png', position: 'top-left', transform: { translateX: 10, scale: 2 } },
    ],
  }

  it('cssDeltaToDesign inverts the renderer’s height/1080 scaling', () => {
    // a 540px-tall viewport renders at half design scale → css deltas double
    expect(cssDeltaToDesign(30, -15, 540)).toEqual({ dx: 60, dy: -30 })
    expect(cssDeltaToDesign(30, 0, 1080)).toEqual({ dx: 30, dy: 0 })
  })

  it('elementConfigId falls back to the renderer’s positional id', () => {
    expect(elementConfigId(config.elements[0], 0)).toBe('title')
    expect(elementConfigId(config.elements[1], 1)).toBe('element_1')
  })

  it('nudgeElementRecipe accumulates translate and preserves other transform keys', () => {
    const r1 = nudgeElementRecipe(config, 'element_1', { dx: 5, dy: 7 })!
    const next = produce(config, r1)
    expect(next.elements[1].transform).toEqual({ translateX: 15, translateY: 7, scale: 2 })
    // original untouched (immer draft semantics)
    expect(config.elements[1].transform).toEqual({ translateX: 10, scale: 2 })

    const r2 = nudgeElementRecipe(next, 'title', { dx: -3, dy: 0 })!
    const next2 = produce(next, r2)
    expect(next2.elements[0].transform).toEqual({ translateX: -3, translateY: 0 })
  })

  it('returns null when there is nothing to commit', () => {
    expect(nudgeElementRecipe({}, 'title', { dx: 1, dy: 1 })).toBeNull()
    expect(nudgeElementRecipe(config, 'nope', { dx: 1, dy: 1 })).toBeNull()
  })

  it('propsForRectCenter maps viewport px to the centered props space', () => {
    expect(propsForRectCenter(600, 400, 1200, 800)).toEqual({ x: 0, y: 0 })
    expect(propsForRectCenter(700, 350, 1200, 800)).toEqual({ x: 100, y: -50 })
  })
})
