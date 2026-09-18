/**
 * The take directory — the CLI's unit of work, human-inspectable on purpose:
 *   take/
 *     recording.webm   encoded footage (CFR; .mp4 when a pull brought it home
 *                      in that container, so readers RESOLVE the name)
 *     frames/          raw screencast JPEGs + frames.json (kept for re-encode)
 *     cursor.json      synthesized CursorTrack
 *     meta.json        RecordingMeta (producer: 'cli')
 *     actions.json     the script that produced it (replay recipe)
 *     doc.json         ProjectDoc — the agent-editable surface
 */
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { basename, join } from 'node:path'
import { TAKE_MEDIA_EXTENSIONS } from './container'
import type { CursorTrack, ProjectDoc, RecordingMeta } from '@vosjs/studio-core'
import type { ActionsFile } from './actions'

/** The name `record` writes its footage under — its encoder emits WebM. */
export const RECORDING_NAME = 'recording.webm'

/**
 * A take's own media under `dir`, whatever container it came home in.
 *
 * `record` writes WebM, but a PULLED take wears the container its hosted asset
 * actually holds, so nothing may spell `recording.webm` at a read site: a take
 * whose footage is mp4 must still render, digest and push. Ordered by
 * `TAKE_MEDIA_EXTENSIONS`, so the answer is deterministic if a stale sibling
 * survives.
 */
export function takeMediaFiles(dir: string, stem: string): string[] {
  return TAKE_MEDIA_EXTENSIONS.map((ext) => join(dir, `${stem}${ext}`)).filter(
    (file) => existsSync(file),
  )
}

/**
 * The one file a take's media stem names, falling back to what `record` would
 * write — so a caller can `existsSync` the answer and get an honest
 * "no footage here" rather than a path that never existed.
 */
export function takeMediaFile(
  dir: string,
  stem: string,
  fallback: string,
): string {
  return takeMediaFiles(dir, stem)[0] ?? join(dir, fallback)
}

/** The previous cut, preserved by a re-record. */
export const PREV_DOC_NAME = 'doc.prev.json'

export interface TakePaths {
  dir: string
  recording: string
  /** The recording's bare filename — what a doc key or a served URL spells. */
  recordingName: string
  framesDir: string
  framesIndex: string
  cursor: string
  meta: string
  actions: string
  doc: string
}

export function takePaths(dir: string): TakePaths {
  const recording = takeMediaFile(dir, 'recording', RECORDING_NAME)
  return {
    dir,
    recording,
    recordingName: basename(recording),
    framesDir: join(dir, 'frames'),
    framesIndex: join(dir, 'frames.json'),
    cursor: join(dir, 'cursor.json'),
    meta: join(dir, 'meta.json'),
    actions: join(dir, 'actions.json'),
    doc: join(dir, 'doc.json'),
  }
}

export async function ensureTakeDir(dir: string): Promise<TakePaths> {
  const p = takePaths(dir)
  await mkdir(p.framesDir, { recursive: true })
  return p
}

/**
 * Re-record into an existing take WITHOUT destroying the cut (the
 * re-render loop's first rung; `rm -rf` here is what made "re-renders on the
 * next version" a false claim). What the old footage produced is cleared
 * (recording, cursor, meta, raw frames, stills/, digest/ — all derived and
 * regenerable); what the human's work lives in survives: `doc.json` moves to
 * `doc.prev.json` — the explicit reuse base `vos plan --reuse` re-anchors
 * onto the new recording — and `actions.json` + `vos.json` stay put. The doc
 * is MOVED, never left in place: a doc.json embeds its footage's cursor and
 * meta (`doc.source`), so leaving it beside new footage would be a document
 * lying about its source, and the auto-plan after recording would replan
 * from the OLD cursor. Returns what was kept, for the terminal to say.
 */
export async function prepareReRecord(
  dir: string,
): Promise<{ prevDoc: boolean; kept: string[] }> {
  const p = takePaths(dir)
  const kept: string[] = []
  let prevDoc = false
  if (existsSync(p.doc)) {
    await rename(p.doc, join(dir, PREV_DOC_NAME))
    prevDoc = true
    kept.push(PREV_DOC_NAME)
  }
  if (existsSync(p.actions)) kept.push('actions.json')
  if (existsSync(join(dir, 'vos.json'))) kept.push('vos.json')
  for (const stale of [
    // Every container, not just the one `record` writes: a pulled take's
    // footage may be mp4, and a survivor would outrank the new recording.
    ...takeMediaFiles(dir, 'recording'),
    ...takeMediaFiles(dir, 'mic'),
    ...takeMediaFiles(dir, 'cam'),
    p.cursor,
    p.meta,
    p.framesIndex,
    p.framesDir,
    join(dir, 'stills'),
    join(dir, 'digest'),
  ]) {
    await rm(stale, { recursive: true, force: true })
  }
  return { prevDoc, kept }
}

export async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await readFile(file, 'utf8')) as T
}

export async function writeJson(
  file: string,
  value: unknown,
  pretty = false,
): Promise<void> {
  await writeFile(
    file,
    pretty ? JSON.stringify(value, null, 2) : JSON.stringify(value),
  )
}

export interface TakeData {
  paths: TakePaths
  cursor: CursorTrack
  meta: RecordingMeta
  actions: ActionsFile | null
  doc: ProjectDoc | null
}

/** Load a take directory; cursor+meta are required, doc/actions optional. */
export async function loadTake(dir: string): Promise<TakeData> {
  const paths = takePaths(dir)
  if (!existsSync(paths.meta)) {
    throw new Error(
      `${dir} is not a take directory (missing meta.json) — run record first`,
    )
  }
  const meta = await readJson<RecordingMeta>(paths.meta)
  const cursor = existsSync(paths.cursor)
    ? await readJson<CursorTrack>(paths.cursor)
    : []
  const actions = existsSync(paths.actions)
    ? await readJson<ActionsFile>(paths.actions)
    : null
  const doc = existsSync(paths.doc)
    ? await readJson<ProjectDoc>(paths.doc)
    : null
  return { paths, cursor, meta, actions, doc }
}
