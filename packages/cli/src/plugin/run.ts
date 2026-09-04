import { mkdir, readFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { totalDuration } from '@vosjs/timeline'
import { migrateHostedDoc, ratedSegments } from '@vosjs/studio-core'
import { UsageError, hasFlag, numFlag, parseArgs, strFlag } from './args'
import {
  EXIT_ERROR,
  EXIT_NO_BROWSER,
  EXIT_OK,
  EXIT_USAGE,
  createReporter,
} from './output'
import { validateActions } from './actions'
import { lintDoc } from './validateDoc'
import {
  collectConfigMediaUrls,
  collectDocMediaUrls,
  mediaProbeLints,
  probeMediaUrls,
} from './mediaProbe'
import { framesTake, parseTimes, writeIndexJson } from './framesTake'
import { deliverTake, resolveChannels, resolveLook } from './deliver'
import { resolveStepTime } from './moments'
import { formatFinding } from './kitPicture'
import { validateKit } from './validateKit'
import { digestTake, parseTranscript } from './digestTake'
import { apiJson, platformOrigin, resolveCredential } from './platform'
import { startTakeServer } from './server'
import { PREV_DOC_NAME, ensureTakeDir, loadTake, prepareReRecord } from './take'
import { BrowserUnavailableError, launchBrowser } from '../browser'
import { recordTake } from './recorder'
import {
  defaultMaxDurationSeconds,
  formatDurationCap,
  hostedRecordingCap,
} from './recordingCap'
import { encodeRecording } from './encode'
import { planTake } from './plan'
import { openingBackdrop } from './backdrops'
import { renderTake } from './renderTake'
import { pullTake, pushTake } from './sync'
import {
  cmdDuplicate,
  cmdFetch,
  cmdLogin,
  cmdPullProgram,
  cmdPushProgram,
  isTakeDir,
  preflightConfig,
  readProgramDoc,
} from './program'
import { cmdFolder } from './folder'
import { cmdAsset } from './asset'
import { cmdRecipe } from './recipe'
import { cmdBrand } from './brand'
import { cmdActions } from './agentBrowser'
import type { Backdrop, ProjectDoc } from '@vosjs/studio-core'
import type { ActionsFile } from './actions'
import type { ParsedArgs } from './args'

const BOOLEAN_FLAGS = new Set([
  'json',
  'help',
  'picture',
  'fresh',
  'reuse',
  'strict',
  'draft',
  'at-zooms',
  'at-moments',
  'no-frames',
  'media',
  'print',
  'yes',
  'composed',
  'check',
])
/** Repeatable value flags (accumulate): --set path=value on render/frames, --override id on push. */
const MULTI_FLAGS = new Set(['set', 'override'])

const HELP = `vos — record a browser flow, plan effects, render a product video; sync with vos.so

Take pipeline
  vos create --actions actions.json [--url <url>] [--out take] [out.webm] [--strict] [--max-duration <s>] [--background <slug|url|none>] [render flags] [--json]
  vos record --actions actions.json [--url <url>] [--out take] [--strict] [--max-duration <s>] [--background <slug|url|none>] [--json]
  vos plan <take> [--fresh] [--reuse [--from <doc.json>]] [--style <doc.json|vosId>] [--background <slug|url|none>] [--json]
  vos render <take> [out.webm] [--width] [--height] [--fps] [--format webm|mp4] [--parallel N] [--range a..b] [--draft] [--frame <kind>] [--background <url|slug>] [--set <path=value>]... [--json]
  vos frames <take> [--times 0,25%,50%,75%,100%] [--frame <t>] [--at-zooms] [--at-moments] [--size WxH] [--out dir] [--background <url|slug>] [--set <path=value>]... [--json]
  vos deliver <take> --to cws,producthunt,x,linkedin,og,github,youtube (or all) [--look plate|gradient|dark|none] [--brand BRAND.md] [--poster <config.json|vosId>] [--shot-time <t>] [--poster-time <t>] [--composed] [--set path=value] [--release v2.1] [--out dir] [--times a,b] [--range a..b] [--parallel N] [--json]
  vos digest <take> [--out dir] [--full 960] [--crop 640] [--no-frames] [--transcript <file.json>] [--style <doc.json|vosId>] [--json]
  vos brand <url> [--out BRAND.md] [--json]
  vos open <take> [--studio <url>] [--print]
  vos validate <actions.json|take|kit.json> [--picture] [--json]
  vos actions from-agent-browser <steps.jsonl> [--out actions.json] [--url <url>] [--viewport WxH] [--json]

Platform (vos.so) — fetch, edit, push, pull, repeat
  vos login [--key <vos_sk_…>] [--label <name>] [--no-browser]
            sign in via the browser (approve at vos.so/cli/auth; works
            headless — print the URL, a human approves, the key stores
            itself). --key skips the browser (mint at vos.so/app/api)
  vos fetch <vosId|watch-url> [--out dir] [--media] [--json]
            writes config.json + vos.json (no auth needed for public programs);
            a take vos also gets its doc.json, and --media its footage
  vos push  <config.json|take> [--vos id] [--title t] [--slug s] [--remix-of id]
            [--desc d] [--tags a,b] [--folder <folderId|slug>]
            [--note n] [--label l] [--base versionId] [--override <id>]... [--yes] [--json]
            [--claimable]
            a take DIRECTORY (doc.json) pushes recording + doc; a config.json
            pushes the program. No --vos: create a PRIVATE vos; with --vos:
            add a version against the tracked base — a stale push 409s WITH
            the platform's typed changelog. --claimable (programs only, NO
            credential): creates a 72h claim link instead — hand it to the
            user and nowhere else; unclaimed work is deleted after 72h.
            --override consents to touching
            protected (human-edited) nodes, ONLY when the user asked.
  vos pull  [dir|take] [--vos <id>] [--since versionId] [--check] [--media] [--json]
            what changed on vos.so since your base; syncs config.json (backup
            kept) or the take's doc.json. ALWAYS pull before editing pushed work.
            --media also downloads the recording (+ mic/cam sidecars) beside
            the doc and re-anchors it, so digest/frames/render run locally
            auth: --key, VOS_API_KEY, or ~/.config/vos/credentials; keys can
            never publish (visibility stays private; humans publish on vos.so)
  vos folder list
  vos folder create <name> [--parent <folderId|slug>] [--desc <text>]
  vos folder move <vosId|assetId|watch-url>... --to <folderId|slug|none>
            organize the shelf: folders nest (≤5 deep, slugs stable); move
            takes vos ids AND asset ids (recipes, uploads) and files them
            into the folder (--to none unfiles). Add-only by design:
            folder rename/delete/reorder stay human gestures on vos.so
  vos asset rename <assetId> <newname.ext>
            rename one of your assets (recipes included) in place — bytes
            and fileUrl untouched; the extension must keep matching the
            asset's kind (a recipe stays .md)
  vos asset push <file...> [--folder <folderId|slug>]
            upload files onto your shelf (a key takes models .glb/.gltf,
            recipes .md and images .png/.jpg/.webp/.gif — posters and
            store stills file into the release's project; 40 images/24h)
  vos recipe push <file.md> --folder <folderId|slug>
  vos recipe push <file.md> --asset <assetId>
            put a recipe (a plain .md) on the shelf: --folder creates it
            filed into that folder, --asset replaces one in place (same
            id, the displaced body kept as the prior version). Reading is
            vos folder pull; restore stays a gesture on the recipe page

create = record then render in one command: drives the flow, auto-plans effects, and writes the video.
--strict aborts before rendering on any skipped selector. For the full
loop (inspect frames, edit doc.json, re-render) use the verbs below.

The take directory is the unit of work: recording.webm + cursor.json +
meta.json + actions.json + doc.json. doc.json is the editable surface —
zoom spans, trims, speed, cursor/frame styling; edit it (or let an agent),
then re-run render. plan preserves manual zoom spans, regenerating only
source:'auto' ones. Results on stdout, logs on stderr; --json = NDJSON.

The re-render loop (re-recording the same script after the product
changed): record into the SAME take dir — footage/cursor/meta are
replaced, the cut survives as doc.prev.json — then plan --reuse re-times
it onto the new recording. meta.json carries steps (when each actions
step ran); a span may carry anchor {step, at, offset} tying it to a step
id/index for exact re-timing; unanchored human spans map piecewise
through matched step edges; autos re-plan; overlays/audio keep OUTPUT
times. The done event's reuse block NAMES whatever could not follow —
fix by exception, never re-cut from scratch. Give steps ids in
actions.json so anchors survive script edits.

record --strict exits 2 when any selector was skipped, the page never
reached networkidle, or the take hit --max-duration (the done event lists
skipped[] and capped either way). --max-duration defaults to the hosted
recording cap, read live from GET /api/limits (30 min when the origin is
unreachable): the capture stops there and says so in one line.
frames captures PNG stills at OUTPUT times (seconds or % of duration);
--at-zooms adds every zoom span's apex, --at-moments every digest moment —
the agent's eyes AND exact-size posters/screenshots (--size WxH). render
--range a..b --draft spot-checks a doc edit in seconds (half res, low
bitrate; range in OUTPUT seconds); a --range render keeps its audio.
deliver renders the take to a release's destinations in one pass — the
channel specs (schema/channel-specs.json, verified sizes for the Chrome
Web Store, Product Hunt, X, LinkedIn, OG, GitHub, YouTube) drive stills at
exact pixels and video cuts, every artifact is VERIFIED against its spec
(px, bytes, duration; misses land in skipped[] with the reason), and
kit.json beside the assets is the manifest. Still times come from the
STORY: every step's end plus a 0.4 s settle (the response, not the
travel), then the zoom apexes, then an even spread; each candidate is
read once as the real page, blank ones (a wallpaper, an empty canvas) are
dropped and two of one frame collapse to one, with every drop said in
skipped[]. --times overrides with seconds, percents or step:<id>[+offset]
(the id from actions.json); --range cuts every video destination.
The LOOK presents the card: card-genre stills with no poster and every
video cut sit on a ground (a cream plate, the house gradient, a dark plate
with a light streak) at ~84% of the width with headroom, a soft ambient
shadow plus a tight contact shadow, and a hairline when card and ground
are both light; a wide frame runs the card off the bottom. --look picks a
house look (or none for the pre-look crops); with no flag the BRAND.md
beside the take (or --brand <file>) decides from its look role or its own
ground (a paper site is a plate, a dark site is dark), and with no brand
the house gradient. Screenshot-genre stills never take a look.
--poster <config.json|vosId> is the CARD half: card-genre destinations
(OG, LinkedIn, X, YouTube thumbnail, the CWS tile + marquee, GitHub
social preview) render from your poster PROGRAM — the split-cover family
— with this release's shot baked into its image element (id "shot"), PNG
at exact pixels. --shot-time <t> picks the take moment (OUTPUT seconds;
default the first still time — pick a zoom apex, the cut's camera makes
the shot the feature, not the whole page); --poster-time <t> is the instant
inside the poster's OWN timeline (default 90% through it). Screenshot-genre
destinations (CWS screenshots, the PH gallery) are the real page at that
moment, FULL BLEED: no zoom, no tilt, no browser bar, no padding (store
policy); --composed keeps the cut's camera and chrome instead. --set
path=value overrides the doc in memory for every render here (the user's
sets apply last). Store uploads stay manual: hand the human the kit
directory, then vos validate <kit.json> re-measures every asset from its
bytes against the channel specs; --picture adds what each asset LOOKS
like, read from its pixels: blank (a wallpaper or an empty canvas where
the product should be), duplicate (two stills of one frame), subject (the
card off the 60 to 92% band, or a crop where a card was asked for),
separation (a light card on a light ground with no shadow), halfsize (a
tile that loses its edges when the store shrinks it), and, where the kit
records its text boxes, sliced, safe and contrast (APCA Lc 60/75); a
video's first and last frames are read through ffmpeg. Every finding
carries a code, a severity, a fix hint and a box; an error fails the
verdict beside the spec problems.
brand writes the product's BRAND.md, witnessed: it reads /design.md when
the site publishes one (the convention beside /llms.txt: fonts, logo assets,
an avoid list), /llms.txt for the name and the claim, then the page itself
in a browser (the body ground, the surfaces, the h1 and body faces and inks,
the accent buttons and links agree on, theme-color, the icons, og:image).
The frontmatter carries the roles the poster family binds (bgA/bgB/bgC,
ink, accent, fontDisplay, logoUrl); the prose says where every value came
from and quotes the site's own avoid list. Resolve the brand BEFORE any
asset is authored; file it with vos recipe push BRAND.md --folder <slug>.
digest is how an agent SEES a recording before it cuts: writes digest/ with
digest.json (the moments the cursor track says matter — click clusters,
typing sessions, scroll runs, dwells, idle gaps, scene changes — each with
source+output extents, a normalized focus/rect you can copy into a zoom span,
per-second motion, and the planners' proposals beside it), one FOOTAGE frame
+ a crop around the target per moment, and sheet.png (the contact sheet).
Read digest.json, then the sheet, then crops only where you must decide.
--full/--crop set the long edge in px (your token budget; the done event
estimates it). --transcript merges Whisper-shaped segments (SOURCE seconds)
onto moments as "said". --style REPORTS a reference doc's style fields.
validate <take> lints doc.json semantics (span overlap/bounds, normalized
[0..1] zoom focus coords, export honesty) — schema in schema/doc.schema.json.
actions from-agent-browser turns the walk an agent made in agent-browser
into actions.json, so a feature verified there becomes a take with no
second script. Input: one record per command in agent-browser's own batch
shape, {command:[…], …result} — a bare --json result does not say what ran,
so wrap each call (the product-video skill has the one-line function) or
keep a batch's output. Refs (@e27) resolve through the last snapshot -i
before them (-u gives links their href); what the recorder cannot follow
(a shortcut key, a drag, a second open) is named in the output, never
dropped. Then: vos record --actions actions.json --strict.
open serves the take and loads it into the studio (?take=<server>) —
doc.json edits arrive intact; a human can drag every zoom span. Keeps
serving until Ctrl-C; --studio overrides the default http://localhost:6060.

push/pull — the hosted iteration loop (credentials: --key, VOS_API_KEY, or
~/.config/vos/credentials via vos login; origin via VOS_ORIGIN, default
https://vos.so). A take push uploads the recording ONCE (content-addressed),
lowers doc.json, and creates a private vos (first push asks; --yes for
headless) or a new version against the base in vos.json — a stale base
prints the human's typed changelog and exits 1 (run pull, re-apply, push
again). A protected conflict means the human touched those nodes in the
studio: keep their values, or --override <id> ONLY when the user asked for
that exact change. ALWAYS pass --label (what you did, one line) and --note
(why: the user's ask) — the version history reads as a conversation, and an
unlabelled push is a turn the human cannot read. pull prints what changed
since your base and writes the head back (doc.json for takes, config.json
for programs, backup kept). ALWAYS pull before editing pushed work.

render/frames doc overrides — check any presentation on the product surface
without hand-editing doc.json (the disk file is untouched; the patched doc is
lint-gated, so a bad override fails like a bad doc.json):
  --set <path=value>   patch any doc field, repeatable; value is JSON when it
                       parses else a string (e.g. --set tilt[0].rx=8
                       --set frame.padding=120 --set frame.browserBar.kind=mac-light)
  --frame <kind>       (render) browser frame: macos|mac-dark|windows|windows-dark|minimal|none
  --background <url|slug>  background media: a URL (kind inferred), or a backdrop slug from GET /api/backdrops
                       (.webm/.mp4 = video @10s loop, image otherwise); "none" clears.
                       On create/record/plan it is the frame a FRESH take opens on; absent, the set's
                       first ready loop (the house backdrop the studio opens on), or a flat ground offline
`

async function loadActions(file: string): Promise<ActionsFile> {
  const raw = JSON.parse(await readFile(file, 'utf8')) as unknown
  const errors = validateActions(raw)
  if (errors.length)
    throw new UsageError(`invalid actions file:\n  ${errors.join('\n  ')}`)
  return raw as ActionsFile
}

/**
 * --max-duration <seconds>: where the capture stops. Defaults to the
 * hosted recording cap so a CLI take is never longer than vos.so will host.
 */
/**
 * The cap a take records under: `--max-duration` when given; else the
 * hosted cap read live from `GET /api/limits` (the caller's plan when a
 * key resolves); else the built-in number, said in words, because a take
 * longer than the platform's cap is refused at push time.
 */
async function maxDuration(
  flags: ParsedArgs['flags'],
  r: { log: (line: string) => void },
): Promise<number> {
  if (hasFlag(flags, 'max-duration')) {
    const v = numFlag(flags, 'max-duration', defaultMaxDurationSeconds())
    if (!(v > 0)) throw new UsageError('--max-duration expects seconds above 0')
    return v
  }
  const origin = platformOrigin({
    origin: strFlag(flags, 'origin'),
    api: strFlag(flags, 'api'),
  })
  const live = await hostedRecordingCap(
    origin,
    resolveCredential(strFlag(flags, 'key')),
  )
  if (live) return live
  r.log(
    `note: could not read the hosted cap from ${origin}/api/limits; recording up to the built-in ${formatDurationCap(defaultMaxDurationSeconds())}`,
  )
  return defaultMaxDurationSeconds()
}

function strictReason(rec: {
  skipped: unknown[]
  navTimeout: boolean
  capped: boolean
}): string {
  const parts = [`${rec.skipped.length} skipped step(s)`]
  if (rec.navTimeout) parts.push('networkidle timeout')
  if (rec.capped) parts.push('stopped at --max-duration')
  return parts.join(' + ')
}

/**
 * The backdrop a FRESH take opens on: `--background <slug|url|none>`, or
 * absent, the set's house pick from `GET /api/backdrops`. Read once per
 * command; a set out of reach is said in words and the take opens on a
 * flat ground rather than failing.
 */
async function takeBackdrop(
  flags: ParsedArgs['flags'],
  r: { log: (line: string) => void },
): Promise<Backdrop | null> {
  const { backdrop, note } = await openingBackdrop(
    strFlag(flags, 'background'),
    platformOrigin({
      origin: strFlag(flags, 'origin'),
      api: strFlag(flags, 'api'),
    }),
  )
  if (note) r.log(`note: ${note}`)
  return backdrop
}

async function cmdRecord(argv: string[]): Promise<number> {
  const { positionals, flags } = parseArgs(argv, BOOLEAN_FLAGS)
  const actionsPath = strFlag(flags, 'actions') ?? positionals[0]
  if (!actionsPath)
    throw new UsageError(
      'vos record --actions actions.json [--url <url>] [--out take]',
    )
  const r = createReporter(flags.json === true)
  const actions = await loadActions(actionsPath)
  const url = strFlag(flags, 'url') ?? actions.url
  if (!url)
    throw new UsageError('no URL — set "url" in the actions file or pass --url')
  const outDir = resolve(strFlag(flags, 'out') ?? 'take')
  const backdrop = await takeBackdrop(flags, r)
  const maxDurationSeconds = await maxDuration(flags, r)

  if (existsSync(join(outDir, 'meta.json'))) {
    // A re-record replaces the FOOTAGE, never the cut. The previous
    // doc.json survives as doc.prev.json (the reuse base), actions.json and
    // vos.json stay put, and derived artifacts of the old footage clear.
    const { prevDoc, kept } = await prepareReRecord(outDir)
    r.log(
      `note: re-recording ${outDir} — kept ${kept.length ? kept.join(', ') : 'nothing'}` +
        (prevDoc
          ? '; apply the previous cut to the new footage with: vos plan ' +
            outDir +
            ' --reuse'
          : ''),
    )
  }
  await mkdir(outDir, { recursive: true })
  const paths = await ensureTakeDir(outDir)

  const browser = await launchBrowser()
  try {
    r.log('recording…')
    r.event({ event: 'phase', phase: 'record' })
    const rec = await recordTake(browser, url, actions, paths, r.log, {
      maxDurationSeconds: maxDurationSeconds,
    })
    r.event({ event: 'phase', phase: 'encode' })
    r.log('encoding…')
    const enc = await encodeRecording(browser, outDir, (p) =>
      r.event({ event: 'progress', phase: 'encode', fraction: p }),
    )
    r.event({ event: 'phase', phase: 'plan' })
    const plan = await planTake(outDir, { backdrop })
    const clicks = rec.events.filter((e) => e.type === 'down').length
    const strict = flags.strict === true
    const strictFail =
      strict && (rec.skipped.length > 0 || rec.navTimeout || rec.capped)
    const skippedNote = rec.skipped.length
      ? `\n  SKIPPED ${rec.skipped.length} step(s): ${rec.skipped.map((s) => `#${s.step} ${s.do} ${s.selector}`).join(', ')}`
      : ''
    r.done(
      {
        take: outDir,
        durationMs: rec.meta.durationMs,
        frames: rec.frames.length,
        events: rec.events.length,
        clicks,
        recordingBytes: enc.bytes,
        zoomSpans: plan.doc.zoom.length,
        skipped: rec.skipped,
        navTimeout: rec.navTimeout,
        freezes: rec.freezes,
        freezePct: rec.freezePct,
        capped: rec.capped,
        ...(strictFail ? { strictFailed: true } : {}),
      },
      strictFail
        ? `STRICT: take recorded but incomplete — ${strictReason(rec)}; fix the flow and re-record.${skippedNote}`
        : `Take ready: ${outDir}\n  ${(rec.meta.durationMs / 1000).toFixed(1)}s · ${rec.frames.length} frames · ${rec.events.length} cursor events · ${clicks} clicks · ${plan.doc.zoom.length} zoom spans planned · ${rec.freezePct}% frozen${rec.freezePct >= 25 ? ' ⚠ keep motion in frame or trim' : ''}${skippedNote}\n  Next: edit ${join(outDir, 'doc.json')} (optional), then: vos render ${outDir}`,
    )
    return strictFail ? EXIT_USAGE : EXIT_OK
  } finally {
    await browser.close()
  }
}

/**
 * The one-shot verb of the `vos <product> create` namespace: record the flow,
 * auto-plan effects, render the video — one command, one browser session.
 * The take dir still lands on disk, so the full loop (frames → doc.json edit
 * → re-render) stays available afterwards. --strict aborts BEFORE rendering
 * when the recording is incomplete (skipped selector / networkidle timeout).
 */
async function cmdCreate(argv: string[]): Promise<number> {
  const { positionals, flags, multi } = parseArgs(
    argv,
    BOOLEAN_FLAGS,
    MULTI_FLAGS,
  )
  const actionsPath = strFlag(flags, 'actions')
  if (!actionsPath) {
    throw new UsageError(
      'vos create --actions actions.json [--url <url>] [--out take] [out.webm]',
    )
  }
  const r = createReporter(flags.json === true)
  const actions = await loadActions(actionsPath)
  const url = strFlag(flags, 'url') ?? actions.url
  if (!url)
    throw new UsageError('no URL — set "url" in the actions file or pass --url')
  const outDir = resolve(strFlag(flags, 'out') ?? 'take')
  const fmtRaw = strFlag(flags, 'format') ?? 'webm'
  if (fmtRaw !== 'webm' && fmtRaw !== 'mp4')
    throw new UsageError('--format must be webm or mp4')
  const format = fmtRaw
  const out = positionals[0] ?? join(outDir, `out.${format}`)
  const parallel = numFlag(flags, 'parallel', 1)
  if (!Number.isInteger(parallel) || parallel < 1 || parallel > 16) {
    throw new UsageError('--parallel expects an integer between 1 and 16')
  }
  const backdrop = await takeBackdrop(flags, r)
  const maxDurationSeconds = await maxDuration(flags, r)

  if (existsSync(join(outDir, 'meta.json'))) {
    // A re-record replaces the FOOTAGE, never the cut. The previous
    // doc.json survives as doc.prev.json (the reuse base), actions.json and
    // vos.json stay put, and derived artifacts of the old footage clear.
    const { prevDoc, kept } = await prepareReRecord(outDir)
    r.log(
      `note: re-recording ${outDir} — kept ${kept.length ? kept.join(', ') : 'nothing'}` +
        (prevDoc
          ? '; apply the previous cut to the new footage with: vos plan ' +
            outDir +
            ' --reuse'
          : ''),
    )
  }
  await mkdir(outDir, { recursive: true })
  const paths = await ensureTakeDir(outDir)

  const browser = await launchBrowser()
  try {
    r.log('recording…')
    r.event({ event: 'phase', phase: 'record' })
    const rec = await recordTake(browser, url, actions, paths, r.log, {
      maxDurationSeconds: maxDurationSeconds,
    })
    r.event({ event: 'phase', phase: 'encode' })
    r.log('encoding…')
    await encodeRecording(browser, outDir, (p) =>
      r.event({ event: 'progress', phase: 'encode', fraction: p }),
    )
    r.event({ event: 'phase', phase: 'plan' })
    await planTake(outDir, { backdrop })

    if (
      flags.strict === true &&
      (rec.skipped.length > 0 || rec.navTimeout || rec.capped)
    ) {
      r.done(
        {
          take: outDir,
          skipped: rec.skipped,
          navTimeout: rec.navTimeout,
          capped: rec.capped,
          strictFailed: true,
          rendered: false,
        },
        `STRICT: take recorded but incomplete — ${strictReason(rec)}; NOT rendering. Fix the flow and re-run, or render the partial take with: vos render ${outDir}`,
      )
      return EXIT_USAGE
    }

    const result = await renderTake(browser, outDir, out, {
      width: hasFlag(flags, 'width') ? numFlag(flags, 'width', 0) : undefined,
      height: hasFlag(flags, 'height')
        ? numFlag(flags, 'height', 0)
        : undefined,
      fps: hasFlag(flags, 'fps') ? numFlag(flags, 'fps', 30) : undefined,
      format,
      parallel,
      draft: flags.draft === true,
      overrides: {
        set: multi.set,
        frame: strFlag(flags, 'frame'),
        background: strFlag(flags, 'background'),
        origin: platformOrigin({
          origin: strFlag(flags, 'origin'),
          api: strFlag(flags, 'api'),
        }),
      },
      onPhase: (phase) => {
        r.log(`${phase}…`)
        r.event({ event: 'phase', phase })
      },
      onProgress: (p) =>
        r.event({ event: 'progress', phase: 'render', fraction: p }),
    })
    r.done(
      {
        take: outDir,
        ...result,
        skipped: rec.skipped,
        navTimeout: rec.navTimeout,
        freezes: rec.freezes,
        freezePct: rec.freezePct,
        ...(flags.draft === true ? { draft: true } : {}),
      },
      `Created ${result.out} (${(result.bytes / 1024).toFixed(0)} KB, ${result.width}x${result.height}@${result.fps}, ${result.duration.toFixed(1)}s, ${result.zoomSpans} zoom spans, ${result.clicks} click effects${result.audio ? ', audio' : ''}${flags.draft === true ? ', DRAFT' : ''})\n  take: ${outDir} — inspect with: vos frames ${outDir} --at-zooms; edit doc.json and re-render with: vos render ${outDir}`,
    )
    return EXIT_OK
  } finally {
    await browser.close()
  }
}

async function cmdPlan(argv: string[]): Promise<number> {
  const { positionals, flags } = parseArgs(argv, BOOLEAN_FLAGS)
  const dir = positionals[0]
  if (!dir)
    throw new UsageError(
      'vos plan <take> [--fresh] [--reuse [--from <doc.json>]] [--style <doc.json|vosId>]',
    )
  const r = createReporter(flags.json === true)
  if (flags.fresh === true) {
    await rm(join(dir, 'doc.json'), { force: true })
    r.log('note: --fresh discarded the existing doc.json')
  }
  // The re-render loop: --reuse applies a previous cut of the same
  // script to this take's new footage. Default source is the doc a
  // re-record preserved (doc.prev.json); --from names another.
  let reuse: { from: string; doc: ProjectDoc } | undefined
  if (flags.reuse === true) {
    const from = resolve(strFlag(flags, 'from') ?? join(dir, PREV_DOC_NAME))
    if (!existsSync(from)) {
      throw new UsageError(
        `--reuse: ${from} does not exist — a re-record into this take writes doc.prev.json, or pass --from <doc.json>`,
      )
    }
    reuse = {
      from,
      doc: JSON.parse(await readFile(from, 'utf8')) as ProjectDoc,
    }
  }
  const style = await resolveStyleRef(flags)
  // A refresh keeps the doc's own frame; only a FRESH doc opens on the
  // house backdrop, so the set is read only when there is no doc.json.
  const backdrop = existsSync(join(dir, 'doc.json'))
    ? null
    : await takeBackdrop(flags, r)
  const s = await planTake(dir, {
    ...(style ? { style } : {}),
    ...(reuse ? { reuse } : {}),
    backdrop,
  })
  const reuseLines = s.reuse
    ? `\n  reused ${s.reuse.from}: ${s.reuse.anchored} anchored + ${s.reuse.mapped} mapped span(s)` +
      (s.reuse.flagged.length
        ? `\n  flagged:\n    ${s.reuse.flagged.join('\n    ')}`
        : '')
    : ''
  r.done(
    {
      take: resolve(dir),
      fresh: s.fresh,
      cursorKept: s.cursorKept,
      zoomAuto: s.zoomAuto,
      zoomManual: s.zoomManual,
      duration: s.doc.source.meta.durationMs / 1000,
      ...(s.backdrop !== undefined ? { backdrop: s.backdrop } : {}),
      ...(s.styleFrom
        ? { styleFrom: s.styleFrom, styleFields: s.styleFields }
        : {}),
      ...(s.reuse ? { reuse: s.reuse } : {}),
    },
    `${s.reuse ? 'Reused' : s.fresh ? 'Planned' : 'Refreshed'} ${join(dir, 'doc.json')}: ${s.zoomAuto} auto + ${s.zoomManual} manual zoom spans${s.cursorKept ? '' : ' (cursor track dropped)'}${reuseLines}`,
  )
  return EXIT_OK
}

async function cmdRender(argv: string[]): Promise<number> {
  const { positionals, flags, multi } = parseArgs(
    argv,
    BOOLEAN_FLAGS,
    MULTI_FLAGS,
  )
  const dir = positionals[0]
  if (!dir)
    throw new UsageError(
      'vos render <take> [out] [--width] [--height] [--fps] [--format] [--parallel]',
    )
  const r = createReporter(flags.json === true)
  const fmtRaw = strFlag(flags, 'format') ?? 'webm'
  if (fmtRaw !== 'webm' && fmtRaw !== 'mp4')
    throw new UsageError('--format must be webm or mp4')
  const format = fmtRaw
  const out = positionals[1] ?? join(dir, `out.${format}`)
  const parallel = numFlag(flags, 'parallel', 1)
  if (!Number.isInteger(parallel) || parallel < 1 || parallel > 16) {
    throw new UsageError('--parallel expects an integer between 1 and 16')
  }
  let range: [number, number] | undefined
  const rangeRaw = strFlag(flags, 'range')
  if (rangeRaw !== undefined) {
    const m = /^(\d+(?:\.\d+)?)\.\.(\d+(?:\.\d+)?)$/.exec(rangeRaw)
    if (!m)
      throw new UsageError(
        '--range expects a..b in OUTPUT seconds (e.g. --range 4..8)',
      )
    range = [Number(m[1]), Number(m[2])]
    if (range[1] <= range[0])
      throw new UsageError('--range end must be > start')
  }

  const browser = await launchBrowser()
  try {
    const result = await renderTake(browser, dir, out, {
      width: hasFlag(flags, 'width') ? numFlag(flags, 'width', 0) : undefined,
      height: hasFlag(flags, 'height')
        ? numFlag(flags, 'height', 0)
        : undefined,
      fps: hasFlag(flags, 'fps') ? numFlag(flags, 'fps', 30) : undefined,
      format,
      parallel,
      range,
      draft: flags.draft === true,
      overrides: {
        set: multi.set,
        frame: strFlag(flags, 'frame'),
        background: strFlag(flags, 'background'),
        origin: platformOrigin({
          origin: strFlag(flags, 'origin'),
          api: strFlag(flags, 'api'),
        }),
      },
      onPhase: (phase) => {
        r.log(`${phase}…`)
        r.event({ event: 'phase', phase })
      },
      onProgress: (p) =>
        r.event({ event: 'progress', phase: 'render', fraction: p }),
    })
    r.done(
      {
        ...result,
        ...(range ? { range } : {}),
        ...(flags.draft === true ? { draft: true } : {}),
      },
      `Wrote ${result.out} (${(result.bytes / 1024).toFixed(0)} KB, ${result.width}x${result.height}@${result.fps}, ${result.duration.toFixed(1)}s, ${result.zoomSpans} zoom spans, ${result.clicks} click effects${result.audio ? ', audio' : ''}${result.chunks > 1 ? `, ${result.chunks} parallel chunks` : ''}${range ? `, range ${range[0]}..${range[1]}s` : ''}${flags.draft === true ? ', DRAFT' : ''})`,
    )
    return EXIT_OK
  } finally {
    await browser.close()
  }
}

async function cmdFrames(argv: string[]): Promise<number> {
  const { positionals, flags, multi } = parseArgs(
    argv,
    BOOLEAN_FLAGS,
    MULTI_FLAGS,
  )
  const dir = positionals[0]
  if (!dir)
    throw new UsageError(
      'vos frames <take> [--times 0,50%,100%] [--frame <t>] [--at-zooms] [--size WxH] [--out dir]',
    )
  const r = createReporter(flags.json === true)

  const take = await loadTake(dir)
  if (!take.doc) throw new UsageError(`${dir} has no doc.json — run plan first`)

  let size: { width: number; height: number } | undefined
  const sizeRaw = strFlag(flags, 'size')
  if (sizeRaw !== undefined) {
    const m = /^(\d+)x(\d+)$/.exec(sizeRaw)
    if (!m) throw new UsageError('--size expects WxH (e.g. --size 1280x800)')
    size = { width: Number(m[1]), height: Number(m[2]) }
  }

  // Duration for % times: output-time total (trims/speed applied).
  const duration = totalDuration(ratedSegments(take.doc))
  const frameRaw = strFlag(flags, 'frame')
  const timesRaw = strFlag(flags, 'times')
  const atZooms = flags['at-zooms'] === true
  const atMoments = flags['at-moments'] === true
  let times: number[]
  try {
    times =
      frameRaw !== undefined
        ? parseTimes(frameRaw, duration)
        : timesRaw !== undefined
          ? parseTimes(timesRaw, duration)
          : atZooms || atMoments
            ? []
            : parseTimes('0,25%,50%,75%,100%', duration)
  } catch (e) {
    throw new UsageError(e instanceof Error ? e.message : String(e))
  }

  const browser = await launchBrowser()
  try {
    r.event({ event: 'phase', phase: 'frames' })
    const result = await framesTake(browser, dir, {
      times,
      atZooms,
      atMoments,
      width: size?.width,
      height: size?.height,
      outDir: strFlag(flags, 'out'),
      // NOTE: no --frame alias here — `frames --frame <t>` is the time selector.
      // Set the browser frame via --set frame.browserBar.kind=mac-light.
      overrides: {
        set: multi.set,
        background: strFlag(flags, 'background'),
        origin: platformOrigin({
          origin: strFlag(flags, 'origin'),
          api: strFlag(flags, 'api'),
        }),
      },
    })
    const index = await writeIndexJson(result)
    r.done(
      {
        outDir: result.outDir,
        index,
        width: result.width,
        height: result.height,
        duration: result.duration,
        frames: result.frames,
      },
      `Wrote ${result.frames.length} still(s) to ${result.outDir} (${result.width}x${result.height})\n  ${result.frames.map((f) => `${f.time.toFixed(2)}s${f.kind === 'zoom' ? ' [zoom apex]' : f.kind === 'moment' ? ` [${f.momentId}]` : ''} → ${f.file}`).join('\n  ')}`,
    )
    return EXIT_OK
  } finally {
    await browser.close()
  }
}

async function cmdDeliver(argv: string[]): Promise<number> {
  const { positionals, flags, multi } = parseArgs(
    argv,
    BOOLEAN_FLAGS,
    MULTI_FLAGS,
  )
  const dir = positionals[0]
  const toRaw = strFlag(flags, 'to')
  if (!dir || !toRaw)
    throw new UsageError(
      'vos deliver <take> --to cws,producthunt,x,linkedin,og,github,youtube (or all) [--release v2.1] [--out dir] [--times a,b] [--range a..b] [--json]\n(hosted work: vos pull <id> --media first — deliver runs on a local take)',
    )
  const r = createReporter(flags.json === true)
  if (!isTakeDir(dir))
    throw new UsageError(
      `${dir} is not a take directory (no doc.json) — for hosted work run: vos pull <vosId> --media`,
    )
  let channels: string[]
  try {
    channels = resolveChannels(toRaw)
  } catch (e) {
    throw new UsageError(e instanceof Error ? e.message : String(e))
  }
  let range: [number, number] | undefined
  const rangeRaw = strFlag(flags, 'range')
  if (rangeRaw !== undefined) {
    const m = /^(\d+(?:\.\d+)?)\.\.(\d+(?:\.\d+)?)$/.exec(rangeRaw)
    if (!m)
      throw new UsageError(
        '--range expects a..b in OUTPUT seconds (e.g. --range 4..24)',
      )
    range = [Number(m[1]), Number(m[2])]
    if (range[1] <= range[0])
      throw new UsageError('--range end must be > start')
  }
  const take = await loadTake(dir)
  if (!take.doc) throw new UsageError(`${dir} has no doc.json — run plan first`)
  const duration = totalDuration(ratedSegments(take.doc))
  const timesRaw = strFlag(flags, 'times')
  let times: number[] | undefined
  if (timesRaw !== undefined) {
    // Entries are seconds, percents, or `step:<id>[+offset]` against the
    // take's step timeline (the still is the step's response, settled).
    try {
      const doc = take.doc
      times = timesRaw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => resolveStepTime(doc, s) ?? parseTimes(s, duration)[0])
    } catch (e) {
      throw new UsageError(e instanceof Error ? e.message : String(e))
    }
  }
  const parallel = numFlag(flags, 'parallel', 1)
  if (!Number.isInteger(parallel) || parallel < 1 || parallel > 16) {
    throw new UsageError('--parallel expects an integer between 1 and 16')
  }

  // The poster leg: card-genre destinations render from the maker's poster
  // program (a local config.json, or a hosted vos id read with the key
  // ladder) with this release's shot baked in.
  let poster: { config: Record<string, unknown>; from: string } | undefined
  const posterRef = strFlag(flags, 'poster')
  if (posterRef !== undefined) {
    if (existsSync(posterRef)) {
      poster = {
        from: resolve(posterRef),
        config: JSON.parse(await readFile(posterRef, 'utf8')) as Record<
          string,
          unknown
        >,
      }
    } else {
      const origin = platformOrigin({
        origin: strFlag(flags, 'origin'),
        api: strFlag(flags, 'api'),
      })
      const key = await resolveCredential(strFlag(flags, 'key'))
      const res = (await apiJson(origin, `/api/vos/${posterRef}/config`, {
        key,
      })) as { config?: Record<string, unknown> }
      if (!res.config)
        throw new UsageError(
          `--poster ${posterRef}: not a file on disk and the platform returned no config`,
        )
      poster = { from: posterRef, config: res.config }
    }
  }

  let lookPick: Awaited<ReturnType<typeof resolveLook>>
  try {
    lookPick = await resolveLook(dir, {
      look: strFlag(flags, 'look'),
      brand: strFlag(flags, 'brand'),
    })
  } catch (e) {
    throw new UsageError(e instanceof Error ? e.message : String(e))
  }
  r.log(`look: ${lookPick.from}`)

  const browser = await launchBrowser()
  try {
    const result = await deliverTake(browser, dir, {
      look: lookPick.look,
      channels,
      outDir: strFlag(flags, 'out'),
      release: strFlag(flags, 'release'),
      times,
      range,
      parallel,
      poster,
      posterTime: hasFlag(flags, 'poster-time')
        ? numFlag(flags, 'poster-time', 0)
        : undefined,
      shotTime: hasFlag(flags, 'shot-time')
        ? numFlag(flags, 'shot-time', 0)
        : undefined,
      composed: hasFlag(flags, 'composed'),
      overrides: {
        set: multi.set,
        background: strFlag(flags, 'background'),
        origin: platformOrigin({
          origin: strFlag(flags, 'origin'),
          api: strFlag(flags, 'api'),
        }),
      },
      onPhase: (phase) => {
        r.log(`${phase}…`)
        r.event({ event: 'phase', phase })
      },
      onProgress: (p) =>
        r.event({ event: 'progress', phase: 'deliver', fraction: p }),
    })
    const { kit } = result
    const assetLines = kit.assets.map(
      (a) =>
        `${a.destination} → ${a.path} (${a.w}x${a.h}, ${(a.bytes / 1024).toFixed(0)} KB${a.seconds !== null ? `, ${a.seconds.toFixed(1)}s` : ''}${a.frameTime !== null ? `, frame ${a.frameTime.toFixed(2)}s` : ''}${a.source === 'poster' ? ', poster' : ''})`,
    )
    const skippedLines = kit.skipped.map((s) => `skipped: ${s}`)
    r.done(
      {
        outDir: result.outDir,
        kit: result.kitFile,
        assets: kit.assets,
        skipped: kit.skipped,
      },
      `Wrote ${kit.assets.length} asset(s) + kit.json to ${result.outDir}` +
        (assetLines.length ? `\n  ${assetLines.join('\n  ')}` : '') +
        (skippedLines.length ? `\n  ${skippedLines.join('\n  ')}` : '') +
        `\nStore uploads stay manual: hand the human this directory and the manifest.`,
    )
    return kit.assets.length > 0 ? EXIT_OK : EXIT_ERROR
  } finally {
    await browser.close()
  }
}

