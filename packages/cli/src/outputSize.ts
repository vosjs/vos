import {
  aspectLabel,
  programSize,
  resolveOutputSize,
  type ProgramSize,
  type ResolvedOutputSize,
} from '@vosjs/core'
import { numFlag, UsageError, type ParsedArgs } from './args'

/** The landscape size a verb uses for a program that declares none. */
export const RENDER_FALLBACK: ProgramSize = { width: 1920, height: 1080 }
export const STILL_FALLBACK: ProgramSize = { width: 1280, height: 720 }

const optNum = (
  flags: ParsedArgs['flags'],
  name: string,
): number | undefined =>
  flags[name] === undefined ? undefined : numFlag(flags, name, 0)

/**
 * Output pixels for a render or a still: `--width`/`--height` win, one of
 * them alone keeps the program's aspect, and neither means the program's own
 * `size` (else the verb's landscape fallback).
 *
 * Returns a note when the flags render a declared program at another aspect:
 * the program lays itself out in whatever frame it gets, so that is a
 * different picture, not a scaled one.
 */
export function outputSizeFor(
  config: Record<string, unknown>,
  flags: ParsedArgs['flags'],
  fallback: ProgramSize,
): ResolvedOutputSize & { note?: string } {
  const declared = programSize(config)
  const width = optNum(flags, 'width')
  const height = optNum(flags, 'height')
  for (const [name, v] of [
    ['width', width],
    ['height', height],
  ] as const) {
    if (v !== undefined && !(v >= 1))
      throw new UsageError(`--${name} expects a positive number, got ${v}`)
  }
  const resolved = resolveOutputSize({ declared, width, height, fallback })
  if (
    declared &&
    resolved.source === 'flags' &&
    Math.abs(
      resolved.width / resolved.height - declared.width / declared.height,
    ) > 0.005
  ) {
    return {
      ...resolved,
      note: `rendering at ${resolved.width}x${resolved.height} (${aspectLabel(resolved)}); the program declares ${declared.width}x${declared.height} (${aspectLabel(declared)}) and lays itself out in the frame it gets`,
    }
  }
  return resolved
}
