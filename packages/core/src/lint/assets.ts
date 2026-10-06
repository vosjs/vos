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
 *
 * Only CODE is scanned: the text of a string, a comment or a regex is not a
 * read (a URL on a host named `assets.` is the usual one), and neither is a
 * property of a local that happens to be called `assets`.
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

/** `const assets = …`, unless what it is given is the manifest itself. */
const LOCAL_ASSETS =
  /\b(?:var|let|const)\s+assets\b(?!\s*=\s*[A-Za-z_$][\w$]*\s*(?:\?\.|\.)\s*assets\b)/g

/** A `/` after one of these opens a regex; after anything else it divides. */
const BEFORE_REGEX = new Set('(,=:[!&|?{};+-*%<>~^')
const WORD_BEFORE_REGEX = new Set([
  'return',
  'typeof',
  'case',
  'in',
  'of',
  'delete',
  'void',
  'throw',
  'new',
  'else',
  'do',
])
const isWordChar = (c: string) => /[A-Za-z0-9_$]/.test(c)

/**
 * Which characters of a function string are CODE: 0 inside a string, the
 * text of a template, a comment or a regex literal, 1 everywhere else (a
 * template's `${ … }` is code). One pass, every character visited a
 * bounded number of times, so its cost is the length of what it is given.
 */
export function codeMask(src: string): Uint8Array {
  const n = src.length
  const mask = new Uint8Array(n)
  // The brace depth each open template interpolation started at: the `}`
  // that returns to that depth goes back to the template's text.
  const templates: number[] = []
  let depth = 0
  // The last code character that is not whitespace, and where it is.
  let prev = ''
  let prevAt = -1
  // After a `/` that turned out to open nothing, no other on its line does.
  let noRegexBefore = 0

  const quoted = (from: number, quote: string): number => {
    let j = from + 1
    while (j < n) {
      const c = src[j]
      if (c === '\\') j += 2
      else if (c === quote) return j + 1
      else if (c === '\n') return j
      else j++
    }
    return n
  }
  const templateText = (from: number): number => {
    let j = from
    while (j < n) {
      const c = src[j]
      if (c === '\\') j += 2
      else if (c === '`') return j + 1
      else if (c === '$' && src[j + 1] === '{') {
        templates.push(depth)
        return j + 2
      } else j++
    }
    return n
  }
  const opensRegex = (): boolean => {
    if (!prev) return true
    if (!isWordChar(prev)) return BEFORE_REGEX.has(prev)
    let a = prevAt
    while (a > 0 && isWordChar(src[a - 1])) a--
    return WORD_BEFORE_REGEX.has(src.slice(a, prevAt + 1))
  }
  /** The index past a regex literal starting at `from`, or -1 for none. */
  const regex = (from: number): number => {
    let j = from + 1
    let inClass = false
    while (j < n) {
      const c = src[j]
      if (c === '\\') j += 2
      else if (c === '\n') break
      else if (c === '[') {
        inClass = true
        j++
      } else if (c === ']') {
        inClass = false
        j++
      } else if (c === '/' && !inClass) {
        j++
        while (j < n && /[a-z]/.test(src[j])) j++
        return j
      } else j++
    }
    noRegexBefore = Math.min(j, n)
    return -1
  }

  let i = 0
  while (i < n) {
    const c = src[i]
    const d = src[i + 1]
    if (c === '/' && d === '/') {
      while (i < n && src[i] !== '\n') i++
      continue
    }
    if (c === '/' && d === '*') {
      const end = src.indexOf('*/', i + 2)
      i = end < 0 ? n : end + 2
      continue
    }
    if (c === "'" || c === '"') {
      i = quoted(i, c)
      prev = c
      prevAt = i - 1
      continue
    }
    if (c === '`') {
      i = templateText(i + 1)
      prev = '`'
      prevAt = i - 1
      continue
    }
    if (c === '/' && i >= noRegexBefore && opensRegex()) {
      const end = regex(i)
      if (end > 0) {
        i = end
        // What follows a regex is an operator or a method, never another.
        prev = ')'
        prevAt = i - 1
        continue
      }
    }
    if (c === '{') depth++
    else if (c === '}') {
      if (templates.length && templates[templates.length - 1] === depth) {
        templates.pop()
        i = templateText(i + 1)
        prev = '`'
        prevAt = i - 1
        continue
      }
      depth--
    }
    mask[i] = 1
    if (c !== ' ' && c !== '\n' && c !== '\t' && c !== '\r') {
      prev = c
      prevAt = i
    }
    i++
  }
  return mask
}

/** True when the character before `at` (whitespace aside) is a `.`. */
function isProperty(source: string, at: number): boolean {
  let j = at - 1
  while (j >= 0 && /\s/.test(source[j])) j--
  return j >= 0 && source[j] === '.'
}

function namesReadIn(source: string): string[] {
  const names: string[] = []
  const code = codeMask(source)
  // A local of the same name is not the manifest: its properties are its
  // own (`const assets = []; assets.push(…)`). `x.assets.<name>` still is.
  let local = false
  for (const m of source.matchAll(LOCAL_ASSETS)) {
    if (code[m.index]) local = true
  }
  for (const m of source.matchAll(READ_IN_CODE)) {
    if (!code[m.index]) continue
    if (local && !isProperty(source, m.index)) continue
    names.push(m[1] ?? m[2])
  }
  for (const m of source.matchAll(DESTRUCTURED)) {
    if (!code[m.index]) continue
    if (local && !/ctx\s*\.\s*assets$/.test(m[0])) continue
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
