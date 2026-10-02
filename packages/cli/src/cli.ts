import { writeFile } from 'node:fs/promises'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { parseArgs, numFlag, UsageError } from './args'
import { helpFlagsFor, unusedFlagsMessage } from './flagUse'
import {
  createReporter,
  EXIT_ERROR,
  EXIT_NO_BROWSER,
  EXIT_OK,
  EXIT_USAGE,
} from './output'
import {
  loadVosConfig,
  configDuration,
  directoryKind,
  loadProgramDirectory,
  readSourceText,
} from './loadConfig'
import { launchBrowser, BrowserUnavailableError } from './browser'
import {
  inspectStill,
  previewPages,
  reencodeStill,
  renderStill,
  renderVideo,
  stillWarnings,
} from './render'
import { runCheck } from './check'
import { outputSizeFor, RENDER_FALLBACK, STILL_FALLBACK } from './outputSize'
import { aspectLabel, programSize } from '@vosjs/core'
import { programAudio } from './programAudio'
import {
  applyDataSets,
  parseTimes,
  setFlags,
  stillFormat,
  stillOutFor,
  videoFormat,
} from './outputs'
import { platformOrigin, resolveCredential } from './plugin/platform'

const BOOLEAN_FLAGS = new Set(['json', 'help', 'version'])

const HELP_ENGINE = `vos — command line for the vos programmatic video engine (https://vos.so/engine)

Engine verbs (local, no account, no network beyond the render page's CDN deps)
  vos render <config.json|url|take> [out.mp4|out.webm] [--width] [--height] [--fps 30]
                               [--duration <s>] [--format webm|mp4] [--set data.<key>=<value>]... [--json]
             the output's name picks the container; a program document's sound is mixed in
             size: the program's own "size" (else 1920x1080; a still, 1280x720); one of
             --width/--height keeps the program's aspect, both set the frame
  vos still  <config.json|url> [out.webp|out.png|out.jpg] [--time 0 | --times 0,1.5,50%]
                               [--width] [--height] [--set data.<key>=<value>]... [--json]
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
  3 no browser available, 4 the recorder met a sign-in instead of the page
  it was asked for (nothing was recorded; it needs a session, not a new
  script). vos <verb> --help prints that verb's flags.
`

/** An `audio` element in the config: something a render never mixes. */
function hasAudioElements(config: unknown): boolean {
  const elements = (config as { elements?: unknown }).elements
  return (
    Array.isArray(elements) &&
    elements.some(
      (e) =>
        !!e &&
        typeof e === 'object' &&
        (e as { type?: unknown }).type === 'audio',
    )
  )
}

function outName(source: string, ext: string): string {
  const base = basename(source).replace(/\.[a-z0-9]+$/i, '') || 'vos'
  return `${base}.${ext}`
}

