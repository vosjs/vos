import { describe, expect, it } from 'vitest'
import { createProjectStore } from '../store'

interface Doc {
  padding: number
  zoom: { t: number }[]
}
const initial: Doc = { padding: 10, zoom: [] }

describe('createProjectStore', () => {
  it('applies edits and reflects them in get()', () => {
    const s = createProjectStore<Doc>(initial)
    s.apply((d) => {
      d.padding = 20
    })
    expect(s.get().padding).toBe(20)
  })

  it('undo/redo round-trips to identical state', () => {
    const s = createProjectStore<Doc>(initial)
    s.apply((d) => {
      d.padding = 20
    })
    s.apply((d) => {
      d.zoom.push({ t: 1 })
    })
    expect(s.get()).toEqual({ padding: 20, zoom: [{ t: 1 }] })
    s.undo()
    expect(s.get()).toEqual({ padding: 20, zoom: [] })
    s.undo()
    expect(s.get()).toEqual({ padding: 10, zoom: [] })
    s.redo()
    expect(s.get()).toEqual({ padding: 20, zoom: [] })
  })

  it('no-op edits do not push undo entries', () => {
    const s = createProjectStore<Doc>(initial)
    s.apply((d) => {
      d.padding = 10 // same value → no patches
    })
    expect(s.canUndo()).toBe(false)
  })

  it('coalesces consecutive same-key edits into one undo entry', () => {
    let t = 0
    const s = createProjectStore<Doc>(initial, { now: () => t, coalesceMs: 400 })
    // simulate a slider drag: many edits under one key, within the window
    for (let i = 1; i <= 5; i++) {
      t = i * 50
      s.apply((d) => {
        d.padding = 10 + i
      }, { coalesceKey: 'frame.padding' })
    }
    expect(s.get().padding).toBe(15)
    // one undo jumps back to before the whole drag
    s.undo()
    expect(s.get().padding).toBe(10)
    expect(s.canUndo()).toBe(false)
  })

  it('does not coalesce across the time window', () => {
    let t = 0
    const s = createProjectStore<Doc>(initial, { now: () => t, coalesceMs: 400 })
    t = 0
    s.apply((d) => { d.padding = 11 }, { coalesceKey: 'frame.padding' })
    t = 1000 // beyond window
    s.apply((d) => { d.padding = 12 }, { coalesceKey: 'frame.padding' })
    s.undo()
    expect(s.get().padding).toBe(11) // only the second edit undone
  })

  it('notifies subscribers with patches', () => {
    const s = createProjectStore<Doc>(initial)
    let calls = 0
    const off = s.subscribe(() => { calls++ })
    s.apply((d) => { d.padding = 99 })
    expect(calls).toBe(1)
    off()
    s.apply((d) => { d.padding = 100 })
    expect(calls).toBe(1)
  })
})