/**
 * `--style <doc.json|take dir|vosId>`: the reference doc whose style fields
 * `vos plan` copies and `vos digest` reports. A file or take dir on
 * disk, else a hosted take's head doc read with the key ladder.
 */
async function resolveStyleRef(
  flags: ParsedArgs['flags'],
): Promise<{ from: string; doc: ProjectDoc } | null> {
  const styleRef = strFlag(flags, 'style')
  if (!styleRef) return null
  const file = existsSync(styleRef)
    ? resolve(
        styleRef,
        existsSync(join(styleRef, 'doc.json')) ? 'doc.json' : '',
      )
    : null
  if (file && existsSync(file)) {
    return {
      from: file,
      doc: JSON.parse(await readFile(file, 'utf8')) as ProjectDoc,
    }
  }
  const origin = platformOrigin({
    origin: strFlag(flags, 'origin'),
    api: strFlag(flags, 'api'),
  })
  const key = resolveCredential(strFlag(flags, 'key'))
  const meta = await apiJson(origin, `/api/vos/${styleRef}`, { key })
  const head = (meta.body.vos as { currentVersionId?: string } | undefined)
    ?.currentVersionId
  if (meta.status !== 200 || !head)
    throw new UsageError(
      `--style: ${styleRef} is neither a doc.json nor a vos I can read`,
    )
  const doc = await apiJson(
    origin,
    `/api/vos/${styleRef}/versions/${head}/doc`,
    { key },
  )
  if (doc.status !== 200)
    throw new UsageError(`--style: ${styleRef} carries no doc (is it a take?)`)
  return {
    from: `${origin}/vos/${styleRef}`,
    doc: migrateHostedDoc(doc.body) as unknown as ProjectDoc,
  }
}

