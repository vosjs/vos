/**
 * Postprocessing-chain linter.
 *
 * A composer chain is ordered, and `{ type: 'output' }` is its TERMINATOR:
 * three's `OutputPass` is what applies tone mapping and converts to the
 * renderer's output color space. Every pass before it works in linear space
 * on a render target, so a chain that simply stops after its last effect
 * hands the screen a linear image the renderer never got to finish — the
 * picture is there, but it is not the picture the same scene renders without
 * postprocessing. The schema cannot catch it: `postprocessing` is a list, and
 * every ordering of it is a valid list.
 *
 * Surfaced as warnings; never throws.
 */
import type { VosConfigJson } from '../types'

export type PostprocessingRule = 'missing-output' | 'output-not-last'
export type PostprocessingSeverity = 'warn'

export interface PostprocessingIssue {
  rule: PostprocessingRule
  severity: PostprocessingSeverity
  /** Which chain: the global one, or the per-layer one. */
  chain: 'postprocessing' | 'perLayerEffects'
  message: string
}

type Pass = { type?: unknown }

function lintChain(
  chain: 'postprocessing' | 'perLayerEffects',
  passes: Pass[] | undefined,
): PostprocessingIssue[] {
  // An absent or empty chain is not a chain: no composer is built, and the
  // renderer draws to the screen itself.
  if (!passes?.length) return []
  const types = passes.map((p) => String(p?.type ?? ''))
  const last = types[types.length - 1]
  if (last === 'output') return []

  const at = types.indexOf('output')
  if (at !== -1) {
    return [
      {
        rule: 'output-not-last',
        severity: 'warn',
        chain,
        message:
          `${chain}: { type: 'output' } sits at index ${at} of ${types.length}, so the ` +
          `${types.length - 1 - at} pass(es) after it run AFTER tone mapping and the ` +
          `color-space conversion, on an image that is already display-ready. Move it to the end.`,
      },
    ]
  }
  return [
    {
      rule: 'missing-output',
      severity: 'warn',
      chain,
      message:
        `${chain}: the chain ends with '${last}' and never applies { type: 'output' }, so what ` +
        `reaches the screen skips tone mapping and stays in linear color space — the same scene ` +
        `renders differently with the chain than without it. End the chain with { type: 'output' }.`,
    },
  ]
}

/** Lint both composer chains of a config. Warnings only. */
export function lintVosPostprocessing(
  config: VosConfigJson,
): PostprocessingIssue[] {
  const c = config as VosConfigJson & {
    postprocessing?: Pass[]
    perLayerEffects?: Pass[]
  }
  return [
    ...lintChain('postprocessing', c.postprocessing),
    ...lintChain('perLayerEffects', c.perLayerEffects),
  ]
}
