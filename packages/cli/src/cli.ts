import { readFile, writeFile } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { parseArgs, numFlag, UsageError } from './args'
import {
  createReporter,
  EXIT_ERROR,
  EXIT_NO_BROWSER,
  EXIT_OK,
  EXIT_USAGE,
} from './output'
import { loadVosConfig, configDuration } from './loadConfig'
import { launchBrowser, BrowserUnavailableError } from './browser'
import { renderVideo, renderStill, previewPages } from './render'
import { runCheck } from './check'

const BOOLEAN_FLAGS = new Set(['json', 'help', 'version'])

const HELP_ENGINE = `vos — command line for the vos programmatic video engine (https://vos.so/engine)

Engine verbs (local, no account, no network beyond the render page's CDN deps)
  vos render <config.json|url|take> [out] [--width 1920] [--height 1080] [--fps 30]
                               [--duration <s>] [--format webm|mp4] [--json]
  vos still  <config.json|url> [out.webp] [--time 0] [--width] [--height] [--json]
  vos info   <config.json|url> [--json]
  vos check  <config.json|url> [--json]
             migrate → schema → syntax → compile → determinism/dialect lints, all local
  vos preview <config.json|url> [--port 0]
  vos versions [--json]
`

const HELP_CONVENTIONS = `
Conventions
  Results go to stdout; logs go to stderr. --json switches stdout to NDJSON
  events ending with {"event":"done",…}. Exit codes: 0 ok, 1 error, 2 usage,
  3 no browser available.
`

function outName(source: string, ext: string): string {
  const base = basename(source).replace(/\.[a-z0-9]+$/i, '') || 'vos'
  return `${base}.${ext}`
}

async function cmdRender(argv: string[]): Promise<number> {
  // Polymorphic render: a take DIRECTORY (detected by its doc.json — the take
  // pipeline's editable document) renders through the plugin; anything else
  // is an engine config render. A deterministic sniff, never a flag.
  const first = argv.find((a) => !a.startsWith('-'))
  if (first && existsSync(join(first, 'doc.json'))) {
    return delegate(['render', ...argv])
  }
  const { positionals, flags } = parseArgs(argv, BOOLEAN_FLAGS)
  const source = positionals[0]
  if (!source) throw new UsageError('vos render <config.json|url|take> [out]')
  const r = createReporter(flags.json === true)
  const format = (flags.format as string) ?? 'webm'
  if (format !== 'webm' && format !== 'mp4')
    throw new UsageError('--format must be webm or mp4')

  const { config, warnings } = await loadVosConfig(source)
  for (const w of warnings) r.log(`note: ${w}`)
  const duration = numFlag(flags, 'duration', configDuration(config) ?? 5)
  const width = numFlag(flags, 'width', 1920)
  const height = numFlag(flags, 'height', 1080)
  const fps = numFlag(flags, 'fps', 30)
  const out = positionals[1] ?? outName(source, format)

  const browser = await launchBrowser()
  try {
    const result = await renderVideo(browser, {
      config,
      width,
      height,
      fps,
      duration,
      format,
      onPhase: (phase) => {
        r.log(`${phase}…`)
        r.event({ event: 'phase', phase })
      },
    })
    await writeFile(out, result.bytes)
    r.done(
      { out, bytes: result.bytes.length, width, height, fps, duration, format },
      `Wrote ${out} (${(result.bytes.length / 1024).toFixed(0)} KB, ${width}x${height}@${fps}, ${duration}s)`,
    )
    return EXIT_OK
  } finally {
    await browser.close()
  }
}

async function cmdStill(argv: string[]): Promise<number> {
  const { positionals, flags } = parseArgs(argv, BOOLEAN_FLAGS)
  const source = positionals[0]
  if (!source) throw new UsageError('vos still <config.json|url> [out.webp]')
  const r = createReporter(flags.json === true)

  const { config, warnings } = await loadVosConfig(source)
  for (const w of warnings) r.log(`note: ${w}`)
  const time = numFlag(flags, 'time', 0)
  const width = numFlag(flags, 'width', 1280)
  const height = numFlag(flags, 'height', 720)
  const out = positionals[1] ?? outName(source, 'webp')
  // The capture template encodes WebP; a .png/.jpg name would ship WebP
  // bytes under a lying extension (stores refuse a mislabelled image), so
  // refuse in words instead of writing it.
  if (/\.(png|jpe?g)$/i.test(out))
    throw new UsageError(
      `vos still writes WebP (the engine's capture format): name the output .webp, or convert afterwards (ffmpeg -i out.webp out.png)`,
    )

  const browser = await launchBrowser()
  try {
    const result = await renderStill(browser, {
      config,
      width,
      height,
      time,
      onPhase: (phase) => {
        r.log(`${phase}…`)
        r.event({ event: 'phase', phase })
      },
    })
    await writeFile(out, result.bytes)
    r.done(
      {
        out,
        bytes: result.bytes.length,
        width,
        height,
        time,
        mimeType: result.mimeType,
      },
      `Wrote ${out} (${(result.bytes.length / 1024).toFixed(0)} KB, ${width}x${height} @ t=${time}s)`,
    )
    return EXIT_OK
  } finally {
    await browser.close()
  }
}

