/**
 * Uploading a take's bytes to vos.so, whole or in parts.
 *
 * A request body has a ceiling the platform does not set and cannot raise
 * from inside a handler: the edge refuses anything past it before the
 * request arrives, with its own error page rather than a worded refusal.
 * A screen recording of any real length clears that ceiling at any
 * watchable bitrate, so a whole-file push of a long take failed with a
 * bare status and no explanation.
 *
 * So a file past `SINGLE_SHOT_MAX_BYTES` is declared first, sent as parts
 * that are each a fraction of the ceiling, and sealed. The part size is
 * NOT decided here — the platform returns it from the declaring call, so
 * the split can change server-side without a CLI release. Only the
 * threshold for choosing the chunked door is stated locally, and it is
 * deliberately far below the ceiling.
 *
 * Both doors are content-addressed: the same bytes pushed twice are
 * recognised and never re-sent, which is what keeps an iterating push from
 * re-uploading a take on every round.
 */
import { apiJson } from './platform'
import type { ApiResult } from './platform'

/**
 * Above this, the upload goes in parts. Well under the edge ceiling, and
 * chosen so a dropped connection costs one part rather than a whole take:
 * re-sending a 40 MB body that died at 90% costs more than re-sending one
 * part of it.
 */
export const SINGLE_SHOT_MAX_BYTES = 32 * 1024 * 1024

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
  url: string
  size: number
  /** The platform already had these exact bytes; nothing was sent. */
  reused: boolean
}

export interface UploadTarget {
  origin: string
  key: string
}

export interface UploadOptions {
  filename: string
  contentType: string
  /** sha256 hex — the platform dedupes on it, per owner. */
  contentHash: string
  /** The take's length, so the platform can hold it to the hosted cap. */
  durationSeconds?: number
  /** Parts landed, for a caller that reports a long upload's progress. */
  onPart?: (done: number, total: number) => void
}

function failed(what: string, r: ApiResult): Error {
  const detail = typeof r.body.error === 'string' ? r.body.error : ''
  return new Error(`${what} (${r.status})${detail ? `: ${detail}` : ''}`)
}

function asAsset(body: Record<string, unknown>): UploadedAsset {
  return {
    id: String(body.id),
    url: String(body.url),
    size: typeof body.size === 'number' ? body.size : 0,
    reused: body.reused === true,
  }
}

/** Worth sending again: the platform was busy or briefly unreachable. A
 * refusal is a decision and will read the same on a second try. */
function transient(status: number): boolean {
  return status >= 500 || status === 429
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Upload one file as an owned asset, picking the transport by size. The
 * caller never chooses: a small file is one request, a recording is parts.
 */
export async function uploadAsset(
  target: UploadTarget,
  bytes: Uint8Array,
  opts: UploadOptions,
): Promise<UploadedAsset> {
  return bytes.length > SINGLE_SHOT_MAX_BYTES
    ? uploadInParts(target, bytes, opts)
    : uploadWhole(target, bytes, opts)
}

async function uploadWhole(
  target: UploadTarget,
  bytes: Uint8Array,
  opts: UploadOptions,
): Promise<UploadedAsset> {
  const res = await apiJson(target.origin, '/api/assets/recording', {
    method: 'POST',
    key: target.key,
    headers: {
      'Content-Type': opts.contentType,
      'Content-Length': String(bytes.length),
      'X-Filename': opts.filename,
      'X-Content-Hash': opts.contentHash,
      ...(opts.durationSeconds && opts.durationSeconds > 0
        ? { 'X-Content-Duration': opts.durationSeconds.toFixed(3) }
        : {}),
    },
    raw: bytes,
  })
  if (res.status !== 201 && res.status !== 200)
    throw failed('upload failed', res)
  return asAsset(res.body)
}

async function uploadInParts(
  target: UploadTarget,
  bytes: Uint8Array,
  opts: UploadOptions,
): Promise<UploadedAsset> {
  // Declare it first. Every quota is weighed here, before a byte moves, so
  // a refusal costs nothing and arrives in words — and the dedupe answers
  // here too, which is what makes re-pushing a hosted take free.
  const begun = await apiJson(
    target.origin,
    '/api/assets/recording/multipart',
    {
      method: 'POST',
      key: target.key,
      body: {
        filename: opts.filename,
        contentType: opts.contentType,
        size: bytes.length,
        contentHash: opts.contentHash,
        ...(opts.durationSeconds && opts.durationSeconds > 0
          ? { durationSeconds: opts.durationSeconds }
          : {}),
      },
    },
  )
  if (begun.status !== 201 && begun.status !== 200) {
    throw failed('upload failed', begun)
  }
  // The platform already holds these bytes: nothing to send.
  if (begun.body.reused === true || typeof begun.body.url === 'string') {
    return asAsset(begun.body)
  }

  const uploadId = String(begun.body.id)
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
            `/api/assets/recording/multipart/${uploadId}/parts/${part.partNumber}`,
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

    const sealed = await apiJson(
      target.origin,
      `/api/assets/recording/multipart/${uploadId}/complete`,
      { method: 'POST', key: target.key, body: { parts: etags } },
    )
    if (sealed.status !== 201 && sealed.status !== 200) {
      throw failed('upload failed', sealed)
    }
    return asAsset(sealed.body)
  } catch (err) {
    // Hand the parts back rather than leaving them held server-side.
    await apiJson(
      target.origin,
      `/api/assets/recording/multipart/${uploadId}`,
      { method: 'DELETE', key: target.key },
    ).catch(() => undefined)
    throw err
  }
}
