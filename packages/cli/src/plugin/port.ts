/**
 * `vos port inventory <source>` and `vos port scaffold` — the mechanical half
 * of bringing a finished piece into vos. The inventory reads the source; the
 * scaffold writes a program that already keeps the port grammar, built into
 * config.json, so the agent starts from data and translates only the motion.
 * The tools are engine-agnostic: a plain page, a HyperFrames composition (its
 * root's data attributes, its audio) and a Remotion project's render.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { UsageError, parseArgs, strFlag } from './args'
import { EXIT_ERROR, EXIT_OK, createReporter } from './output'
import { buildProgram } from './buildProgram'
import { readInventory } from './portInventory'
import type { Inventory } from './portInventory'
import { planScaffold, probeAudioDuration, writeScaffold } from './portScaffold'

const BOOLEAN_FLAGS = new Set(['json', 'help'])

export async function cmdPort(argv: string[]): Promise<number> {
  const [sub, ...rest] = argv
  if (sub === 'inventory') return await inventory(rest)
  if (sub === 'scaffold') return await scaffold(rest)
  throw new UsageError(
    'vos port inventory <page.html|project dir> [--render <their render.mp4>] [--out port] [--json]\n' +
      'vos port scaffold [--from port/inventory.json] [--out port/program] [--json]',
  )
}

async function inventory(argv: string[]): Promise<number> {
  const { positionals, flags } = parseArgs(argv, BOOLEAN_FLAGS)
  const source = positionals[0] ?? '.'
  const r = createReporter(flags.json === true)
  const outDir = resolve(strFlag(flags, 'out') ?? 'port')
  mkdirSync(outDir, { recursive: true })
  const renderFlag = strFlag(flags, 'render')
  const inv = await readInventory(source, {
    render: renderFlag === undefined ? undefined : resolve(renderFlag),
    outDir,
    log: (l) => r.log(`note: ${l}`),
  })
  const file = join(outDir, 'inventory.json')
  writeFileSync(file, JSON.stringify(inv, null, 2) + '\n')
  const missing = inv.fonts.filter((f) => !f.catalog).map((f) => f.family)
  r.log(
    `${inv.engine}, ${inv.width}×${inv.height}${inv.fps ? `@${inv.fps}` : ''}, ${inv.duration ?? '?'}s: ` +
      `${inv.texts.length} words, ${Object.keys(inv.palette).length} palette colours, ${inv.fonts.length} faces` +
      `${missing.length ? ` (not in the catalog: ${missing.join(', ')})` : ''}, ` +
      `${inv.media.length} media, ${inv.scenes.length} scenes, ${inv.canvases.length} canvases` +
      `${inv.gaps.length ? `; needs a painter or an approximation: ${inv.gaps.join(', ')}` : ''}`,
  )
  r.done(
    { inventory: file, ...summary(inv) },
    `Wrote ${file}${inv.stills.length ? ` and ${inv.stills.length} reference stills` : ''}. Next: npx vos port scaffold`,
  )
  return EXIT_OK
}

function summary(inv: Inventory) {
  return {
    engine: inv.engine,
    width: inv.width,
    height: inv.height,
    fps: inv.fps,
    duration: inv.duration,
    words: inv.texts.length,
    palette: Object.keys(inv.palette).length,
    faces: inv.fonts.map((f) => ({ family: f.family, catalog: f.catalog })),
    media: inv.media.length,
    scenes: inv.scenes.length,
    canvases: inv.canvases.length,
    gaps: inv.gaps,
    render: inv.render,
  }
}

async function scaffold(argv: string[]): Promise<number> {
  const { flags } = parseArgs(argv, BOOLEAN_FLAGS)
  const r = createReporter(flags.json === true)
  const from = resolve(strFlag(flags, 'from') ?? join('port', 'inventory.json'))
  if (!existsSync(from))
    throw new UsageError(
      `no inventory at ${from}: run npx vos port inventory <source> first`,
    )
  const inv = JSON.parse(readFileSync(from, 'utf8')) as Inventory
  const outDir = resolve(
    strFlag(flags, 'out') ?? join(dirname(from), 'program'),
  )
  const plan = planScaffold(inv, {
    sourceDir: scaffoldSourceDir(inv),
    probeDuration: probeAudioDuration,
  })
  writeScaffold(plan, outDir)

  // Build config.json from the program, as `vos build` does.
  const programFile = join(outDir, 'program.mjs')
  const mod = (await import(
    `${pathToFileURL(programFile).href}?t=${Date.now()}`
  )) as { default: Record<string, unknown> }
  const built = buildProgram(mod.default, 'program.mjs', plan.program)
  for (const p of built.problems) r.log(`error ${p.fn}: ${p.message}`)
  if (built.problems.length) return EXIT_ERROR
  writeFileSync(
    join(outDir, 'config.json'),
    JSON.stringify(built.config, null, 2) + '\n',
  )
  r.done(
    { program: outDir, report: join(dirname(outDir), 'REPORT.md') },
    `Wrote ${outDir}/program.mjs, config.json and doc.json, and ${join(dirname(outDir), 'REPORT.md')}. ` +
      'Translate the motion where it says TODO, then: npx vos build program.mjs && npx vos compare . --against <their render>',
  )
  return EXIT_OK
}

/**
 * The folder the scaffold resolves the source's media against: the absolute
 * root the inventory recorded, else (an older inventory) its source label
 * read from where the scaffold runs.
 */
export function scaffoldSourceDir(
  inv: Pick<Inventory, 'source' | 'root'>,
): string {
  if (inv.root) return inv.root
  return inv.source.endsWith('.html')
    ? dirname(resolve(inv.source))
    : resolve(inv.source)
}
