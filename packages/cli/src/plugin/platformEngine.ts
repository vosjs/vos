/**
 * Can the platform play what this take uses?
 *
 * A CLI release can teach the document a field (a caption anchored to a
 * step, a loudness target on a clip) days before the hosting platform runs
 * the `@vosjs/studio-core` release that reads it. A push lowers the take
 * HERE, so the program the platform plays from the push is right; but the
 * platform keeps the document too, and its studio lowers that document
 * again with its own release when the take is opened, and every version
 * saved from the studio (a person's save, an autosave checkpoint) stores
 * that lowering. An older release skips a field it does not know, without
 * a word, so the take is right until somebody opens it there.
 *
 * So a push reads the platform's release (`GET <origin>/api/engine`, public,
 * `{ studioCore, core }`) and refuses, in words, a take that uses a feature
 * newer than it (studio-core's feature table), unless `--bake` says those
 * features in what the older release reads, on the copy that is sent. An
 * unreadable answer (no such endpoint, a refusal, a timeout) never blocks a
 * push: it warns and goes ahead.
 */
import { bakeDocFeatures, featuresNewerThan } from '@vosjs/studio-core'
import type { StudioDoc, UsedFeature } from '@vosjs/studio-core'

/** The platform's renderer, as `GET /api/engine` answers it. */
export interface PlatformEngine {
  studioCore: string
  core?: string
}

/** How long a push waits for the answer, ms. */
export const ENGINE_TIMEOUT_MS = 2000

const VERSION = /^\d+\.\d+\.\d+([-+].*)?$/

/** Read the platform's releases; a reason in words when they cannot be read. */
export async function readPlatformEngine(
  origin: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = ENGINE_TIMEOUT_MS,
): Promise<{ engine: PlatformEngine } | { unknown: string }> {
  const url = `${origin.replace(/\/+$/, '')}/api/engine`
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), timeoutMs)
  try {
    const res = await fetchImpl(url, {
      signal: ctl.signal,
      headers: { accept: 'application/json' },
    })
    if (!res.ok) return { unknown: `GET ${url} answered ${res.status}` }
    const body = (await res.json()) as Record<string, unknown>
    const v = body?.studioCore
    if (typeof v !== 'string' || !VERSION.test(v.trim()))
      return { unknown: `GET ${url} named no studio-core release` }
    return {
      engine: {
        studioCore: v.trim(),
        ...(typeof body.core === 'string' ? { core: body.core } : {}),
      },
    }
  } catch (e) {
    return {
      unknown: ctl.signal.aborted
        ? `GET ${url} did not answer within ${timeoutMs / 1000} s`
        : `GET ${url} failed (${e instanceof Error ? e.message : String(e)})`,
    }
  } finally {
    clearTimeout(timer)
  }
}

/** A take that uses what the platform cannot play yet: exit 2, in words. */
export class PlatformBehindError extends Error {}

const listOf = (words: string[]): string =>
  words.length <= 1
    ? (words[0] ?? '')
    : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`

/** The refusal, in words. */
export function behindMessage(
  used: readonly UsedFeature[],
  platform: string,
  host: string,
  bake: boolean,
): string {
  const named = (u: UsedFeature) =>
    `${u.feature.name} (studio-core ${u.feature.since})`
  const head =
    used.length === 1
      ? `this take uses ${named(used[0])}; ${host} renders with ${platform}, and its studio ${used[0].feature.before}, as would every version saved there.`
      : `this take uses fields ${host} cannot play yet; it renders with ${platform}, and its studio, and every version saved there, would get them wrong: ${used.map((u) => `${named(u)} ${u.feature.before}`).join('; ')}.`
  const cannot = used.filter((u) => !u.feature.bake).map((u) => u.feature.name)
  if (bake)
    return `${head} --bake cannot say ${listOf(cannot)} in what ${platform} reads; push again when ${host} updates`
  if (!cannot.length)
    return `${head} Push again when ${host} updates, or bake them: vos push --bake`
  return `${head} Push again when ${host} updates (${listOf(cannot)} cannot be baked).`
}

export interface PushCheck {
  /** The document to send: the take's own, or its baked copy. */
  doc: StudioDoc
  /** Said on the way (a platform that could not be read, what a bake changed). */
  lines: string[]
  /** The features baked into the copy. */
  baked: string[]
}

/**
 * The check a take push makes before anything is sent. Throws
 * PlatformBehindError on a take the platform cannot play yet (unless
 * `bake` can say every such feature); never on a network failure.
 *
 * `bake` is the person's choice to send a copy ANY renderer plays, so it
 * bakes every feature the take uses that can be baked, whatever the check
 * found: a platform behind, current, or one that could not say.
 */
export async function checkPlatformPlays(
  doc: StudioDoc,
  opts: { origin: string; bake?: boolean; fetchImpl?: typeof fetch },
): Promise<PushCheck> {
  const host = hostOf(opts.origin)
  const read = await readPlatformEngine(opts.origin, opts.fetchImpl)
  const platform = 'engine' in read ? read.engine.studioCore : null
  const newer = platform ? featuresNewerThan(doc, platform) : []
  if (
    platform &&
    newer.length &&
    (!opts.bake || newer.some((u) => !u.feature.bake))
  )
    throw new PlatformBehindError(
      behindMessage(newer, platform, host, !!opts.bake),
    )
  const unread =
    'unknown' in read
      ? `could not read which studio-core ${host} renders with (${read.unknown}); `
      : ''
  if (!opts.bake)
    return {
      doc,
      lines: unread
        ? [
            `${unread}pushing without checking that it plays every field this take uses`,
          ]
        : [],
      baked: [],
    }
  // Every bakeable feature, against the oldest release there is.
  const r = bakeDocFeatures(doc, '0.0.0')
  const against = platform
    ? `${host} renders with ${platform}`
    : `${host} could not say what it renders with`
  return {
    doc: r.doc,
    lines: [
      ...(unread ? [`${unread}baking every field --bake can say`] : []),
      r.baked.length
        ? `baked: ${listOf(r.baked.map((f) => f.name))} (${against}; the copy sent, doc.json untouched)`
        : `baked: nothing, this take uses no field --bake says (${against})`,
      ...r.notes.map((n) => `  ${n}`),
    ],
    baked: r.baked.map((f) => f.id),
  }
}

function hostOf(origin: string): string {
  try {
    return new URL(origin).host
  } catch {
    return origin
  }
}
