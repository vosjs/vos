/**
 * The retired `*marked*` emphasis, read into runs.
 *
 * A text layer used to say `emphasis: { weight?, color? }` and wrap words in
 * asterisks: each marked word was set in the emphasis weight. That was
 * markup inside the words. A layer now carries runs, and this is the one
 * place that still knows the old spelling: it turns a layer that carries
 * `emphasis` into the runs it painted as (each marked word a run in the
 * resolved weight, and the colour when the layer named one), unescapes
 * `\*`, and drops the field. A layer without `emphasis` is left exactly as
 * it is, asterisks included: that is what it painted.
 *
 * Idempotent, and a document with nothing to migrate comes back as the
 * same object, so identity checks hold.
 */
import { boldWeightFor, snapRunWeight } from '../overlayText'
import { normalizeRuns } from './runs'
import type { ProjectDoc, TextOverlayClip } from '../types'
import type { TextRun } from './runs'

/** A text layer as it was written before runs. */
type LegacyTextClip = Omit<TextOverlayClip, 'text'> & {
  text: string
  emphasis?: { weight?: number; color?: string } | null
}

/**
 * One line's characters, each marked or not. A `*` pairs with the next `*`
 * on the same line around non-blank words; `\*` is a literal asterisk; a
 * lone `*` stays literal; a space is never marked (each word was its own
 * mark, which is what the runs must reproduce).
 */
function parseLine(line: string): { c: string; b: boolean }[] {
  const chars: string[] = []
  const marker: boolean[] = []
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '\\' && line[i + 1] === '*') {
      chars.push('*')
      marker.push(false)
      i++
    } else {
      chars.push(line[i])
      marker.push(line[i] === '*')
    }
  }
  const keep = chars.map(() => true)
  const bold: boolean[] = []
  for (let i = 0; i < chars.length; i++) {
    if (!marker[i]) continue
    let j = i + 1
    while (j < chars.length && !marker[j]) j++
    if (j >= chars.length) break
    if (
      !chars
        .slice(i + 1, j)
        .join('')
        .trim()
    ) {
      i = j - 1
      continue
    }
    keep[i] = false
    keep[j] = false
    for (let k = i + 1; k < j; k++) bold[k] = true
    i = j
  }
  const out: { c: string; b: boolean }[] = []
  for (let i = 0; i < chars.length; i++) {
    if (keep[i]) out.push({ c: chars[i], b: !!bold[i] && !/\s/.test(chars[i]) })
  }
  return out
}

/** Does a legacy text mark any word? (The CLI's lint asks.) */
export function marksEmphasis(text: string): boolean {
  return text.split('\n').some((line) => parseLine(line).some((x) => x.b))
}

/** One layer: its `emphasis` read into runs. Others come back as they are. */
export function migrateTextClip(clip: TextOverlayClip): TextOverlayClip {
  const legacy = clip as unknown as LegacyTextClip
  if (!('emphasis' in legacy)) return clip
  const { emphasis, ...rest } = legacy
  const next = rest as unknown as TextOverlayClip
  // `emphasis: null` or a layer already in runs: only the field goes.
  if (!emphasis || typeof legacy.text !== 'string') return next
  const weight =
    emphasis.weight !== undefined
      ? snapRunWeight(next, emphasis.weight)
      : boldWeightFor(next)
  const runs: TextRun[] = []
  legacy.text.split('\n').forEach((line, li) => {
    if (li > 0) runs.push({ text: '\n' })
    for (const { c, b } of parseLine(line)) {
      runs.push(
        b
          ? {
              text: c,
              weight,
              ...(emphasis.color ? { color: emphasis.color } : {}),
            }
          : { text: c },
      )
    }
  })
  return { ...next, text: normalizeRuns(runs) }
}

/** A document's text layers, each read out of the old spelling. */
export function migrateText<T extends Pick<ProjectDoc, 'overlays'>>(doc: T): T {
  const overlays = Array.isArray(doc.overlays) ? doc.overlays : []
  const legacy = overlays.some((o) => o.kind === 'text' && 'emphasis' in o)
  if (!legacy) return doc
  return {
    ...doc,
    overlays: overlays.map((o) => (o.kind === 'text' ? migrateTextClip(o) : o)),
  }
}
