/**
 * `vos compare <program> --against <their render>` — the port's eyes.
 *
 * Every port compared its frames against the source's render by hand: an
 * ffmpeg line per time, an SSIM loop, a side-by-side to look at. This verb is
 * that loop. At each sampled time it takes the source frame from the render,
 * captures the program's frame through the engine's own still, scores the
 * pair (SSIM, ffmpeg's filter) and writes a sheet: source | vos | difference.
 * It exits non-zero when ANY frame falls under the threshold, because a
 * missing element is one frame's failure that an average would hide.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { UsageError, parseArgs, strFlag } from './args'
import { EXIT_ERROR, EXIT_OK, createReporter } from './output'
import { launchBrowser } from '../browser'
import { configDuration, loadVosConfig } from '../loadConfig'
import { parseTimes } from '../outputs'
import { programAssets } from '../programAssets'
import { reencodeStill, renderStill } from '../render'
import { platformOrigin, resolveCredential } from './platform'

const BOOLEAN_FLAGS = new Set(['json', 'help'])

export interface FrameScore {
  t: number
  ssim: number
  sheet: string
}

/** Default sample times: every `every` seconds, centred in each step (pure). */
export function sampleTimes(duration: number, every: number): number[] {
  const step = every > 0 ? every : 1
  const out: number[] = []
  for (let t = step / 2; t < duration; t += step) out.push(Number(t.toFixed(3)))
  return out.length ? out : [Number((duration / 2).toFixed(3))]
}

/** Parse ffmpeg's ssim summary line (pure). */
export function parseSsim(stderr: string): number | null {
  const m = /All:([0-9.]+)/.exec(stderr)
  return m ? Number(m[1]) : null
}

/** The verdict over a run (pure): every frame must clear the threshold. */
export function compareVerdict(scores: FrameScore[], threshold: number) {
  const values = scores.map((s) => s.ssim)
  const min = values.length ? Math.min(...values) : 0
  const mean = values.length
    ? values.reduce((a, b) => a + b, 0) / values.length
    : 0
  const failing = scores.filter((s) => s.ssim < threshold).map((s) => s.t)
  return { min, mean, failing, pass: failing.length === 0 && values.length > 0 }
}

function ffmpeg(args: string[]): { ok: boolean; stderr: string } {
  const res = spawnSync('ffmpeg', ['-hide_banner', ...args], {
    encoding: 'utf8',
  })
  return { ok: res.status === 0, stderr: res.stderr ?? '' }
}

function requireFfmpeg(): void {
  const res = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' })
  if (res.status !== 0)
    throw new UsageError(
      'vos compare reads frames with ffmpeg, and none is on PATH: install it (brew install ffmpeg, apt install ffmpeg) and run again',
    )
}

function probeSize(video: string): { width: number; height: number } | null {
  const res = spawnSync(
    'ffprobe',
    [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-show_entries',
      'stream=width,height',
      '-of',
      'csv=p=0',
      video,
    ],
    { encoding: 'utf8' },
  )
  const m = /(\d+),(\d+)/.exec(res.stdout ?? '')
  return m ? { width: Number(m[1]), height: Number(m[2]) } : null
}