async function cmdDigest(argv: string[]): Promise<number> {
  const { positionals, flags } = parseArgs(argv, BOOLEAN_FLAGS)
  const dir = positionals[0]
  if (!dir)
    throw new UsageError(
      'vos digest <take> [--out dir] [--full 960] [--crop 640] [--no-frames] [--transcript <file>] [--style <doc.json|vosId>]',
    )
  const r = createReporter(flags.json === true)
  const take = await loadTake(dir)
  if (!take.doc) throw new UsageError(`${dir} has no doc.json — run plan first`)

  const transcriptPath = strFlag(flags, 'transcript')
  const transcript = transcriptPath
    ? parseTranscript(JSON.parse(await readFile(transcriptPath, 'utf8')))
    : null

  const style = await resolveStyleRef(flags)

  const noFrames = flags['no-frames'] === true
  let browser = null
  if (!noFrames) browser = await launchBrowser()
  try {
    r.event({ event: 'phase', phase: 'digest' })
    const result = await digestTake(browser, dir, {
      outDir: strFlag(flags, 'out'),
      full: strFlag(flags, 'full') ? numFlag(flags, 'full', 0) : undefined,
      crop: strFlag(flags, 'crop') ? numFlag(flags, 'crop', 0) : undefined,
      frames: !noFrames,
      transcript,
      style,
    })
    const d = result.digest
    const kinds = d.moments.reduce<Partial<Record<string, number>>>(
      (acc, m) => {
        acc[m.kind] = (acc[m.kind] ?? 0) + 1
        return acc
      },
      {},
    )
    r.done(
      {
        file: result.file,
        outDir: result.outDir,
        moments: d.moments.length,
        kinds,
        frames: d.images.full,
        crops: d.images.crop,
        sheet: d.images.sheet ? join(result.outDir, d.images.sheet) : null,
        scenes: kinds.scene ?? 0,
        sourceDuration: d.take.sourceDuration,
        outputDuration: d.take.outputDuration,
        hasCursor: d.take.hasCursor,
        tokensEstimate: d.images.tokensEstimate,
        bytes: result.bytes,
      },
      `Wrote ${result.file} — ${d.moments.length} moments (${Object.entries(
        kinds,
      )
        .map(([k, n]) => `${n} ${k}`)
        .join(', ')}), ${d.images.full} frames + ${d.images.crop} crops` +
        (d.images.sheet ? `, sheet.png` : '') +
        ` — ~${d.images.tokensEstimate} image tokens to read them all` +
        (d.take.hasCursor
          ? ''
          : '\n  no cursor track: moments are head/tail/scenes only — pace by activity, zoom only where the ask names a place') +
        `\n  Read digest.json, then the sheet, then a crop only where you must decide.`,
    )
    return EXIT_OK
  } finally {
    if (browser) await browser.close()
  }
}

