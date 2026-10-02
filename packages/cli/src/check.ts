/**
 * `vos check` — the local validation pipeline, pure so it can be unit-tested:
 * envelope unwrap → migrate → schema → compile → determinism + dialect lints.
 * Everything runs locally (no network, no browser). The platform runs the
 * same compiler server-side, so a clean check is a push that will compile.
 */
import {
  CURRENT_CONFIG_VERSION,
  compileVosConfig,
  migrateConfig,
  programSize,
  vosConfigJsonSchema,
} from '@vosjs/core'
import {
  lintVosConfig,
  lintVosDialect,
  lintVosAssets,
  lintVosFonts,
  lintVosPostprocessing,
} from '@vosjs/core/lint'
import { STUDIO_ENTRY_ID } from '@vosjs/studio-core'
import { knobWarnings } from './plugin/knobs'

export interface CheckIssue {
  level: 'error' | 'warn'
  source:
    | 'schema'
    | 'syntax'
    | 'compile'
    | 'determinism'
    | 'dialect'
    | 'shape'
    | 'fonts'
    | 'assets'
    | 'postprocessing'
  message: string
}

export interface CheckResult {
  ok: boolean
  errors: number
  warnings: number
  issues: CheckIssue[]
  /** The migrated config (params/presets untouched) — what a push should send. */
  config: Record<string, unknown> | null
}

// Top-level keys the schema does not know but the platform preserves on push.
const PLATFORM_EXTRA_KEYS = new Set(['params', 'presets'])