async function cmdInfo(argv: string[]): Promise<number> {
  const { positionals, flags } = parseArgs(argv, BOOLEAN_FLAGS)
  const source = positionals[0]
  if (!source) throw new UsageError('vos info <config.json|url>')
  const r = createReporter(flags.json === true)

  const { config, warnings } = await loadVosConfig(source)
  const elements = Array.isArray(config.elements) ? config.elements.length : 0
  const data =
    typeof config.data === 'object' && config.data !== null
      ? Object.keys(config.data)
      : []
  const fns = ['setup', 'createContent', 'createTimeline', 'onFrame'].filter(
    (k) => typeof config[k] === 'string',
  )
  const info = {
    version: config.version,
    duration: configDuration(config) ?? null,
    camera:
      (config.camera as Record<string, unknown> | undefined)?.preset ?? null,
    elements,
    dataKeys: data,
    functions: fns,
    warnings,
  }
  if (r.json) r.done(info, '')
  else {
    for (const w of warnings) r.log(`note: ${w}`)
    process.stdout.write(
      `version:   v${String(info.version)}\n` +
        `duration:  ${info.duration === null ? '(none)' : `${info.duration}s`}\n` +
        `camera:    ${String(info.camera ?? '(default)')}\n` +
        `elements:  ${elements}\n` +
        `data keys: ${data.length ? data.join(', ') : '(none)'}\n` +
        `functions: ${fns.join(', ')}\n`,
    )
  }
  return EXIT_OK
}

function packageVersion(name: string): string | null {
  const require = createRequire(import.meta.url)
  // Fast path — packages that export ./package.json (e.g. playwright).
  try {
    return (require(`${name}/package.json`) as { version: string }).version
  } catch {
    // Strict `exports` maps (the @vosjs packages) hide package.json — resolve
    // the entry module instead and walk up to the owning package.json.
  }
  let entry: string | null = null
  try {
    entry = fileURLToPath(import.meta.resolve(name))
  } catch {
    try {
      entry = require.resolve(name)
    } catch {
      return null
    }
  }
  let dir = dirname(entry)
  for (let i = 0; i < 6; i++) {
    try {
      const pkg = JSON.parse(
        readFileSync(join(dir, 'package.json'), 'utf8'),
      ) as {
        name?: string
        version?: string
      }
      if (pkg.name === name && pkg.version) return pkg.version
    } catch {
      // keep walking
    }
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
  return null
}

function ownVersion(): string {
  try {
    const own = JSON.parse(
      readFileSync(
        fileURLToPath(new URL('../package.json', import.meta.url)),
        'utf8',
      ),
    ) as { version: string }
    return own.version
  } catch {
    return '(unknown)'
  }
}

async function cmdVersions(argv: string[]): Promise<number> {
  const { flags } = parseArgs(argv, BOOLEAN_FLAGS)
  const r = createReporter(flags.json === true)
  const versions: Record<string, string> = {}
  versions['@vosjs/cli'] = ownVersion()
  for (const name of [
    '@vosjs/core',
    '@vosjs/elements',
    '@vosjs/tween',
    '@vosjs/editor',
    '@vosjs/timeline',
    '@vosjs/studio-core',
    '@vosjs/render-core',
    '@vosjs/shared',
    'mediabunny',
    'playwright',
  ]) {
    versions[name] = packageVersion(name) ?? '(not found)'
  }
  if (r.json) r.done({ versions }, '')
  else
    for (const [k, v] of Object.entries(versions))
      process.stdout.write(`${k} ${v}\n`)
  return EXIT_OK
}

async function cmdPreview(argv: string[]): Promise<number> {
  const { positionals, flags } = parseArgs(argv, BOOLEAN_FLAGS)
  const source = positionals[0]
  if (!source) throw new UsageError('vos preview <config.json|url> [--port 0]')
  const r = createReporter(false)
  const { config, warnings } = await loadVosConfig(source)
  for (const w of warnings) r.log(`note: ${w}`)
  const { hostHtml, playerHtml } = previewPages(config)
  const server = createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://x').pathname
    res.writeHead(200, { 'content-type': 'text/html' })
    res.end(path === '/player' ? playerHtml : hostHtml)
  })
  const port = numFlag(flags, 'port', 0)
  await new Promise<void>((resolve) => server.listen(port, resolve))
  const addr = server.address()
  const url = `http://localhost:${typeof addr === 'object' && addr ? addr.port : port}/`
  process.stdout.write(`${url}\n`)
  r.log('Serving playback preview — Ctrl-C to stop.')
  await new Promise(() => {}) // keep alive until interrupted
  return EXIT_OK
}

