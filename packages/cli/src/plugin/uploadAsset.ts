/**
 * Uploading a file to vos.so: one door, for every kind and every size.
 *
 * The file is declared first, sent as parts, and sealed. Three reasons it
 * is never one request:
 *
 * - A request body has a ceiling the platform does not set and cannot
 *   raise from inside a handler: the edge refuses anything past it before
 *   the request arrives, with its own error page rather than a worded
 *   refusal. A screen recording of any real length clears that ceiling.
 * - Everything the platform may refuse a file for (its kind, its size, a
 *   daily rate, the account's storage) is weighed at the declaring call,
 *   before a byte moves, so a refusal costs nothing and arrives in words.
 * - The declaring call is content-addressed: the same bytes pushed twice
 *   are recognised and never re-sent, which is what keeps an iterating
 *   push from re-uploading a take on every round.
 *
 * The part size is NOT decided here. The platform returns it from the
 * declaring call, so the split can change server-side without a CLI
 * release.
 *
 * What the file IS comes back from the sealing call: the platform reads
 * the stored bytes and answers its kind, the name it is stored under and
 * anything worth saying about it. Nothing here decides what is accepted;
 * `GET /api/limits` lists the kinds and their caps.
 */
import { apiJson } from './platform'
import type { ApiResult } from './platform'

/** Attempts per part. A part commits nothing until the upload is sealed,
 * so it is always safe to send again. */
const PART_ATTEMPTS = 3

export interface PartPlan {
  /** Part numbers are 1-based. */
  partNumber: number
  start: number
  /** One past the last byte. */
  end: number
}

/**
 * The slices to send, in order. Every part but the last is exactly
 * `partBytes`; the last is the remainder. The platform holds each part to
 * exactly this length, so the split has to agree with the size that was
 * declared — which is why `partBytes` comes from the platform rather than
 * from a constant here.
 */
export function planParts(totalBytes: number, partBytes: number): PartPlan[] {
  if (totalBytes <= 0 || partBytes <= 0) return []
  const parts: PartPlan[] = []
  for (let start = 0; start < totalBytes; start += partBytes) {
    parts.push({
      partNumber: parts.length + 1,
      start,
      end: Math.min(start + partBytes, totalBytes),
    })
  }
  return parts
}

export interface UploadedAsset {
  id: string
  /** The path a document names the file by. */
  url: string
  size: number
  /** The platform already had these exact bytes; nothing was sent. */
  reused: boolean
  /** What the bytes are, as the platform read them (video, audio, image,
   * vector, model, font, hdr, recipe, captions). */
  kind: string
  /** The name it is stored under: the extension follows the bytes. */
  filename: string
  /** The frontmatter summary of a recipe, a picture's size, a clip's codec. */
  metadata: Record<string, unknown> | null
  /** What the platform did to the file or wants said about it. */
  notes: string[]
  /** The reference a program's manifest takes. */
  ref: string
  /** Seconds, for what plays. */
  duration: number | null
}

export interface UploadTarget {
  origin: string
  /** The bearer: a content key, or a claimable push's session token. */
  key: string
  /**
   * The door's path. The account's by default; a claimable push sends its
   * files through `/api/claim/uploads/files`, which speaks the same
   * protocol under its session token.
   */
  door?: string
}

export interface UploadOptions {
  filename: string
  /** Only a hint: the platform types a file by its bytes. It settles the
   * one thing bytes cannot, a WebM that holds sound alone. */
  contentType?: string
  /** sha256 hex — the platform dedupes on it, per owner. */
  contentHash: string
  /** The take's length, so a refusal for one past the hosted cap arrives
   * before anything is sent. The platform measures the file either way. */
  durationSeconds?: number
  /** Parts landed, for a caller that reports a long upload's progress. */
  onPart?: (done: number, total: number) => void
  /** File the asset into one of the caller's folders. */
  folderId?: string
  /**
   * `library`: a file added to keep (`vos asset push`, a recipe).
   * `attached` (the default): a file a document is about to name, which
   * the platform collects if nothing ever does.
   */
  intent?: 'library' | 'attached'
  /**
   * Where the file came from, as the uploader states it: kept beside the
   * file and shown with it. The platform does not check it.
   */
  provenance?: { sourceUrl?: string; license?: string; attribution?: string }
}

function failed(what: string, r: ApiResult): Error {
  const detail = typeof r.body.error === 'string' ? r.body.error : ''
  const hint = typeof r.body.hint === 'string' ? ` ${r.body.hint}` : ''
  return new Error(`${what} (${r.status})${detail ? `: ${detail}${hint}` : ''}`)
}