async function cmdOpen(argv: string[]): Promise<number> {
  const { positionals, flags } = parseArgs(argv, BOOLEAN_FLAGS)
  const dir = positionals[0]
  if (!dir) throw new UsageError('vos open <take> [--studio <url>]')
  const r = createReporter(flags.json === true)
  const take = await loadTake(dir) // validates it IS a take (meta.json)
  if (!existsSync(take.paths.recording)) {
    throw new UsageError(`${dir} has no recording.webm — re-run record`)
  }

  const studio = (strFlag(flags, 'studio') ?? 'http://localhost:6060').replace(
    /\/+$/,
    '',
  )
  const server = await startTakeServer(resolve(dir), {})
  // /studio is the one editor route (older CLIs that open
  // /voila/studio ride a query-preserving 301 forever).
  const url = `${studio}/studio?take=${encodeURIComponent(server.base)}`
  r.event({ event: 'open', server: server.base, url })
  r.log(`take served at ${server.base}`)
  process.stdout.write(flags.json === true ? '' : `${url}\n`)
  if (flags.print !== true) {
    r.log('opening the studio… (Ctrl-C to stop serving)')
    // Best-effort browser launch; the printed URL is the contract.
    const opener =
      process.platform === 'darwin'
        ? 'open'
        : process.platform === 'win32'
          ? 'start'
          : 'xdg-open'
    const { exec } = await import('node:child_process')
    exec(`${opener} ${JSON.stringify(url)}`, () => {})
  } else {
    r.log('serving (— --print: not launching a browser; Ctrl-C to stop)')
  }

  // Serve until interrupted — the studio streams the recording from us.
  await new Promise<void>((resolvePromise) => {
    const stop = () => {
      server.close()
      resolvePromise()
    }
    process.once('SIGINT', stop)
    process.once('SIGTERM', stop)
  })
  return EXIT_OK
}

