/**
 * Dialect-subset linter for VosConfigJson `createTimeline` (and related) strings.
 *
 * The vos tween dialect is a deliberately frozen subset of the GSAP timeline API —
 * the surface an alternate deterministic backend (`@vosjs/tween`) is expected to
 * reproduce, and the surface a per-element timeline extractor can structure. These
 * rules reject GSAP features OUTSIDE that subset so authored/LLM-generated configs
 * cannot drift beyond what the sampler implements and the editor can represent.
 *
 * This is separate from `determinism.ts`: a config can be perfectly deterministic on
 * real GSAP (e.g. a `modifiers` callback) yet still be off-dialect. See
 * `DIALECT.md` for the human-readable spec and the rationale per rule.
 *
 * Suppress a single line with `// vos-lint-disable-next-line <rule|all>` (same
 * mechanism as the determinism linter).
 */
import type { VosConfigJson } from '../types'
import { FN_KEYS, lineOf, suppressedLines } from './determinism'

export type DialectRule =
  | 'plugin'
  | 'modifiers'
  | 'dom-target'
  | 'playback-control'
  | 'repeat-refresh'
  | 'immediate-render'
  | 'snap'
  | 'unknown-ease'

export type DialectSeverity = 'error' | 'warn'

export interface DialectIssue {
  fn: (typeof FN_KEYS)[number]
  rule: DialectRule
  severity: DialectSeverity
  /** The offending snippet. */
  match: string
  /** Character offset within the function string. */
  index: number
  /** 1-based line within the function string. */
  line: number
  message: string
}

interface RuleDef {
  rule: DialectRule
  severity: DialectSeverity
  pattern: RegExp
  message: string
}

/**
 * GSAP plugins & non-core add-ons. None are in the dialect: plugin effects should
 * be absorbed as vos element capabilities driven by numeric props (e.g. DrawSVG →
 * element `drawStart`/`drawEnd`), never admitted into the tween surface.
 */
const PLUGIN_NAMES = [
  'ScrollTrigger',
  'ScrollSmoother',
  'MorphSVGPlugin',
  'MorphSVG',
  'DrawSVGPlugin',
  'DrawSVG',
  'MotionPathPlugin',
  'MotionPathHelper',
  'Physics2DPlugin',
  'PhysicsPropsPlugin',
  'PixiPlugin',
  'TextPlugin',
  'ScrambleTextPlugin',
  'SplitText', // vos has native split via element `split` config — do not use the plugin
  'Flip',
  'Observer',
  'Draggable',
  'InertiaPlugin',
  'EaselPlugin',
  'GSDevTools',
  'CustomEase',
  'CustomBounce',
  'CustomWiggle',
]