async function cmdRender(argv: string[]): Promise<number> {
  // Polymorphic render: a take DIRECTORY (its doc.json is a recording
  // document) renders through the plugin; a program directory (config.json,
  // composed with a program document when one sits beside it) and every
  // other source are engine config renders. A deterministic sniff, never a
  // flag — and the sniff reads the document, because a program directory
  // carries a doc.json too.
  const first = argv.find((a) => !a.startsWith('-'))
  if (first && directoryKind(first) === 'take') {
    return delegate(['render', ...argv])
  }
  const { positionals, flags } = parseArgs(argv, BOOLEAN_FLAGS)
  const source = positionals[0]
  if (!source) throw new UsageError('vos render <config.json|url|take> [out]')
  const r = createReporter(flags.json === true)
  const format = videoFormat(
    flags.format === undefined ? undefined : String(flags.format),
    positionals[1],
  )

  const loaded = await loadVosConfig(source)
  for (const w of loaded.warnings) r.log(`note: ${w}`)
  void flags.set
  const config = applyDataSets(
    loaded.config as Record<string, unknown>,
    setFlags(argv),
  )
  const duration = numFlag(flags, 'duration', configDuration(config) ?? 5)
  const size = outputSizeFor(config, flags, RENDER_FALLBACK)
  if (size.note) r.log(`note: ${size.note}`)
  const { width, height } = size
  const fps = numFlag(flags, 'fps', 30)
  const out = positionals[1] ?? outName(source, format)

  // A program document's sound rides its studio entry; mix it like a take's.
  const audio = await programAudio(config as Record<string, unknown>, {
    baseDir:
      existsSync(source) && statSync(source).isDirectory()
        ? source
        : dirname(source),
    duration,
    origin: platformOrigin({}),
    key: resolveCredential(),
    log: (line) => r.log(line),
  })
  if (audio) r.log(`mixing ${audio.clips} sound${audio.clips === 1 ? '' : 's'}`)
  if (hasAudioElements(config)) {
    r.log(
      'note: an audio ELEMENT is not mixed by a render; put the sound on the program document instead (doc.json audio: [{ key, start, in, out, duration, gain }])',
    )
  }

  const browser = await launchBrowser()
  try {
    const result = await renderVideo(browser, {
      config,
      width,
      height,
      fps,
      duration,
      format,
      audioProducerCode: audio?.producerCode,
      onPhase: (phase) => {
        r.log(`${phase}…`)
        r.event({ event: 'phase', phase })
      },
    })
    await writeFile(out, result.bytes)
    const warnings = stillWarnings(
      { transparent: false, flat: false },
      result.pageErrors,
      result.engineNotes,
    )
    for (const w of warnings) r.log(`warn: ${w}`)
    r.done(
      {
        out,
        bytes: result.bytes.length,
        width,
        height,
        fps,
        duration,
        format,
        audio: audio?.clips ?? 0,
        ...(warnings.length ? { warnings } : {}),
      },
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
  if (!source)
    throw new UsageError(
      'vos still <config.json|url> [out.webp|out.png|out.jpg] [--time t | --times a,b,50%]',
    )
  const r = createReporter(flags.json === true)

  const loaded = await loadVosConfig(source)
  for (const w of loaded.warnings) r.log(`note: ${w}`)
  void flags.set
  const config = applyDataSets(
    loaded.config as Record<string, unknown>,
    setFlags(argv),
  )
  const size = outputSizeFor(config, flags, STILL_FALLBACK)
  if (size.note) r.log(`note: ${size.note}`)
  const { width, height } = size
  const out = positionals[1] ?? outName(source, 'webp')
  const encoding = stillFormat(out)
  const timesRaw = flags.times === undefined ? undefined : String(flags.times)
  if (timesRaw !== undefined && flags.time !== undefined)
    throw new UsageError('--time and --times: pass one')
  const times =
    timesRaw !== undefined
      ? parseTimes(timesRaw, configDuration(config) ?? 5)
      : [numFlag(flags, 'time', 0)]
  const many = times.length > 1

  // One browser for every time: each still is its own capture page.
  const browser = await launchBrowser()
  try {
    const written: {
      out: string
      bytes: number
      time: number
      warnings?: string[]
    }[] = []
    for (const time of times) {
      const target = stillOutFor(out, time, many)
      const result = await renderStill(browser, {
        config,
        width,
        height,
        time,
        onPhase: (phase) => {
          r.event({ event: 'phase', phase, time })
        },
      })
      // The engine captures WebP; a .png or .jpg name is re-encoded in the
      // page, so the bytes always match the name.
      const bytes =
        encoding === 'webp'
          ? result.bytes
          : await reencodeStill(browser, result.bytes, encoding)
      await writeFile(target, bytes)
      // A still is checked before anyone looks at it: a fully transparent
      // or flat frame is written, and said, never passed off as a picture.
      const warnings = stillWarnings(
        await inspectStill(browser, result.bytes),
        result.pageErrors,
        result.engineNotes,
      )
      written.push({
        out: target,
        bytes: bytes.length,
        time,
        ...(warnings.length ? { warnings } : {}),
      })
      r.log(
        `Wrote ${target} (${(bytes.length / 1024).toFixed(0)} KB @ t=${Number(time.toFixed(2))}s)`,
      )
      for (const w of warnings)
        r.log(`warn: t=${Number(time.toFixed(2))}s ${w}`)
    }
    const first = written[0]
    r.done(
      many
        ? { stills: written, width, height, format: encoding }
        : { ...first, width, height, format: encoding },
      many
        ? `Wrote ${written.length} stills (${width}x${height})`
        : `Wrote ${first.out} (${(first.bytes / 1024).toFixed(0)} KB, ${width}x${height} @ t=${first.time}s)`,
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
  const declared = programSize(config)
  const info = {
    version: config.version,
    duration: configDuration(config) ?? null,
    size: declared ?? null,
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
        `size:      ${declared ? `${declared.width}x${declared.height} (${aspectLabel(declared)})` : '(none declared; render 1920x1080, still 1280x720)'}\n` +
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

  // A directory is a take (refused here: its document is `vos validate`'s
  // job) or a program directory (config.json, composed with the program
  // document beside it so the ladder reads the layers' strings too).
  const kind = /^https?:\/\//.test(source) ? 'none' : directoryKind(source)
  if (kind === 'take') {
    throw new UsageError(
      `${source} is a take (its doc.json is a recording document). vos validate ${source} lints it; vos render ${source} renders it.`,
    )
  }
  let raw: string
  let parsed: unknown
  try {
    if (kind === 'program') {
      const notes: string[] = []
      parsed = await loadProgramDirectory(source, notes)
      for (const n of notes) r.log(`note: ${n}`)
      raw = ''
    } else {
      raw = await readSourceText(source)
      parsed = JSON.parse(raw)
    }
  } catch (e) {
    if (!(e instanceof SyntaxError)) throw e
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
  // An engine verb asked for its flags: the engine's usage lines, plus the
  // take pipeline's where the verb is shared (render takes a config OR a take).
  if (rest.includes('--help') || rest.includes('-h')) {
    const engine = HELP_ENGINE.split('\n').filter((l) =>
      l.startsWith(`  vos ${cmd} `),
    )
    const { verbHelp } = await import('./plugin/run')
    const take = verbHelp(cmd)
    process.stdout.write(
      `${engine.join('\n')}\n${take.includes('no such verb') ? '' : take}`,
    )
    return EXIT_OK
  }
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
  .then(async (code) => {
    // A run that succeeded while ignoring a flag it was given did not do
    // what was asked (flagUse.ts): say so, and do not exit 0.
    if (code === EXIT_OK) {
      const verb = process.argv[2] ?? ''
      const { HELP } = await import('./plugin/run')
      const documented = [
        ...helpFlagsFor(HELP_ENGINE, verb),
        ...helpFlagsFor(HELP, verb),
      ]
      const message = unusedFlagsMessage(verb, [...new Set(documented)])
      if (message) {
        process.stderr.write(`usage error: ${message}\n`)
        process.exit(EXIT_USAGE)
      }
    }
    process.exit(code)
  })
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
