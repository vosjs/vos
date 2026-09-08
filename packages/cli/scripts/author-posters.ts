/**
 * Author the first poster documents from a take with the stage arithmetic
 * (the one-time authoring pass): one plain take document per aspect class,
 * written to `<take>/poster/<class>/doc.json`. Each poster narrows the cut
 * to a window around the hero moment and ends on a trailing hold whose
 * start is the still.
 *
 *   pnpm tsx scripts/author-posters.ts <take> --headline "…" [--kicker "…"] [--brand BRAND.md] [--at <t>]
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  lookFromBrand,
  ratedSegments,
  spanOutputExtent,
} from '@vosjs/studio-core'
import { totalDuration } from '@vosjs/timeline'
import { applyDocOverrides } from '../src/plugin/docOverride'
import { posterValues } from '../src/plugin/posterValues'
import { stageSplitCover, stageTile } from '../src/plugin/stages'
import { fetchBrandMarks } from '../src/plugin/markAsset'
import { readBrandBesideTake } from '../src/plugin/deliver'
import type { ProjectDoc } from '@vosjs/studio-core'

const CLASSES = {
  landscape: { w: 1200, h: 630 },
  square: { w: 1080, h: 1080 },
  portrait: { w: 1080, h: 1920 },
  tile: { w: 440, h: 280 },
} as const

const HOLD = 3
const LEAD = 2.5

async function main() {
  const [dir, ...rest] = process.argv.slice(2)
  if (!dir) throw new Error('usage: author-posters <take> --headline "…"')
  const flag = (name: string) => {
    const i = rest.indexOf(`--${name}`)
    return i >= 0 ? rest[i + 1] : undefined
  }
  const doc = JSON.parse(
    await readFile(join(dir, 'doc.json'), 'utf8'),
  ) as ProjectDoc
  const brand = await readBrandBesideTake(dir, flag('brand'))
  const roles = brand?.roles ?? null
  if (brand) console.log(`brand: ${brand.file}`)
  const look = lookFromBrand(roles)
  const marks = await fetchBrandMarks(dir, roles)
  const mark = look.kind === 'dark' ? marks.dark : marks.light
  // A literal \n in a flag is a line break, as it is on the CLI.
  const lines = (v: string | undefined) =>
    v === undefined ? null : v.replace(/\\n/g, '\n')
  const words = {
    headline: lines(flag('headline')),
    kicker: lines(flag('kicker')),
    brand: roles?.wordmark ?? null,
    release: flag('release') ?? null,
  }
  const fill = posterValues(roles, words)
  if (mark) {
    fill.values.logoKey = mark.key
    fill.values.logoAspect = mark.aspect
  }
  const rated = ratedSegments(doc)
  const duration = totalDuration(rated)
  // The hero moment: --at, else the first zoom apex, else mid-take.
  let at = flag('at') ? Number(flag('at')) : NaN
  if (!Number.isFinite(at)) {
    const z = doc.zoom[0]
    const ext = z ? spanOutputExtent(rated, z.in, z.out) : null
    at = ext ? (ext.start + ext.end) / 2 : duration / 2
  }
  const meta = doc.source.meta
  const footageAspect =
    (meta.captureWidth ?? meta.width) / (meta.captureHeight ?? meta.height)

  for (const [cls, px] of Object.entries(CLASSES)) {
    const staged =
      cls === 'tile'
        ? stageTile({
            size: px,
            values: fill.values,
            sourceSeconds: meta.durationMs / 1000,
            outputSeconds: LEAD + HOLD,
            text: 'none',
            footageAspect,
          })
        : stageSplitCover({
            size: px,
            values: fill.values,
            sourceSeconds: meta.durationMs / 1000,
            outputSeconds: LEAD + HOLD,
            text: 'expected',
            footageAspect,
          })
    const poster = structuredClone(doc)
    applyDocOverrides(poster, { set: staged.set })
    // The window: LEAD seconds of the product playing up to the moment,
    // then the rest. Source seconds through the take's own rate map.
    const srcAt = sourceAt(doc, at)
    const srcIn = Math.max(0, srcAt - LEAD)
    poster.segments = [{ in: round(srcIn), out: round(srcAt) }]
    poster.freeze = [{ id: 'f0', at: round(srcAt), seconds: HOLD }]
    poster.zoom = []
    poster.speed = []
    delete poster.endCard
    delete poster.rejected
    poster.frame.aspectRatio = `${px.w}:${px.h}`
    const out = join(dir, 'poster', cls)
    await mkdir(out, { recursive: true })
    await writeFile(join(out, 'doc.json'), JSON.stringify(poster, null, 2))
    console.log(
      `${cls}: ${join(out, 'doc.json')} (rest at ${LEAD}s, ${staged.text.length} text box(es))`,
    )
  }
}

const round = (v: number) => Math.round(v * 1000) / 1000

/** Output seconds → source seconds through the rated segments. */
function sourceAt(doc: ProjectDoc, t: number): number {
  let acc = 0
  for (const s of ratedSegments(doc)) {
    const rate = s.rate && s.rate > 0 ? s.rate : 1
    const len = (s.out - s.in) / rate
    if (t <= acc + len) return s.in + (t - acc) * rate
    acc += len
  }
  const last = doc.segments.at(-1)
  return last ? last.out : doc.source.meta.durationMs / 1000
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
