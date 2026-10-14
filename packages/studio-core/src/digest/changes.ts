/**
 * The digest sees consequences: what a click or a typing run DID to the
 * page. A press is one frame; the page's answer comes after it, a dialog
 * opening, a 200 landing, a graph re-laying out, a card vanishing. The
 * region that changed in the seconds after the step is a moment a cut can
 * hold on, and a zoom can frame.
 *
 * Pure: the browser samples luma grids (the cli's digest page) at the
 * step's end and a few beats after it; this module finds the changed
 * region and keeps the sample that changed most. Two things keep it
 * honest on a page that moves on its own. A sample a beat BEFORE the step
 * gives each cell its own drift, and only what moved past that drift
 * counts (`ambientDrift`). And a change is judged by the blocks it FILLS,
 * not by the cells it touches: a silk or a shimmer flickers cells all over
 * the frame and fills no block, while a dialog, a recoloured pane or a
 * status line fills its own.
 */
import type { NormRect } from './moments'

/** A luma grid of the frame at one instant, row-major, `w × h` cells. */
export interface LumaGrid {
  w: number
  h: number
  luma: ArrayLike<number>
}

/** What changed between two grids: the largest cluster of blocks that filled, and its box. */
export interface ChangedRegion {
  /** The cluster's share of the frame's blocks, 0..1. */
  fraction: number
  /** The cluster's bounding box, normalized frame fractions. */
  rect: NormRect
}

/** The grid the browser samples: coarse enough that a cursor is one cell, a dialog a block. */
export const CHANGE_GRID = { w: 128, h: 72 } as const
/** A block changed when at least this share of its cells moved. */
export const BLOCK_FILL = 0.5
/** The floor a change must clear to be named: 2% of the frame's blocks. */
export const CHANGE_FLOOR = 0.02
/** How long after a seed the digest looks for its consequence, source seconds. */
export const CHANGE_OFFSETS = [0.3, 0.8, 1.5, 2.5] as const
/** How long before a seed the ambient sample is taken, source seconds. */
export const CHANGE_LEAD = 0.5

/**
 * The changed region between two grids, or null when nothing (or fewer
 * than `minBlocks`) filled. `delta` is the luma step a cell must move by,
 * the digest's own motion delta. `ambient`, when given, is what each cell
 * moves by on its own (see `ambientDrift`) and how long after `before`
 * this grid was taken: a cell counts only when it moved past what its own
 * drift explains over that time. A block is `block` cells a side (the
 * grid's sixteenth by default: 16 × 9 blocks over the sampled grid).
 */
export function changedRegion(
  before: LumaGrid,
  after: LumaGrid,
  delta: number,
  minBlocks = 1,
  ambient: { rate: ArrayLike<number>; dt: number } | null = null,
  block = Math.max(1, Math.round(before.w / 16)),
): ChangedRegion | null {
  const { w, h } = before
  if (after.w !== w || after.h !== h || w <= 0 || h <= 0) return null
  const cols = Math.ceil(w / block)
  const rows = Math.ceil(h / block)
  // Cells that moved past their drift, counted per block.
  const moved = new Uint16Array(cols * rows)
  const cells = new Uint16Array(cols * rows)
  for (let y = 0; y < h; y++) {
    const by = Math.floor(y / block)
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      const b = by * cols + Math.floor(x / block)
      cells[b]++
      const drift = ambient ? ambient.rate[i] * ambient.dt : 0
      if (Math.abs(after.luma[i] - before.luma[i]) - drift > delta) moved[b]++
    }
  }
  // The changed blocks, then the largest CONNECTED cluster of them: what a
  // press did is one thing in one place (a dialog, a recoloured pane), and
  // a background that flickers leaves scattered blocks that never join.
  const filled = new Uint8Array(cols * rows)
  for (let b = 0; b < filled.length; b++)
    if (moved[b] >= cells[b] * BLOCK_FILL) filled[b] = 1
  const seen = new Uint8Array(cols * rows)
  let best: {
    size: number
    minX: number
    minY: number
    maxX: number
    maxY: number
  } | null = null
  for (let start = 0; start < filled.length; start++) {
    if (!filled[start] || seen[start]) continue
    const stack = [start]
    seen[start] = 1
    let size = 0
    let minX = cols
    let minY = rows
    let maxX = -1
    let maxY = -1
    while (stack.length) {
      const b = stack.pop() as number
      size++
      const bx = b % cols
      const by = Math.floor(b / cols)
      if (bx < minX) minX = bx
      if (bx > maxX) maxX = bx
      if (by < minY) minY = by
      if (by > maxY) maxY = by
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const nx = bx + dx
        const ny = by + dy
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue
        const n = ny * cols + nx
        if (filled[n] && !seen[n]) {
          seen[n] = 1
          stack.push(n)
        }
      }
    }
    if (!best || size > best.size) best = { size, minX, minY, maxX, maxY }
  }
  if (!best || best.size < minBlocks) return null
  return {
    fraction: best.size / (cols * rows),
    rect: {
      x: (best.minX * block) / w,
      y: (best.minY * block) / h,
      w: Math.min(w, (best.maxX + 1) * block) / w - (best.minX * block) / w,
      h: Math.min(h, (best.maxY + 1) * block) / h - (best.minY * block) / h,
    },
  }
}

/**
 * How much each cell moves on its own, per second: a page whose background
 * animates (a silk, a video, a shimmer) changes everywhere every frame, and
 * the consequence of a press would drown in it. Two grids taken BEFORE the
 * seed, `lead` seconds apart, give each cell its drift; `changedRegion`
 * then counts a cell only when it moved past what that drift explains.
 */
export function ambientDrift(
  earlier: LumaGrid,
  before: LumaGrid,
  lead: number,
): number[] | null {
  const { w, h } = before
  if (earlier.w !== w || earlier.h !== h || !(lead > 0)) return null
  const rate = new Array<number>(w * h)
  for (let i = 0; i < rate.length; i++)
    rate[i] = Math.abs(before.luma[i] - earlier.luma[i]) / lead
  return rate
}

/** One sample after a seed: when it was taken and what had changed by then. */
export interface ChangeSample {
  /** Source seconds after the seed. */
  dt: number
  region: ChangedRegion | null
}

/** A consequence the digest will name: a moment's seed and the region it changed. */
export interface ChangeWitness {
  /** The seed moment's id (a click or a typing run). */
  seed: string
  /** Source second the seed ended at: the frame the change is measured from. */
  at: number
  /** Source second of the sample that had changed most. */
  peakAt: number
  fraction: number
  rect: NormRect
}

/**
 * The witness for one seed: the sample that changed most, when it clears
 * the floor. A consequence that never clears it is no moment, and a seed
 * that changed everything (a navigation) is the scene detector's.
 */
export function pickChange(
  seed: { id: string; at: number },
  samples: readonly ChangeSample[],
  floor = CHANGE_FLOOR,
): ChangeWitness | null {
  let best: ChangeSample | null = null
  for (const s of samples) {
    if (!s.region || s.region.fraction < floor) continue
    if (!best || s.region.fraction > (best.region?.fraction ?? 0)) best = s
  }
  if (!best?.region) return null
  return {
    seed: seed.id,
    at: seed.at,
    peakAt: seed.at + best.dt,
    fraction: best.region.fraction,
    rect: best.region.rect,
  }
}
