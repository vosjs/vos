/**
 * `vos validate <kit.json>` — the kit's own verifier, run AFTER deliver (or
 * after a hand-assembled kit): every asset in the manifest must exist, be
 * what its name says (a `.png` that is really WebP is the classic miss),
 * measure what the manifest claims, and meet its destination's spec (px,
 * bytes, duration, count). Reads dims and durations from the FILES, never
 * from intent, so a manifest that lies is caught the way a still that lies
 * is. Pure over a directory: no browser, no network.
 */
import { existsSync } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { dirname, isAbsolute, join } from 'node:path'
import { DESTINATIONS } from '@vosjs/studio-core'
import { pictureChecks } from './kitPicture'
import type { PictureAsset, PictureFinding, TextBox } from './kitPicture'
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
  frameTime?: number | null
  source?: string
  /**
   * Where the words are, as fractions of the asset (the poster leg records
   * the element layout it rendered): what the sliced, safe and contrast
   * checks read. Absent on a take frame, whose page text is unknown.
   */
  text?: TextBox[]
  /** A screenshot rendered with the cut's camera and chrome (--composed). */
  composed?: boolean
  /** A poster card's shot placement, fractions of the asset. */
  shot?: { x: number; y: number; w: number; h: number }
  /** A tile: the shot is a close CROP of the page's hero, past the frame by design. */
  crop?: boolean
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

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** PNG dims from the IHDR chunk, or null when the bytes are not a PNG. */
export function pngDimensions(bytes: Buffer): { w: number; h: number } | null {
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(PNG_SIG)) return null
  if (bytes.toString('ascii', 12, 16) !== 'IHDR') return null
  return { w: bytes.readUInt32BE(16), h: bytes.readUInt32BE(20) }
}

/** What a file's leading bytes say it is, for the "named .png, is WebP" miss. */
export function sniffImage(bytes: Buffer): 'png' | 'webp' | 'jpeg' | 'unknown' {
  if (bytes.subarray(0, 8).equals(PNG_SIG)) return 'png'
  if (
    bytes.length >= 12 &&
    bytes.toString('ascii', 0, 4) === 'RIFF' &&
    bytes.toString('ascii', 8, 12) === 'WEBP'
  )
    return 'webp'
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8) return 'jpeg'
  return 'unknown'
}

/**
 * Video dims + duration through mediabunny (the render harness's own
 * demuxer), so a kit's mp4 is measured by the same library that wrote it.
 * Loaded lazily: a stills-only kit never pays for it.
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
  const perDestination = new Map<string, number>()
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
    perDestination.set(id, (perDestination.get(id) ?? 0) + 1)
    if (bytes !== a.bytes)
      problems.push(
        `${label}: manifest says ${a.bytes} bytes, the file is ${bytes}`,
      )
    const spec = specById.get(id)
    let w: number | null = null
    let h: number | null = null
    let seconds: number | null = null
    if (/\.(png|jpe?g|webp)$/i.test(file)) {
      const head = Buffer.from(await readFile(file))
      const kind = sniffImage(head)
      if (file.toLowerCase().endsWith('.png') && kind !== 'png')
        problems.push(
          `${label}: ${a.path} is named .png but its bytes are ${kind} — stores refuse a mislabelled image`,
        )
      const dims = kind === 'png' ? pngDimensions(head) : null
      if (dims) {
        w = dims.w
        h = dims.h
        if (w !== a.w || h !== a.h)
          problems.push(
            `${label}: manifest says ${a.w}x${a.h}, the file is ${w}x${h}`,
          )
      } else if (kind === 'png') {
        problems.push(`${label}: ${a.path} has no readable IHDR`)
      }
    } else if (/\.(mp4|webm|mov)$/i.test(file)) {
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
      warnings.push(
        `${label}: ${a.path} is not an image or video the kit verifies`,
      )
    }
    measured.push({ destination: id, path: a.path, w, h, bytes, seconds })
    pictureAssets.push({
      destination: id,
      path: a.path,
      file,
      spec,
      text: a.text,
      seconds,
      composed: a.composed,
      shot: a.source === 'poster' || a.source === 'stage' ? a.shot : undefined,
      crop: a.crop,
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
    if (spec.format === 'png' && !file.toLowerCase().endsWith('.png'))
      warnings.push(
        `${label}: spec renders png, the file is ${file.split('.').pop()}`,
      )
  }

  for (const [id, n] of perDestination) {
    const spec = specById.get(id)
    if (spec?.count && (n < spec.count.min || n > spec.count.max))
      problems.push(
        `${spec.channel} ${spec.asset}: spec wants ${spec.count.min}-${spec.count.max}, the kit has ${n}`,
      )
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
