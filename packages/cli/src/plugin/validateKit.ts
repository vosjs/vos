/**
 * `vos validate <kit.json>` — the kit's own verifier, run AFTER deliver (or
 * after a hand-assembled kit): every cut in the manifest must exist,
 * measure what the manifest claims, and meet its destination's spec (px,
 * bytes, duration). Reads dims and durations from the FILES, never from
 * intent, so a manifest that lies is caught. Pure over a directory: no
 * browser, no network.
 */
import { existsSync } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { dirname, isAbsolute, join } from 'node:path'
import { DESTINATIONS } from '@vosjs/studio-core'
import { pictureChecks } from './kitPicture'
import type { PictureAsset, PictureFinding } from './kitPicture'
import type { StillMeasure } from './picture'
import type { Destination } from '@vosjs/studio-core'

export interface KitAssetRecord {
  channel: string
  asset: string
  destination?: string
  path: string
  w: number
  h: number
  bytes: number
  seconds: number | null
  source?: string
}

export interface KitRecord {
  release?: string | null
  take?: string
  produced?: string
  skipped?: string[]
  assets: KitAssetRecord[]
}

export interface KitVerdict {
  valid: boolean
  problems: string[]
  warnings: string[]
  /**
   * The picture checks (`--picture`): every finding with a code, a
   * severity, a message, a fix hint and a box. An `error` finding fails
   * the verdict beside the spec problems; absent when the pass did not run.
   */
  picture?: PictureFinding[]
  /** Per asset, what the picture pass measured (null = unreadable). */
  pictureMeasured?: { destination: string; measure: StillMeasure | null }[]
  /** Per asset: what the file measured. */
  measured: {
    destination: string
    path: string
    w: number | null
    h: number | null
    bytes: number
    seconds: number | null
  }[]
}

/**
 * Video dims + duration through mediabunny (the render harness's own
 * demuxer), so a kit's mp4 is measured by the same library that wrote it.
 */
async function probeVideo(
  path: string,
): Promise<{ w: number; h: number; seconds: number } | null> {
  const MB = await import('mediabunny')
  const input = new MB.Input({
    formats: MB.ALL_FORMATS,
    source: new MB.BufferSource(new Uint8Array(await readFile(path))),
  })
  try {
    const track = await input.getPrimaryVideoTrack()
    if (!track) return null
    const seconds = await input.computeDuration()
    return { w: track.displayWidth, h: track.displayHeight, seconds }
  } finally {
    input.dispose()
  }
}

const specById = new Map<string, Destination>(
  DESTINATIONS.map((d) => [d.id, d]),
)

const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol

/**
 * Verify a kit manifest against the files beside it and the channel specs.
 * `kitPath` is the manifest's path; relative asset paths resolve against
 * its directory (the deliver output layout) or against `take`-relative
 * `media/kit/…` paths a hand-assembled PR kit uses.
 */
export async function validateKit(
  kitPath: string,
  opts: { picture?: boolean } = {},
): Promise<KitVerdict> {
  const problems: string[] = []
  const warnings: string[] = []
  const measured: KitVerdict['measured'] = []
  let kit: KitRecord
  try {
    kit = JSON.parse(await readFile(kitPath, 'utf8')) as KitRecord
  } catch (e) {
    return {
      valid: false,
      problems: [`${kitPath}: ${e instanceof Error ? e.message : String(e)}`],
      warnings,
      measured,
    }
  }
  if (!Array.isArray(kit.assets)) {
    return {
      valid: false,
      problems: [`${kitPath}: no assets[] in the manifest`],
      warnings,
      measured,
    }
  }
  const base = dirname(kitPath)
  const resolvePath = (p: string) => {
    // An absolute path from the machine that made the kit (a CI runner) is
    // honoured while it exists; a moved kit resolves beside its manifest.
    if (isAbsolute(p) && existsSync(p)) return p
    // A PR kit records paths as `media/kit/<name>`; the file sits beside the
    // manifest, so the last segment is what resolves.
    const beside = join(base, p.split('/').pop() ?? p)
    return beside
  }
  const pictureAssets: PictureAsset[] = []

  for (const a of kit.assets) {
    const id = a.destination ?? `${a.channel}-${a.asset}`
    const label = `${a.channel} ${a.asset}`
    const file = resolvePath(a.path)
    let bytes: number
    try {
      bytes = (await stat(file)).size
    } catch {
      problems.push(`${label}: ${a.path} is missing`)
      continue
    }
    if (bytes !== a.bytes)
      problems.push(
        `${label}: manifest says ${a.bytes} bytes, the file is ${bytes}`,
      )
    const spec = specById.get(id)
    let w: number | null = null
    let h: number | null = null
    let seconds: number | null = null
    if (/\.(mp4|webm|mov)$/i.test(file)) {
      try {
        const v = await probeVideo(file)
        if (!v) problems.push(`${label}: ${a.path} has no video track`)
        else {
          w = v.w
          h = v.h
          seconds = v.seconds
          if (w !== a.w || h !== a.h)
            problems.push(
              `${label}: manifest says ${a.w}x${a.h}, the file is ${w}x${h}`,
            )
          if (a.seconds === null || !near(seconds, a.seconds, 0.25))
            problems.push(
              `${label}: manifest says ${a.seconds ?? 'no'} s, the file is ${seconds.toFixed(2)} s`,
            )
        }
      } catch (e) {
        problems.push(
          `${label}: could not read ${a.path} (${e instanceof Error ? e.message : String(e)})`,
        )
      }
    } else {
      warnings.push(`${label}: ${a.path} is not a video the kit verifies`)
    }
    measured.push({ destination: id, path: a.path, w, h, bytes, seconds })
    pictureAssets.push({
      destination: id,
      path: a.path,
      file,
      seconds,
    })

    if (!spec) {
      if (a.channel !== 'demo')
        warnings.push(
          `${label}: no channel spec for "${id}" — not verified against one`,
        )
      continue
    }
    if (w !== null && h !== null && (w !== spec.px.w || h !== spec.px.h))
      problems.push(
        `${label}: spec wants ${spec.px.w}x${spec.px.h}, the file is ${w}x${h}`,
      )
    if (spec.maxBytes !== undefined && bytes > spec.maxBytes)
      problems.push(
        `${label}: ${Math.ceil(bytes / 1024)} KB exceeds the ${Math.floor(spec.maxBytes / 1024)} KB ceiling`,
      )
    if (seconds !== null) {
      if (spec.minSeconds !== undefined && seconds < spec.minSeconds - 0.25)
        problems.push(
          `${label}: spec wants at least ${spec.minSeconds} s, the file is ${seconds.toFixed(1)} s`,
        )
      if (spec.maxSeconds !== undefined && seconds > spec.maxSeconds + 0.25)
        problems.push(
          `${label}: spec caps at ${spec.maxSeconds} s, the file is ${seconds.toFixed(1)} s`,
        )
    }
  }

  if (!opts.picture) {
    return { valid: problems.length === 0, problems, warnings, measured }
  }
  const picture = await pictureChecks(pictureAssets)
  const pictureErrors = picture.findings.filter((f) => f.severity === 'error')
  return {
    valid: problems.length === 0 && pictureErrors.length === 0,
    problems,
    warnings,
    measured,
    picture: picture.findings,
    pictureMeasured: picture.measured,
  }
}
