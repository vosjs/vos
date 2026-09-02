import { applyTimelineEdits } from '@vosjs/shared/timelineEdits'
import { totalDuration } from '@vosjs/timeline'
import { isRecordingDoc, programDuration } from '../doc/studioDoc'
import {
  lowerToComposition,
  ratedSegments,
  studioLayerData,
} from './lowerToComposition'
import { STUDIO_ENTRY_ID, studioEntry } from './studioEntry'
import type { ProgramAnchorDoc, StudioDoc } from '../doc/studioDoc'
import type { LoweredComposition } from './lowerToComposition'

/**
 * ONE lowering for the document family: the anchor's program
 * plus the studio stack entry, on every anchor.
 *
 * - A recording lowers to its card program (`lowerToComposition`), which
 *   already carries the entry.
 * - A program lowers to the user's config, COMPLETE and untouched (the
 *   execution IR, D1) with its tween-timing overlay baked into
 *   `createTimeline`, plus the same entry carrying the shared layers. Params
 *   and Looks ride the config as authored. `retime` arrives with speed spans
 *   absent, the engine's identity is the identity.
 *
 * The composed config is what the platform stores for a layered program and
 * what the fleet compiles; the player runs it MINUS every data object (the
 * structural hash), with `data` and `stack` delivered live.
 */
export function lowerStudioDoc(
  doc: StudioDoc,
  opts: LowerProgramOptions = {},
): LoweredComposition {
  return isRecordingDoc(doc)
    ? lowerToComposition(doc)
    : lowerProgramDoc(doc, opts)
}

export interface LowerProgramOptions {
  /**
   * Bake the tween overlay into `createTimeline` (the STORED composed
   * config: the fleet, the watch page and `vos render` have no bridge to
   * hand an overlay to). Off by default: the player runs the user's
   * timeline and retimes it live, so the program string is constant
   * across every timing edit.
   */
  bake?: boolean
}

export { programDuration } from '../doc/studioDoc'

/**
 * `config.retime` for a program with speed spans: output time →
 * program time through the RATED segments on `data.retime` (the same map
 * `mapTime` performs; inlined so the config stays self-contained, tested
 * against it). Reads data live, so a rate edit is SET_DATA, never a LOAD.
 */
export const PROGRAM_RETIME = `(t, data) => {
  var s = data && data.retime
  if (!s || !s.length) return t
  var acc = 0
  for (var i = 0; i < s.length; i++) {
    var r = s[i].rate && s[i].rate > 0 ? s[i].rate : 1
    var d = (s[i].out - s[i].in) / r
    if (t < acc + d) return s[i].in + (t - acc) * r
    acc += d
  }
  return s[s.length - 1].out
}`

/**
 * With speed spans the OUTPUT length is not the program's own, but the
 * engine hands ONE \`duration\` to both the clock and \`createTimeline\`. The
 * composed config's \`duration\` is the output length (the clock, the fleet's
 * render length); this wrapper hands the user's function the program's own
 * length from \`data.programDuration\` — data, so a rate edit stays live.
 */
export function wrapProgramLength(source: string): string {
  return `(ctx, content, duration) => {
  const __base = (${source});
  const __own = ctx && ctx.data && typeof ctx.data.programDuration === 'number' ? ctx.data.programDuration : duration;
  return __base(ctx, content, __own);
}`
}

export function lowerProgramDoc(
  doc: ProgramAnchorDoc,
  opts: LowerProgramOptions = {},
): LoweredComposition {
  const edits = Object.values(doc.program.tweenEdits ?? {})
  const anchor = (
    opts.bake
      ? applyTimelineEdits(
          doc.program.config as { createTimeline?: unknown },
          edits,
        )
      : doc.program.config
  ) as Record<string, unknown>
  // Speed spans retime the program on the engine. The program's own
  // length is the source clock; the rated segments give the output length.
  const own = programDuration(doc)
  const rated = ratedSegments(doc)
  const duration = own > 0 ? totalDuration(rated) : 0
  const entryData: Record<string, unknown> = studioLayerData(doc, duration)
  const baseData =
    anchor.data && typeof anchor.data === 'object'
      ? (anchor.data as Record<string, unknown>)
      : {}
  const retimed = !!doc.speed?.length && own > 0
  const data: Record<string, unknown> = retimed
    ? { ...baseData, retime: rated, programDuration: own }
    : baseData
  const config: Record<string, unknown> = {
    ...anchor,
    ...(retimed
      ? {
          duration,
          data,
          retime: PROGRAM_RETIME,
          createTimeline: wrapProgramLength(
            String(anchor.createTimeline ?? ''),
          ),
        }
      : {}),
    stack: [studioEntry(entryData)],
  }
  return {
    config,
    data,
    stack: { [STUDIO_ENTRY_ID]: entryData },
    ...(opts.bake ? {} : { tweenEdits: edits }),
    duration,
  }
}
