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
  vosConfigJsonSchema,
} from '@vosjs/core'
import { lintVosConfig, lintVosDialect } from '@vosjs/core/lint'

export interface CheckIssue {
  level: 'error' | 'warn'
  source: 'schema' | 'syntax' | 'compile' | 'determinism' | 'dialect' | 'shape'
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
    issues.push({ level: 'error', source: 'shape', message: 'not a JSON object' })
    return finish(null)
  }

  // API endpoints wrap the config: { config: {...} } — accept both shapes.
  let obj = parsed as Record<string, unknown>
  if (typeof obj.config === 'object' && obj.config !== null && !('createTimeline' in obj)) {
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
  if (version !== CURRENT_CONFIG_VERSION) {
    issues.push({
      level: 'warn',
      source: 'shape',
      message: `config is v${String(version ?? 1)} — migrated to v${CURRENT_CONFIG_VERSION}; save the migrated form`,
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
  const known = new Set([...Object.keys(vosConfigJsonSchema.shape), ...PLATFORM_EXTRA_KEYS])
  for (const key of Object.keys(migrated)) {
    if (!known.has(key)) {
      issues.push({
        level: 'warn',
        source: 'shape',
        message: `unknown top-level key "${key}" — the platform drops it on push`,
      })
    }
  }

  // Function strings are pasted into the template as text, so the compiler
  // cannot see a syntax error — parse each one here (construction only,
  // nothing executes).
  let syntaxErrors = 0
  for (const key of ['setup', 'createContent', 'createTimeline', 'onFrame'] as const) {
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

  for (const i of lintVosConfig(migrated as never)) {
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

  return finish(migrated)
}
