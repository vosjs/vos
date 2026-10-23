/**
 * The recorder, as the CLI runs it: the mechanism lives in
 * `@vosjs/render-core/record` (AN4, host-free: a structural driver, a frame
 * sink, no filesystem); this wraps it with a take DIRECTORY, the shell's
 * env for a setup's `{ env }` texts, and this machine's platform, and
 * writes the same four files it always wrote (cursor.json, meta.json,
 * frames.json, actions.json), byte for byte, plus `outputs/<name>` for every
 * file a `download` step kept and `page-sound/<name>` for every sound the
 * page was heard playing.
 */
import { writeFileSync } from 'node:fs'
import { lstat, mkdir, readFile, realpath } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import {
  fileNameProblem,
  inlineScript,
  loadScriptFiles,
  recordTake as recordTakeCore,
} from '@vosjs/render-core/record'
import type {
  OutputSink,
  RecordOpts as CoreRecordOpts,
  SoundSink,
  ScriptFiles,
} from '@vosjs/render-core/record'
import type { Browser, BrowserContext } from 'playwright'
import { writeJson } from './take'
import { looksLikeStorageState } from './session'
import { refuseSymlink, writeFileSafe } from './safeWrite'
import type { ActionsFile } from './actions'
import type { TakePaths } from './take'

export type {
  DisabledClick,
  FrameRec,
  FreezeSpan,
  RecordResult,
  SkippedStep,
  StoppedTake,
} from '@vosjs/render-core/record'

/** The take's `outputs/`: where a `download` step's file lands, and nowhere else. */
export function outputsSink(dir: string): OutputSink {
  const outDir = join(dir, 'outputs')
  return {
    save: async (name, bytes) => {
      // The recorder names the file; a name that is not plain never
      // reaches the disk, whoever chose it.
      const problem = fileNameProblem(name)
      if (problem) throw new Error(`outputs/${name}: ${problem}`)
      await refuseSymlink(outDir)
      await mkdir(outDir, { recursive: true })
      await writeFileSafe(join(outDir, name), bytes)
    },
  }
}

/** The take's `page-sound/`: the sound the page played, keyed take-relative for the plan's clips. */
export const PAGE_SOUND_DIR = 'page-sound'

export function pageSoundSink(dir: string): SoundSink {
  const soundDir = join(dir, PAGE_SOUND_DIR)
  return {
    save: async (name, bytes) => {
      const problem = fileNameProblem(name)
      if (problem) throw new Error(`${PAGE_SOUND_DIR}/${name}: ${problem}`)
      await refuseSymlink(soundDir)
      await mkdir(soundDir, { recursive: true })
      await writeFileSafe(join(soundDir, name), bytes)
      return `${PAGE_SOUND_DIR}/${name}`
    },
  }
}

/**
 * The files a script names beside itself (a drag's path, a paste's file):
 * a plain name in the actions file's own directory, never a link, never a
 * path that resolves outside it, whoever wrote the name.
 */
export function actionsDirFiles(dir: string): ScriptFiles {
  return {
    read: async (name) => {
      const problem = fileNameProblem(name)
      if (problem) throw new Error(problem)
      const file = join(dir, name)
      if ((await lstat(file)).isSymbolicLink())
        throw new Error(
          `${name} is a symbolic link, which a script never follows`,
        )
      const [real, root] = await Promise.all([realpath(file), realpath(dir)])
      if (!real.startsWith(root + sep))
        throw new Error(`${name} resolves outside the actions file's directory`)
      return new Uint8Array(await readFile(real))
    },
  }
}

/**
 * Where a peer's `storageState` is read from: a path from the actions
 * file's directory (or an absolute one), to a regular file shaped like a
 * Playwright storage state. The file is opened by the browser and nothing
 * else: never copied into a take, never uploaded, never printed.
 */
export function peerStateFrom(dir: string): (name: string) => Promise<string> {
  return async (name) => {
    const file = resolve(dir, name)
    let raw: string
    try {
      raw = await readFile(file, 'utf8')
    } catch {
      throw new Error(
        `there is no file at ${file}; a storage state is never copied into a take, so name it by a path from the actions file (or an absolute one, such as one saved under ~/.config/vos)`,
      )
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      parsed = null
    }
    if (!looksLikeStorageState(parsed))
      throw new Error(
        `${file} is not a Playwright storage state ({ cookies, origins }); save one with context.storageState({ path })`,
      )
    return file
  }
}

