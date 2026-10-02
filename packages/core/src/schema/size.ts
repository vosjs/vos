import { z } from 'zod'

/**
 * A program's declared canvas: the frame it was designed for. Its ratio is
 * the program's aspect; its pixels are the default output size. Design units
 * stay 1080-high at every size (element sizes scale with height), so a size
 * changes the frame's shape and default pixels, never the meaning of a design
 * number.
 */
export interface ProgramSize {
  width: number
  height: number
}

/** The smallest and largest edge a declared size may name, in pixels. */
export const PROGRAM_SIZE_MIN_EDGE = 16
export const PROGRAM_SIZE_MAX_EDGE = 8192

const edge = z
  .number()
  .int()
  .min(PROGRAM_SIZE_MIN_EDGE)
  .max(PROGRAM_SIZE_MAX_EDGE)

export const programSizeSchema = z
  .object({ width: edge, height: edge })
  .strict()

/**
 * The size a config declares, or undefined when it declares none (or one that
 * does not validate: a reader never guesses from a malformed size).
 */
export function programSize(config: unknown): ProgramSize | undefined {
  if (typeof config !== 'object' || config === null) return undefined
  const parsed = programSizeSchema.safeParse(
    (config as { size?: unknown }).size,
  )
  return parsed.success ? parsed.data : undefined
}

/** Rounds to the nearest even integer, never below 2 (H.264 needs even edges). */
export function evenEdge(n: number): number {
  return Math.max(2, Math.round(n / 2) * 2)
}

export interface ResolvedOutputSize extends ProgramSize {
  /**
   * Where the pixels came from: both edges given (`flags`), one edge given and
   * the other derived from the aspect (`derived`), the program's own size
   * (`declared`), or the caller's default for a program that declares none
   * (`default`).
   */
  source: 'flags' | 'derived' | 'declared' | 'default'
}

/**
 * Output pixels for a render of a program.
 *
 * - Both edges given: used as given.
 * - One edge given: the other follows the declared aspect (else the
 *   fallback's), rounded to even.
 * - Neither: the declared size, else the fallback.
 */
export function resolveOutputSize(opts: {
  declared?: ProgramSize
  width?: number
  height?: number
  fallback: ProgramSize
}): ResolvedOutputSize {
  const { declared, width, height, fallback } = opts
  const basis = declared ?? fallback
  const aspect = basis.width / basis.height
  if (width !== undefined && height !== undefined)
    return {
      width: Math.round(width),
      height: Math.round(height),
      source: 'flags',
    }
  if (width !== undefined)
    return {
      width: Math.round(width),
      height: evenEdge(width / aspect),
      source: 'derived',
    }
  if (height !== undefined)
    return {
      width: evenEdge(height * aspect),
      height: Math.round(height),
      source: 'derived',
    }
  return declared
    ? { ...declared, source: 'declared' }
    : { ...fallback, source: 'default' }
}

/**
 * Scales a size down (never up) so it fits within edge caps, keeping its
 * aspect. Caps are LONG and SHORT edges, so a portrait size fits the same
 * budget as its landscape twin: 1080x1920 fits a 1920/1080 cap as is.
 */
export function fitWithinEdges(
  size: ProgramSize,
  caps: { long: number; short: number },
): ProgramSize {
  const long = Math.max(size.width, size.height)
  const short = Math.min(size.width, size.height)
  const k = Math.min(1, caps.long / long, caps.short / short)
  if (k === 1) return { width: size.width, height: size.height }
  return { width: evenEdge(size.width * k), height: evenEdge(size.height * k) }
}

/** The ratio in lowest terms, e.g. `9:16` for 1080x1920. */
export function aspectLabel(size: ProgramSize): string {
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b))
  const g = gcd(size.width, size.height)
  return `${size.width / g}:${size.height / g}`
}
