import { lowerToComposition } from '../../lower/lowerToComposition'
import { STUDIO_ENTRY_ID } from '../../lower/studioEntry'
import type { LoweredComposition } from '../../lower/lowerToComposition'
import type { ProjectDoc } from '../../types'

type FrameFn = (ctx: unknown, content: unknown, dt: number) => void

/**
 * The stub-context harnesses drive the compositor off ONE ctx. The
 * shared layers (overlay clips, props) are the studio STACK ENTRY's program
 * with its own data, so a harness runs both programs: `data` here is the
 * main data with the entry's merged over it (each program reads only its
 * own keys), and `bothFrames` runs the main ON_FRAME then the entry's on the
 * same refs (the entry paints on `refs.ov`, reconciles `refs.objects`).
 */
export function lowerMerged(doc: ProjectDoc): LoweredComposition {
  const lowered = lowerToComposition(doc)
  return {
    ...lowered,
    data: { ...lowered.data, ...lowered.stack[STUDIO_ENTRY_ID] },
  }
}

export function bothFrames(config: Record<string, unknown>): FrameFn {
  const main = new Function(`return (${config.onFrame as string})`)() as FrameFn
  const entry = (config.stack as { onFrame: string }[])[0]
  const studio = new Function(`return (${entry.onFrame})`)() as FrameFn
  return (ctx, content, dt) => {
    main(ctx, content, dt)
    studio(ctx, content, dt)
  }
}

/** The studio entry's function strings, for text assertions. */
export function studioEntryOf(config: Record<string, unknown>) {
  return (
    config.stack as {
      id: string
      data: Record<string, unknown>
      setup: string
      createContent: string
      onFrame: string
    }[]
  )[0]
}
