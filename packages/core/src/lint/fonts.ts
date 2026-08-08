/**
 * Font-declaration linter.
 *
 * Canvas text silently falls back to a default font when a family isn't
 * loaded, and headless render environments have near-zero system fonts — so a
 * text element using a non-generic family without a matching `config.fonts`
 * declaration renders differently in a fresh browser than on the author's
 * machine. Surfaced as warnings; never throws.
 */
import type { VosConfigJson } from '../types'

export type FontRule = 'undeclared-family'
export type FontSeverity = 'warn'

export interface FontIssue {
  rule: FontRule
  severity: FontSeverity
  /** Element id (or `element_<index>`). */
  elementId: string
  /** The first family token of the element's font stack. */
  family: string
  message: string
}

/** CSS generic + universally-safe keywords that need no declaration. */
const GENERIC_FAMILIES = new Set([
  'system-ui',
  'sans-serif',
  'serif',
  'monospace',
  'cursive',
  'fantasy',
  'math',
  'emoji',
  'fangsong',
  'ui-sans-serif',
  'ui-serif',
  'ui-monospace',
  'ui-rounded',
  '-apple-system',
])

function firstFamilyToken(stack: string): string {
  const first = stack.split(',')[0] ?? ''
  return first.trim().replace(/^['"]|['"]$/g, '')
}

export function lintVosFonts(config: VosConfigJson): FontIssue[] {
  const issues: FontIssue[] = []
  const elements = Array.isArray(config.elements) ? config.elements : []
  const declared = new Set(
    (Array.isArray(config.fonts) ? config.fonts : [])
      .map((f) => (typeof f?.family === 'string' ? f.family.toLowerCase() : ''))
      .filter(Boolean),
  )

  elements.forEach((el: any, index: number) => {
    if (el?.type !== 'text') return
    const stack = el.font?.family
    if (typeof stack !== 'string' || !stack.trim()) return
    const family = firstFamilyToken(stack)
    if (!family || GENERIC_FAMILIES.has(family.toLowerCase())) return
    if (declared.has(family.toLowerCase())) return
    issues.push({
      rule: 'undeclared-family',
      severity: 'warn',
      elementId: el.id ?? `element_${index}`,
      family,
      message: `text element "${el.id ?? `element_${index}`}" uses family "${family}" with no matching config.fonts declaration — headless renders will fall back to a default font. Declare { family, url } in config.fonts (catalog: https://vos.so/api/fonts).`,
    })
  })

  return issues
}
