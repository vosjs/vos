/**
 * Stagger expansion: per-element start-time offsets for array targets,
 * matching GSAP's documented semantics for the dialect subset
 * (numeric `each`, or `{ each, amount, from: index|'start'|'center'|'end'|'edges' }`).
 */

export interface StaggerResult {
  offsets: number[]
  /** Largest offset — the staggered tween's total span extends by this much. */
  max: number
  /** True when the stagger form is outside the dialect (e.g. a function). */
  opaque: boolean
}

interface StaggerObject {
  each?: number
  amount?: number
  from?: number | 'start' | 'center' | 'end' | 'edges'
}

const ZERO = (n: number): StaggerResult => ({
  offsets: new Array<number>(n).fill(0),
  max: 0,
  opaque: false,
})

export function staggerOffsets(n: number, stagger: unknown): StaggerResult {
  if (n <= 0) return ZERO(0)
  if (stagger == null) return ZERO(n)

  if (typeof stagger === 'number') {
    const offsets = Array.from({ length: n }, (_, i) => i * stagger)
    return { offsets, max: Math.max(0, (n - 1) * stagger), opaque: false }
  }

  if (typeof stagger === 'object') {
    const { each, amount, from = 'start' } = stagger as StaggerObject
    const center = (n - 1) / 2
    const dist = (i: number): number => {
      if (from === 'start') return i
      if (from === 'end') return n - 1 - i
      if (from === 'center') return Math.abs(i - center)
      if (from === 'edges') return center - Math.abs(i - center)
      return Math.abs(i - Number(from))
    }
    const dists = Array.from({ length: n }, (_, i) => dist(i))
    const maxD = Math.max(...dists, 0)
    // GSAP normalizes distances so the farthest element sits at n-1 (verified
    // black-box: {each: 0.3, from: 'center'} on 5 targets → offsets ×0.3 of
    // [4,2,0,2,4], not the raw [2,1,0,1,2]). `amount` distributes across the
    // same normalized spread with max offset = amount.
    const norm = dists.map((d) => (maxD > 0 ? (d * (n - 1)) / maxD : 0))
    const unit =
      typeof each === 'number'
        ? each
        : typeof amount === 'number' && n > 1
          ? amount / (n - 1)
          : 0
    const offsets = norm.map((d) => d * unit)
    return { offsets, max: Math.max(...offsets.map(Math.abs), 0), opaque: false }
  }

  // Function-based (or otherwise exotic) stagger — outside the dialect.
  return { ...ZERO(n), opaque: true }
}
