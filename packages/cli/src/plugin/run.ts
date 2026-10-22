import { videoFormat } from '../outputs'
import { landedLines, waitForLanded } from './landed'
import { mkdir, readFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  END_CARD_FROM,
  docOutputDuration,
  migrateHostedDoc,
} from '@vosjs/studio-core'
import { UsageError, hasFlag, numFlag, parseArgs, strFlag } from './args'
import {
  EXIT_ERROR,
  EXIT_NO_BROWSER,
  EXIT_OK,
  EXIT_USAGE,
  EXIT_WALL,
  createReporter,
} from './output'
import { validateActions } from './actions'
import { lintDoc } from './validateDoc'
import { containerMismatch } from './container'
import { readMediaHead } from './media'
import {
  collectConfigMediaUrls,
  collectDocMediaUrls,
  mediaProbeLints,
  probeMediaUrls,
} from './mediaProbe'
import {
  framesTake,
  parseTimes,
  unrenderedZoomLine,
  writeIndexJson,
} from './framesTake'
import {
  deliverTake,
  readLaunchBesideTake,
  resolveChannels,
  resolveLook,
  readBrandBesideTake,
} from './deliver'
import { launchDefaultBrowser } from './login'
import { fetchBrandMarks } from './markAsset'
import { endCardInk } from './motionPlan'
import type { MotionAnchor, MotionTemplate } from './motionPlan'
import { OFFICIAL_END_CARD_TITLE, findOfficialByRef } from './officialTemplates'
import type { OfficialRow } from './officialTemplates'
import { fetchMusicCatalog } from './music'
import {
  composeCallout,
  footageFrames,
  groundFindings,
  isCalloutShape,
  registerFrom,
} from './callout'
import { formatFinding } from './kitPicture'
import { validateKit } from './validateKit'
import { digestTake, parseTranscript } from './digestTake'
import {
  apiJson,
  platformOrigin,
  promptHint,
  readSyncState,
  requireCredential,
  resolveCredential,
} from './platform'
import { startTakeServer } from './server'
import {
  PREV_DOC_NAME,
  dropScreencastFrames,
  ensureTakeDir,
  loadTake,
  prepareReRecord,
  takePaths,
  writeJson,
} from './take'
import { deadLine, deadWarns } from './pace'
import type { TakePaths } from './take'
import { BrowserUnavailableError, launchBrowser } from '../browser'
import { recordTake } from './recorder'
import type { RecordResult, SkippedStep } from './recorder'
import {
  RecordRefusedError,
  guardVerdict,
  guardedSteps,
  hostedRefusals,
  readyProblem,
} from '@vosjs/render-core/record'
import type { ReadyMode, ReadyReport } from '@vosjs/render-core/record'
import { WALL_PROBE, WallError, wallVerdict } from './wall'
import { EXPOSURE_ADVICE, exposureLine } from './exposure'
import { SetupEnvError, SetupError, parseHeaders } from './setup'
import {
  listSessions,
  openSession,
  removeSession,
  sessionDir,
  sessionNameVerdict,
  summarizeSession,
  summaryLine,
  withSession,
} from './session'
import type { Arrival, WallVerdict } from './wall'
import type { Reporter } from './output'
import {
  defaultMaxDurationSeconds,
  formatDurationCap,
  hostedRecordingCap,
} from './recordingCap'
import { encodeRecording } from './encode'
import { planTake } from './plan'
import { openingBackdrop } from './backdrops'
import { renderTake } from './renderTake'
import { pullTake, pushTake, pushTakeClaimable, takePushRefusal } from './sync'
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
import { cmdDelete } from './remove'
import { cmdRestore, cmdTrash } from './trash'
import { cmdBuild } from './buildProgram'
import { cmdCompare } from './compare'
import { cmdPort } from './port'
import { cmdRecipe } from './recipe'
import { cmdBrand } from './brand'
import { announceEnvNames, hostedEnv, recordHosted } from './hostedRecord'
import { urlSchemeProblem } from '@vosjs/render-core/record'
import { cmdActions } from './agentBrowser'
import { cmdIngest } from './ingest'
import { cmdCheckVideo } from './checkVideo'
import { cmdJoin } from './join'
import { cmdScore } from './score'
import { bareCaptionsFlag, landStepCaptions } from './stepCaptions'
import type { StepCaptionReport } from './stepCaptions'
import { cmdLook } from './look'
import { cmdDoctor, cmdLogout, cmdSetup, cmdWhoami } from './machineCmd'
import type { Backdrop, ProjectDoc } from '@vosjs/studio-core'
import type { ActionsFile } from './actions'
import type { ParsedArgs } from './args'

const BOOLEAN_FLAGS = new Set([
  'json',
  'help',
  'wait',
  'picture',
  'fresh',
  'reuse',
  'strict',
  'draft',
  'at-zooms',
  'at-moments',
  'at-still',
  'no-frames',
  'media',
  'print',
  'yes',
  'check',
  'motion',
  'leader',
  'keep-frames',
  'dry-run',
  'allow-wall',
  'hosted',
  'claimable',
  'share',
  'verbose',
])
/** Repeatable value flags (accumulate): --set path=value on render/frames, --override id on push, --browser-arg=<switch> and --confirm <id> on record/create. */
export const MULTI_FLAGS = new Set([
  'set',
  'override',
  'browser-arg',
  'header',
  'confirm',
])

