/**
 * `vos look --app <name> --app <name> …`: see a STAGE before scripting it.
 *
 * One picture of the stage as a take would show it (only the named apps'
 * windows, where they are), and each app's outline: every control with one
 * proposed selector. A step of a stage's script says which app it acts on,
 * so the listing is by app. Nothing is pressed.
 */
import { mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { strFlag } from './args'
import { appControl, appControlLine, unbuiltLine, withinLimit } from './lookApp'
import { EXIT_OK } from './output'
import {
  ACCESSIBILITY_FOR_SCRIPT,
  SCREEN_RECORDING,
  driverFailure,
} from './recordApp'
import { SCRIPTED_STAGE_NEEDS_DRIVER, listed } from './recordStage'
import type { createReporter } from './output'
import type { DesktopDriver } from './recordApp'
import type { StillResult } from '@vosjs/driver'

/** A stage's picture, as a driver that knows one answers. */
type StageStill = StillResult & {
  apps?: { name: string; id: string }[]
  windows?: {
    id: number
    app: string
    pid: number
    x: number
    y: number
    w: number
    h: number
  }[]
}

export async function lookStage(a: {
  apps: string[]
  flags: Record<string, string | true>
  driver: DesktopDriver
  r: ReturnType<typeof createReporter>
}): Promise<number> {
  const { apps, flags, driver, r } = a
  const granted = await driver.check().catch((error) => {
    throw driverFailure(error)
  })
  if (!granted.screenRecording) throw new Error(SCREEN_RECORDING)
  if (!granted.accessibility) throw new Error(ACCESSIBILITY_FOR_SCRIPT)

  const outDir = resolve(strFlag(flags, 'out') ?? 'look')
  await mkdir(outDir, { recursive: true })
  const screenshot = join(outDir, 'look.png')

  let shot: StageStill
  const outlines: Awaited<ReturnType<DesktopDriver['tree']>>[] = []
  try {
    // Read as a driver of any version takes it: one from before stages has
    // no stage among what it can picture.
    const still = driver.still as unknown as (request: {
      apps: string[]
      out: string
    }) => Promise<StageStill>
    shot = await still({ apps, out: screenshot })
    if (!shot.windows) throw new Error(SCRIPTED_STAGE_NEEDS_DRIVER)
    for (const app of apps) outlines.push(await driver.tree({ app }))
  } catch (error) {
    if (error instanceof Error && error.message === SCRIPTED_STAGE_NEEDS_DRIVER)
      throw error
    const e = error as { code?: string; message?: string }
    if (
      e.code === 'bad-request' &&
      /names no (target|window)/.test(e.message ?? '')
    )
      throw new Error(SCRIPTED_STAGE_NEEDS_DRIVER)
    throw driverFailure(error)
  }

  const size = `${Math.round(shot.frame.w)}×${Math.round(shot.frame.h)}`
  const listing = outlines.map((outline, i) => {
    const all = outline.elements.map(appControl)
    const controls = withinLimit(all)
    return {
      // The name the stage was given, which is what a step's `app` says.
      app: apps[i]!,
      name: outline.app,
      kind: outline.kind,
      built: outline.built,
      window: outline.window,
      controls,
      more: all.length - controls.length,
    }
  })
  r.done(
    {
      ok: true,
      stage: {
        apps,
        frame: { w: shot.frame.w, h: shot.frame.h },
        windows: shot.windows,
      },
      screenshot,
      apps: listing,
    },
    [
      `Looked at a stage of ${listed(apps)} (${size} points): ${screenshot}`,
      ...listing.flatMap((l) => [
        '',
        `${l.app} (window ${Math.round(l.window.w)}×${Math.round(l.window.h)} points): ${l.controls.length} control${l.controls.length === 1 ? '' : 's'}${l.more > 0 ? `, ${l.more} past the listing's limit` : ''}`,
        ...(!l.built ? [unbuiltLine(l.kind, l.name)] : []),
        ...l.controls.map(appControlLine),
      ]),
      '',
      `A step of a stage's script says which app it acts on: { "do": "click", "app": "${apps[0]}", "selector": "…" }; one that says none stays with the app of the step before it. A point (x, y) is in that app's own window. Then record: vos record --actions actions.json, with "apps": ${JSON.stringify(apps)} in the script`,
    ].join('\n'),
  )
  return EXIT_OK
}
