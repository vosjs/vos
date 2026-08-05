import { mkdir, readFile, writeFile } from 'node:fs/promises'
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
import {
  PLATFORM_ORIGIN,
  apiError,
  apiJson,
  deriveSlug,
  parseVosId,
  resolveCredential,
} from './platform'

const BOOLEAN_FLAGS = new Set(['json', 'help', 'version'])

const HELP = `vos — command line for the vos programmatic video engine (https://vos.so)

Usage
  vos render <config.json|url|take> [out] [--width 1920] [--height 1080] [--fps 30]
                               [--duration <s>] [--format webm|mp4] [--json]
  vos still  <config.json|url> [out.webp] [--time 0] [--width] [--height] [--json]
  vos info   <config.json|url> [--json]
  vos preview <config.json|url> [--port 0]
  vos versions [--json]

Platform (vos.so) — fetch a program, validate locally, push a private remix
  vos fetch <vosId|watch-url> [--out dir] [--json]
            writes config.json + meta.json (no auth needed for public programs)
  vos check <config.json> [--json]
            migrate → schema → compile → determinism/dialect lints, all local
  vos push  <config.json> [--vos id] [--title t] [--slug s] [--remix-of id]
            [--note n] [--base versionId] [--json]
            no --vos: create a PRIVATE vos (lineage from meta.json / --remix-of)
            with --vos: add a version to it; --base = the version you edited
            from, --note = what changed (recorded where the platform supports it)
            auth: VOS_API_KEY or ~/.config/vos/credentials — mint at vos.so/app/api;
            keys can never publish (visibility stays private; humans publish on vos.so)

Take pipeline — screen recordings in, polished product video out
(ships separately: npm i -D @vosso/cli)
  vos create   --actions actions.json [out.webm] [--strict]   (record + plan + render, one shot)
  vos record   --actions actions.json [--out take] [--strict]
  vos plan     <take> [--fresh]
  vos frames   <take> [--at-zooms | --frame <t> --size WxH]
  vos open     <take>            (serve the take into the studio at vos.so)
  vos validate <actions.json|take>
  vos render   <take> [out]      (a take directory is detected by its doc.json)

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
  // pipeline's editable document) renders through the take pipeline; anything
  // else is an engine config render. A deterministic sniff, never a flag.
  const first = argv.find((a) => !a.startsWith('-'))
  if (first && existsSync(join(first, 'doc.json'))) {
    return delegateTake(['render', ...argv])
  }
  const { positionals, flags } = parseArgs(argv, BOOLEAN_FLAGS)
  const source = positionals[0]
  if (!source) throw new UsageError('vos render <config.json|url|take> [out]')
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

async function cmdFetch(argv: string[]): Promise<number> {
  const { positionals, flags } = parseArgs(argv, BOOLEAN_FLAGS)
  const source = positionals[0]
  if (!source) throw new UsageError('vos fetch <vosId|watch-url> [--out dir]')
  const r = createReporter(flags.json === true)
  const id = parseVosId(source)
  // Attached when present so your own private programs fetch too; public and
  // unlisted programs need no credential at all.
  const key = resolveCredential()

  const meta = await apiJson(`/api/vos/${id}`, { key })
  if (meta.status !== 200) throw new Error(apiError(`fetch vos ${id}`, meta))
  const cfg = await apiJson(`/api/vos/${id}/config`, { key })
  if (cfg.status !== 200) throw new Error(apiError(`fetch config for ${id}`, cfg))

  const vosMeta = (meta.body.vos ?? {}) as Record<string, unknown>
  const slug = typeof vosMeta.slug === 'string' && vosMeta.slug ? vosMeta.slug : id
  const out = (flags.out as string) ?? slug
  await mkdir(out, { recursive: true })
  // The config is written EXACTLY as stored (params/presets included) — this
  // file round-trips back through `vos push`.
  await writeFile(join(out, 'config.json'), JSON.stringify(cfg.body.config, null, 2))
  await writeFile(join(out, 'meta.json'), JSON.stringify(vosMeta, null, 2))

  const title = typeof vosMeta.title === 'string' ? vosMeta.title : ''
  r.done(
    {
      out,
      id,
      slug,
      title,
      currentVersionId: vosMeta.currentVersionId ?? null,
    },
    `Wrote ${out}/config.json + meta.json (${title || id})\n` +
      `Edit config.json, then: vos check ${out}/config.json && vos push ${out}/config.json`,
  )
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
    r.done({ ok: false, errors: 1, warnings: 0, issues: [{ level: 'error', source: 'json', message: (e as Error).message }] }, `${source}: 1 error`)
    return EXIT_ERROR
  }

  const result = runCheck(parsed)
  if (r.json) {
    r.done(
      { ok: result.ok, errors: result.errors, warnings: result.warnings, issues: result.issues },
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

async function cmdPush(argv: string[]): Promise<number> {
  const { positionals, flags } = parseArgs(argv, BOOLEAN_FLAGS)
  const source = positionals[0]
  if (!source) {
    throw new UsageError(
      'vos push <config.json> [--vos id] [--title t] [--slug s] [--remix-of id] [--note n] [--base versionId]',
    )
  }
  const r = createReporter(flags.json === true)

  const parsed = JSON.parse(await readFile(source, 'utf8')) as unknown
  const check = runCheck(parsed)
  if (!check.ok || !check.config) {
    for (const i of check.issues) {
      if (i.level === 'error') r.log(`error [${i.source}] ${i.message}`)
    }
    throw new Error(`config does not validate — run: vos check ${source}`)
  }
  const config = check.config

  const key = resolveCredential()
  if (!key) {
    throw new Error(
      'no credential found — set VOS_API_KEY or write the key as the first line of ' +
        '~/.config/vos/credentials (mint one at https://vos.so/app/api; a vos_rg_ remix grant works too)',
    )
  }

  if (flags.vos) {
    // Iterate an existing vos: add a version. --base names the version this
    // edit was made FROM and --note says what changed — both are forwarded
    // and recorded where the platform supports them.
    const vosId = parseVosId(String(flags.vos))
    const body: Record<string, unknown> = { config }
    if (flags.base) body.baseVersionId = String(flags.base)
    if (flags.note) body.note = String(flags.note)
    const res = await apiJson(`/api/vos/${vosId}/versions`, { method: 'POST', key, body })
    if (res.status === 409) {
      // The platform copy moved since --base: it answers with the changes made
      // there. Surface them — the correction path is the data path.
      const changes = Array.isArray(res.body.changes) ? res.body.changes : []
      for (const ch of changes) {
        const summary =
          typeof ch === 'object' && ch !== null && 'summary' in ch
            ? String((ch as Record<string, unknown>).summary)
            : JSON.stringify(ch)
        r.log(`platform change: ${summary}`)
      }
      r.event({ event: 'conflict', reason: res.body.error ?? 'conflict', changes })
      throw new Error(
        `version base is stale — the platform copy changed (${changes.length} edit${changes.length === 1 ? 's' : ''} above). ` +
          `Fetch, rebase your edit, and push again: vos fetch ${vosId}`,
      )
    }
    if (res.status !== 201) throw new Error(apiError(`push version to ${vosId}`, res))
    const version = (res.body.version ?? {}) as Record<string, unknown>
    const watchUrl = `${PLATFORM_ORIGIN}/vos/${vosId}`
    const studioUrl = `${PLATFORM_ORIGIN}/studio?vos=${vosId}`
    r.done(
      {
        id: vosId,
        versionId: version.id ?? null,
        versionNumber: version.versionNumber ?? null,
        watchUrl,
        studioUrl,
      },
      `Pushed version ${String(version.versionNumber ?? '?')} of ${vosId}\n` +
        `  watch:  ${watchUrl}\n  studio: ${studioUrl}`,
    )
    return EXIT_OK
  }

  // Create a new PRIVATE vos. Lineage comes from meta.json (written by
  // `vos fetch` beside the config) or --remix-of; the platform validates it.
  let meta: Record<string, unknown> = {}
  try {
    meta = JSON.parse(await readFile(join(dirname(source), 'meta.json'), 'utf8')) as Record<
      string,
      unknown
    >
  } catch {
    // no meta.json — fine, push without lineage
  }
  const remixOfId = flags['remix-of']
    ? String(flags['remix-of'])
    : typeof meta.id === 'string'
      ? meta.id
      : undefined
  const fallbackTitle =
    typeof meta.title === 'string' && meta.title
      ? `${meta.title} remix`
      : basename(source).replace(/\.json$/i, '') || 'vos remix'
  const title = ((flags.title as string) ?? fallbackTitle).slice(0, 100)
  const slugGiven = typeof flags.slug === 'string'
  const baseSlug = slugGiven ? (flags.slug as string) : deriveSlug(title)

  for (let attempt = 0; ; attempt++) {
    const slug = attempt === 0 ? baseSlug : `${baseSlug}-${attempt + 1}`.slice(0, 50)
    const body: Record<string, unknown> = {
      title,
      slug,
      visibility: 'private',
      config,
    }
    if (remixOfId) body.remixOfId = remixOfId
    const res = await apiJson('/api/vos', { method: 'POST', key, body })
    if (res.status === 409 && !slugGiven && attempt < 3) {
      r.log(`slug "${slug}" is taken — retrying`)
      continue
    }
    if (res.status !== 201) throw new Error(apiError('push vos', res))
    const created = (res.body.vos ?? {}) as Record<string, unknown>
    const id = String(created.id ?? '')
    const watchUrl = `${PLATFORM_ORIGIN}/vos/${id}`
    const studioUrl = `${PLATFORM_ORIGIN}/studio?vos=${id}`
    r.done(
      {
        id,
        slug: created.slug ?? slug,
        title,
        visibility: created.visibility ?? 'private',
        remixOfId: remixOfId ?? null,
        currentVersionId: created.currentVersionId ?? null,
        watchUrl,
        studioUrl,
      },
      `Created private vos ${id} (${title})\n` +
        `  watch:  ${watchUrl}\n  studio: ${studioUrl}\n` +
        `Iterate with: vos push ${source} --vos ${id}`,
    )
    return EXIT_OK
  }
}

// The take pipeline's verbs live in @vosso/cli (published; previously
// @vosso/voila-cli, kept as an install fallback during the transition).
// The delegation contract is its `run(argv)` export.
const TAKE_VERBS = new Set(['create', 'record', 'plan', 'frames', 'open', 'validate'])

async function delegateTake(argv: string[], viaAlias = false): Promise<number> {
  for (const name of ['@vosso/cli', '@vosso/voila-cli']) {
    let mod: { run?: (argv: string[]) => Promise<number> }
    try {
      mod = (await import(name as string)) as typeof mod
    } catch {
      continue
    }
    if (typeof mod.run !== 'function') continue
    if (viaAlias && argv[0]) {
      process.stderr.write(`note: "vos voila ${argv[0]}" is now "vos ${argv[0]}".\n`)
    }
    return await mod.run(argv)
  }
  process.stderr.write(
    'The take pipeline (screen recordings in, product video out) ships separately.\n' +
      '  npm i -D @vosso/cli\n' +
      `then re-run: vos ${argv.join(' ')}\n`,
  )
  return EXIT_ERROR
}

async function main(): Promise<number> {
  const [cmd, ...rest] = process.argv.slice(2)
  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
    process.stdout.write(HELP)
    return cmd ? EXIT_OK : EXIT_USAGE
  }
  if (cmd === '--version') return cmdVersions(['--json'])
  if (TAKE_VERBS.has(cmd)) return delegateTake([cmd, ...rest])
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
    case 'fetch':
      return cmdFetch(rest)
    case 'check':
      return cmdCheck(rest)
    case 'push':
      return cmdPush(rest)
    // Hidden alias for existing scripts; not in HELP. Same code path as the
    // promoted verbs, plus a one-line pointer at the new spelling.
    case 'voila':
      return delegateTake(rest, true)
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