export const HELP = `vos — record a browser flow, plan effects, render a product video; sync with vos.so

Take pipeline
  vos create --actions actions.json [--url <url>] [--out take] [out.webm] [--strict] [--allow-wall] [--keep-frames] [--max-duration <s>] [--ready settle|networkidle] [--storage-state <file>|--session <name>] [--header name=value]... [--confirm <id>]... [--browser-arg=<switch>]... [--background <slug|url|none>] [render flags] [--json]
  vos record --actions actions.json [--url <url>] [--out take] [--strict] [--dry-run] [--allow-wall] [--keep-frames] [--max-duration <s>] [--ready settle|networkidle] [--storage-state <file>|--session <name>] [--header name=value]... [--confirm <id>]... [--browser-arg=<switch>]... [--background <slug|url|none>] [--verbose] [--json]
  vos record --hosted --actions actions.json [--url <url>] [--out take] [--title "…"] [--folder <id>] [--header name=value]... [--json]
            the take recorded on vos.so's fleet (no browser here): lands as a private vos with its doc and digest, then fetched into --out with its media
  vos plan <take> [--fresh] [--reuse [--from <doc.json>]] [--style <doc.json|vosId>] [--with <doc.json|vosId>[@end|@start|@step:<id>|@<s>]]... [--background <slug|url|none>] [--motion] [--headline "…"] [--kicker "…"] [--launch LAUNCH.md] [--brand BRAND.md] [--music <slug|mood|none>] [--entrance tilt-in|pull-out|rise|fade|slide|none] [--transitions slide|fade|scale|none] [--end-card on|none|<doc.json|vosId>] [--captions|--captions none] [--clicks none] [--still <t>] [--release v2.1] [--json]
  vos render <take> [out.webm] [--width] [--height] [--fps] [--format webm|mp4] [--parallel N] [--range a..b] [--draft] [--frame <kind>] [--background <url|slug>] [--set <path=value>]... [--json]
  vos frames <take> [--times 0,25%,50%,75%,100%] [--frame <t>] [--at-zooms] [--at-moments] [--at-still] [--size WxH] [--out dir] [--background <url|slug>] [--set <path=value>]... [--strict] [--json]
            --at-zooms stills every zoom span's apex on every media of the take and renders it again with the zooms off: a zoom whose frame matches its zoom-off twin did not render, and says so (exit 2 under --strict)
  vos check-video <file.mp4|webm> [--out dir] [--strict] [--json]
            the rendered file itself, no ffmpeg: duration, size, codecs, resolution, frame rate; full-frame scene changes (a warning when a 5 s window holds more than one); loudness (short-term every 3 s, integrated, sample peak; a warning below -23 or above -9 LUFS); the first and last frames as PNGs (a warning when either is near-uniform). Exit 2 on any warning under --strict
  vos deliver <take> --to youtube,x,shorts,github (or all) [--look plate|gradient|dark|none] [--brand BRAND.md] [--set path=value] [--release v2.1] [--out dir] [--range a..b] [--parallel N] [--json]
  vos digest <take> [--out dir] [--full 960] [--crop 640] [--no-frames] [--transcript <file.json>] [--style <doc.json|vosId>] [--json]
  vos brand <url> [--out BRAND.md] [--json]
  vos open <take> [--studio <url>] [--print]
  vos callout <take> <note|tag|code> --step <id> [--title "…"] [--body "…"] [--kicker "…"] [--code "…"|--code-file f] [--seconds 3] [--side auto|right|left|below|above] [--mark ring|underline|none] [--leader] [--color #hex (the mark and leader; the kicker is --accent)] [--brand BRAND.md] [--ground #hex] [--accent #hex] [--font "…"] [--body-px <n> (the body size on the delivered frame)] [--id x] [--print] [--json]
  vos validate <actions.json|take|kit.json> [--picture] [--json]
  vos actions from-agent-browser <steps.jsonl> [--out actions.json] [--url <url>] [--viewport WxH] [--json]
  vos ingest <video.webm|mp4> [--cursor <trace.zip|steps.jsonl|cursor.csv>] [--as footage|take] [--out take] [--offset <ms>] [--viewport WxH] [--background <slug|url|none>] [--json]
            a take from a recording someone else made (a cloud agent's PR video, a Playwright run's video, a Loom export): the file becomes recording.<container>, meta.json from its own dimensions and duration, and a trace beside it becomes cursor.json so the planner has clicks to zoom on; without one, nothing is planned and the done event says so. Without a trace the file opens as FINISHED footage (a render from HyperFrames or Remotion, a film): no card, no browser bar, no drawn cursor, its own frame rate; --as take gives a screen demo the card
  vos join <take> <take|file.mp4>... --out <dir> [--force] [--captions] [--mute <file>]... [--json]
            several takes (and plain video files) as ONE take, cut in argument order: the first is the primary (its frame, cursor, export and sound), each next one a media m1, m2, … with its footage copied, its spans tagged and renamed, its layers moved to where it now starts; a file opens full-bleed and its own sound plays as an audio clip (--mute <file> leaves it out). --captions lands every step's caption anchored to its step, each ending with its clip. The result must pass vos validate before anything is written
  vos score <take> --track <slug|file> [--at <step id|output seconds>] [--gain 0..1] [--fade-in <s>] [--fade-out <s>] [--dry-run] [--json]
            the film's music as one audio clip (id score): reads the track's loudness, finds its strongest swell and offsets the track so the swell lands at --at (a step, resolved through the cut, or output seconds); without --at it starts where the track first rises above its median level
  vos port inventory <page.html|project dir> [--render <their render.mp4>] [--out port] [--json]
            a finished piece (a HyperFrames composition, a Remotion project bundled with its own bundler, a hand-rolled page) read as a browser renders it: words, palette, faces (catalog or missing), media, scenes, gaps → port/inventory.json, with stills from its render
  vos port scaffold [--from port/inventory.json] [--out port/program] [--json]
            a data-first program from it: every word a bound element, every colour a key, knobs, a label and a TODO per scene, the score as a doc.json track, port/REPORT.md
  vos build <program.mjs> [--out config.json] [--json]
            real functions → config.json, refusing a module-scope read, syntax the page cannot run and non-JSON data; config.sources.json maps each function to its line
  vos compare <program dir|config.json> --against <their render.mp4> [--times a,b,50%] [--every 1] [--threshold 0.95] [--out compare] [--json]
            per-frame SSIM and source | vos | difference sheets; exit 1 when ANY frame is under the threshold (needs ffmpeg)
  vos look <url> [--session <name>|--storage-state <file>] [--viewport WxH] [--headed] [--click <selector>]... [--type <selector>=<text>]... [--wait <ms>] [--header name=value]... [--browser-arg=<switch>]... [--out look] [--json]
            see a page before scripting it, signed in the way vos record would be: <out>/look.png and every control in view with ONE proposed selector (test id, aria-label, role + name, then words in its dialog or landmark), UNIQUE or AMBIGUOUS as the recorder's own engine counts it, plus what the frame exposes. --click/--type run first, in order; a click on a spend or delete word is refused. Exit 4 at a sign-in wall
  vos session open <url> --name <app>   a plain Chrome window on a vos-owned profile; sign in, close it
  vos session check <name> [--url <url>]   headless: does the session still open the page? exit 0/4
  vos session list | rm <name>          what exists and how old; delete one
  vos actions script <actions.json> [--json]
            the flow as numbered beats in words, for a person recording it by hand

This machine (no account)
  vos setup [--agent claude,cursor,codex,copilot|all] [--global] [--no-skills] [--skills-from-catalog] [--no-rules] [--no-browser] [--url <dev server>] [--json]
            ready this computer for the loop: the vos skills into your
            agent's directories (the copy bundled in this package, or with
            --skills-from-catalog the same tag through skills.sh), a
            browser found or installed, one idempotent block in AGENTS.md
            (or CLAUDE.md), then doctor.
            NDJSON whenever stdout is not a TTY; done carries next_step
  vos doctor [--url <dev server>] [--json]
            what is ready, in words: node, browser, ffmpeg, the skills per
            agent, a credential (present or absent, never printed), and the
            dev server when --url names one. Exit 3 when no browser
  vos whoami [--json]
            the key's name and the account it belongs to, never the key
  vos logout [--json]
            remove ~/.config/vos/credentials (VOS_API_KEY still resolves)

Platform (vos.so) — fetch, edit, push, pull, repeat
  vos login [--key <vos_sk_…>] [--handoff <url>] [--label <name>] [--no-browser]
            sign in via the browser (approve at vos.so/cli/auth; works
            headless — print the URL, a human approves, the key stores
            itself). --key skips the browser (mint at vos.so/app/api).
            --handoff https://vos.so/h/… exchanges the setup link a
            signed-in person's line carries for a key, once, no click
  vos fetch <vosId|watch-url> [--out dir] [--media] [--json]
            writes config.json + vos.json (no auth needed for public programs);
            a take vos also gets its doc.json, and --media its footage
  vos push  <config.json|take> [--vos id] [--title t] [--slug s] [--remix-of id]
            [--desc d] [--tags a,b] [--folder <folderId|slug>]
            [--note n] [--label l] [--base versionId] [--override <id>]... [--yes] [--json]
            [--claimable] [--wait] [--still <seconds>]
            a take DIRECTORY (doc.json) pushes recording + doc; a config.json
            pushes the program. No --vos: create a PRIVATE vos; with --vos:
            add a version against the tracked base — a stale push 409s WITH
            the platform's typed changelog. A TAKE pushes to the vos in its
            vos.json; --vos on a take with none ADOPTS that vos (the take
            becomes its next version, built on its head), and --vos that
            disagrees with vos.json is refused before anything uploads. --claimable (NO
            credential): creates a 72h claim link instead — hand it to the
            user and nowhere else; unclaimed work is deleted after 72h. On a
            take it is for a REMIX of a public take fetched with --media: it
            uploads nothing, so every file must be one the fetch brought home,
            unchanged, and it credits the take it came from.
            --override consents to touching
            protected (human-edited) nodes, ONLY when the user asked.
            Without --folder a new vos lands unfiled, at the root of your
            shelf. A document's local files (doc.json: picture and video
            overlays, 3D props, sound; a take's mic and cam too) upload
            with the push, each once. --wait stays until the version's still has
            rendered and prints absolute still and preview links.
            --still <seconds> sets a PROGRAM's cover (doc.json "still", kept
            by every later push); without it the platform picks an early
            frame. A take's cover is its doc.json "still".
  vos delete <vosId|watch-url|dir> [--yes] [--dry-run] [--json]
            move a vos to Trash on vos.so. Nothing is erased: it stays
            restorable until the date the delete prints (vos restore <id>).
            Asks on a terminal; headless it needs --yes. --dry-run names
            what would move and changes nothing. A dir that tracked it is
            unlinked (its vos.json removed). Needs a key with the delete
            scope; no key can delete forever, only the person can, on the
            web
  vos trash [--json]
            what is in Trash on vos.so: what, moved by whom, restorable
            until when
  vos restore <id|watch-url> [...] [--json]
            bring those back from Trash, as they were
  vos trash restore --since <30m|1h|2d|ISO> [--by <key name>] [--json]
            undo everything this key (or the named one) moved to Trash
            since then
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
            add files to your library: models, pictures and SVGs, fonts,
            HDR maps, sound, video, captions and recipes. The platform
            reads each file and answers what it is; the same bytes twice
            are the same file. Prints, per file, what was read, its
            asset:<id>, the url a doc.json key takes, and the line that
            declares it in a program's "assets"
  vos asset import <url> [--name <file>] [--folder <slug>]
                         [--license <text>] [--attribution <text>]
            fetch a file from an address and add it, with where it came
            from kept beside it. Say the license: it is what lets the
            next person use the file
  vos assets ls [--kind <kind>] [--folder <slug>|none] [--q <text>]
                [--sort recent|size|name] [--limit <n>]
            what is in your library: id, kind, size, whether a program
            uses it, and whether it is a library file or attached to a
            document
  vos assets usage
            storage held, of how much, and the part in Trash; uploads in
            the last 24 hours per kind against each daily rate
  vos assets why <assetId>
            every program that uses a file, and how (in what plays now,
            in history, in a draft): why it is kept
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
step ran); a human span follows the step it was made on (its window, or
the gesture just before it), keeping its offset exactly, or an explicit
anchor {step, at, offset}; a span between steps maps piecewise through
matched step edges; a span whose step vanished is dropped and named with
what it framed; autos re-plan; a layer pinned to a step follows its new
output time, every other layer and audio keep OUTPUT times, and a layer
over a step that moved is named with the pin to write. The done event's
reuse block NAMES whatever could not follow — fix by exception, never
re-cut from scratch. Give steps ids in actions.json so re-timing survives
script edits.

record --strict exits 2 when any selector was skipped, an expect never
held, a click landed on a disabled control, an await timed out, or the
take hit --max-duration (the done event lists skipped[], disabled[] and
capped either way). Step 1 runs once the first page has stopped changing
(after load, 800 ms with no DOM change, at most 8 s); --ready networkidle
(or "ready" in actions.json) waits for network idle instead, at most 45 s,
which a page holding a socket open never reaches. The done event's ready
{ mode, ms, capped } says how it settled; navTimeout is true only when
networkidle was asked for and never came; neither is a strict failure. --max-duration defaults to
the hosted recording cap, read live from GET /api/limits (30 min when the
origin is unreachable): the capture stops there and says so in one line.
Three steps beyond the gestures: expect checks the page on camera
(selector, text or gone; enabled; timeout 5 s); await waits OFF camera
(until {selector|text|gone}, timeout 600 s, poll 2 s, reload, onTimeout
fail|continue), so the footage has no gap and the cut lands in
meta.skips[] and becomes a segment boundary; download keeps a file the page
makes in the take's outputs/ (selector: the download a click starts; src:
the currentSrc of a video, audio or img; as: the file name), listed in
meta.outputs[]. Sound the page plays (a video or audio element heard,
not muted) lands in meta.media[] with the footage stretches it was heard;
its file is fetched into page-sound/ and the plan places it as audio
clips with source "page", which a re-plan replaces. A click, press or type with "guard": "spend" costs
something real: --dry-run hovers it and never presses, and record presses
it only with --confirm <id> (repeatable), refusing before any capture
otherwise. --hosted refuses guarded and download steps.
frames captures PNG stills at OUTPUT times (seconds or % of duration);
--at-zooms adds every zoom span's apex, --at-moments every digest moment —
the agent's eyes (--size WxH for an exact size). render
--range a..b --draft spot-checks a doc edit in seconds (half res, low
bitrate; range in OUTPUT seconds); a --range render keeps its audio.
deliver renders the take to a release's video destinations in one pass —
the channel specs (schema/channel-specs.json, verified sizes for a YouTube
demo, an X feed cut, a 9:16 cut for Shorts and LinkedIn, a GitHub README
loop) drive each cut at exact pixels, every artifact is VERIFIED against
its spec (px, bytes, duration; misses land in skipped[] with the reason),
and kit.json beside the assets is the manifest. --range cuts every
destination. A channel with no video destination is refused in words.
The LOOK presents the card: every cut sits on a ground (a cream plate,
the house gradient, a dark plate with a light streak) at ~84% of the width
with headroom, a soft ambient shadow plus a tight contact shadow, and a
hairline when card and ground are both light; a wide frame runs the card
off the bottom. --look picks a house look (or none for the doc's own
frame); with no flag the BRAND.md beside the take (or --brand <file>)
decides from its look role or its own ground, and with no brand the house
gradient.
plan --style <doc.json|vosId> copies a signed-off take's layout onto this
one (its card placement, its stage clips with the release's words patched
in from LAUNCH.md's headline and kicker roles or --headline and --kicker,
its rest lean, its freeze), or edit doc.json by hand.
The cut's MOTION is the document's too, in ONE vocabulary: every visual
thing (the card, a text, image or video clip, a prop) carries anim.enter,
anim.exit and anim.idle; the output lasts until the last clip ends, and
the card leaves with its clip (a freeze keeps it under what follows).
There is no end-card field and no entrance field: a
COMPONENT is a TEMPLATE, a plain take on a shelf whose clips carry stable
ids, laid onto the take at an anchor (LAUNCH.md with: <ref>[@end|@start|
@step:<id>|@<s>], comma list; --with the same, repeatable; endCard: <ref>
names one at the end), its clips stamped with where they came from
(from). plan proposes on a fresh plan (--motion re-proposes, replacing
only its own work): the card's ENTER (tilt-in by default), the templates
named, the END CARD when endCard is on or absent (the official End card
template on vos.so, laid at the end with the release's words, the mark
from BRAND.md logoUrl and a freeze of the last frame under it, from:
endcard; offline, the house clips stand in), a CAPTION per
actions.json step at the step's moment, a music BED from LAUNCH.md's music
role (a catalog slug or a mood) and a click sound on every press when the
take has no mic. LAUNCH.md's entrance, transitions, endCard, captions, music and clicks
roles, or the flags, change or switch each off; a deleted proposal stays
deleted on a refresh. deliver applies each destination's MECHANICS and
nothing more: the README loop drops the card's motion, every clip a
template placed and every sound; a channel that autoplays muted drops the
bed; the 9:16 cut is a reframe, not a letterbox, and the crop follows
the camera. --set
path=value overrides the doc in memory for every render here (the user's
sets apply last). Uploads stay manual: hand the human the kit
directory, then vos validate <kit.json> re-measures every cut from its
bytes against the channel specs; --picture adds what each cut LOOKS like:
its first and last frames, read through ffmpeg, must not be blank or bled
on all four sides. Every finding carries a code, a severity and a fix
hint; an error fails the verdict beside the spec problems.
brand writes the product's BRAND.md, witnessed: it reads /design.md when
the site publishes one (the convention beside /llms.txt: fonts, logo assets,
an avoid list), /llms.txt for the name and the claim, then the page itself
in a browser (the body ground, the surfaces, the h1 and body faces and inks,
the accent buttons and links agree on, theme-color, the icons, og:image).
The frontmatter carries the brand's roles (bgA/bgB/bgC, ink, accent,
fontDisplay, logoUrl); the prose says where every value came
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
serving until Ctrl-C. The studio is https://vos.so by default (VOS_ORIGIN
moves it; --studio http://localhost:6060 for a dev server).

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
  disabled?: unknown[]
  capped: boolean
  masks?: { selector: string; hits: number }[]
  meta?: { steps?: { do: string; timedOut?: boolean }[] }
}): string {
  const parts = [`${rec.skipped.length} skipped step(s)`]
  if (rec.disabled?.length)
    parts.push(`${rec.disabled.length} click(s) on a disabled control`)
  const timedOut = timedOutAwaits(rec)
  if (timedOut) parts.push(`${timedOut} await(s) that timed out`)
  if (rec.capped) parts.push('stopped at --max-duration')
  const missed = maskMisses(rec)
  if (missed.length)
    parts.push(
      `${missed.length} mask(s) that hid nothing (${missed.join(', ')}): whatever they were for may be showing`,
    )
  return parts.join(' + ')
}

/** How many awaits gave up and let the take go on (`onTimeout: "continue"`). */
function timedOutAwaits(rec: {
  meta?: { steps?: { do: string; timedOut?: boolean }[] }
}): number {
  return (rec.meta?.steps ?? []).filter((s) => s.do === 'await' && s.timedOut)
    .length
}

/**
 * What `--strict` fails a take on: a skipped step (a selector that never
 * appeared, an expect that never held, a download that never came), a
 * click on a disabled control, an await that timed out, the cap, a mask
 * that hid nothing. Never a first load that missed networkidle: plenty of
 * real apps hold a socket open for good and never go network-idle, so that
 * is a warning (`navTimeout` in the done event), or every take of them
 * would fail.
 */
export function strictFails(rec: RecordResult): boolean {
  return (
    rec.skipped.length > 0 ||
    rec.disabled.length > 0 ||
    timedOutAwaits(rec) > 0 ||
    rec.capped ||
    maskMisses(rec).length > 0
  )
}

/**
 * `--ready settle|networkidle`: when the first page counts as ready, over
 * the script's own `ready`. Folded into the actions, so the take's
 * actions.json says how it was recorded and a hosted take carries it.
 */
function withReady(
  actions: ActionsFile,
  flags: ParsedArgs['flags'],
): ActionsFile {
  const asked = strFlag(flags, 'ready')
  if (asked === undefined) return actions
  const problem = readyProblem(asked)
  if (problem) throw new UsageError(`--${problem}`)
  return { ...actions, ready: asked as ReadyMode }
}

/**
 * The note a take or rehearsal prints when the first load gave up waiting:
 * network idle never came (asked for with `ready: "networkidle"`), or the
 * page never stopped changing within the settle's cap.
 */
function navTimeoutNote(rec: {
  navTimeout: boolean
  ready?: ReadyReport
}): string {
  if (rec.navTimeout)
    return '\n  note: the first load never reached networkidle (a page holding a socket open never does); recorded anyway. The default, ready "settle", waits for the page to stop changing instead'
  if (rec.ready?.mode === 'settle' && rec.ready.capped)
    return `\n  note: the first page was still changing after ${(rec.ready.ms / 1000).toFixed(1)} s (an animation, a ticker); the take started anyway. Give step 1 a wait if the page needs longer`
  return ''
}

/** The sound the page played, as the take-ready line says it. */
function pageSoundNote(rec: Pick<RecordResult, 'media'>): string {
  const heard = rec.media.filter((m) => m.intervals.length)
  if (!heard.length) return ''
  const kept = heard.filter((m) => m.file)
  const lost = heard.filter((m) => !m.file)
  return `\n  page sound: ${heard.length} source(s) heard; ${kept.length} kept in page-sound/ and placed as audio clips (source "page")${lost.length ? `; not kept: ${lost.map((m) => `${m.src || 'a media element'} (${m.fetchError ?? 'no file'})`).join(', ')}` : ''}`
}

/** A mask whose selector never reached an element hid nothing. */
function maskMisses(rec: {
  masks?: { selector: string; hits: number }[]
}): string[] {
  return (rec.masks ?? []).filter((m) => m.hits === 0).map((m) => m.selector)
}

/** What the frame shows, in words, for the end of a record or a rehearsal. */
function exposureNote(rec: {
  exposures: Parameters<typeof exposureLine>[0][]
}): string {
  if (!rec.exposures.length) return ''
  return `\n  EXPOSED in the frame (${rec.exposures.length}):\n${rec.exposures
    .map((e) => `    - ${exposureLine(e)}`)
    .join('\n')}\n  ${EXPOSURE_ADVICE}`
}

/**
 * `--confirm <id>`, repeatable: the guarded steps a recording may press.
 * Checked against the script BEFORE a browser opens, so a step that
 * spends is refused (or a typo in an id is caught) at no cost; a
 * rehearsal presses no guarded step, so it takes the flag and checks
 * nothing.
 */
function takeConfirm(
  multi: ParsedArgs['multi'],
  actions: ActionsFile,
  opts: { dryRun: boolean; r: Reporter },
): string[] {
  const given = ((multi.confirm as string[] | undefined) ?? []).filter(Boolean)
  if (opts.dryRun) return given
  const verdict = guardVerdict(actions, given)
  if (!verdict.ok) {
    // Under --json the refusal is an event too, one per step or name it is
    // about, beside the sentence on stderr.
    const guarded = guardedSteps(actions)
    for (const id of verdict.unconfirmed)
      opts.r.event({
        event: 'refused',
        reason: verdict.message,
        step: guarded.find((g) => g.id === id)?.step ?? null,
        id,
      })
    for (const id of verdict.unknown)
      opts.r.event({
        event: 'refused',
        reason: verdict.message,
        step: null,
        id,
      })
    throw new UsageError(verdict.message)
  }
  return given
}

/** What the new steps reported, in lines for the end of a record or a rehearsal. */
function stepReportNote(
  rec: Pick<
    RecordResult,
    'disabled' | 'skips' | 'outputs' | 'confirmed' | 'stopped'
  >,
): string {
  const lines: string[] = []
  if (rec.disabled.length)
    lines.push(
      `DISABLED when clicked: ${rec.disabled.map((d) => `#${d.step}${d.id ? ` ${d.id}` : ''} ${d.selector}`).join(', ')} (the press likely did nothing; an expect with enabled: true before it waits for the control)`,
    )
  if (rec.skips.length)
    lines.push(
      `off camera: ${rec.skips.map((s) => `#${s.step}${s.id ? ` ${s.id}` : ''} ${(s.ms / 1000).toFixed(1)} s, cut at ${s.at.toFixed(2)}s${s.timedOut ? ' (timed out)' : ''}`).join(', ')}`,
    )
  if (rec.outputs.length)
    lines.push(
      `outputs/: ${rec.outputs.map((o) => `${o.name} (${o.bytes} bytes)`).join(', ')}`,
    )
  if (rec.confirmed.length)
    lines.push(`pressed, as --confirm said: ${rec.confirmed.join(', ')}`)
  if (rec.stopped) lines.push(`STOPPED: ${rec.stopped.reason}`)
  return lines.map((l) => `\n  ${l}`).join('')
}

/** A skipped step in words: the reason when it has one, else the selector that never appeared. */
function skippedLine(s: SkippedStep): string {
  return `#${s.step}${s.id ? ` ${s.id}` : ''} ${s.do}${s.reason ? `: ${s.reason}` : ` ${s.selector}`}`
}

