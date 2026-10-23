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
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import {
  fileNameProblem,
  recordTake as recordTakeCore,
} from '@vosjs/render-core/record'
import type {
  OutputSink,
  RecordOpts as CoreRecordOpts,
  SoundSink,
} from '@vosjs/render-core/record'
import type { Browser, BrowserContext } from 'playwright'
import { writeJson } from './take'
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

export type RecordOpts = Omit<
  CoreRecordOpts,
  'context' | 'env' | 'platform' | 'outputs' | 'sounds'
> & {
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
    await writeJson(paths.cursor, result.events)
    await writeJson(paths.meta, result.meta, true)
    await writeJson(paths.framesIndex, result.frames)
    await writeJson(paths.actions, result.actions, true)
  }
  return result
}
