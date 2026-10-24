/**
 * Time ranges in which the drawn cursor is off (`doc.cursor.off`), read at
 * OUTPUT time. One rule for every place the cursor is drawn: the primary
 * card (any media it plays), the dot carried across a transition, and a
 * layer card's own cursor. A pure function of `t`, so a frame stays a pure
 * function of time, and the ranges ride the document's data (a live edit).
 *
 * The fades sit OUTSIDE a range: the dot fades out over `CURSOR_OFF_FADE`
 * before `in` and back in over the same after `out`, so every moment inside
 * the range is fully hidden. A range at 0 is hidden from the first frame
 * (nothing before it to fade over), and one with no `out` never returns.
 */
import type { CursorOff } from '../types'

/** Seconds the dot takes to leave before a range and return after it. */
export const CURSOR_OFF_FADE = 0.15

/**
 * The cursor's opacity factor at OUTPUT time `t`, 0..1: 1 away from every
 * range, 0 inside one, a linear ramp over the fade beside each edge. A range
 * whose `in` is not a finite number, or whose `out` is present and not past
 * its `in`, hides nothing (the lint names both).
 */
export function cursorOffAlpha(
  off: readonly CursorOff[] | null | undefined,
  t: number,
): number {
  let a = 1
  if (!Array.isArray(off)) return a
  for (const r of off as readonly (CursorOff | null | undefined)[]) {
    if (!r || typeof r.in !== 'number' || !Number.isFinite(r.in)) continue
    if (r.out !== undefined && !(typeof r.out === 'number' && r.out > r.in))
      continue
    const out = r.out === undefined ? Infinity : r.out
    const k =
      t < r.in
        ? (r.in - t) / CURSOR_OFF_FADE
        : t > out
          ? (t - out) / CURSOR_OFF_FADE
          : 0
    if (k < a) a = k
  }
  return a < 0 ? 0 : a > 1 ? 1 : a
}

/**
 * The same rule as page code, a function declaration inlined into the
 * runtime strings (ON_FRAME and the studio entry, which share no scope).
 * `cursorOff.test.ts` holds the two to each other.
 */
export const CURSOR_OFF_CODE = `function cxoAlpha(cxoL, cxoT) {
    var cxoA = 1
    if (!cxoL || !cxoL.length) return cxoA
    for (var cxoI = 0; cxoI < cxoL.length; cxoI++) {
      var cxoR = cxoL[cxoI]
      if (!cxoR || typeof cxoR.in !== 'number' || !isFinite(cxoR.in)) continue
      if (cxoR.out !== undefined && !(typeof cxoR.out === 'number' && cxoR.out > cxoR.in)) continue
      var cxoO = cxoR.out === undefined ? Infinity : cxoR.out
      var cxoK = cxoT < cxoR.in ? (cxoR.in - cxoT) / ${CURSOR_OFF_FADE} : cxoT > cxoO ? (cxoT - cxoO) / ${CURSOR_OFF_FADE} : 0
      if (cxoK < cxoA) cxoA = cxoK
    }
    return cxoA < 0 ? 0 : cxoA > 1 ? 1 : cxoA
  }`