async function cmdCheck(argv: string[]): Promise<number> {
  const { positionals, flags } = parseArgs(argv, BOOLEAN_FLAGS)
  const source = positionals[0]
  if (!source) throw new UsageError('vos check <config.json>')
  const r = createReporter(flags.json === true)

  let raw: string
  if (/^https?:\/\//.test(source)) {
    const res = await fetch(source)
    if (!res.ok) throw new Error(`fetch ${source} → ${res.status}`)
    raw = await res.text()
  } else {
    raw = await readFile(source, 'utf8')
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (e) {
    parsed = undefined
    if (!r.json) process.stdout.write(`error [json] ${(e as Error).message}\n`)
    r.done(
      {
        ok: false,
        errors: 1,
        warnings: 0,
        issues: [
          { level: 'error', source: 'json', message: (e as Error).message },
        ],
      },
      `${source}: 1 error`,
    )
    return EXIT_ERROR
  }

  const result = runCheck(parsed)
  if (r.json) {
    r.done(
      {
        ok: result.ok,
        errors: result.errors,
        warnings: result.warnings,
        issues: result.issues,
      },
      '',
    )
  } else {
    for (const i of result.issues) {
      process.stdout.write(`${i.level} [${i.source}] ${i.message}\n`)
    }
    process.stdout.write(
      result.ok
        ? `${source}: ok (${result.warnings} warning${result.warnings === 1 ? '' : 's'})\n`
        : `${source}: ${result.errors} error${result.errors === 1 ? '' : 's'}, ${result.warnings} warning${result.warnings === 1 ? '' : 's'}\n`,
    )
  }
  return result.ok ? EXIT_OK : EXIT_ERROR
}

// ---------------------------------------------------------------------------
// Every verb this file does not own is a take-pipeline or vos.so verb from
// `./plugin` (what used to ship separately as @vosso/vos-plugin). It loads on
// demand, so the engine verbs never pay for the recorder's imports, and the
// old names (`@vosso/cli`, `@vosso/voila-cli`, the `vos voila` alias) keep
// resolving here for scripts that still use them.
// ---------------------------------------------------------------------------

async function delegate(argv: string[], viaAlias = false): Promise<number> {
  const { run } = await import('./plugin/run')
  if (viaAlias && argv[0]) {
    process.stderr.write(
      `note: "vos voila ${argv[0]}" is now "vos ${argv[0]}".\n`,
    )
  }
  return await run(argv)
}

async function printHelp(): Promise<void> {
  process.stdout.write(HELP_ENGINE)
  const { manifest } = await import('./plugin/manifest')
  process.stdout.write('\nTake pipeline + vos.so verbs\n')
  for (const v of manifest.verbs) {
    if (v.name === 'render') continue // polymorphic — already listed above
    process.stdout.write(`  vos ${v.name.padEnd(8)} ${v.summary}\n`)
  }
  process.stdout.write(HELP_CONVENTIONS)
}

const ENGINE_VERBS = new Set([
  'render',
  'still',
  'info',
  'versions',
  'preview',
  'check',
])

async function main(): Promise<number> {
  const [cmd, ...rest] = process.argv.slice(2)
  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
    await printHelp()
    return cmd ? EXIT_OK : EXIT_USAGE
  }
  if (cmd === '--version') return cmdVersions(['--json'])
  if (!ENGINE_VERBS.has(cmd) && cmd !== 'voila') return delegate([cmd, ...rest])
  switch (cmd) {
    case 'render':
      return cmdRender(rest)
    case 'still':
      return cmdStill(rest)
    case 'info':
      return cmdInfo(rest)
    case 'versions':
      return cmdVersions(rest)
    case 'preview':
      return cmdPreview(rest)
    case 'check':
      return cmdCheck(rest)
    // Hidden alias for existing scripts; not in HELP. Same code path as the
    // promoted verbs, plus a one-line pointer at the new spelling.
    case 'voila':
      return delegate(rest, true)
    default:
      throw new UsageError(`unknown command "${cmd}" — run vos help`)
  }
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    if (e instanceof UsageError) {
      process.stderr.write(`usage error: ${e.message}\n`)
      process.exit(EXIT_USAGE)
    }
    if (e instanceof BrowserUnavailableError) {
      process.stderr.write(`${e.message}\n`)
      process.exit(EXIT_NO_BROWSER)
    }
    process.stderr.write(
      `error: ${e instanceof Error ? e.message : String(e)}\n`,
    )
    process.exit(EXIT_ERROR)
  })
