import { writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
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

const BOOLEAN_FLAGS = new Set(['json', 'help', 'version'])

const HELP = `vos — command line for the vos programmatic video engine (https://vos.so)

Usage
  vos render <config.json|url> [out] [--width 1920] [--height 1080] [--fps 30]
                               [--duration <s>] [--format webm|mp4] [--json]
  vos still  <config.json|url> [out.webp] [--time 0] [--width] [--height] [--json]
  vos info   <config.json|url> [--json]
  vos preview <config.json|url> [--port 0]
  vos versions [--json]
  vos voila <subcommand> …     (product-video pipeline — separate install)

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
  const { positionals, flags } = parseArgs(argv, BOOLEAN_FLAGS)
  const source = positionals[0]
  if (!source) throw new UsageError('vos render <config.json|url> [out]')
  const r = createReporter(flags.json === true)
  const format = (flags.format as string) ?? 'webm'
  if (format !== 'webm' && format !== 'mp4') throw new UsageError('--format must be webm or mp4')

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
      { out, bytes: result.bytes.length, width, height, time, mimeType: result.mimeType },
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
  const data = typeof config.data === 'object' && config.data !== null ? Object.keys(config.data) : []
  const fns = ['setup', 'createContent', 'createTimeline', 'onFrame'].filter(
    (k) => typeof config[k] === 'string',
  )
  const info = {
    version: config.version,
    duration: configDuration(config) ?? null,
    camera: (config.camera as Record<string, unknown> | undefined)?.preset ?? null,
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
      const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as {
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

async function cmdVersions(argv: string[]): Promise<number> {
  const { flags } = parseArgs(argv, BOOLEAN_FLAGS)
  const r = createReporter(flags.json === true)
  const versions: Record<string, string> = {}
  // Own version: read relative to dist (self-require is blocked by `exports`).
  try {
    const own = JSON.parse(
      readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
    ) as { version: string }
    versions['@vosjs/cli'] = own.version
  } catch {
    versions['@vosjs/cli'] = '(unknown)'
  }
  for (const name of ['@vosjs/core', '@vosjs/elements', '@vosjs/tween', 'playwright']) {
    versions[name] = packageVersion(name) ?? '(not found)'
  }
  if (r.json) r.done({ versions }, '')
  else for (const [k, v] of Object.entries(versions)) process.stdout.write(`${k} ${v}\n`)
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

async function cmdVoila(argv: string[]): Promise<number> {
  try {
    const mod = (await import('@vosso/voila-cli' as string)) as {
      run?: (argv: string[]) => Promise<number>
    }
    if (typeof mod.run === 'function') return await mod.run(argv)
    process.stderr.write('@vosso/voila-cli is installed but exposes no run() — update it.\n')
    return EXIT_ERROR
  } catch {
    process.stderr.write(
      'The Voila product-video pipeline ships separately.\n' +
        '  npm i -D @vosso/voila-cli\n' +
        'then re-run: vos voila …\n',
    )
    return EXIT_ERROR
  }
}

async function main(): Promise<number> {
  const [cmd, ...rest] = process.argv.slice(2)
  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
    process.stdout.write(HELP)
    return cmd ? EXIT_OK : EXIT_USAGE
  }
  if (cmd === '--version') return cmdVersions(['--json'])
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
    case 'voila':
      return cmdVoila(rest)
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
    process.stderr.write(`error: ${e instanceof Error ? e.message : String(e)}\n`)
    process.exit(EXIT_ERROR)
  })
