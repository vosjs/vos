import { readFile } from 'node:fs/promises'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import {
  CURRENT_CONFIG_VERSION,
  migrateConfig,
  vosConfigJsonSchema,
} from '@vosjs/core'
import { UsageError } from './args'

export interface LoadedConfig {
  config: Record<string, unknown>
  warnings: string[]
}

/**
 * What a directory holds, by one deterministic sniff and never a flag:
 * a TAKE carries a recording document (`doc.json` with `source`); a PROGRAM
 * directory carries `config.json`, optionally beside a program document
 * (`doc.json` without `source`: the shared layers, the tween overlay, the
 * program's own length, with `program.config` omitted on disk). An unparsable
 * doc.json counts as a take so the take path reports the real error.
 */
export type DirectoryKind = 'take' | 'program' | 'none'

export function directoryKind(target: string): DirectoryKind {
  try {
    if (!statSync(target).isDirectory()) return 'none'
  } catch {
    return 'none'
  }
  const docPath = join(target, 'doc.json')
  if (existsSync(docPath)) {
    try {
      const doc: unknown = JSON.parse(readFileSync(docPath, 'utf8'))
      if (typeof doc === 'object' && doc !== null && 'source' in doc)
        return 'take'
    } catch {
      return 'take'
    }
  }
  return existsSync(join(target, 'config.json')) ? 'program' : 'none'
}

/**
 * A program directory's config: `config.json`, composed with the program
 * document beside it when there is one (the layers ride as the studio stack
 * entry, the tween overlay is baked into `createTimeline`), so a render of
 * the directory is a render of what the studio and vos.so play.
 */
export async function loadProgramDirectory(
  dir: string,
  warnings: string[],
): Promise<unknown> {
  const config: unknown = JSON.parse(
    await readFile(join(dir, 'config.json'), 'utf8'),
  )
  const docPath = join(dir, 'doc.json')
  if (!existsSync(docPath)) return config
  const doc: unknown = JSON.parse(await readFile(docPath, 'utf8'))
  if (typeof doc !== 'object' || doc === null || 'source' in doc) return config
  if (typeof config !== 'object' || config === null) {
    throw new UsageError(`${dir}/config.json does not contain a JSON object`)
  }
  const raw = doc as Record<string, unknown>
  const program =
    raw.program && typeof raw.program === 'object'
      ? (raw.program as Record<string, unknown>)
      : {}
  const { lowerProgramDoc } = await import('@vosjs/studio-core')
  const composed = lowerProgramDoc(
    { ...raw, program: { ...program, config } } as never,
    { bake: true },
  ).config
  warnings.push(
    'composed config.json with doc.json (a program document: its layers and tween edits ride the render)',
  )
  return composed
}

/**
 * The text of a config source: an http(s) URL or a file. A directory that is
 * neither a take nor a program directory is refused in words, since the raw
 * read would report a bare EISDIR.
 */
export async function readSourceText(source: string): Promise<string> {
  if (/^https?:\/\//.test(source)) {
    const res = await fetch(source)
    if (!res.ok) throw new Error(`fetch ${source} → ${res.status}`)
    return await res.text()
  }
  let isDir = false
  try {
    isDir = statSync(source).isDirectory()
  } catch {
    /* a missing path reads below and reports itself */
  }
  if (isDir) {
    throw new UsageError(
      `${source} is a directory with no config.json and no doc.json — pass a config file, a URL, a program directory or a take`,
    )
  }
  return await readFile(source, 'utf8')
}

/**
 * Load a VosConfigJson from a file path, an http(s) URL, or a program
 * directory (config.json, composed with a program document when one sits
 * beside it); unwrap API `{ config }` envelopes, migrate old versions, and
 * validate against the schema. A take directory is refused here in words:
 * takes render through the take pipeline (`vos render <take>`).
 */
export async function loadVosConfig(source: string): Promise<LoadedConfig> {
  const warnings: string[] = []
  let parsed: unknown
  const kind = /^https?:\/\//.test(source) ? 'none' : directoryKind(source)
  if (kind === 'take') {
    throw new UsageError(
      `${source} is a take (its doc.json is a recording document). Render it through the take pipeline: vos render ${source} [out]; vos frames ${source} for stills.`,
    )
  }
  if (kind === 'program') {
    parsed = await loadProgramDirectory(source, warnings)
    return finish(source, parsed, warnings)
  }
  const raw = await readSourceText(source)

  try {
    parsed = JSON.parse(raw)
  } catch (e) {
    throw new UsageError(`${source} is not valid JSON: ${(e as Error).message}`)
  }
  return finish(source, parsed, warnings)
}

function finish(
  source: string,
  parsed: unknown,
  warnings: string[],
): LoadedConfig {
  if (typeof parsed !== 'object' || parsed === null) {
    throw new UsageError(`${source} does not contain a JSON object`)
  }

  // API endpoints wrap the config: { config: {...} }.
  let obj = parsed as Record<string, unknown>
  if (
    typeof obj.config === 'object' &&
    obj.config !== null &&
    !('createTimeline' in obj)
  ) {
    obj = obj.config as Record<string, unknown>
    warnings.push('unwrapped { config } envelope')
  }

  const version = obj.version
  const migrated = migrateConfig(obj)
  if (version === undefined) {
    // Plays fine (the stamp happens above), but a storer refuses it.
    warnings.push(
      `config declares no "version". Add "version": ${CURRENT_CONFIG_VERSION} before pushing it.`,
    )
  } else if (version !== CURRENT_CONFIG_VERSION) {
    warnings.push(
      `migrated config v${String(version)} to v${CURRENT_CONFIG_VERSION}`,
    )
  }

  const check = vosConfigJsonSchema.safeParse(migrated)
  if (!check.success) {
    const issues = check.error.issues
      .slice(0, 5)
      .map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n')
    throw new UsageError(`invalid vos config:\n${issues}`)
  }

  return { config: migrated, warnings }
}

/** Best-effort duration from the config (seconds). */
export function configDuration(
  config: Record<string, unknown>,
): number | undefined {
  const d = config.duration
  return typeof d === 'number' && Number.isFinite(d) && d > 0 ? d : undefined
}