async function cmdValidate(argv: string[]): Promise<number> {
  const { positionals, flags } = parseArgs(argv, BOOLEAN_FLAGS)
  const target = positionals[0]
  if (!target) throw new UsageError('vos validate <actions.json|take>')
  const r = createReporter(flags.json === true)
  // A kit manifest (deliver's output, or a hand-assembled PR kit): every
  // asset re-measured from its bytes against the channel specs.
  const kitTarget = target.endsWith('kit.json')
    ? target
    : existsSync(join(target, 'kit.json')) && !isTakeDir(target)
      ? join(target, 'kit.json')
      : null
  if (kitTarget) {
    const picture = flags.picture === true
    const verdict = await validateKit(kitTarget, { picture })
    const pictureLines = (verdict.picture ?? []).map(formatFinding)
    const pictureErrors = (verdict.picture ?? []).filter(
      (f) => f.severity === 'error',
    ).length
    const tail =
      (verdict.warnings.length
        ? `\n  warnings:\n  ${verdict.warnings.join('\n  ')}`
        : '') +
      (picture
        ? `\n  picture: ${pictureErrors} problem(s), ${(verdict.picture ?? []).length - pictureErrors} note(s)` +
          (pictureLines.length ? `\n  ${pictureLines.join('\n  ')}` : '')
        : '')
    if (!verdict.valid) {
      r.done(
        { ...verdict, target: kitTarget },
        `${kitTarget}:${verdict.problems.length ? `\n  ${verdict.problems.join('\n  ')}` : ''}${tail}`,
      )
      return EXIT_ERROR
    }
    r.done(
      { ...verdict, target: kitTarget },
      `${kitTarget}: ${verdict.measured.length} asset(s) match their bytes and their specs${tail}`,
    )
    return EXIT_OK
  }
  if (target.endsWith('.json')) {
    await loadActions(target)
    r.done({ valid: true, target }, `${target}: valid actions file`)
    return EXIT_OK
  }
  // A PROGRAM directory: config.json plus, optionally, a program
  // document — lint the document's shared layers against the program.
  if (!isTakeDir(target) && existsSync(join(target, 'config.json'))) {
    const parsed = JSON.parse(
      await readFile(join(target, 'config.json'), 'utf8'),
    ) as unknown
    const pre = preflightConfig(parsed)
    const problems = pre.ok ? [] : pre.issues.map((i) => `config.json: ${i}`)
    const warnings: string[] = []
    const doc = pre.config ? await readProgramDoc(target, pre.config) : null
    if (doc) {
      const lint = lintDoc(doc as never)
      problems.push(...lint.problems.map((p) => `doc.json: ${p}`))
      warnings.push(...lint.warnings.map((w) => `doc.json: ${w}`))
    }
    {
      const urls = [
        ...collectConfigMediaUrls(pre.config ?? parsed),
        ...collectDocMediaUrls(doc),
      ]
      const probe = mediaProbeLints(await probeMediaUrls([...new Set(urls)]))
      problems.push(...probe.problems)
      warnings.push(...probe.warnings)
    }
    if (problems.length) {
      r.done(
        { valid: false, target, problems, warnings },
        `${target}:\n  ${problems.join('\n  ')}${warnings.length ? `\n  warnings:\n  ${warnings.join('\n  ')}` : ''}`,
      )
      return EXIT_ERROR
    }
    r.done(
      { valid: true, target, warnings, doc: !!doc },
      `${target}: program${doc ? ' + document' : ''} is valid${warnings.length ? `\n  warnings:\n  ${warnings.join('\n  ')}` : ''}`,
    )
    return EXIT_OK
  }
  const take = await loadTake(target)
  const problems: string[] = []
  const warnings: string[] = []
  if (!existsSync(take.paths.recording))
    problems.push('missing recording.webm (re-run record)')
  if (!take.doc) problems.push('missing doc.json (run plan)')
  if (take.doc) {
    const lint = lintDoc(take.doc)
    problems.push(...lint.problems.map((p) => `doc.json: ${p}`))
    warnings.push(...lint.warnings.map((w) => `doc.json: ${w}`))
    const probe = mediaProbeLints(
      await probeMediaUrls(collectDocMediaUrls(take.doc)),
    )
    problems.push(...probe.problems)
    warnings.push(...probe.warnings)
  }
  if (problems.length) {
    r.done(
      { valid: false, target, problems, warnings },
      `${target}:\n  ${problems.join('\n  ')}${warnings.length ? `\n  warnings:\n  ${warnings.join('\n  ')}` : ''}`,
    )
    return EXIT_ERROR
  }
  r.done(
    { valid: true, target, warnings },
    `${target}: take is complete and renderable${warnings.length ? `\n  warnings:\n  ${warnings.join('\n  ')}` : ''}`,
  )
  return EXIT_OK
}

