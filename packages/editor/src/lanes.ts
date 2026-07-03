/**
 * Lane adapters — the app↔timeline contract. The timeline UI owns the generic
 * mechanics (ruler, px↔t, snapping, drag lifecycle); an adapter owns the app's
 * opinion: how its document projects onto a lane (`items`) and what a gesture
 * means as a patch (`gesture` → an Immer recipe for the project store). Gesture
 * times arrive in OUTPUT-timeline seconds, already snapped.
 */
import type { Recipe } from './store'

export interface LaneItem {
  /** Stable identity for selection + drag targeting. */
  id: string
  /** 'clip' renders as a spanning block (t..t+duration); 'keyframe' as a point. */
  kind: 'clip' | 'keyframe'
  /** Output-timeline seconds. */
  t: number
  duration?: number
  label?: string
}

export type LaneGesture =
  /** Retime a keyframe / move an item to `t`. */
  | { type: 'move'; id: string; t: number }
  /**
   * Drag a clip edge to `t`. `t` may fall OUTSIDE the current timeline
   * (e.g. negative when extending the first clip's head back) — adapters clamp
   * in source space, which is what lets trimmed footage be restored.
   */
  | { type: 'resize'; id: string; edge: 'start' | 'end'; t: number }
  /** Create an item at `t` (double-click / split-at-playhead). */
  | { type: 'create'; t: number }
  | { type: 'remove'; id: string }

/**
 * ANCHORING CONTRACT (industry-standard trim behavior): for continuous
 * gestures (a drag's stream of move/resize events), the UI evaluates
 * `gesture(doc, g)` against the DOC CAPTURED AT POINTER-DOWN with `t` derived
 * from the pointer's total delta — never against the live document, whose
 * layout shifts under the pointer mid-drag (compounding feedback). Recipes
 * must therefore address items by ID and write ABSOLUTE state (whole-array
 * assignment or id-lookup in the draft), so replaying against the live draft
 * converges instead of accumulating.
 */

export interface LaneAdapter<TDoc> {
  id: string
  label: string
  items: (doc: TDoc) => LaneItem[]
  /**
   * Translate a gesture into a doc patch, or null when it doesn't apply.
   * Recipes run through the patch store, so every gesture is undoable; the UI
   * coalesces a drag's stream of gestures into one undo entry via coalesceKey.
   */
  gesture: (doc: TDoc, g: LaneGesture) => Recipe<TDoc> | null
  /** Magnetic snap targets (output-timeline seconds) this lane contributes. */
  magnets?: (doc: TDoc) => number[]
}
