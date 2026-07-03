import { describe, expect, it, vi } from 'vitest'
import { produce } from 'immer'
import { createEditorBridgeClient } from '../editorBridge'
import {
  cssDeltaToDesign,
  elementBaseRotation,
  elementConfigId,
  nudgeElementRecipe,
  propsForRectCenter,
  rotateElementRecipe,
  scaleElementRecipe,
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

  it('scaleElementRecipe multiplies transform.scale and clamps the floor', () => {
    const r1 = scaleElementRecipe(config, 'element_1', 1.5)!
    const next = produce(config, r1)
    expect(next.elements[1].transform).toEqual({ translateX: 10, scale: 3 })

    // no existing scale → starts from 1
    const r2 = scaleElementRecipe(config, 'title', 0.5)!
    expect(produce(config, r2).elements[0].transform).toEqual({ scale: 0.5 })

    // floor: can never scale into oblivion
    const r3 = scaleElementRecipe(config, 'title', 1e-9)!
    expect(produce(config, r3).elements[0].transform).toEqual({ scale: 0.05 })

    expect(scaleElementRecipe(config, 'title', 0)).toBeNull()
    expect(scaleElementRecipe(config, 'nope', 2)).toBeNull()
  })

  it('rotateElementRecipe accumulates, folds the rotateZ alias, and normalizes', () => {
    const withRotate = {
      elements: [{ id: 'a', type: 'text', transform: { rotateZ: 170, scale: 2 } }],
    }
    const r1 = rotateElementRecipe(withRotate, 'a', 20)!
    const next = produce(withRotate, r1)
    // 170 + 20 = 190 → normalized to -170; rotateZ alias folded away
    expect(next.elements[0].transform).toEqual({ scale: 2, rotation: -170 })

    const r2 = rotateElementRecipe(config, 'title', -45)!
    expect(produce(config, r2).elements[0].transform).toEqual({ rotation: -45 })
  })

  it('elementBaseRotation reads the committed rotation (alias respected)', () => {
    expect(elementBaseRotation({ elements: [{ transform: { rotateZ: 30 } }] }, 'element_0')).toBe(30)
    expect(elementBaseRotation({ elements: [{ transform: { rotation: -15 } }] }, 'element_0')).toBe(-15)
    expect(elementBaseRotation(config, 'title')).toBe(0)
    expect(elementBaseRotation({}, 'x')).toBe(0)
  })
})
