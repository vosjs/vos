/**
 * Manifest linter (`config.assets`).
 *
 * A program reads a declared file as `ctx.assets.<name>`, and an element,
 * object or font names one as the string `"$assets.<name>"`. Both fail
 * quietly when the name is not in the manifest: the function gets
 * `undefined` and the string is drawn as a URL that does not exist. This
 * says so before a render does not.
 *
 * It also reports a declared file nothing reads, which is usually a rename
 * that reached one side only. Function strings are scanned by pattern, so a
 * name read some other way (a computed key, a helper) can be reported as
 * unused: that one is a warning, never an error.
 */
import type { VosConfigJson } from '../types'

export type AssetRule = 'undeclared-asset' | 'unused-asset'
export type AssetSeverity = 'error' | 'warn'

export interface AssetIssue {
  rule: AssetRule
  severity: AssetSeverity
  /** The manifest name the issue is about. */
  name: string
  /** Where it was read: a function field, or a path into the config. */
  where: string
  message: string
}

const FUNCTION_FIELDS = [
  'setup',
  'createContent',
  'createTimeline',
  'onFrame',
] as const

/** `assets.logo`, `assets?.logo`, `assets['logo']`, `assets["logo"]`. */
const READ_IN_CODE =
  /\bassets\s*(?:\?\.|\.)\s*([A-Za-z_][A-Za-z0-9_]*)|\bassets\s*(?:\?\.)?\[\s*['"]([A-Za-z_][A-Za-z0-9_]*)['"]\s*\]/g
/** `const { logo, photos: p } = ctx.assets` */
const DESTRUCTURED = /\{([^{}]*)\}\s*=\s*(?:ctx\s*\.\s*)?assets\b/g
const BOUND_STRING = /^\$assets\.([A-Za-z_][A-Za-z0-9_]*)(?:\[\d+\])?$/

function namesReadIn(source: string): string[] {
  const names: string[] = []
  for (const m of source.matchAll(READ_IN_CODE)) names.push(m[1] ?? m[2])
  for (const m of source.matchAll(DESTRUCTURED)) {
    for (const part of m[1].split(',')) {
      const name = part.split(':')[0].split('=')[0].trim()
      if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) names.push(name)
    }
  }
  return names
}

function walkStrings(
  value: unknown,
  path: string,
  visit: (s: string, path: string) => void,
): void {
  if (typeof value === 'string') return visit(value, path)
  if (Array.isArray(value)) {
    value.forEach((v, i) => walkStrings(v, `${path}[${i}]`, visit))
    return
  }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      walkStrings(v, path ? `${path}.${k}` : k, visit)
    }
  }
}

export function lintVosAssets(config: VosConfigJson): AssetIssue[] {
  const issues: AssetIssue[] = []
  const declared = new Set(Object.keys(config.assets ?? {}))
  const read = new Set<string>()

  const sources: [string, string][] = []
  for (const field of FUNCTION_FIELDS) {
    const src = config[field]
    if (typeof src === 'string') sources.push([field, src])
  }
  for (const entry of config.stack ?? []) {
    for (const field of ['setup', 'createContent', 'onFrame'] as const) {
      const src = entry[field]
      if (typeof src === 'string')
        sources.push([`stack.${entry.id}.${field}`, src])
    }
  }
  for (const [where, src] of sources) {
    for (const name of namesReadIn(src)) {
      read.add(name)
      if (!declared.has(name)) {
        issues.push({
          rule: 'undeclared-asset',
          // A pattern match in code can be some other object named `assets`.
          severity: 'warn',
          name,
          where,
          message: `${where} reads assets.${name}, which config.assets does not declare`,
        })
      }
    }
  }

  // Declarations are data: a "$assets.<name>" string there is exact.
  for (const field of ['elements', 'objects', 'fonts'] as const) {
    walkStrings(config[field], field, (s, where) => {
      const m = BOUND_STRING.exec(s)
      if (!m) return
      read.add(m[1])
      if (!declared.has(m[1])) {
        issues.push({
          rule: 'undeclared-asset',
          severity: 'error',
          name: m[1],
          where,
          message: `${where} is "${s}", but config.assets declares no "${m[1]}": it would be drawn as a URL that does not exist`,
        })
      }
    })
  }

  for (const name of declared) {
    if (read.has(name)) continue
    issues.push({
      rule: 'unused-asset',
      severity: 'warn',
      name,
      where: `assets.${name}`,
      message: `config.assets declares "${name}" and nothing reads it (ctx.assets.${name}, or "$assets.${name}" in an element)`,
    })
  }
  return issues
}

export function hasAssetErrors(issues: readonly AssetIssue[]): boolean {
  return issues.some((i) => i.severity === 'error')
}