export function runCheck(parsed: unknown): CheckResult {
  const issues: CheckIssue[] = []
  const finish = (config: Record<string, unknown> | null): CheckResult => {
    const errors = issues.filter((i) => i.level === 'error').length
    return {
      ok: errors === 0,
      errors,
      warnings: issues.length - errors,
      issues,
      config,
    }
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    issues.push({
      level: 'error',
      source: 'shape',
      message: 'not a JSON object',
    })
    return finish(null)
  }

  // API endpoints wrap the config: { config: {...} } — accept both shapes.
  let obj = parsed as Record<string, unknown>
  if (
    typeof obj.config === 'object' &&
    obj.config !== null &&
    !('createTimeline' in obj)
  ) {
    obj = obj.config as Record<string, unknown>
  }

  const version = obj.version
  let migrated: Record<string, unknown>
  try {
    migrated = migrateConfig(obj) as Record<string, unknown>
  } catch (e) {
    issues.push({
      level: 'error',
      source: 'shape',
      message: `migration failed: ${e instanceof Error ? e.message : String(e)}`,
    })
    return finish(null)
  }
  if (version === undefined) {
    // It compiles (the engine reads an absent version as the current one),
    // but a push is refused: a stored config must say which schema era it was
    // written against, and nobody can tell that from the file later.
    issues.push({
      level: 'warn',
      source: 'shape',
      message: `config declares no "version". It plays here, but a push is refused without one. Add "version": ${CURRENT_CONFIG_VERSION}.`,
    })
  } else if (version !== CURRENT_CONFIG_VERSION) {
    issues.push({
      level: 'warn',
      source: 'shape',
      message: `config is v${String(version)}, migrated to v${CURRENT_CONFIG_VERSION}. Save the migrated form.`,
    })
  }

  const schema = vosConfigJsonSchema.safeParse(migrated)
  if (!schema.success) {
    for (const i of schema.error.issues.slice(0, 10)) {
      issues.push({
        level: 'error',
        source: 'schema',
        message: `${i.path.join('.') || '(root)'}: ${i.message}`,
      })
    }
    return finish(null)
  }

  // Keys the platform's schema will silently drop on push (params/presets
  // excepted — those are re-attached by contract).
  const known = new Set([
    ...Object.keys(vosConfigJsonSchema.shape),
    ...PLATFORM_EXTRA_KEYS,
  ])
  for (const key of Object.keys(migrated)) {
    if (!known.has(key)) {
      issues.push({
        level: 'warn',
        source: 'shape',
        message: `unknown top-level key "${key}" — the platform drops it on push`,
      })
    }
  }

  // A declared size with an odd edge renders, but an MP4 (H.264) cannot
  // carry it: say so before an export does.
  const size = programSize(migrated)
  if (size && (size.width % 2 || size.height % 2)) {
    issues.push({
      level: 'warn',
      source: 'shape',
      message: `size ${size.width}x${size.height} has an odd edge; an MP4 needs even edges, so pick ${size.width + (size.width % 2)}x${size.height + (size.height % 2)}`,
    })
  }

  // Knobs and Looks vos.so would drop (the push still saves, without them).
  for (const message of knobWarnings(migrated as Record<string, unknown>)) {
    issues.push({ level: 'warn', source: 'shape', message })
  }

  // Sound as an ELEMENT is not a track: no timeline row, no gain or fades,
  // nothing a render mixes, and a `data:` source inflates the config past
  // what a claimable push can carry. The document is where sound goes.
  const elements = Array.isArray(migrated.elements) ? migrated.elements : []
  for (const el of elements) {
    if (!el || typeof el !== 'object') continue
    const e = el as { type?: unknown; id?: unknown; src?: unknown }
    if (e.type !== 'audio') continue
    const inline =
      typeof e.src === 'string' && e.src.startsWith('data:')
        ? ` (embedded, ${Math.round(e.src.length / 1024)} KB of config)`
        : ''
    issues.push({
      level: 'warn',
      source: 'shape',
      message: `audio element "${String(e.id ?? '?')}"${inline} is not a track: renders do not mix it and the studio cannot edit it. Put the file beside the config and name it in doc.json (audio: [{ key: "score.ogg", start, in, out, duration, gain }]); vos push uploads it`,
    })
  }

  // Function strings are pasted into the template as text, so the compiler
  // cannot see a syntax error — parse each one here (construction only,
  // nothing executes).
  let syntaxErrors = 0
  for (const key of [
    'setup',
    'createContent',
    'createTimeline',
    'onFrame',
  ] as const) {
    const src = migrated[key]
    if (typeof src !== 'string' || !src.length) continue
    try {
      new Function(`"use strict"; return (${src}\n)`)
    } catch (e) {
      syntaxErrors++
      issues.push({
        level: 'error',
        source: 'syntax',
        message: `${key}: ${e instanceof Error ? e.message : String(e)}`,
      })
    }
  }
  if (syntaxErrors) return finish(migrated)

  try {
    // Same options as `vos render` — a clean check is a config the CLI's own
    // render path will accept.
    compileVosConfig(migrated as never, { tweenEngine: 'vos' })
  } catch (e) {
    issues.push({
      level: 'error',
      source: 'compile',
      message: e instanceof Error ? e.message : String(e),
    })
    return finish(migrated)
  }

  // The studio's own layers ride a program document's composed config as a
  // stack entry: machinery the author did not write, tested where it lives.
  // Its lines are not the author's, so they never reach the author's check.
  for (const i of lintVosConfig(migrated as never)) {
    if (i.entry === STUDIO_ENTRY_ID) continue
    issues.push({
      level: i.severity === 'error' ? 'error' : 'warn',
      source: 'determinism',
      message: `${i.fn}:${i.line} [${i.rule}] ${i.message}`,
    })
  }
  for (const i of lintVosDialect(migrated as never)) {
    issues.push({
      level: i.severity === 'error' ? 'error' : 'warn',
      source: 'dialect',
      message: `${i.fn}:${i.line} [${i.rule}] ${i.message}`,
    })
  }
  for (const i of lintVosFonts(migrated as never)) {
    issues.push({
      level: 'warn',
      source: 'fonts',
      message: `[${i.rule}] ${i.message}`,
    })
  }
  for (const i of lintVosAssets(migrated as never)) {
    issues.push({
      level: i.severity === 'error' ? 'error' : 'warn',
      source: 'assets',
      message: `[${i.rule}] ${i.message}`,
    })
  }
  for (const i of lintVosPostprocessing(migrated as never)) {
    issues.push({
      level: 'warn',
      source: 'postprocessing',
      message: `[${i.rule}] ${i.message}`,
    })
  }

  return finish(migrated)
}
