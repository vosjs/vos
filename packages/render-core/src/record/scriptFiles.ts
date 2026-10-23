/**
 * The files a script names beside itself, read before the take: a drag's
 * path file (points as JSON) and a paste's file (its bytes). The host
 * hands in where they come from (`ScriptFiles`); the names are plain file
 * names, checked by `validateActions`, so a script can only name what sits
 * next to it.
 */
import type { ActionsFile } from './actions'
import { fileNameProblem, scriptFiles } from './actions'
import type { ScriptFiles } from './driver'
import { readPath } from './gestures'
import type { PathPoint, PathSample } from './gestures'
import { PASTE_MAX_BYTES, pasteTypeOf } from './paste'

export interface LoadedFiles {
  /** a drag's path, read from its file, by step index */
  paths: Map<number, { points: PathSample[]; timed: boolean }>
  /** a paste's file, by step index */
  pastes: Map<number, { bytes: Uint8Array; type: string; name: string }>
}

/**
 * Read every file the script names. Answers the files, or the problem in
 * words (the step, the file, what is wrong) for the caller to refuse the
 * take with.
 */
export async function loadScriptFiles(
  actions: Pick<ActionsFile, 'steps'>,
  source: ScriptFiles | undefined,
): Promise<LoadedFiles | { problem: string }> {
  const loaded: LoadedFiles = { paths: new Map(), pastes: new Map() }
  const named = scriptFiles(actions)
  if (!named.length) return loaded
  if (!source) {
    const f = named[0]
    return {
      problem: `steps[${f.step}] names the file "${f.name}", and this recorder has no actions directory to read it from${f.as === 'path' ? ': write the points inline as path' : ''}. Nothing was recorded.`,
    }
  }
  for (const f of named) {
    const at = `steps[${f.step}]`
    const bad = fileNameProblem(f.name)
    if (bad) return { problem: `${at}: ${bad}. Nothing was recorded.` }
    let bytes: Uint8Array
    try {
      bytes = await source.read(f.name)
    } catch (e) {
      const why = e instanceof Error ? e.message : String(e)
      return {
        problem:
          f.as === 'paste'
            ? `${at} pastes the file "${f.name}", which could not be read beside the actions file (${why}): a file paste needs its file beside the script, so put ${f.name} next to it (a take fetched from vos.so carries its paths and its words, never a pasted file). Nothing was recorded.`
            : `${at} names "${f.name}", which could not be read beside the actions file (${why}). Nothing was recorded.`,
      }
    }
    if (f.as === 'path') {
      let raw: unknown
      try {
        raw = JSON.parse(new TextDecoder().decode(bytes))
      } catch {
        return {
          problem: `${at}: the path file "${f.name}" is not JSON (an array of [x, y] or [x, y, tMs] points). Nothing was recorded.`,
        }
      }
      const path = readPath(raw)
      if ('problems' in path)
        return {
          problem: `${at}: the path file "${f.name}" ${path.problems.join('; ')}. Nothing was recorded.`,
        }
      loaded.paths.set(f.step, path)
    } else {
      if (bytes.length > PASTE_MAX_BYTES)
        return {
          problem: `${at}: "${f.name}" is larger than ${PASTE_MAX_BYTES / 1024 / 1024} MB, more than a paste carries. Nothing was recorded.`,
        }
      loaded.pastes.set(f.step, {
        bytes,
        type: pasteTypeOf(f.name) ?? 'application/octet-stream',
        name: f.name,
      })
    }
  }
  return loaded
}

/** A read path as inline points: its own times when it had them, its pressure when it carried one. */
export function inlinePoints(path: {
  points: PathSample[]
  timed: boolean
}): PathPoint[] {
  return path.points.map((p): PathPoint => {
    if (path.timed)
      return p.pressure !== undefined
        ? [p.x, p.y, p.at, p.pressure]
        : [p.x, p.y, p.at]
    return p.pressure !== undefined
      ? { x: p.x, y: p.y, pressure: p.pressure }
      : [p.x, p.y]
  })
}

/**
 * The script as it ran, self-contained: every path a file held is written
 * inline, so the script a take keeps (and the one a push embeds, a fetch
 * writes back and a hosted recorder runs) re-records the same strokes with
 * the file gone. A paste's file stays a name: it is bytes, kept beside the
 * script by the host.
 */
export function inlineScript<T extends Pick<ActionsFile, 'steps'>>(
  actions: T,
  files: LoadedFiles,
): T {
  if (!files.paths.size) return actions
  return {
    ...actions,
    steps: actions.steps.map((s, i) => {
      const read = files.paths.get(i)
      if (s.do !== 'drag' || typeof s.path !== 'string' || !read) return s
      return { ...s, path: inlinePoints(read) }
    }),
  }
}