export async function cmdCompare(argv: string[]): Promise<number> {
  const { positionals, flags } = parseArgs(argv, BOOLEAN_FLAGS)
  const source = positionals[0]
  const against = strFlag(flags, 'against')
  if (!source || !against)
    throw new UsageError(
      'vos compare <program dir|config.json> --against <their render.mp4> [--times a,b,50%] [--every 1] [--width W --height H] [--threshold 0.95] [--out compare] [--json]',
    )
  requireFfmpeg()
  const r = createReporter(flags.json === true)
  const ref = resolve(against)

  const loaded = await loadVosConfig(source)
  for (const w of loaded.warnings) r.log(`note: ${w}`)
  const config = loaded.config as Record<string, unknown>
  const duration = configDuration(config) ?? 5
  const assets = await programAssets(config, {
    baseDir: /^https?:\/\//.test(source)
      ? null
      : existsSync(source) && statSync(source).isDirectory()
        ? source
        : dirname(source),
    origin: platformOrigin({}),
    key: resolveCredential(),
    log: (line) => r.log(line),
  })

  // Compare at the render's own size unless told otherwise, halved past
  // 1280 wide: the sheet is for looking at, and SSIM is stable at half size.
  const probed = probeSize(ref)
  const half = probed && probed.width > 1280 ? 2 : 1
  const width = Number(
    strFlag(flags, 'width') ?? (probed ? probed.width / half : 960),
  )
  const height = Number(
    strFlag(flags, 'height') ?? (probed ? probed.height / half : 540),
  )
  const threshold = Number(strFlag(flags, 'threshold') ?? 0.95)
  const timesRaw = strFlag(flags, 'times')
  const times = timesRaw
    ? parseTimes(timesRaw, duration)
    : sampleTimes(duration, Number(strFlag(flags, 'every') ?? 1))
  const outDir = resolve(strFlag(flags, 'out') ?? 'compare')
  mkdirSync(outDir, { recursive: true })

  const browser = await launchBrowser()
  const scores: FrameScore[] = []
  try {
    for (const t of times) {
      const tag = t.toFixed(2)
      const refPng = join(outDir, `src-${tag}.png`)
      const vosPng = join(outDir, `vos-${tag}.png`)
      const sheet = join(outDir, `sheet-${tag}.png`)
      const grab = ffmpeg([
        '-v',
        'error',
        '-y',
        '-ss',
        String(t),
        '-i',
        ref,
        '-frames:v',
        '1',
        '-vf',
        `scale=${width}:${height}`,
        refPng,
      ])
      if (!grab.ok)
        throw new Error(
          `could not read ${against} at ${tag}s: ${grab.stderr.trim()}`,
        )
      const still = await renderStill(browser, {
        config,
        assets,
        width,
        height,
        time: t,
      })
      writeFileSync(vosPng, await reencodeStill(browser, still.bytes, 'png'))
      const pair = ['-i', refPng, '-i', vosPng]
      const ssim = parseSsim(
        ffmpeg([
          ...pair,
          '-lavfi',
          '[0:v]format=rgb24[x];[1:v]format=rgb24[y];[x][y]ssim',
          '-f',
          'null',
          '-',
        ]).stderr,
      )
      ffmpeg([
        '-v',
        'error',
        '-y',
        ...pair,
        '-filter_complex',
        '[0:v]format=gbrp[x];[1:v]format=gbrp[y];[x]split[x1][x2];[y]split[y1][y2];[x1][y1]blend=all_mode=difference[d];[x2][y2][d]hstack=inputs=3,format=rgb24',
        sheet,
      ])
      const score = { t, ssim: ssim ?? 0, sheet }
      scores.push(score)
      const mark = score.ssim < threshold ? '  ← under' : ''
      r.log(`t=${tag}s  SSIM ${score.ssim.toFixed(3)}  ${sheet}${mark}`)
      for (const w of still.pageErrors)
        r.log(`warn: t=${tag}s the page threw: ${w}`)
    }
  } finally {
    await browser.close()
  }

  // One picture of the whole run: the sheets stacked at a third of their size.
  const overview = join(outDir, 'overview.png')
  if (scores.length) {
    const inputs = scores.flatMap((s) => ['-i', s.sheet])
    const scaled = scores
      .map((_, i) => `[${i}:v]scale=iw/3:-2[s${i}]`)
      .join(';')
    const stack = scores.map((_, i) => `[s${i}]`).join('')
    ffmpeg([
      '-v',
      'error',
      '-y',
      ...inputs,
      '-filter_complex',
      scores.length > 1
        ? `${scaled};${stack}vstack=inputs=${scores.length}`
        : `${scaled}`.replace('[s0]', ''),
      overview,
    ])
  }

  const verdict = compareVerdict(scores, threshold)
  const report = {
    against: ref,
    width,
    height,
    threshold,
    ...verdict,
    frames: scores,
    overview,
  }
  writeFileSync(
    join(outDir, 'report.json'),
    JSON.stringify(report, null, 2) + '\n',
  )
  r.done(
    report,
    `${scores.length} frames: mean SSIM ${verdict.mean.toFixed(3)}, lowest ${verdict.min.toFixed(3)}${
      verdict.failing.length
        ? `; under ${threshold} at ${verdict.failing.map((t) => `${t}s`).join(', ')}: look at those sheets`
        : `; every frame at or above ${threshold}`
    }. Sheets (source | vos | difference) and overview.png in ${outDir}`,
  )
  return verdict.pass ? EXIT_OK : EXIT_ERROR
}
