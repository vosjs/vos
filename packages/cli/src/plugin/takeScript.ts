/**
 * The script travels with the take. `actions.json` is what makes a take
 * re-recordable, and a take fetched from vos.so used to come home without
 * it, so nobody but the directory's owner could ever record it again.
 * `vos push` embeds the script in the document (`source.script`) and
 * `vos fetch --media` / `vos pull --media` write it back beside the
 * recording — never over a script already on disk, which is the person's
 * working copy.
 *
 * The pure halves (`scriptFromText`, `scriptToWrite`) are unit-tested; the
 * two I/O wrappers are a read and a write.
 */
import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ProjectDoc } from '@vosjs/studio-core'

/** The script as an object, or null for anything that is not one. */
export function scriptFromText(text: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(text) as unknown
    return v && typeof v === 'object' && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

/**
 * The bytes to write as actions.json beside a fetched take, or null: the
 * document carries no script, or one is already on disk.
 */
export function scriptToWrite(
  doc: Pick<ProjectDoc, 'source'>,
  hasLocal: boolean,
): string | null {
  const script = doc.source.script
  if (hasLocal || !script || typeof script !== 'object') return null
  return `${JSON.stringify(script, null, 2)}\n`
}

/** Embed the take directory's actions.json into the document about to be pushed. */
export function embedScript(doc: ProjectDoc, dir: string): void {
  const path = join(dir, 'actions.json')
  if (!existsSync(path)) return
  const script = scriptFromText(readFileSync(path, 'utf8'))
  if (script) doc.source.script = script
}

/** Write the document's script beside the take when none is there; true when written. */
export async function writeScriptBeside(
  dir: string,
  doc: Pick<ProjectDoc, 'source'>,
): Promise<boolean> {
  const path = join(dir, 'actions.json')
  const text = scriptToWrite(doc, existsSync(path))
  if (text === null) return false
  await writeFile(path, text, 'utf8')
  return true
}

/** Read a take's script, or null when there is none. */
export async function readScript(
  dir: string,
): Promise<Record<string, unknown> | null> {
  const path = join(dir, 'actions.json')
  if (!existsSync(path)) return null
  return scriptFromText(await readFile(path, 'utf8'))
}