/** The name a pasted file is kept under in the take: `paste-<name>`, once. */
export const pasteCopyName = (name: string): string =>
  name.startsWith('paste-') ? name : `paste-${name}`

/**
 * Copy every file a `paste` step names into the take, under
 * `paste-<name>`, and point the script at the copy: the take's own
 * actions.json then re-records on this machine with the original gone. A
 * paste's bytes never travel inside the script itself (a push embeds the
 * script, not the file).
 */
export async function keepPasteFiles(
  actions: ActionsFile,
  actionsDir: string,
  takeDir: string,
): Promise<ActionsFile> {
  if (!actions.steps.some((s) => s.do === 'paste' && s.file)) return actions
  const files = actionsDirFiles(actionsDir)
  const steps = await Promise.all(
    actions.steps.map(async (s) => {
      if (s.do !== 'paste' || !s.file) return s
      const name = pasteCopyName(s.file)
      const same = resolve(actionsDir) === resolve(takeDir) && name === s.file
      if (!same)
        await writeFileSafe(join(takeDir, name), await files.read(s.file))
      return { ...s, file: name }
    }),
  )
  return { ...actions, steps }
}

/**
 * The script a hosted recorder runs: every path a file held written
 * inline, since the script travels alone. A paste is left as it is for the
 * hosted refusal to name.
 */
export async function scriptForHost(
  actions: ActionsFile,
  actionsDir: string,
): Promise<ActionsFile> {
  const pathsOnly = {
    steps: actions.steps.map((s) =>
      s.do === 'paste' ? ({ do: 'wait', ms: 0 } as const) : s,
    ),
  }
  const files = await loadScriptFiles(pathsOnly, actionsDirFiles(actionsDir))
  if ('problem' in files) throw new Error(files.problem)
  return inlineScript(actions, files)
}

export type RecordOpts = Omit<
  CoreRecordOpts,
  'context' | 'env' | 'platform' | 'outputs' | 'sounds' | 'files'
> & {
  /**
   * The actions file's directory: where a drag's path file and a paste's
   * file are read from. Absent, a script that names one is refused.
   */
  actionsDir?: string
  /**
   * A ready-made context to record IN, instead of one made from `browser`:
   * `--session <name>`, a persistent profile the person signed in to.
   */
  context?: BrowserContext
}

export async function recordTake(
  browser: Browser,
  url: string,
  actions: ActionsFile,
  paths: TakePaths,
  log: (msg: string) => void,
  opts: RecordOpts = {},
): Promise<import('@vosjs/render-core/record').RecordResult> {
  const dry = opts.dryRun === true
  const result = await recordTakeCore(
    browser,
    url,
    actions,
    {
      frame: (file, bytes) => {
        writeFileSync(join(paths.framesDir, file), bytes)
      },
    },
    log,
    {
      ...opts,
      outputs: outputsSink(paths.dir),
      sounds: pageSoundSink(paths.dir),
      ...(opts.actionsDir
        ? {
            files: actionsDirFiles(opts.actionsDir),
            peerStorageState: peerStateFrom(opts.actionsDir),
          }
        : {}),
      env: process.env,
      platform:
        process.platform === 'darwin'
          ? 'mac'
          : process.platform === 'win32'
            ? 'windows'
            : 'linux',
    },
  )
  // A rehearsal writes nothing: the take beside it keeps its footage, its
  // cut and its script exactly as they were.
  if (!dry) {
    // The script as it ran, self-contained: paths are inline (the
    // recorder's), and a pasted file is kept beside it under its own name.
    if (opts.actionsDir)
      result.actions = await keepPasteFiles(
        result.actions,
        opts.actionsDir,
        paths.dir,
      )
    await writeJson(paths.cursor, result.events)
    await writeJson(paths.meta, result.meta, true)
    await writeJson(paths.framesIndex, result.frames)
    await writeJson(paths.actions, result.actions, true)
  }
  return result
}
