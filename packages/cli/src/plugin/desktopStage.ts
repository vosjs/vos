/**
 * What a desktop script does to the app around its take: `setup` before,
 * `teardown` after, and the masks the take is recorded under.
 *
 * A desktop script presses the real app, so there is no page to throw
 * away: what a rehearsal typed is still in the field, what a take created
 * is still in the account. `setup` and `teardown` are the script's own way
 * to put the app where the take starts and back where it was. Both run OFF
 * CAMERA: a session of the driver whose footage is deleted, so the app is
 * brought forward and pressed exactly as a take presses it, and nothing of
 * it reaches the take.
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  TEARDOWN_BOUND_MS,
  runDesktopSetup,
  teardownEnvProblem,
} from '@vosjs/render-core/record'
import { UsageError } from './args'
import type { DesktopDriver } from './recordApp'
import type {
  ActionsFile,
  SetupResult,
  StepPhase,
  TeardownReport,
} from '@vosjs/render-core/record'
import type { RecordRequest } from '@vosjs/driver'

/** The record request's target: a window, a process, or an app. */
export type DesktopTargetRequest = Pick<RecordRequest, 'window' | 'pid' | 'app'>

/**
 * Why a selector is not one in the desktop dialect: the driver's own
 * check, or undefined when the driver here has none (before 0.4.0) or is
 * not installed. A test's driver hands in its own.
 */
export async function driverSelectorProblem(
  driver?: DesktopDriver,
): Promise<((selector: string) => string | null) | undefined> {
  if (driver) return driver.selectorProblem
  try {
    const mod = (await import('@vosjs/driver')) as {
      selectorProblem?: (selector: string) => string | null
    }
    return typeof mod.selectorProblem === 'function'
      ? mod.selectorProblem
      : undefined
  } catch {
    return undefined
  }
}

/**
 * What stands between a script's `mask`, `setup` or `teardown` and a take,
 * said before anything on the machine is touched.
 */
export function desktopStageProblem(
  actions: ActionsFile,
  canMask: boolean,
  env: Record<string, string | undefined> = process.env,
): string | null {
  if (actions.mask?.length && !canMask)
    return 'the script has a mask, and the @vosjs/driver installed here does not cover one: it would record what the mask names. Install @vosjs/driver 0.4.0 or later (npm i -D @vosjs/cli@latest). Nothing was recorded.'
  return teardownEnvProblem(actions.teardown, env)
}

/** The script's masks as the driver takes them: every match of each selector. */
export function driverMasks(
  actions: ActionsFile | undefined,
): { selector: string }[] | undefined {
  return actions?.mask?.length
    ? actions.mask.map((m) => ({ selector: m.selector }))
    : undefined
}

/**
 * Runs a script's `setup` or `teardown` against the app, off camera. Null
 * when the script has none.
 */
export async function offCamera(
  driver: DesktopDriver,
  target: DesktopTargetRequest,
  actions: ActionsFile,
  phase: StepPhase,
  log: (msg: string) => void,
): Promise<SetupResult | null> {
  const steps = actions[phase]
  if (!steps?.length) return null
  const scratch = await mkdtemp(join(tmpdir(), `vos-${phase}-`))
  try {
    const take = driver.record({
      ...target,
      out: scratch,
      drive: true,
      pointer: false,
      maxSeconds: Math.ceil(TEARDOWN_BOUND_MS / 1000) + 30,
      ...(actions.viewport
        ? { size: { w: actions.viewport.width, h: actions.viewport.height } }
        : {}),
    })
    try {
      await take.ready
      log(`${phase}: ${steps.length} step(s), off camera…`)
      return await runDesktopSetup(take, steps, phase, log, {
        env: process.env,
      })
    } finally {
      await take.stop().catch(() => {})
    }
  } finally {
    await rm(scratch, { recursive: true, force: true })
  }
}

/**
 * The setup, or a refusal: a take that begins where its setup stopped is
 * a take of the wrong screen.
 */
export async function desktopSetup(
  driver: DesktopDriver,
  target: DesktopTargetRequest,
  actions: ActionsFile,
  log: (msg: string) => void,
): Promise<void> {
  const done = await offCamera(driver, target, actions, 'setup', log)
  const f = done?.failed
  if (f)
    throw new UsageError(
      `setup stopped at setup[${f.step}] (${f.do}${f.selector ? ` ${f.selector}` : ''}): ${(f.error ?? 'it missed').replace(/[.\s]+$/, '')}. Nothing was recorded.`,
    )
}

/**
 * The teardown, as a report. It never throws: a take that is already in
 * its file is not failed by what could not be undone afterwards, and the
 * report says where it stopped.
 */
export async function desktopTeardown(
  driver: DesktopDriver,
  target: DesktopTargetRequest,
  actions: ActionsFile,
  log: (msg: string) => void,
): Promise<TeardownReport | undefined> {
  const of = actions.teardown?.length ?? 0
  if (!of) return undefined
  try {
    const done = await offCamera(driver, target, actions, 'teardown', log)
    if (!done) return undefined
    return {
      ran: done.ran,
      of,
      ...(done.failed
        ? {
            failed: {
              step: done.failed.step,
              do: done.failed.do,
              ...(done.failed.selector
                ? { selector: done.failed.selector }
                : {}),
              error: done.failed.error ?? 'it missed',
            },
          }
        : {}),
      ...(done.skipped ? { skipped: done.skipped } : {}),
    }
  } catch (error) {
    return {
      ran: 0,
      of,
      failed: {
        step: 0,
        do: actions.teardown![0]!.do,
        error: error instanceof Error ? error.message : String(error),
      },
    }
  }
}