const RULES: RuleDef[] = [
  {
    rule: 'plugin',
    severity: 'error',
    pattern: /\bgsap\.registerPlugin\s*\(/g,
    message:
      'GSAP plugins are outside the vos tween dialect — plugin effects belong as element capabilities (numeric props), not tweens.',
  },
  {
    rule: 'plugin',
    severity: 'error',
    pattern: new RegExp(`\\b(?:${PLUGIN_NAMES.join('|')})\\b`, 'g'),
    message:
      'This GSAP plugin is outside the vos tween dialect. See DIALECT.md for the supported surface and the element-capability alternative.',
  },
  {
    // ModifiersPlugin ships in GSAP core (so it "works"), but it is per-tick
    // post-processing with vars-ordering semantics the sampler must not clone.
    rule: 'modifiers',
    severity: 'error',
    pattern: /\bmodifiers\s*:/g,
    message:
      "modifiers is outside the dialect — compute derived properties in onUpdate from the tweened driver instead.",
  },
  {
    // First arg to .to/.from/.fromTo/.set is a string literal → DOM/selector target
    // (CSSPlugin territory). Dialect targets must be plain objects / element props.
    rule: 'dom-target',
    severity: 'error',
    pattern: /\.(?:to|from|fromTo|set)\s*\(\s*['"`]/g,
    message:
      'String/selector tween targets are outside the dialect — tween plain objects, element `props`, or THREE object properties.',
  },
  {
    rule: 'playback-control',
    severity: 'error',
    pattern: /\b(?:addPause\s*\(|\.tweenTo\s*\(|\.tweenFrom\s*\()/g,
    message:
      'Playback-control calls (addPause/tweenTo) break seek-driven determinism — the engine owns transport.',
  },
  {
    rule: 'repeat-refresh',
    severity: 'error',
    pattern: /\brepeatRefresh\s*:/g,
    message:
      'repeatRefresh re-evaluates values per iteration (iteration-dependent under scrub) — outside the dialect.',
  },
  {
    rule: 'snap',
    severity: 'error',
    pattern: /\bsnap\s*:/g,
    message: 'snap is per-tick post-processing — precompute snapped values instead.',
  },
  {
    rule: 'immediate-render',
    severity: 'warn',
    pattern: /\bimmediateRender\s*:/g,
    message:
      'Explicit immediateRender overrides GSAP default render-on-add semantics — the sampler implements defaults only.',
  },
]

/**
 * Ease families the vendored evaluator (`@vosjs/timeline` EASINGS) implements
 * with verified GSAP curve parity. Parameterized forms are supported for
 * `back(overshoot)`, `elastic(amplitude, period)` and `steps(n)`; anything
 * else (`rough`, `slow`, `expoScale`, CustomEase, …) would silently fall back
 * to linear — flag it so that never ships.
 */
const SUPPORTED_EASE_FAMILIES = new Set([
  'none',
  'linear',
  'power1',
  'power2',
  'power3',
  'power4',
  'sine',
  'expo',
  'circ',
  'back',
  'elastic',
  'bounce',
])

/** Families whose parameterized form the evaluator implements. */
const PARAMETERIZABLE = new Set(['back', 'elastic', 'steps'])

// Capture the string value of `ease: '<name>'` (single or double quoted).
const EASE_RE = /\bease\s*:\s*['"]([^'"]+)['"]/g
// `family[.direction][(args)]` — mirrors @vosjs/timeline's resolveEase grammar.
const EASE_EXPR = /^([a-zA-Z0-9]+)(?:\.(in|out|inOut))?(?:\(([^)]*)\))?$/

function easeSupported(raw: string): boolean {
  const m = EASE_EXPR.exec(raw)
  if (!m) return false
  const [, family, , argsRaw] = m
  if (argsRaw !== undefined) {
    if (!PARAMETERIZABLE.has(family)) return false
    const args = argsRaw.split(',').map((s) => Number(s.trim()))
    return args.length > 0 && args.every((a) => Number.isFinite(a))
  }
  if (family === 'steps') return false // steps requires (n)
  return SUPPORTED_EASE_FAMILIES.has(family)
}

function lintEases(
  fn: (typeof FN_KEYS)[number],
  src: string,
  suppressed: Map<number, Set<string>>,
): DialectIssue[] {
  const issues: DialectIssue[] = []
  EASE_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = EASE_RE.exec(src)) !== null) {
    const raw = m[1].trim()
    if (easeSupported(raw)) continue
    const line = lineOf(src, m.index)
    const sup = suppressed.get(line)
    if (sup && (sup.has('unknown-ease') || sup.has('all'))) continue
    issues.push({
      fn,
      rule: 'unknown-ease',
      severity: 'warn',
      match: m[0],
      index: m.index,
      line,
      message: `Ease "${raw}" is outside the supported set (families: ${[...SUPPORTED_EASE_FAMILIES].join(', ')}; parameterized: back/elastic/steps) — would fall back to linear.`,
    })
  }
  return issues
}

function lintFunctionString(
  fn: (typeof FN_KEYS)[number],
  src: string,
): DialectIssue[] {
  const issues: DialectIssue[] = []
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
  issues.push(...lintEases(fn, src, suppressed))
  return issues
}

/**
 * Lint a VosConfigJson's function-strings against the frozen tween dialect.
 * Returns all issues (errors + warnings); never throws.
 */
export function lintVosDialect(config: VosConfigJson): DialectIssue[] {
  const issues: DialectIssue[] = []
  const record = config as unknown as Record<string, unknown>
  for (const key of FN_KEYS) {
    const src = record[key]
    if (typeof src === 'string' && src.length) {
      issues.push(...lintFunctionString(key, src))
    }
  }
  return issues
}

/** Convenience: true if any `error`-severity dialect issue is present. */
export function hasDialectErrors(issues: DialectIssue[]): boolean {
  return issues.some((i) => i.severity === 'error')
}