async function cmdPush(argv: string[]): Promise<number> {
  const { positionals, flags, multi } = parseArgs(
    argv,
    BOOLEAN_FLAGS,
    MULTI_FLAGS,
  )
  const dir = positionals[0]
  if (!dir)
    throw new UsageError(
      'vos push <take> [--title|--label|--note|--folder|--override|--yes|--key|--api]',
    )
  const r = createReporter(flags.json === true)
  // Index access is typed present but is runtime-optional — pushTake guards.
  const overrides = multi.override
  const result = await pushTake(
    resolve(dir),
    {
      key: strFlag(flags, 'key'),
      api: strFlag(flags, 'api'),
      origin: strFlag(flags, 'origin'),
      yes: flags.yes === true,
      title: strFlag(flags, 'title'),
      label: strFlag(flags, 'label'),
      note: strFlag(flags, 'note'),
      folder: strFlag(flags, 'folder'),
      overrides,
    },
    r,
  )
  r.done(
    { ...result },
    `pushed v${result.versionNumber} → vos ${result.vosId}\n  review: https://vos.so/vos/${result.vosId}\n  studio: https://vos.so/studio?vos=${result.vosId}`,
  )
  return EXIT_OK
}

async function cmdPull(argv: string[]): Promise<number> {
  const { positionals, flags } = parseArgs(argv, BOOLEAN_FLAGS, MULTI_FLAGS)
  const dir = positionals[0] ?? '.'
  const r = createReporter(flags.json === true)
  const result = await pullTake(
    resolve(dir),
    {
      key: strFlag(flags, 'key'),
      api: strFlag(flags, 'api'),
      origin: strFlag(flags, 'origin'),
      vos: strFlag(flags, 'vos'),
      media: flags.media === true,
      since: strFlag(flags, 'since'),
      check: flags.check === true,
    },
    r,
  )
  if (result.checked) {
    r.done(
      { ...result },
      result.behind === null
        ? `${result.vosId}: head is ${result.versionId.slice(0, 8)}… — no base to count from; run without --check to sync`
        : result.behind === 0
          ? `${result.vosId}: up to date`
          : `${result.behind} version${result.behind === 1 ? '' : 's'} behind — run without --check to sync`,
    )
    return EXIT_OK
  }
  const mediaLine = result.media
    ? result.media.downloaded.length
      ? ` + ${result.media.downloaded.map((m) => m.file).join(', ')} (footage home — digest/frames/render run here now)`
      : result.media.kept.length
        ? ` (footage already here: ${result.media.kept.join(', ')})`
        : ' (no hosted media on this doc)'
    : ''
  r.done(
    { ...result },
    (result.changed
      ? `pulled v${result.versionNumber ?? '?'} into doc.json — your edit loop continues from the human's version`
      : 'up to date') + mediaLine,
  )
  return EXIT_OK
}

