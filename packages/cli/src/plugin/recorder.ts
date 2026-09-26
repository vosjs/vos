/**
 * The recorder, as the CLI runs it: the mechanism lives in
 * `@vosjs/render-core/record` (AN4, host-free: a structural driver, a frame
 * sink, no filesystem); this wraps it with a take DIRECTORY, the shell's
 * env for a setup's `{ env }` texts, and this machine's platform, and
 * writes the same four files it always wrote (cursor.json, meta.json,
 * frames.json, actions.json), byte for byte.
 */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { recordTake as recordTakeCore } from '@vosjs/render-core/record'
import type { RecordOpts as CoreRecordOpts } from '@vosjs/render-core/record'
import type { Browser, BrowserContext } from 'playwright'
import { writeJson } from './take'
import type { ActionsFile } from './actions'
import type { TakePaths } from './take'

export type {
  FrameRec,
  FreezeSpan,
  RecordResult,
  SkippedStep,
} from '@vosjs/render-core/record'

export type RecordOpts = Omit<
  CoreRecordOpts,
  'context' | 'env' | 'platform'
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
