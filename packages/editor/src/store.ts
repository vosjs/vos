/**
 * Patch-based document store — the undo/redo substrate for vos editors.
 *
 * Every edit runs through `apply(recipe)`, producing a forward + inverse patch
 * pair (Immer). The app's document is the single source of truth; whatever is
 * derived from it (a lowered vos composition, a compiled program) is recomputed
 * by the app on change. Undo/redo only ever touches the document. One mechanism
 * powers undo/redo, coalesced drag gestures (one undo entry per drag), autosave
 * (the forward patch log), and — later — real-time collaboration.
 */
import { applyPatches, enablePatches, produceWithPatches } from 'immer'
import type { Objectish, Patch } from 'immer'

enablePatches()

export type { Patch }

export interface Command {
  forward: Patch[]
  inverse: Patch[]
  label: string
  coalesceKey?: string
}

export type Recipe<T> = (draft: T) => void

export interface ApplyOptions {
  /** Merge consecutive same-key edits (within the time window) into one undo entry. */
  coalesceKey?: string
  label?: string
}

export interface ProjectStore<T> {
  get: () => T
  apply: (recipe: Recipe<T>, opts?: ApplyOptions) => void
  undo: () => void
  redo: () => void
  canUndo: () => boolean
  canRedo: () => boolean
  /** Subscribe to changes; receives the new doc + the patches that produced it. */
  subscribe: (fn: (doc: T, patches: Patch[]) => void) => () => void
}

export interface StoreOptions {
  /** Injectable clock (tests pass a fake; default Date.now). */
  now?: () => number
  /** Coalescing window in ms (default 400). */
  coalesceMs?: number
}

export function createProjectStore<T extends Objectish>(
  initial: T,
  options: StoreOptions = {},
): ProjectStore<T> {
  const now = options.now ?? (() => Date.now())
  const coalesceMs = options.coalesceMs ?? 400

  let doc = initial
  const undoStack: Command[] = []
  const redoStack: Command[] = []
  const subs = new Set<(doc: T, patches: Patch[]) => void>()
  let lastApplyAt = -Infinity

  const emit = (patches: Patch[]) => subs.forEach((fn) => fn(doc, patches))

  function apply(recipe: Recipe<T>, opts: ApplyOptions = {}) {
    const [next, forward, inverse] = produceWithPatches(doc, recipe)
    if (forward.length === 0) return // no-op edit
    doc = next

    const t = now()
    const top = undoStack.at(-1) // Command | undefined
    const canCoalesce =
      !!opts.coalesceKey &&
      top?.coalesceKey === opts.coalesceKey &&
      t - lastApplyAt <= coalesceMs

    if (canCoalesce) {
      // Extend the existing undo entry: forward grows, inverse prepends
      // (so undo replays inverses newest→oldest).
      top.forward.push(...forward)
      top.inverse.unshift(...inverse)
    } else {
      undoStack.push({
        forward,
        inverse,
        label: opts.label ?? '',
        coalesceKey: opts.coalesceKey,
      })
    }
    redoStack.length = 0
    lastApplyAt = t
    emit(forward)
  }

  function undo() {
    const cmd = undoStack.pop()
    if (!cmd) return
    doc = applyPatches(doc, cmd.inverse)
    redoStack.push(cmd)
    lastApplyAt = -Infinity // a subsequent edit cannot coalesce across an undo
    emit(cmd.inverse)
  }

  function redo() {
    const cmd = redoStack.pop()
    if (!cmd) return
    doc = applyPatches(doc, cmd.forward)
    undoStack.push(cmd)
    lastApplyAt = -Infinity
    emit(cmd.forward)
  }

  return {
    get: () => doc,
    apply,
    undo,
    redo,
    canUndo: () => undoStack.length > 0,
    canRedo: () => redoStack.length > 0,
    subscribe(fn) {
      subs.add(fn)
      return () => subs.delete(fn)
    },
  }
}
