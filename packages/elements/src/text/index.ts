/**
 * Styled text, as the engine understands it: what a run is and every edit
 * made to a list of them (`runs`), how runs are laid out into lines,
 * fragments and animated units (`layout`), and where a caret stands on
 * what was laid out (`caret`).
 *
 * Everything here is pure: no DOM, no three, measurement handed in. The
 * renderer in this package paints from it, a host picks and edits with it,
 * and a plain node test runs the same functions over the same rules.
 */
export {
  layoutText,
  decorationRect,
  graphemesOf,
  tokenRanges,
  UNDERLINE_OFFSET_EM,
  STRIKE_OFFSET_EM,
  DECORATION_THICKNESS_EM,
  HIGHLIGHT_HALF_EM,
} from './layout'
export type {
  Fragment,
  LayoutInput,
  LayoutLine,
  LayoutRun,
  LayoutUnit,
  Measure,
  RunStyle,
  TextLayout,
  Unit,
} from './layout'
export {
  caretAt,
  caretStops,
  lineOfOffset,
  offsetAtX,
  rangeRects,
} from './caret'
export type { CaretStop } from './caret'
export {
  MIXED,
  RUN_STYLE_KEYS,
  clearStyle,
  commonStyle,
  diffInput,
  layoutLines,
  normalizeRuns,
  plainText,
  replaceRange,
  runsOf,
  setStyle,
  sliceRuns,
  snapOffset,
  styleAt,
  styleOf,
  toRichText,
  toggleStyle,
} from './runs'
export type { RichText, RunStyleKey, TextRun, TextRunStyle } from './runs'