/**
 * The backdrop a FRESH take opens on: `--background <slug|url|none>`, or
 * absent, the set's house pick from `GET /api/backdrops`. Read once per
 * command; a set out of reach is said in words and the take opens on a
 * flat ground rather than failing.
 */
/**
 * `--browser-arg=<switch>`, repeatable: extra Chromium switches for the
 * recording browser. Some product surfaces cannot be reached without one
 * (a fake capture device to pass a permission prompt, a loaded extension).
 *
 * Read from `multi`, never from `flags`: a flag bag holds ONE value per name,
 * so a second switch used to overwrite the first, and the pair that grants a
 * fake microphone (`--use-fake-ui-for-media-stream` beside
 * `--use-fake-device-for-media-stream`) reached Chromium as its last half.
 * A switch starts with `--`, so it is written with `=`.
 */
/**
 * `--header name=value`, repeatable: a request header on every request the
 * recording browser makes. The way past a preview deployment that is
 * protected by a bypass header alone (rung 0 of the session ladder).
 */
function takeHeaders(multi: ParsedArgs['multi']): Record<string, string> {
  try {
    return parseHeaders(multi.header as string[] | undefined)
  } catch (e) {
    throw new UsageError(e instanceof Error ? e.message : String(e))
  }
}

export function takeBrowserArgs(multi: ParsedArgs['multi']): string[] {
  // Index access is typed present but is runtime-optional.
  const given = multi['browser-arg'] as string[] | undefined
  return (given ?? []).filter(Boolean)
}

/**
 * `--storage-state <file>`: a Playwright storage state, so the recorder
 * drives a SIGNED-IN product. Recording a demo of anything behind a login
 * needs it, and a sign-in form cannot always be scripted (an emailed code,
 * an SSO hop, a passkey). Export one from a real browser session.
 */
function takeStorageState(flags: ParsedArgs['flags']): string | undefined {
  const raw = strFlag(flags, 'storage-state')
  if (!raw) return undefined
  const path = resolve(raw)
  if (!existsSync(path))
    throw new UsageError(`--storage-state: no such file: ${path}`)
  return path
}

/**
 * `--session <name>`: record on a profile the person signed in to
 * (`vos session open`). Mutually exclusive with `--storage-state`: a
 * persistent context cannot take a storage state, and a take has one door.
 */
function takeSessionName(
  flags: ParsedArgs['flags'],
  storageState: string | undefined,
): string | undefined {
  const name = strFlag(flags, 'session')
  if (!name) return undefined
  const bad = sessionNameVerdict(name)
  if (bad) throw new UsageError(bad)
  if (storageState)
    throw new UsageError(
      '--session and --storage-state are two doors to one take: a persistent profile cannot take a storage state. Pass one',
    )
  if (!existsSync(sessionDir(name)))
    throw new UsageError(
      `no session "${name}". Make one: vos session open <url> --name ${name} (a Chrome window opens; sign in and close it)`,
    )
  return name
}

/** Run `fn` in the named session's persistent context, or with none. */
async function inSession<T>(
  name: string | undefined,
  actions: { viewport?: { width: number; height: number } },
  fn: (ctx: import('playwright').BrowserContext | undefined) => Promise<T>,
): Promise<T> {
  if (!name) return fn(undefined)
  return withSession(name, (ctx) => fn(ctx), {
    headless: true,
    viewport: {
      width: actions.viewport?.width ?? 1280,
      height: actions.viewport?.height ?? 720,
    },
  })
}