/** Entry point — the delegation contract for @vosjs/cli: the host forwards
    every non-engine verb here (`vos <verb>`; `vos voila <verb>` stays a
    hidden alias until public launch). The exported `manifest` (index.ts)
    tells the host which verbs exist and how to summarize them in help. */
export async function run(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv
  try {
    if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
      process.stdout.write(HELP)
      return cmd ? EXIT_OK : EXIT_USAGE
    }
    switch (cmd) {
      case 'create':
        return await cmdCreate(rest)
      case 'record':
        return await cmdRecord(rest)
      case 'plan':
        return await cmdPlan(rest)
      case 'render':
        return await cmdRender(rest)
      case 'frames':
        return await cmdFrames(rest)
      case 'deliver':
        return await cmdDeliver(rest)
      case 'digest':
        return await cmdDigest(rest)
      case 'open':
        return await cmdOpen(rest)
      case 'validate':
        return await cmdValidate(rest)
      case 'fetch':
        return await cmdFetch(rest)
      case 'duplicate':
        return await cmdDuplicate(rest)
      case 'login':
        return await cmdLogin(rest)
      case 'push': {
        // Polymorphic by the deterministic sniff: a take DIRECTORY (doc.json)
        // pushes recording + doc; anything else is a program config push.
        const target = rest.find((a) => !a.startsWith('-'))
        if (target && isTakeDir(target)) {
          if (rest.includes('--claimable')) {
            throw new UsageError(
              '--claimable pushes are PROGRAMS only (a config.json) — takes carry recordings, which need an account: vos login, then vos push',
            )
          }
          return await cmdPush(rest)
        }
        return await cmdPushProgram(rest)
      }
      case 'pull': {
        const target = rest.find((a) => !a.startsWith('-')) ?? '.'
        return isTakeDir(target)
          ? await cmdPull(rest)
          : await cmdPullProgram(rest)
      }
      case 'folder':
        return await cmdFolder(rest)
      case 'asset':
        return await cmdAsset(rest)
      case 'recipe':
        return await cmdRecipe(rest)
      case 'brand':
        return await cmdBrand(rest)
      case 'actions':
        return await cmdActions(rest)
      default:
        throw new UsageError(`unknown command "${cmd}" — run: vos help`)
    }
  } catch (e) {
    if (e instanceof UsageError) {
      process.stderr.write(`usage error: ${e.message}\n`)
      return EXIT_USAGE
    }
    if (e instanceof BrowserUnavailableError) {
      process.stderr.write(`${e.message}\n`)
      return EXIT_NO_BROWSER
    }
    process.stderr.write(
      `error: ${e instanceof Error ? e.message : String(e)}\n`,
    )
    return EXIT_ERROR
  }
}
