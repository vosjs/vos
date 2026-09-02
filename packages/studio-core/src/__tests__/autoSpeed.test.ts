import { describe, expect, it } from 'vitest'
import { planAutoSpeed } from '../planner/autoSpeed'
import type { CursorEvent } from '../types'

const ev = (t: number, type: CursorEvent['type']): CursorEvent => ({
  t: t * 1000,
  x: 100,
  y: 100,
  type,
})

describe('planAutoSpeed', () => {
  it('returns nothing for an empty track (browser-recorder takes)', () => {
    expect(planAutoSpeed([], { durationMs: 30_000 })).toEqual([])
  })

  it('proposes an idle span for a long gap between events, padded', () => {
    const spans = planAutoSpeed([ev(2, 'move'), ev(12, 'move')], {
      durationMs: 14_000,
    })
    expect(spans).toEqual([
      { id: 's0', in: 2.6, out: 11.4, rate: 4, source: 'auto' },
    ])
  })

  it('an idle gap with measured activity is playback and plans no speed', () => {
    const track = [ev(2, 'move'), ev(12, 'move')]
    const quiet = new Array(14).fill(0.02)
    expect(
      planAutoSpeed(track, { durationMs: 14_000, activity: quiet }),
    ).toHaveLength(1)
    const playing = quiet.map((v, i) => (i >= 3 && i < 11 ? 0.2 : v))
    expect(
      planAutoSpeed(track, { durationMs: 14_000, activity: playing }),
    ).toEqual([])
    // no witness → the cursor-only rule stands (the studio's ingest)
    expect(planAutoSpeed(track, { durationMs: 14_000 })).toHaveLength(1)
  })

  it('covers the head and the tail when nothing happens there', () => {
    const spans = planAutoSpeed([ev(8, 'move'), ev(9, 'move')], {
      durationMs: 20_000,
    })
    expect(spans.map((s) => [s.in, s.out])).toEqual([
      [0.6, 7.4],
      [9.6, 19.4],
    ])
  })

  it('groups key pings into a typing session at the typing rate', () => {
    const track = [
      ev(1, 'move'),
      ev(2, 'key'),
      ev(3, 'key'),
      ev(4, 'key'),
      ev(5.5, 'key'),
      ev(6, 'move'),
    ]
    const spans = planAutoSpeed(track, { durationMs: 8_000 })
    expect(spans).toEqual([
      { id: 's0', in: 2, out: 5.5, rate: 3, source: 'auto' },
    ])
  })

  it('short typing blips propose nothing', () => {
    const spans = planAutoSpeed(
      [ev(1, 'move'), ev(2, 'key'), ev(3, 'key'), ev(4, 'move')],
      { durationMs: 6_000 },
    )
    expect(spans).toEqual([])
  })

  it('proposes a scroll run at the scroll rate', () => {
    const track = [
      ev(1, 'move'),
      ev(2, 'scroll'),
      ev(2.5, 'scroll'),
      ev(3.2, 'scroll'),
      ev(3.9, 'scroll'),
      ev(4.6, 'scroll'),
      ev(5, 'move'),
    ]
    const spans = planAutoSpeed(track, { durationMs: 7_000 })
    expect(spans).toEqual([
      { id: 's0', in: 2, out: 4.6, rate: 2, source: 'auto' },
    ])
  })

  it('typing beats scroll on an overlap; the loser is clipped', () => {
    const track = [
      ev(0, 'move'),
      // scroll run 1..8
      ...[1, 1.5, 2, 2.7, 3.4, 4, 4.6, 5.3, 6, 6.7, 7.4, 8].map((t) =>
        ev(t, 'scroll'),
      ),
      // typing 4..8 (overlaps the scroll tail)
      ...[4, 5, 6, 7, 8].map((t) => ev(t, 'key')),
      ev(8.2, 'move'),
    ]
    const spans = planAutoSpeed(track, { durationMs: 10_000 })
    expect(spans).toEqual([
      { id: 's0', in: 1, out: 4, rate: 2, source: 'auto' },
      { id: 's1', in: 4, out: 8, rate: 3, source: 'auto' },
    ])
  })

  it('params override the thresholds and rates', () => {
    const spans = planAutoSpeed([ev(1, 'move'), ev(5, 'move')], {
      durationMs: 6_000,
      params: { idleMin: 3, idleRate: 8 },
    })
    expect(spans).toHaveLength(1)
    expect(spans[0].rate).toBe(8)
  })

  it('is deterministic and sorted', () => {
    const track = [ev(20, 'move'), ...[2, 3, 4, 5, 6].map((t) => ev(t, 'key'))]
    const a = planAutoSpeed(track, { durationMs: 30_000 })
    const b = planAutoSpeed(track, { durationMs: 30_000 })
    expect(a).toEqual(b)
    expect([...a].sort((x, y) => x.in - y.in)).toEqual(a)
  })
})
