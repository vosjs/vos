/**
 * Determinism linter for VosConfigJson function-strings.
 *
 * Frame-stepped export requires that rendering be a pure function of timeline
 * time: same `t` → same pixels. These rules flag the common determinism-breakers
 * that silently corrupt export (non-seedable randomness, wall-clock, timers,
 * network). Surfaced as issues; never throws on its own.
 *
 * Suppress a single line with `// vos-lint-disable-next-line <rule>` (e.g. when
 * you have seeded `Math.random` yourself).
 */
import type { VosConfigJson } from '../types'

export type DeterminismRule =
  | 'random'
  | 'gsap-random'
  | 'gsap-string-random'
  | 'wall-clock'
  | 'timer'
  | 'network'

export type DeterminismSeverity = 'error' | 'warn'

export interface DeterminismIssue {
  fn: 'setup' | 'createContent' | 'createTimeline' | 'onFrame'
  rule: DeterminismRule
  severity: DeterminismSeverity
  /** The offending snippet. */
  match: string
  /** Character offset within the function string. */
  index: number
  /** 1-based line within the function string. */
  line: number
  message: string
}

interface RuleDef {
  rule: DeterminismRule
  severity: DeterminismSeverity
  pattern: RegExp
  message: string
}

// Patterns are intentionally simple/robust. Comment & string-literal false
// positives are acceptable at `warn`; `error` rules target unambiguous calls.
const RULES: RuleDef[] = [
  {
    rule: 'random',
    severity: 'error',
    pattern: /\bMath\.random\s*\(/g,
    message: 'Math.random() is non-deterministic — seed it or precompute values.',
  },
  {
    rule: 'gsap-random',
    severity: 'error',
    pattern: /\bgsap\.utils\.random\s*\(/g,
    message: 'gsap.utils.random() is not seedable — breaks reproducible export.',
  },
  {
    // GSAP interprets string-form values like { x: 'random(-100, 100)' } or
    // 'random([1, 2, 3])' as non-seedable randomness. Invisible to gsap-random.
    rule: 'gsap-string-random',
    severity: 'error',
    pattern: /["']random\s*[([]/g,
    message:
      "String-form random() tween value is non-seedable — breaks reproducible export. Precompute values instead.",
  },
  {
    // stagger: { from: 'random' } shuffles start order non-deterministically.
    rule: 'gsap-string-random',
    severity: 'error',
    pattern: /\bfrom\s*:\s*["']random["']/g,
    message:
      "stagger from:'random' is non-seedable — breaks reproducible export. Use a numeric or index-based stagger.",
  },
  {
    rule: 'wall-clock',
    severity: 'error',
    pattern: /\b(?:Date\.now\s*\(|new\s+Date\s*\(|performance\.now\s*\()/g,
    message: 'Wall-clock time is non-deterministic — use the timeline (ctx.time / progress).',
  },
  {
    rule: 'timer',
    severity: 'warn',
    pattern: /\b(?:setTimeout|setInterval|requestAnimationFrame)\s*\(/g,
    message: 'Timers/rAF are not driven by the timeline — state may differ across export frames.',
  },
  {
    rule: 'network',
    severity: 'warn',
    pattern: /\b(?:fetch\s*\(|XMLHttpRequest\b|WebSocket\b)/g,
    message: 'Network access at render time is non-deterministic — load assets in setup().',
  },
]

export const FN_KEYS = ['setup', 'createContent', 'createTimeline', 'onFrame'] as const

export function lineOf(src: string, index: number): number {
  let line = 1
  for (let i = 0; i < index && i < src.length; i++) if (src[i] === '\n') line++
  return line
}

/** Lines suppressed by a preceding `// vos-lint-disable-next-line <rule|all>`. */
export function suppressedLines(src: string): Map<number, Set<string>> {
  const out = new Map<number, Set<string>>()
  const lines = src.split('\n')
  const re = /\/\/\s*vos-lint-disable-next-line\s*([\w-]*)/
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(re)
    if (m) {
      const target = i + 2 // next line is 1-based i+2
      if (!out.has(target)) out.set(target, new Set())
      out.get(target)!.add(m[1] || 'all')
    }
  }
  return out
}

function lintFunctionString(
  fn: (typeof FN_KEYS)[number],
  src: string,
): DeterminismIssue[] {
  const issues: DeterminismIssue[] = []
  const suppressed = suppressedLines(src)
  for (const def of RULES) {
    def.pattern.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = def.pattern.exec(src)) !== null) {
      const line = lineOf(src, m.index)
      const sup = suppressed.get(line)
      if (sup && (sup.has(def.rule) || sup.has('all'))) continue
      issues.push({
        fn,
        rule: def.rule,
        severity: def.severity,
        match: m[0],
        index: m.index,
        line,
        message: def.message,
      })
    }
  }
  return issues
}

/**
 * Lint a VosConfigJson's function-strings for determinism hazards.
 * Returns all issues (errors + warnings); never throws.
 */
export function lintVosConfig(config: VosConfigJson): DeterminismIssue[] {
  const issues: DeterminismIssue[] = []
  const record = config as unknown as Record<string, unknown>
  for (const key of FN_KEYS) {
    const src = record[key]
    if (typeof src === 'string' && src.length) {
      issues.push(...lintFunctionString(key, src))
    }
  }
  return issues
}

/** Convenience: true if any `error`-severity issue is present. */
export function hasDeterminismErrors(issues: DeterminismIssue[]): boolean {
  return issues.some((i) => i.severity === 'error')
}