function asAsset(
  body: Record<string, unknown>,
  reused: boolean,
): UploadedAsset {
  const asset = (body.asset ?? {}) as Record<string, unknown>
  return {
    id: String(asset.id),
    url: String(asset.fileUrl),
    size: typeof asset.size === 'number' ? asset.size : 0,
    reused,
    kind: typeof asset.kind === 'string' ? asset.kind : '',
    filename: typeof asset.filename === 'string' ? asset.filename : '',
    metadata:
      asset.metadata && typeof asset.metadata === 'object'
        ? (asset.metadata as Record<string, unknown>)
        : null,
    notes: Array.isArray(body.notes)
      ? body.notes.filter((n): n is string => typeof n === 'string')
      : [],
    ref:
      typeof asset.ref === 'string' ? asset.ref : `asset:${String(asset.id)}`,
    duration: typeof asset.duration === 'number' ? asset.duration : null,
  }
}

/** Worth sending again: the platform was busy or briefly unreachable. A
 * refusal is a decision and will read the same on a second try. */
function transient(status: number): boolean {
  return status >= 500 || status === 429
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Upload one file as an owned asset: declare it, send its parts, seal it. */
export async function uploadAsset(
  target: UploadTarget,
  bytes: Uint8Array,
  opts: UploadOptions,
): Promise<UploadedAsset> {
  // Declare it first. Every quota is weighed here, before a byte moves, so
  // a refusal costs nothing and arrives in words — and the dedupe answers
  // here too, which is what makes re-pushing a hosted take free.
  const door = target.door ?? '/api/assets/uploads'
  const begun = await apiJson(target.origin, door, {
    method: 'POST',
    key: target.key,
    body: {
      filename: opts.filename,
      ...(opts.contentType ? { contentType: opts.contentType } : {}),
      size: bytes.length,
      sha256: opts.contentHash,
      ...(opts.durationSeconds && opts.durationSeconds > 0
        ? { durationSeconds: opts.durationSeconds }
        : {}),
      ...(opts.folderId ? { folderId: opts.folderId } : {}),
      ...(opts.intent ? { intent: opts.intent } : {}),
    },
  })
  if (begun.status !== 201 && begun.status !== 200) {
    throw failed('upload failed', begun)
  }
  // The platform already holds these bytes: nothing to send.
  if (begun.body.asset) return asAsset(begun.body, true)

  const uploadId = String(begun.body.uploadId)
  const partBytes = Number(begun.body.partBytes)
  if (!Number.isFinite(partBytes) || partBytes <= 0) {
    throw new Error('upload failed: the platform returned no part size')
  }
  const parts = planParts(bytes.length, partBytes)
  const etags: { partNumber: number; etag: string }[] = []

  try {
    for (const part of parts) {
      const chunk = bytes.subarray(part.start, part.end)
      let sent: ApiResult | null = null
      for (let attempt = 1; attempt <= PART_ATTEMPTS; attempt++) {
        try {
          sent = await apiJson(
            target.origin,
            `${door}/${uploadId}/parts/${part.partNumber}`,
            {
              method: 'PUT',
              key: target.key,
              headers: {
                'Content-Type': 'application/octet-stream',
                'Content-Length': String(chunk.length),
              },
              raw: chunk,
            },
          )
        } catch (networkError) {
          // Dropped connection, a sleeping machine: worth another try.
          if (attempt === PART_ATTEMPTS) throw networkError
          await wait(500 * 2 ** (attempt - 1))
          continue
        }
        if (sent.status === 200) break
        if (!transient(sent.status) || attempt === PART_ATTEMPTS) {
          throw failed(`part ${part.partNumber} failed`, sent)
        }
        await wait(500 * 2 ** (attempt - 1))
      }
      if (!sent || sent.status !== 200) {
        throw new Error(`part ${part.partNumber} failed`)
      }
      etags.push({
        partNumber: Number(sent.body.partNumber),
        etag: String(sent.body.etag),
      })
      opts.onPart?.(etags.length, parts.length)
    }

    // Sealing is where the platform reads the file. A refusal here means
    // the bytes are not what the name said, and it has already taken them
    // back out.
    const sealed = await apiJson(
      target.origin,
      `${door}/${uploadId}/complete`,
      {
        method: 'POST',
        key: target.key,
        body: {
          parts: etags,
          ...(opts.provenance ? { provenance: opts.provenance } : {}),
        },
      },
    )
    if (sealed.status !== 201 && sealed.status !== 200) {
      throw failed('upload failed', sealed)
    }
    // The platform hashes what it stored: bytes this account already held
    // come back as the file it had, whatever was declared.
    return asAsset(sealed.body, sealed.body.reused === true)
  } catch (err) {
    // Hand the parts back rather than leaving them held server-side.
    await apiJson(target.origin, `${door}/${uploadId}`, {
      method: 'DELETE',
      key: target.key,
    }).catch(() => undefined)
    throw err
  }
}