export async function takeBackdrop(
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

/** After a verified encode: the screencast JPEGs go, unless `--keep-frames`. */
async function releaseFrames(
  paths: TakePaths,
  flags: ParsedArgs['flags'],
  log: (line: string) => void,
): Promise<void> {
  if (flags['keep-frames'] === true) return
  const freed = await dropScreencastFrames(paths)
  // Said only when it is worth a line: a few kB of frames is not news.
  if (freed >= 1e6)
    log(
      `released ${Math.round(freed / 1e6)} MB of screencast frames (the recording holds them now; --keep-frames keeps them)`,
    )
}

/**
 * The wall gate, handed to the recorder as `onArrival`. It judges where the
 * first navigation landed and only THEN lets `prepare` touch the take
 * directory: a re-record clears the old footage, and a session that expired
 * since the last take must never cost the recording it failed to replace.
 *
 * A hard wall (a sign-in, an identity provider, a 401/403) is always refused.
 * A soft one (sent elsewhere, no sign-in in sight) is refused under
 * `--strict` and in a rehearsal, and said as a warning otherwise.
 * `--allow-wall` records either, and the take's meta says so.
 */
function wallGate(
  flags: ParsedArgs['flags'],
  r: Reporter,
  opts: { strict: boolean; prepare?: () => Promise<void> },
): (arrival: Arrival) => Promise<WallVerdict | null> {
  const allow = flags['allow-wall'] === true
  return async (arrival) => {
    const verdict = wallVerdict(arrival)
    if (verdict && !allow && (verdict.level === 'hard' || opts.strict)) {
      r.event({ event: 'wall', ...verdict, refused: true })
      throw new WallError(verdict)
    }
    if (verdict) {
      r.event({ event: 'wall', ...verdict, refused: false })
      r.log(
        allow
          ? `   note: recording past the wall (--allow-wall): landed on ${verdict.landed}`
          : `   WARNING: ${verdict.message}`,
      )
    }
    await opts.prepare?.()
    return verdict
  }
}

async function cmdRecord(argv: string[]): Promise<number> {
  const { positionals, flags, multi } = parseArgs(
    argv,
    BOOLEAN_FLAGS,
    MULTI_FLAGS,
  )
  const actionsPath = strFlag(flags, 'actions') ?? positionals[0]
  if (!actionsPath)
    throw new UsageError(
      'vos record --actions actions.json [--url <url>] [--out take]',
    )
  const r = createReporter(flags.json === true)
  const actions = withReady(await loadActions(actionsPath), flags)
  const url = strFlag(flags, 'url') ?? actions.url
  if (!url)
    throw new UsageError('no URL — set "url" in the actions file or pass --url')
  const scheme = urlSchemeProblem(url)
  if (scheme) throw new UsageError(scheme)
  // What the script reads from this shell, by name, before any value is.
  announceEnvNames(actions, r)
  const outDir = resolve(strFlag(flags, 'out') ?? 'take')
  const storageState = takeStorageState(flags)
  const sessionName = takeSessionName(flags, storageState)
  const browserArgs = takeBrowserArgs(multi)
  const headers = takeHeaders(multi)
  // A guarded step the command did not name is refused here, before a
  // browser opens; on the fleet there is no way to name one at all.
  const confirm =
    flags.hosted === true
      ? []
      : takeConfirm(multi, actions, {
          dryRun: flags['dry-run'] === true,
          r,
        })

  // ON THE FLEET: the script goes up, vos.so records, plans and lands the
  // take, and it comes home with `vos fetch --media`. No browser is opened
  // here; a session never travels; a rehearsal stays a local act.
  if (flags.hosted === true) {
    if (flags['dry-run'] === true)
      throw new UsageError(
        '--dry-run rehearses on this machine; drop --hosted to rehearse, or --dry-run to record on vos.so',
      )
    if (storageState || sessionName)
      throw new UsageError(
        'a session never reaches vos.so: --hosted takes no --session or --storage-state. Put the sign-in in the setup steps with { "env": "NAME" }, or record here with vos record.',
      )
    // Nobody can confirm a step that spends on the fleet, and a download
    // has no take directory to land in there.
    const refusals = hostedRefusals(actions)
    if (refusals.length)
      throw new UsageError(
        `a hosted take cannot run this script: ${refusals.join('; ')}`,
      )
    if ((multi.confirm as string[] | undefined)?.length)
      throw new UsageError(
        '--confirm presses a guarded step on this machine; a hosted take runs no guarded step, so drop --hosted to record it here',
      )
    const origin = platformOrigin({
      origin: strFlag(flags, 'origin'),
      api: strFlag(flags, 'api'),
    })
    const key = resolveCredential(strFlag(flags, 'key'))
    if (!key)
      throw new UsageError(
        'recording on vos.so needs a credential: vos login, or VOS_API_KEY (mint a key at https://vos.so/app/api)',
      )
    const { env, missing } = hostedEnv(actions, process.env)
    if (missing.length)
      throw new UsageError(
        `the setup reads ${missing.map((n) => `{ "env": "${n}" }`).join(', ')} and this shell has no ${missing.length === 1 ? 'value for it' : 'values for them'}; export ${missing.join(', ')} and run again (the value rides the job, and is never stored)`,
      )
    r.log('recording on vos.so…')
    r.event({ event: 'phase', phase: 'record' })
    const started = Date.now()
    const outcome = await recordHosted({
      origin,
      key,
      url,
      actions: { ...actions, url },
      headers,
      title: strFlag(flags, 'title'),
      folderId: strFlag(flags, 'folder'),
      env,
      log: r.log,
    })
    if (!outcome.ok) {
      // The vos was made before the take, so a refusal leaves an empty one
      // on the shelf; the CLI takes it back down (its job row goes with it,
      // which is why this runs only once the refusal has been read).
      if (outcome.vosId) {
        const gone = await apiJson(origin, `/api/vos/${outcome.vosId}`, {
          method: 'DELETE',
          key,
        })
        if (gone.status === 200)
          r.log('the empty vos it would have landed on was removed')
      }
      r.done(
        {
          hosted: true,
          ok: false,
          wall: outcome.wall,
          error: outcome.error,
          vosId: outcome.vosId,
          jobId: outcome.jobId,
        },
        `${outcome.wall ? 'REFUSED' : 'FAILED'} on vos.so: ${outcome.error}`,
      )
      return outcome.wall ? EXIT_WALL : EXIT_ERROR
    }
    r.event({ event: 'phase', phase: 'fetch' })
    r.log(`landed as ${outcome.studio}; fetching the take into ${outDir}…`)
    const fetched = await cmdFetch([
      outcome.vosId,
      '--out',
      outDir,
      '--media',
      ...(strFlag(flags, 'origin')
        ? ['--origin', strFlag(flags, 'origin')!]
        : []),
      ...(strFlag(flags, 'key') ? ['--key', strFlag(flags, 'key')!] : []),
      ...(flags.json === true ? ['--json'] : []),
    ])
    if (fetched !== EXIT_OK) return fetched
    const t = outcome.job.telemetry ?? {}
    r.done(
      {
        hosted: true,
        ok: true,
        vosId: outcome.vosId,
        jobId: outcome.jobId,
        out: outDir,
        seconds: +((Date.now() - started) / 1000).toFixed(1),
        telemetry: t,
      },
      `Recorded on vos.so in ${((Date.now() - started) / 1000).toFixed(1)}s: ${outcome.studio}\n  ${outDir}/ holds doc.json, the recording and vos.json${typeof t.durationMs === 'number' ? ` (${(t.durationMs / 1000).toFixed(1)}s of footage)` : ''}${Array.isArray(t.dead) && t.dead.length ? `\n  DEAD TIME: ${t.dead.length} stretch(es) under a parked cursor; give those steps their ms` : ''}${Array.isArray(t.exposures) && t.exposures.length ? `\n  EXPOSURES: ${t.exposures.length} sensitive-looking text(s) in frame; mask them in actions.json` : ''}\n  Next: vos digest ${outDir} — look before you cut; edit doc.json; vos push ${outDir}`,
    )
    return EXIT_OK
  }
  const backdrop = await takeBackdrop(flags, r)
  const maxDurationSeconds = await maxDuration(flags, r)

  // A REHEARSAL: run the script against the real page and say which
  // selectors resolve, before a real-time take and its encode are spent
  // finding out. Branches HERE, before the take directory is touched: a
  // re-record moves doc.json aside, and a rehearsal must leave the take
  // exactly as it found it.
  if (flags['dry-run'] === true) {
    // The same command line with --dry-run added must rehearse cleanly, so
    // the take's own flags are read here: a rehearsal is ALWAYS strict (any
    // miss exits 2) and has no frames to keep, and neither is "ignored".
    void flags.strict
    void flags['keep-frames']
    const browser = await launchBrowser(browserArgs)
    try {
      r.log('rehearsing (nothing is captured or written)…')
      r.event({ event: 'phase', phase: 'rehearse' })
      const started = Date.now()
      const rec = await inSession(sessionName, actions, (context) =>
        recordTake(browser, url, actions, takePaths(outDir), r.log, {
          storageState,
          headers,
          context,
          dryRun: true,
          verbose: flags.verbose === true,
          onEvent: (e) => r.event(e),
          // A rehearsal is always strict, and it touches no directory.
          onArrival: wallGate(flags, r, { strict: true }),
        }),
      )
      const steps = rec.meta.steps ?? []
      const lines = steps.map((s) => {
        const rect = s.rect
          ? `  rect ${s.rect.x},${s.rect.y} ${s.rect.w}×${s.rect.h}`
          : ''
        const what = s.selector ? ` ${s.selector}` : ''
        const out = rec.outputs.find((o) => o.step === s.step)
        const notes = [
          ...(rec.disabled.some((d) => d.step === s.step)
            ? ['DISABLED, pressed anyway']
            : []),
          ...(s.guard && !s.skipped
            ? [`guarded (${s.guard}), hovered, not pressed`]
            : []),
          ...(s.followsGuard !== undefined
            ? [
                `not waited: it follows #${s.followsGuard} (guarded, not pressed)`,
              ]
            : []),
          ...(s.offCameraMs !== undefined
            ? [
                `${s.timedOut ? 'timed out after' : 'held after'} ${(s.offCameraMs / 1000).toFixed(1)} s off camera`,
              ]
            : []),
          ...(out
            ? [`→ ${out.name} (${out.bytes} bytes, not kept in a rehearsal)`]
            : []),
        ].map((n) => `  ${n}`)
        return `  ${s.skipped ? '✗' : '✓'} #${s.step}${s.id ? ` (${s.id})` : ''} ${s.do}${what}${s.skipped ? `  ${s.reason ?? 'NOT FOUND'}` : rect}${s.navigated ? '  → navigated' : ''}${notes.join('')}`
      })
      // A step that never ran (the take stopped, or hit the cap) is listed
      // too, so the count is out of the whole script.
      for (const [i, step] of actions.steps.entries())
        if (!steps.some((s) => s.step === i))
          lines.push(
            `  – #${i}${step.id ? ` (${step.id})` : ''} ${step.do}  not run`,
          )
      const resolved = steps.filter((s) => !s.skipped).length
      // A rehearsal is always strict; a first load that never went
      // network-idle is a note, as in a take.
      const failed = strictFails(rec) || rec.stopped !== null
      const unconfirmed = guardVerdict(actions, confirm)
      // The next command is THIS command minus --dry-run. A hint that
      // dropped --storage-state sent a signed-in rehearsal on to record
      // the sign-in page.
      const carried = [
        ...(strFlag(flags, 'storage-state')
          ? [`--storage-state ${strFlag(flags, 'storage-state')}`]
          : []),
        ...browserArgs.map((a) => `--browser-arg=${a}`),
        // A header value is a bypass token more often than not: named, never
        // printed.
        ...Object.keys(headers).map((k) => `--header ${k}=…`),
        ...(sessionName ? [`--session ${sessionName}`] : []),
        ...(flags['allow-wall'] === true ? ['--allow-wall'] : []),
        ...confirm.map((c) => `--confirm ${c}`),
      ].join(' ')
      const nextOut = strFlag(flags, 'out') ?? 'take'
      // A guarded step the next command does not name would refuse it: the
      // hint says so rather than adding the confirmation for the person.
      const guardNote = !unconfirmed.ok
        ? unconfirmed.unconfirmed.length
          ? ` (it refuses until you add ${unconfirmed.unconfirmed.map((id) => `--confirm ${id}`).join(' ')}: ${unconfirmed.unconfirmed.length === 1 ? 'that step spends' : 'those steps spend'} something real)`
          : ` (${unconfirmed.unknown.map((c) => `--confirm ${c}`).join(', ')} names no guarded step)`
        : ''
      r.done(
        {
          dryRun: true,
          ok: !failed,
          seconds: +((Date.now() - started) / 1000).toFixed(1),
          steps,
          skipped: rec.skipped,
          disabled: rec.disabled,
          skips: rec.skips,
          outputs: rec.outputs,
          pageErrors: rec.pageErrors,
          ...(rec.stopped ? { stopped: rec.stopped } : {}),
          navTimeout: rec.navTimeout,
          ready: rec.ready,
          exposures: rec.exposures,
          masks: rec.masks,
        },
        `${failed ? 'REHEARSAL FAILED' : 'Rehearsal passed'}: ${resolved}/${actions.steps.length} steps resolved in ${((Date.now() - started) / 1000).toFixed(1)}s${rec.navTimeout ? ' (the first load never reached networkidle)' : rec.ready.capped ? ' (the first page never stopped changing)' : ''}\n${lines.join('\n')}\n  ${maskMisses(rec).length ? `MASK hid nothing: ${maskMisses(rec).join(', ')} (the selector reached no element). ` : ''}${rec.stopped ? `STOPPED: ${rec.stopped.reason}. ` : ''}${failed ? 'Fix the script, rehearse again, then record.' : `Rects are capture px (the step rects a pin or a callout reads). Next: vos record --actions ${actionsPath} --out ${nextOut}${carried ? ` ${carried}` : ''} --strict${guardNote}`}${exposureNote(rec)}`,
      )
      // An await that gave up stops the take, in a rehearsal as in a record.
      return rec.stopped ? EXIT_ERROR : failed ? EXIT_USAGE : EXIT_OK
    } finally {
      await browser.close()
    }
  }

  // Run by the wall gate, once the recorder has landed where it was asked.
  // A re-record replaces the FOOTAGE, never the cut. The previous doc.json
  // survives as doc.prev.json (the reuse base), actions.json and vos.json
  // stay put, and derived artifacts of the old footage clear.
  const paths = takePaths(outDir)
  const prepare = async () => {
    if (existsSync(join(outDir, 'meta.json'))) {
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
    await ensureTakeDir(outDir)
  }

  const browser = await launchBrowser(browserArgs)
  try {
    r.log('recording…')
    r.event({ event: 'phase', phase: 'record' })
    const rec = await inSession(sessionName, actions, (context) =>
      recordTake(browser, url, actions, paths, r.log, {
        maxDurationSeconds: maxDurationSeconds,
        storageState: storageState,
        headers,
        context,
        confirm,
        verbose: flags.verbose === true,
        onEvent: (e) => r.event(e),
        onArrival: wallGate(flags, r, {
          strict: flags.strict === true,
          prepare,
        }),
      }),
    )
    r.event({ event: 'phase', phase: 'encode' })
    r.log('encoding…')
    const enc = await encodeRecording(browser, outDir, (p) =>
      r.event({ event: 'progress', phase: 'encode', fraction: p }),
    )
    await releaseFrames(paths, flags, r.log)
    r.event({ event: 'phase', phase: 'plan' })
    const plan = await planTake(outDir, { backdrop })
    const clicks = rec.events.filter((e) => e.type === 'down').length
    const strict = flags.strict === true
    const strictFail = strict && strictFails(rec)
    const skippedNote = rec.skipped.length
      ? `\n  SKIPPED ${rec.skipped.length} step(s): ${rec.skipped.map(skippedLine).join(', ')}`
      : ''
    const stepNote = stepReportNote(rec)
    // An await that gave up stopped the take: the directory holds the
    // footage up to it, whole, and the command fails in words.
    if (rec.stopped) {
      r.done(
        {
          take: outDir,
          ok: false,
          stopped: rec.stopped,
          durationMs: rec.meta.durationMs,
          skipped: rec.skipped,
          disabled: rec.disabled,
          confirmed: rec.confirmed,
          skips: rec.skips,
          outputs: rec.outputs,
          pageErrors: rec.pageErrors,
        },
        `FAILED: ${rec.stopped.reason}.\n  The footage up to it is in ${outDir}.${skippedNote}${stepNote}${navTimeoutNote(rec)}`,
      )
      return EXIT_ERROR
    }
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
        ready: rec.ready,
        freezes: rec.freezes,
        freezePct: rec.freezePct,
        dead: rec.dead,
        capped: rec.capped,
        pace: rec.pace,
        ...(rec.wall ? { wall: rec.wall } : {}),
        exposures: rec.exposures,
        ...(rec.masks.length ? { masks: rec.masks } : {}),
        disabled: rec.disabled,
        confirmed: rec.confirmed,
        skips: rec.skips,
        outputs: rec.outputs,
        ...(rec.media.length ? { media: rec.media } : {}),
        pageErrors: rec.pageErrors,
        ...(strictFail ? { strictFailed: true } : {}),
      },
      strictFail
        ? `STRICT: take recorded but incomplete — ${strictReason(rec)}; fix the flow and re-record.${skippedNote}${stepNote}${navTimeoutNote(rec)}${exposureNote(rec)}`
        : `Take ready: ${outDir}\n  ${(rec.meta.durationMs / 1000).toFixed(1)}s · ${rec.frames.length} frames · ${rec.events.length} cursor events · ${clicks} clicks · ${plan.doc.zoom.length} zoom spans planned · ${rec.freezePct}% frozen · ${rec.dead.pct}% dead${deadWarns(rec.dead) ? ' ⚠ ' + deadLine(rec.dead) : ''}${skippedNote}${stepNote}${navTimeoutNote(rec)}${pageSoundNote(rec)}\n  Next: edit ${join(outDir, 'doc.json')} (optional), then: vos render ${outDir}${exposureNote(rec)}`,
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
 * when the recording is incomplete (a skipped step, a disabled click, a
 * timed-out await, the cap); a missed networkidle is only a warning.
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
  const actions = withReady(await loadActions(actionsPath), flags)
  const url = strFlag(flags, 'url') ?? actions.url
  if (!url)
    throw new UsageError('no URL — set "url" in the actions file or pass --url')
  const scheme = urlSchemeProblem(url)
  if (scheme) throw new UsageError(scheme)
  announceEnvNames(actions, r)
  const outDir = resolve(strFlag(flags, 'out') ?? 'take')
  const format = videoFormat(strFlag(flags, 'format'), positionals[0])
  const out = positionals[0] ?? join(outDir, `out.${format}`)
  const parallel = numFlag(flags, 'parallel', 1)
  if (!Number.isInteger(parallel) || parallel < 1 || parallel > 16) {
    throw new UsageError('--parallel expects an integer between 1 and 16')
  }
  const backdrop = await takeBackdrop(flags, r)
  const maxDurationSeconds = await maxDuration(flags, r)
  const storageState = takeStorageState(flags)
  const sessionName = takeSessionName(flags, storageState)
  const browserArgs = takeBrowserArgs(multi)
  const headers = takeHeaders(multi)
  const confirm = takeConfirm(multi, actions, { dryRun: false, r })

  // Run by the wall gate, once the recorder has landed where it was asked.
  // A re-record replaces the FOOTAGE, never the cut. The previous doc.json
  // survives as doc.prev.json (the reuse base), actions.json and vos.json
  // stay put, and derived artifacts of the old footage clear.
  const paths = takePaths(outDir)
  const prepare = async () => {
    if (existsSync(join(outDir, 'meta.json'))) {
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
    await ensureTakeDir(outDir)
  }

  const browser = await launchBrowser(browserArgs)
  try {
    r.log('recording…')
    r.event({ event: 'phase', phase: 'record' })
    const rec = await inSession(sessionName, actions, (context) =>
      recordTake(browser, url, actions, paths, r.log, {
        maxDurationSeconds: maxDurationSeconds,
        storageState: storageState,
        headers,
        context,
        confirm,
        verbose: flags.verbose === true,
        onEvent: (e) => r.event(e),
        onArrival: wallGate(flags, r, {
          strict: flags.strict === true,
          prepare,
        }),
      }),
    )
    r.event({ event: 'phase', phase: 'encode' })
    r.log('encoding…')
    await encodeRecording(browser, outDir, (p) =>
      r.event({ event: 'progress', phase: 'encode', fraction: p }),
    )
    await releaseFrames(paths, flags, r.log)
    r.event({ event: 'phase', phase: 'plan' })
    await planTake(outDir, { backdrop })

    // An await that gave up stopped the take: nothing is rendered.
    if (rec.stopped) {
      r.done(
        {
          take: outDir,
          ok: false,
          stopped: rec.stopped,
          skipped: rec.skipped,
          rendered: false,
        },
        `FAILED: ${rec.stopped.reason}. NOT rendering; the footage up to it is in ${outDir}.`,
      )
      return EXIT_ERROR
    }

    if (flags.strict === true && strictFails(rec)) {
      r.done(
        {
          take: outDir,
          skipped: rec.skipped,
          disabled: rec.disabled,
          navTimeout: rec.navTimeout,
          ready: rec.ready,
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
        ready: rec.ready,
        freezes: rec.freezes,
        freezePct: rec.freezePct,
        dead: rec.dead,
        exposures: rec.exposures,
        ...(rec.masks.length ? { masks: rec.masks } : {}),
        disabled: rec.disabled,
        confirmed: rec.confirmed,
        skips: rec.skips,
        outputs: rec.outputs,
        ...(rec.media.length ? { media: rec.media } : {}),
        pageErrors: rec.pageErrors,
        ...(flags.draft === true ? { draft: true } : {}),
      },
      `Created ${result.out} (${(result.bytes / 1024).toFixed(0)} KB, ${result.width}x${result.height}@${result.fps}, ${result.duration.toFixed(1)}s, ${result.zoomSpans} zoom spans, ${result.clicks} click effects${result.audio ? ', audio' : ''}${flags.draft === true ? ', DRAFT' : ''})\n  take: ${outDir} — inspect with: vos frames ${outDir} --at-zooms; edit doc.json and re-render with: vos render ${outDir}${stepReportNote(rec)}${navTimeoutNote(rec)}${exposureNote(rec)}`,
    )
    return EXIT_OK
  } finally {
    await browser.close()
  }
}

async function cmdPlan(argvIn: string[]): Promise<number> {
  // A bare `--captions` lands every step's caption anchored to its step.
  const argv = bareCaptionsFlag(argvIn)
  const { positionals, flags, multi } = parseArgs(
    argv,
    BOOLEAN_FLAGS,
    new Set(['with']),
  )
  const dir = positionals[0]
  if (!dir)
    throw new UsageError(
      'vos plan <take> [--fresh] [--reuse [--from <doc.json>]] [--style <doc.json|vosId>] [--with <doc.json|vosId>[@end|@start|@step:<id>|@<seconds>]]... [--motion] [--headline "…"] [--launch LAUNCH.md] [--brand BRAND.md]',
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
  const hasDoc = existsSync(join(dir, 'doc.json'))
  const backdrop = hasDoc ? null : await takeBackdrop(flags, r)
  // The release's words and roles (LAUNCH.md and BRAND.md beside the take,
  // flags over them): the words patch a layout's stage clips and name the
  // end card; the roles decide the motion proposals; the brand's mark is
  // fetched into the take's brand/ folder for the layout and the end card.
  const release = await releaseInputs(dir, flags, r, multi.with ?? [])
  const stepCaptions = strFlag(flags, 'captions') === 'steps'
  // Step captions are anchored to their steps; the plan's fixed-time beat
  // captions would say the same words twice.
  if (stepCaptions) release.launchRoles.captions = 'none'
  const motionWanted = !hasDoc || flags.motion === true || flags.fresh === true
  // The frame that stands for the take: --still, else LAUNCH.md's still:.
  const stillRaw = strFlag(flags, 'still') ?? release.launchRoles.still
  const still = stillRaw === undefined ? null : Number(stillRaw)
  if (still !== null && !(Number.isFinite(still) && still >= 0))
    throw new UsageError(
      `--still expects output seconds ≥ 0, got "${stillRaw}"`,
    )
  const s = await planTake(dir, {
    ...(style ? { style } : {}),
    ...(reuse ? { reuse } : {}),
    backdrop,
    words: release.words,
    mark: release.mark,
    ...(still !== null ? { still } : {}),
    ...(motionWanted
      ? {
          motion: {
            words: release.words,
            launch: release.launchRoles,
            ink: release.ink,
            mark: release.mark,
            captions: release.captions,
            catalog: release.catalog,
            templates: release.templates,
            again: flags.motion === true,
          },
        }
      : {}),
  })
  let captions: StepCaptionReport | null = null
  if (stepCaptions) {
    const take = await loadTake(dir)
    captions = landStepCaptions(s.doc, new Map([['', take.actions]]))
    await writeJson(take.paths.doc, s.doc, true)
  }
  const captionLines = captions
    ? `\n  ${captions.landed.length} step caption${captions.landed.length === 1 ? '' : 's'} anchored to their steps` +
      (captions.skipped.length
        ? `\n  not landed: ${captions.skipped.join('; ')}`
        : '') +
      (captions.uncaptioned.length
        ? `\n  no step in ${captions.uncaptioned.length === 1 && captions.uncaptioned[0] === '' ? 'this take' : captions.uncaptioned.map((m) => (m ? `media ${m}` : 'the primary')).join(', ')} carries a caption`
        : '')
    : ''
  const layoutLines = s.layout
    ? `\n  layout from ${s.styleFrom}: ${[
        s.layout.clips.length ? `${s.layout.clips.length} stage clip(s)` : '',
        s.layout.lean ? 'the rest lean' : '',
        s.layout.freeze ? 'the freeze' : '',
      ]
        .filter(Boolean)
        .join(', ')}` +
      (s.layout.notes.length ? `\n    ${s.layout.notes.join('\n    ')}` : '')
    : ''
  const motionLines = s.motion
    ? (s.motion.notes.length
        ? `\n  proposed: ${s.motion.notes.join(', ')}`
        : '') +
      (s.motion.skipped.length
        ? `\n  not proposed: ${s.motion.skipped.join('; ')}`
        : '')
    : ''
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
      ...(s.layout ? { layout: s.layout } : {}),
      ...(s.motion ? { motion: s.motion } : {}),
      ...(s.reuse ? { reuse: s.reuse } : {}),
      ...(captions ? { captions } : {}),
    },
    `${s.reuse ? 'Reused' : s.fresh ? 'Planned' : 'Refreshed'} ${join(dir, 'doc.json')}: ${s.zoomAuto} auto + ${s.zoomManual} manual zoom spans${s.cursorKept ? '' : ' (cursor track dropped)'}${layoutLines}${motionLines}${reuseLines}${captionLines}`,
  )
  return EXIT_OK
}

/**
 * The release's inputs beside a take, for `plan`: the words (LAUNCH.md's
 * headline and kicker roles, BRAND.md's wordmark; flags override), the
 * motion roles (LAUNCH.md's music, entrance, transitions, endCard, captions, clicks;
 * flags override), the end card's ink from the brand's look, the brand's
 * mark fetched into `<take>/brand/`, the step captions from actions.json,
 * and the music catalog when a bed is asked for (one network read, only
 * then).
 */
async function releaseInputs(
  dir: string,
  flags: ParsedArgs['flags'],
  r: ReturnType<typeof createReporter>,
  withRefs: string[] = [],
): Promise<{
  words: {
    headline: string | null
    kicker: string | null
    brand: string | null
    release: string | null
  }
  launchRoles: Record<string, string>
  ink: string | null
  mark: { key: string; aspect: number } | null
  captions: { step: number; id?: string; caption: string }[]
  catalog: Awaited<ReturnType<typeof fetchMusicCatalog>> | null
  templates: MotionTemplate[]
}> {
  let lookPick: Awaited<ReturnType<typeof resolveLook>>
  try {
    lookPick = await resolveLook(dir, {
      look: strFlag(flags, 'look'),
      brand: strFlag(flags, 'brand'),
    })
  } catch (e) {
    throw new UsageError(e instanceof Error ? e.message : String(e))
  }
  const launch = await readLaunchBesideTake(dir, strFlag(flags, 'launch'))
  // A literal \n in a frontmatter value or a flag is a line break: a headline
  // is written over its lines on purpose.
  const lines = (v: string | null | undefined) =>
    v === null || v === undefined ? null : v.replace(/\\n/g, '\n')
  const words = {
    headline: lines(strFlag(flags, 'headline') ?? launch?.roles.headline),
    kicker: lines(strFlag(flags, 'kicker') ?? launch?.roles.kicker),
    brand: strFlag(flags, 'brand-name') ?? lookPick.roles?.wordmark ?? null,
    release: strFlag(flags, 'release') ?? null,
  }
  if (launch) r.log(`words: ${launch.file}`)
  const launchRoles: Record<string, string> = { ...(launch?.roles ?? {}) }
  for (const [flag, role] of [
    ['music', 'music'],
    ['entrance', 'entrance'],
    ['transitions', 'transitions'],
    ['end-card', 'endCard'],
    ['captions', 'captions'],
    ['clicks', 'clicks'],
  ] as const) {
    const v = strFlag(flags, flag)
    if (v !== undefined) launchRoles[role] = v
  }
  // The brand's mark: BRAND.md's logoUrl on a light ground, its
  // logoOnDarkUrl on a dark one; a dark ground with no on-dark mark keeps
  // the wordmark in words rather than an invisible ink mark.
  const marks = await fetchBrandMarks(dir, lookPick.roles)
  for (const n of marks.notes) r.log(`note: ${n}`)
  const mark = lookPick.look?.kind === 'dark' ? marks.dark : marks.light
  if (mark) r.log(`brand mark: ${mark.key} (${mark.aspect.toFixed(2)}:1)`)
  const off = (v: string | undefined) =>
    v !== undefined && /^(none|off|no|false)$/i.test(v)
  let catalog: Awaited<ReturnType<typeof fetchMusicCatalog>> | null = null
  if (launchRoles.music && !off(launchRoles.music)) {
    try {
      catalog = await fetchMusicCatalog(
        platformOrigin({
          origin: strFlag(flags, 'origin'),
          api: strFlag(flags, 'api'),
        }),
      )
    } catch (e) {
      r.log(
        `music catalog: ${e instanceof Error ? e.message : String(e)} — no bed`,
      )
    }
  }
  const take = await loadTake(dir)
  const captions = (take.actions?.steps ?? []).flatMap((st, i) => {
    const step = st as { id?: string; caption?: string }
    return typeof step.caption === 'string' && step.caption.trim()
      ? [{ step: i, id: step.id, caption: step.caption.trim() }]
      : []
  })
  // The templates: `--with <ref>[@anchor]` (repeatable), LAUNCH.md's
  // `with:` role (a comma list of the same), and an `endCard:` role that
  // names a document instead of on/none (anchored at the end). A ref is a
  // doc.json, a take dir, or a vos id read with the key ladder.
  const refs: { ref: string; at: MotionAnchor }[] = []
  const parseRef = (raw: string, fallback: MotionAnchor) => {
    const m = /^(.*?)(?:@(end|start|step:[^@\s]+|\d+(?:\.\d+)?))?$/.exec(
      raw.trim(),
    )
    const ref = m?.[1]?.trim() ?? raw.trim()
    const anchor = m?.[2]
    const at: MotionAnchor = !anchor
      ? fallback
      : anchor === 'end' || anchor === 'start'
        ? anchor
        : anchor.startsWith('step:')
          ? { step: anchor.slice(5) }
          : Number(anchor)
    if (ref) refs.push({ ref, at })
  }
  for (const raw of withRefs) parseRef(raw, 'end')
  for (const raw of (launchRoles.with ?? '').split(','))
    if (raw.trim()) parseRef(raw, 'end')
  const endCardRole = launchRoles.endCard
  if (
    endCardRole &&
    !/^(none|off|no|false|on|yes|true)$/i.test(endCardRole.trim())
  )
    parseRef(endCardRole, 'end')
  const templates: MotionTemplate[] = []
  for (const { ref, at } of refs) {
    const found = await resolveDocRef(ref, flags, '--with')
    templates.push({ from: found.from, doc: found.doc, at })
    r.log(`template: ${found.from}`)
  }
  // The end card the recipe leaves on (or unsaid) is the OFFICIAL one on
  // vos.so, laid at the end and stamped `from: endcard` so a loop drops it
  // and a re-plan replaces it; offline, `plan` falls back to the house
  // clips. A recipe that names its own end card took the branch above.
  if (!endCardRole || /^(on|yes|true)$/i.test(endCardRole.trim())) {
    const origin = platformOrigin({
      origin: strFlag(flags, 'origin'),
      api: strFlag(flags, 'api'),
    })
    const official = await officialTemplate(origin, OFFICIAL_END_CARD_TITLE)
    if (official) {
      try {
        const found = await resolveDocRef(official.id, flags, 'endCard')
        templates.push({ from: END_CARD_FROM, doc: found.doc, at: 'end' })
        r.log(`template: ${found.from} (the official end card)`)
      } catch {
        r.log(
          'end card: the official template is unreadable here; the house clips stand in',
        )
      }
    }
  }
  return {
    words,
    launchRoles,
    ink: endCardInk(lookPick.look, lookPick.roles),
    mark,
    captions,
    catalog,
    templates,
  }
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
  const format = videoFormat(strFlag(flags, 'format'), positionals[1])
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

  // Duration for % times: the output's end (trims, speed and the clips
  // after the footage applied).
  const duration = docOutputDuration(take.doc)
  const frameRaw = strFlag(flags, 'frame')
  const timesRaw = strFlag(flags, 'times')
  const atZooms = flags['at-zooms'] === true
  const atMoments = flags['at-moments'] === true
  const atStill = flags['at-still'] === true
  const strict = flags.strict === true
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
      atStill,
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
    for (const z of result.skippedZooms ?? [])
      r.warn(
        `zoom ${z.id}${z.media ? ` (media ${z.media})` : ''} has no apex to still: ${z.reason}`,
      )
    const unrendered = result.frames.filter((f) => f.rendered === false)
    for (const f of unrendered) r.warn(unrenderedZoomLine(f))
    const zoomTag = (f: (typeof result.frames)[number]) =>
      `${f.zoomId ? ` ${f.zoomId}` : ''}${f.media ? ` on ${f.media}` : ''}${f.rendered === false ? ', DID NOT RENDER' : ''}`
    r.done(
      {
        outDir: result.outDir,
        index,
        width: result.width,
        height: result.height,
        duration: result.duration,
        frames: result.frames,
        ...(result.skippedZooms ? { skippedZooms: result.skippedZooms } : {}),
        ...(atZooms ? { unrenderedZooms: unrendered.length } : {}),
      },
      `Wrote ${result.frames.length} still(s) to ${result.outDir} (${result.width}x${result.height})\n  ${result.frames.map((f) => `${f.time.toFixed(2)}s${f.kind === 'zoom' ? ` [zoom apex${zoomTag(f)}]` : f.kind === 'moment' ? ` [${f.momentId}]` : ''} → ${f.file}`).join('\n  ')}`,
    )
    return unrendered.length && strict ? EXIT_USAGE : EXIT_OK
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
      'vos deliver <take> --to youtube,x,shorts,github (or all) [--release v2.1] [--out dir] [--range a..b] [--json]\n(hosted work: vos pull <id> --media first — deliver runs on a local take)',
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
  const parallel = numFlag(flags, 'parallel', 1)
  if (!Number.isInteger(parallel) || parallel < 1 || parallel > 16) {
    throw new UsageError('--parallel expects an integer between 1 and 16')
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
      range,
      parallel,
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
        `${a.destination} → ${a.path} (${a.w}x${a.h}, ${(a.bytes / 1024).toFixed(0)} KB, ${a.seconds.toFixed(1)}s)`,
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
        `\nUploads stay manual: hand the human this directory and the manifest.`,
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
  return resolveDocRef(styleRef, flags, '--style')
}

/**
 * A document reference: a doc.json or a take dir on disk, else a hosted
 * take's head doc read with the key ladder. What a template, a style seed
 * and a digest's reference all are. A local file is read into the current
 * vocabulary too.
 */
async function resolveDocRef(
  ref: string,
  flags: ParsedArgs['flags'],
  what: string,
): Promise<{ from: string; doc: ProjectDoc }> {
  const styleRef = ref
  const file = existsSync(styleRef)
    ? resolve(
        styleRef,
        existsSync(join(styleRef, 'doc.json')) ? 'doc.json' : '',
      )
    : null
  if (file && existsSync(file)) {
    return {
      from: file,
      doc: migrateHostedDoc(
        JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>,
      ) as unknown as ProjectDoc,
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
  if (meta.status !== 200 || !head) {
    // Not an id or a slug: a TITLE on the official shelf ("End card",
    // "Split cover, landscape"), the platform's registry of templates.
    const official = await officialTemplate(origin, styleRef)
    if (official && official.id !== styleRef)
      return resolveDocRef(official.id, flags, what)
    throw new UsageError(
      `${what}: ${styleRef} is neither a doc.json, a vos I can read, nor an official template's title`,
    )
  }
  const doc = await apiJson(
    origin,
    `/api/vos/${styleRef}/versions/${head}/doc`,
    { key },
  )
  if (doc.status !== 200)
    throw new UsageError(`${what}: ${styleRef} carries no doc (is it a take?)`)
  return {
    from: `${origin}/vos/${styleRef}`,
    doc: migrateHostedDoc(doc.body) as unknown as ProjectDoc,
  }
}

/** The official vos a ref names by title or slug, or null (offline = null). */
async function officialTemplate(
  origin: string,
  ref: string,
): Promise<OfficialRow | null> {
  try {
    const list = await apiJson(origin, '/api/vos/official', {})
    if (list.status !== 200) return null
    const rows = (list.body as { voses?: OfficialRow[] }).voses ?? []
    return findOfficialByRef(rows, ref)
  } catch {
    return null
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
        ...(d.take.wall ? { wall: d.take.wall } : {}),
        ...(d.take.exposures.length ? { exposures: d.take.exposures } : {}),
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
        (d.take.exposures.length
          ? `\n  EXPOSED in the footage: ${d.take.exposures.map((e) => `${e.kind} in ${e.selector}`).join('; ')} — look at those frames before this take goes anywhere`
          : '') +
        (d.take.wall
          ? `\n  WALL: asked for ${d.take.wall.asked}, recorded ${d.take.wall.landed} — this footage may be the wrong page; re-record with a session before cutting it`
          : '') +
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
    throw new UsageError(`${dir} has no recording — re-run record`)
  }

  // The studio at vos.so by default (AN1): the one line an agent is handed
  // ends with the person's own product open there, on a clean machine with
  // no repo of ours around. VOS_ORIGIN (the platform origin) moves it for
  // this repo's dev server; --studio overrides both.
  const studio = (strFlag(flags, 'studio') ?? platformOrigin()).replace(
    /\/+$/,
    '',
  )
  const server = await startTakeServer(resolve(dir), {})
  // /studio is the one editor route.
  const url = `${studio}/studio?take=${encodeURIComponent(server.base)}`
  r.event({ event: 'open', server: server.base, url })
  r.log(`take served at ${server.base}`)
  process.stdout.write(flags.json === true ? '' : `${url}\n`)
  if (flags.print !== true) {
    r.log('opening the studio… (Ctrl-C to stop serving)')
    // Best-effort browser launch; the printed URL is the contract.
    await launchDefaultBrowser(url)
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

async function cmdCallout(argv: string[]): Promise<number> {
  const { positionals, flags } = parseArgs(argv, BOOLEAN_FLAGS)
  const dir = positionals[0]
  const shape = positionals[1]
  if (!dir || !shape || !isCalloutShape(shape))
    throw new UsageError(
      'vos callout <take> <note|tag|code> --step <id> [--title "…"] [--body "…"] [--kicker "…"] [--code "…"|--code-file f] [--seconds 3] [--side …] [--mark ring|underline|none] [--leader] [--color #hex (the mark and leader; the kicker is --accent)] [--brand BRAND.md] [--ground #hex --accent #hex] [--font "…"] [--body-px <n> (the body size on the delivered frame)] [--id x] [--print] [--json]',
    )
  const r = createReporter(flags.json === true)
  const take = await loadTake(dir)
  if (!take.doc) throw new UsageError(`${dir} has no doc.json — run plan first`)
  const brand = await readBrandBesideTake(dir, strFlag(flags, 'brand'))
  const bodyPx = strFlag(flags, 'body-px')
  const register = registerFrom(brand?.roles ?? null, {
    ground: strFlag(flags, 'ground'),
    accent: strFlag(flags, 'accent'),
    face: strFlag(flags, 'font'),
    mono: strFlag(flags, 'mono'),
    body: bodyPx !== undefined ? Number(bodyPx) : undefined,
  })
  if (!register)
    throw new UsageError(
      `no register: put a BRAND.md beside the take (vos brand <url> --out BRAND.md; its bgA and accent are the ground and the accent), or pass --ground #hex --accent #hex`,
    )
  const codeFile = strFlag(flags, 'code-file')
  const code = codeFile
    ? await readFile(codeFile, 'utf8')
    : strFlag(flags, 'code')
  const words = {
    kicker: strFlag(flags, 'kicker'),
    title: strFlag(flags, 'title'),
    body: strFlag(flags, 'body'),
    code: code?.replace(/\\n/g, '\n'),
  }
  if (shape === 'code' && !words.code)
    throw new UsageError(
      'a code callout needs --code "…" or --code-file <file>',
    )
  if (shape === 'note' && !words.title)
    throw new UsageError('a note needs --title "…"')
  if (shape === 'tag' && !words.kicker && !words.title)
    throw new UsageError('a tag needs --kicker "…"')
  const stepRaw = strFlag(flags, 'step')
  const atRaw = strFlag(flags, 'at')
  const secondsRaw = strFlag(flags, 'seconds')
  const side = strFlag(flags, 'side')
  const mark = strFlag(flags, 'mark')
  let composed
  try {
    composed = composeCallout(take.doc, register, {
      shape,
      words,
      id: strFlag(flags, 'id'),
      step:
        stepRaw !== undefined
          ? /^\d+$/.test(stepRaw)
            ? Number(stepRaw)
            : stepRaw
          : undefined,
      at: atRaw !== undefined ? Number(atRaw) : undefined,
      seconds: secondsRaw !== undefined ? Number(secondsRaw) : undefined,
      side: side as never,
      mark: mark as never,
      leader: flags.leader === true,
      color: strFlag(flags, 'color'),
      bodyPxGiven: bodyPx !== undefined,
    })
  } catch (e) {
    throw new UsageError(e instanceof Error ? e.message : String(e))
  }
  const { clip, window, sizes } = composed
  if (flags.print === true) {
    r.done(
      { clip, window, sizes, register, brand: brand?.file ?? null },
      JSON.stringify(clip, null, 2),
    )
    return EXIT_OK
  }
  const doc = take.doc
  const overlays = (doc.overlays ?? []).filter((o) => o.id !== clip.id)
  const next = { ...doc, overlays: [...overlays, clip] }
  const lint = lintDoc(next)
  if (lint.problems.length) {
    r.done(
      { valid: false, problems: lint.problems, warnings: lint.warnings, clip },
      `the callout would not validate:\n  ${lint.problems.join('\n  ')}`,
    )
    return EXIT_ERROR
  }
  await writeJson(take.paths.doc, next, true)
  r.done(
    {
      clip,
      window,
      sizes,
      register,
      brand: brand?.file ?? null,
      warnings: lint.warnings,
    },
    `${shape} "${clip.id}" at ${window.start.toFixed(2)}s for ${window.duration.toFixed(2)}s${clip.pin ? `, pinned to ${clip.pin.step !== undefined ? `step ${String(clip.pin.step)}` : `the press at ${String(clip.pin.press)}s`}` : ''}, ground ${register.ground} → card in the product's hue, type ${sizes.kickerPx} / ${sizes.titlePx} / ${sizes.bodyPx} px (kicker / title / body; ${bodyPx !== undefined ? `--body-px ${bodyPx} as delivered` : `the app's body as seen, footage scale ${sizes.scale}; --body-px <n> sets the delivered size`}), written to ${take.paths.doc}${lint.warnings.length ? `\n  warnings:\n  ${lint.warnings.join('\n  ')}` : ''}`,
  )
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
  const notes: string[] = []
  if (!existsSync(take.paths.recording)) {
    problems.push('missing recording (re-run record)')
  } else {
    const mismatch = containerMismatch(
      take.paths.recordingName,
      await readMediaHead(take.paths.recording),
    )
    if (mismatch) warnings.push(mismatch)
  }
  // What the recorder saw in the frame, and masks that hid nothing. The take
  // is valid either way (the doc is fine); these are what to look at before
  // the footage goes anywhere.
  for (const e of take.meta.exposures ?? [])
    warnings.push(`the recording shows ${exposureLine(e)}`)
  if (take.meta.exposures?.length) warnings.push(EXPOSURE_ADVICE)
  for (const m of take.meta.masks ?? [])
    if (m.hits === 0)
      warnings.push(
        `mask "${m.selector}" reached no element, so it hid nothing: whatever it was for may be showing`,
      )
  if (take.meta.wall)
    warnings.push(
      `recorded past a wall: asked for ${take.meta.wall.asked}, landed on ${take.meta.wall.landed}. This footage may be the wrong page`,
    )
  if (!take.doc) problems.push('missing doc.json (run plan)')
  if (take.doc) {
    const lint = lintDoc(take.doc)
    problems.push(...lint.problems.map((p) => `doc.json: ${p}`))
    warnings.push(...lint.warnings.map((w) => `doc.json: ${w}`))
    notes.push(...(lint.notes ?? []).map((n) => `doc.json: ${n}`))
    const probe = mediaProbeLints(
      await probeMediaUrls(collectDocMediaUrls(take.doc)),
    )
    problems.push(...probe.problems)
    warnings.push(...probe.warnings)
    // --picture: each html layer's ground against the footage it covers, as
    // the camera shows it at the layer's start (one browser session, the
    // footage rendered without layers).
    if (
      flags.picture === true &&
      (take.doc.overlays ?? []).some((o) => o.kind === 'html')
    ) {
      const doc = take.doc
      const times = [
        ...new Set(
          (doc.overlays ?? [])
            .filter((o) => o.kind === 'html')
            .map((o) => +(o.start + Math.min(0.35, o.duration / 2)).toFixed(3)),
        ),
      ]
      const browser = await launchBrowser()
      try {
        const frames = await footageFrames(
          browser,
          target,
          doc,
          times,
          framesTake,
        )
        const findings = await groundFindings(
          doc,
          async (t) => frames.get(+t.toFixed(3)) ?? null,
        )
        for (const f of findings) {
          if (f.level === 'problem') problems.push(`doc.json: ${f.message}`)
          else if (f.level === 'warning')
            warnings.push(`doc.json: ${f.message}`)
          else r.event({ event: 'ground', ...f })
        }
      } finally {
        await browser.close()
      }
    }
  }
  if (problems.length) {
    r.done(
      {
        valid: false,
        target,
        problems,
        warnings,
        ...(notes.length ? { notes } : {}),
      },
      `${target}:\n  ${problems.join('\n  ')}${warnings.length ? `\n  warnings:\n  ${warnings.join('\n  ')}` : ''}${notes.length ? `\n  notes:\n  ${notes.join('\n  ')}` : ''}`,
    )
    return EXIT_ERROR
  }
  const noteLines = notes.length ? `\n  notes:\n  ${notes.join('\n  ')}` : ''
  r.done(
    { valid: true, target, warnings, ...(notes.length ? { notes } : {}) },
    `${target}: take is complete and renderable${warnings.length ? `\n  warnings:\n  ${warnings.join('\n  ')}` : ''}${noteLines}`,
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
      'vos push <take> [--vos|--title|--label|--note|--prompt|--folder|--override|--yes|--key|--api|--claimable [--share]]',
    )
  const refusal = takePushRefusal({
    vos: strFlag(flags, 'vos'),
    trackedVosId: readSyncState(resolve(dir))?.vosId ?? null,
    programOnly: ['slug', 'desc', 'tags', 'base', 'remix-of', 'still'].filter(
      (name) => hasFlag(flags, name),
    ),
  })
  if (refusal) throw new UsageError(refusal)
  const r = createReporter(flags.json === true)
  if (flags.claimable === true) {
    // A claimable take creates a NEW vos and uploads nothing: the flags
    // that iterate or file one have nothing to act on.
    const iterating = ['vos', 'folder', 'override', 'base'].filter((name) =>
      hasFlag(flags, name),
    )
    if (iterating.length)
      throw new UsageError(
        `--claimable creates a NEW claimable vos; ${iterating.map((f) => `--${f}`).join(', ')} ${iterating.length > 1 ? 'apply' : 'applies'} to a keyed push`,
      )
    const claim = await pushTakeClaimable(
      resolve(dir),
      {
        api: strFlag(flags, 'api'),
        origin: strFlag(flags, 'origin'),
        title: strFlag(flags, 'title'),
        prompt: strFlag(flags, 'prompt'),
        share: flags.share === true,
      },
      r,
    )
    r.done(
      { ...claim },
      `Claimable push created (${claim.title})\n` +
        `  claim:   ${claim.claimUrl}\n` +
        `  expires: ${claim.expiresAt} — unclaimed work is deleted after 72h\n` +
        `Hand the claim link to the user and NOWHERE else — it is the only\n` +
        `reference and the only credential.`,
    )
    return 0
  }
  // Index access is typed present but is runtime-optional — pushTake guards.
  const overrides = multi.override
  const result = await pushTake(
    resolve(dir),
    {
      key: strFlag(flags, 'key'),
      api: strFlag(flags, 'api'),
      origin: strFlag(flags, 'origin'),
      yes: flags.yes === true,
      vos: strFlag(flags, 'vos'),
      title: strFlag(flags, 'title'),
      label: strFlag(flags, 'label'),
      note: strFlag(flags, 'note'),
      folder: strFlag(flags, 'folder'),
      overrides,
      prompt: strFlag(flags, 'prompt'),
    },
    r,
  )
  // The links name the origin the push went to, so a local dev push does
  // not point at the public site.
  const pushedTo = platformOrigin({
    origin: strFlag(flags, 'origin'),
    api: strFlag(flags, 'api'),
  }).replace(/\/+$/, '')
  const landed =
    flags.wait === true
      ? await waitForLanded({
          origin: pushedTo,
          key: requireCredential(strFlag(flags, 'key')),
          vosId: result.vosId,
          versionId: result.versionId ?? null,
          log: (l) => r.log(l),
        })
      : null
  const filed =
    result.versionNumber === 1
      ? `\n  shelf:  ${strFlag(flags, 'folder') ? `in ${strFlag(flags, 'folder')}` : `unfiled, at the root of your shelf (file it: vos folder move ${result.vosId} --to <slug>)`}`
      : ''
  // A new vos shows the prompt that made it by default: say how, when none
  // was given, because an agent acts on what a push prints.
  const prompt = strFlag(flags, 'prompt')
  const hint =
    result.versionNumber === 1 && !prompt ? promptHint(dir, result.vosId) : null
  r.done(
    {
      ...result,
      ...(hint ? { promptHint: hint } : {}),
      ...(landed
        ? {
            still: landed.still,
            thumbnailUrl: landed.thumbnailUrl,
            previewUrl: landed.previewUrl,
          }
        : {}),
    },
    `pushed v${result.versionNumber} → vos ${result.vosId}\n  review: ${pushedTo}/vos/${result.vosId}\n  studio: ${pushedTo}/studio?vos=${result.vosId}` +
      filed +
      (hint
        ? `\n  prompt: none shown; show the one that made it: ${hint}`
        : '') +
      (landed ? `\n${landedLines(landed)}` : ''),
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

/**
 * One verb's lines out of HELP: its usage line(s) and whatever is indented
 * under them. HELP stays the one text, so a verb's help cannot drift from it.
 */
export function verbHelp(verb: string): string {
  const lines = HELP.split('\n')
  const out: string[] = []
  let taking = false
  for (const line of lines) {
    if (/^ {2}vos /.test(line)) taking = line.startsWith(`  vos ${verb} `)
    else if (taking && !/^ {3,}\S/.test(line)) taking = false
    if (taking) out.push(line)
  }
  if (out.length === 0) return `vos ${verb}: no such verb here. Run: vos help\n`
  return `${out.join('\n')}\n\nThe whole reference, with every flag explained: https://vos.so/llms-full.txt\nExit codes: 0 ok, 1 error, 2 usage or --strict failure, 3 no browser, 4 the recorder met a sign-in instead of the page.\n`
}

/** Entry point — the delegation contract for @vosjs/cli: the host forwards
    every non-engine verb here (`vos <verb>`). The exported `manifest` (index.ts)
    tells the host which verbs exist and how to summarize them in help. */
export async function run(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv
  try {
    if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
      process.stdout.write(HELP)
      return cmd ? EXIT_OK : EXIT_USAGE
    }
    // `vos <verb> --help` is a question, never a usage error: an agent that
    // asks a verb for its flags used to get one line and exit 2, and went
    // grepping the package for the answer.
    if (rest.includes('--help') || rest.includes('-h')) {
      process.stdout.write(verbHelp(cmd))
      return EXIT_OK
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
      case 'callout':
        return await cmdCallout(rest)
      case 'fetch':
        return await cmdFetch(rest)
      case 'duplicate':
        return await cmdDuplicate(rest)
      case 'login':
        return await cmdLogin(rest)
      case 'setup':
        return await cmdSetup(rest)
      case 'doctor':
        return await cmdDoctor(rest)
      case 'whoami':
        return await cmdWhoami(rest)
      case 'logout':
        return cmdLogout(rest)
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
      case 'delete':
        return await cmdDelete(rest)
      case 'trash':
        return await cmdTrash(rest)
      case 'restore':
        return await cmdRestore(rest)
      case 'build':
        return await cmdBuild(rest)
      case 'compare':
        return await cmdCompare(rest)
      case 'port':
        return await cmdPort(rest)
      case 'folder':
        return await cmdFolder(rest)
      case 'asset':
      case 'assets':
        return await cmdAsset(rest)
      case 'recipe':
        return await cmdRecipe(rest)
      case 'brand':
        return await cmdBrand(rest)
      case 'session':
        return await cmdSession(rest)
      case 'actions':
        return await cmdActions(rest)
      case 'ingest':
        return await cmdIngest(rest)
      case 'check-video':
        return await cmdCheckVideo(rest)
      case 'join':
        return await cmdJoin(rest)
      case 'score':
        return await cmdScore(rest)
      case 'look':
        return await cmdLook(rest)
      default:
        throw new UsageError(`unknown command "${cmd}" — run: vos help`)
    }
  } catch (e) {
    if (e instanceof UsageError) {
      process.stderr.write(`usage error: ${e.message}\n`)
      return EXIT_USAGE
    }
    if (
      e instanceof SetupError ||
      e instanceof SetupEnvError ||
      e instanceof RecordRefusedError
    ) {
      process.stderr.write(`${e.message}\n`)
      return EXIT_USAGE
    }
    if (e instanceof WallError) {
      process.stderr.write(`wall: ${e.message}\n`)
      return EXIT_WALL
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

/**
 * `vos session`: takeover mode, local. open / check / list / rm. Counts,
 * origins and expiry only; no verb prints a cookie value, --json included.
 */
async function cmdSession(argv: string[]): Promise<number> {
  const { positionals, flags } = parseArgs(argv, BOOLEAN_FLAGS)
  const [sub, arg] = positionals
  const r = createReporter(flags.json === true)
  const usage =
    'vos session open <url> --name <app> | check <name> [--url <url>] | list | rm <name>'
  switch (sub) {
    case 'open': {
      if (!arg) throw new UsageError(usage)
      const name = strFlag(flags, 'name')
      const bad = sessionNameVerdict(name)
      if (bad) throw new UsageError(bad)
      let url: URL
      try {
        url = new URL(arg)
      } catch {
        throw new UsageError(`vos session open wants a URL, got "${arg}"`)
      }
      if (!/^https?:$/.test(url.protocol))
        throw new UsageError('vos session open wants an http(s) URL')
      await openSession(name!, url.href, { log: r.log })
      const summary = await summarizeSession(name!)
      r.done(
        {
          name: summary.name,
          origins: summary.origins,
          newestExpires: summary.newestExpires,
          sessionOnly: summary.sessionOnly,
        },
        `${summaryLine(summary)}\n  Record on it: vos record --actions actions.json --out take --session ${name} --strict`,
      )
      return summary.origins.length ? EXIT_OK : EXIT_ERROR
    }
    case 'check': {
      if (!arg) throw new UsageError(usage)
      const bad = sessionNameVerdict(arg)
      if (bad) throw new UsageError(bad)
      if (!existsSync(sessionDir(arg)))
        throw new UsageError(`no session "${arg}" (vos session list)`)
      const summary = await summarizeSession(arg)
      const url = strFlag(flags, 'url')
      if (!url) {
        r.done(
          {
            name: arg,
            origins: summary.origins,
            newestExpires: summary.newestExpires,
            sessionOnly: summary.sessionOnly,
          },
          summaryLine(summary),
        )
        return summary.origins.length ? EXIT_OK : EXIT_WALL
      }
      // Does the session still open the page it was made for? The wall
      // check's own verdict, on this profile.
      const verdict = await withSession(arg, async (ctx) => {
        const page = await ctx.newPage()
        const response = await page
          .goto(url, { waitUntil: 'networkidle', timeout: 30000 })
          .catch(() => null)
        const seen = (await page.evaluate(WALL_PROBE).catch(() => null)) as {
          passwordFields: number
          newPasswordField: boolean
          oneTimeCodeField: boolean
        } | null
        return wallVerdict({
          askedUrl: url,
          landedUrl: page.url(),
          ...(response ? { status: response.status() } : {}),
          passwordFields: seen?.passwordFields ?? 0,
          newPasswordField: seen?.newPasswordField ?? false,
          oneTimeCodeField: seen?.oneTimeCodeField ?? false,
        })
      })
      if (verdict) {
        r.done(
          {
            name: arg,
            ok: false,
            wall: verdict,
            origins: summary.origins,
            newestExpires: summary.newestExpires,
          },
          `session "${arg}" no longer opens ${url}: ${verdict.message.split('. ')[0]}. It expired, or the sign-in never landed. Sign in again: vos session open ${url} --name ${arg}`,
        )
        return EXIT_WALL
      }
      r.done(
        {
          name: arg,
          ok: true,
          origins: summary.origins,
          newestExpires: summary.newestExpires,
        },
        `session "${arg}" opens ${url} signed in. ${summaryLine(summary)}`,
      )
      return EXIT_OK
    }
    case 'list': {
      const rows = listSessions()
      r.done(
        { sessions: rows },
        rows.length
          ? rows
              .map(
                (x) =>
                  `  ${x.name}  ${x.ageDays} day${x.ageDays === 1 ? '' : 's'} old`,
              )
              .join('\n')
          : 'no sessions. Make one: vos session open <url> --name <app>',
      )
      return EXIT_OK
    }
    case 'rm': {
      if (!arg) throw new UsageError(usage)
      const bad = sessionNameVerdict(arg)
      if (bad) throw new UsageError(bad)
      const gone = removeSession(arg)
      r.done(
        { name: arg, removed: gone },
        gone ? `removed session "${arg}"` : `no session "${arg}"`,
      )
      return gone ? EXIT_OK : EXIT_ERROR
    }
    default:
      throw new UsageError(usage)
  }
}
