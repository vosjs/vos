/**
 * What a media file IS, read from its first bytes.
 *
 * A file's NAME and its Content-Type are both CLAIMS, and both drift from the
 * bytes: the in-page recorder remuxes a take to mp4 while keeping the name
 * `recording.webm`, and a hosted asset keeps whatever name it was uploaded
 * under. Believing a claim is how an mp4 gets uploaded as `video/webm`, and
 * every render of that version then dies inside the video element with a
 * format error — one machine and one day away from the mislabelling that
 * caused it.
 *
 * So the rule is one line: THE BYTES DECIDE. A claim is the fallback only for
 * bytes that say nothing (an SVG, a recipe, an unknown blob), which keeps the
 * override safe — a name is corrected only when the file positively contradicts
 * it, never on a guess.
 */

const OCTET_STREAM = 'application/octet-stream'

/** The one extension↔type table. */
const TYPES_BY_EXTENSION: Record<string, string> = {
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  avif: 'image/avif',
  webm: 'video/webm',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  m4a: 'audio/mp4',
}

/** The extension each type is written under, where the table is many-to-one. */
const EXTENSION_BY_TYPE: Record<string, string> = {
  'image/jpeg': '.jpg',
  'video/mp4': '.mp4',
  'audio/mp4': '.m4a',
}

/**
 * Every container a take's own media (footage, mic, cam) can come home in —
 * the name `record` writes first, so a resolver is deterministic when a stale
 * sibling is somehow present.
 */
export const TAKE_MEDIA_EXTENSIONS = [
  '.webm',
  '.mp4',
  '.mov',
  '.m4a',
  '.mp3',
  '.ogg',
  '.wav',
] as const

/** Enough bytes for every signature below (the longest reads 12). */
export const MEDIA_HEAD_BYTES = 16

/**
 * ISO base media brands that are NOT plain mp4. Everything else carrying an
 * `ftyp` box (isom, mp42, avc1, iso5, dash, M4V…) is video/mp4.
 */
const ISO_BRANDS: Record<string, string> = {
  'qt  ': 'video/quicktime',
  'M4A ': 'audio/mp4',
  'M4B ': 'audio/mp4',
  avif: 'image/avif',
  avis: 'image/avif',
}

/** RIFF forms, read from the four bytes after the size field. */
const RIFF_FORMS: Record<string, string> = {
  WEBP: 'image/webp',
  WAVE: 'audio/wav',
  'AVI ': 'video/x-msvideo',
}

/** The media type a file's first bytes prove, or null when they prove nothing. */
export function sniffMediaType(head: Uint8Array): string | null {
  const ascii = (at: number, len: number): string =>
    head.length >= at + len
      ? String.fromCharCode(...head.subarray(at, at + len))
      : ''
  const startsWith = (...bytes: number[]): boolean =>
    bytes.every((b, i) => head[i] === b)

  // EBML: Matroska and its WebM profile. A .mkv sniffs as webm, which is what
  // every consumer here wants — the distinction is a codec constraint, not a
  // container one.
  if (startsWith(0x1a, 0x45, 0xdf, 0xa3)) return 'video/webm'
  if (ascii(4, 4) === 'ftyp') return ISO_BRANDS[ascii(8, 4)] ?? 'video/mp4'
  if (ascii(0, 4) === 'RIFF') return RIFF_FORMS[ascii(8, 4)] ?? null
  if (startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))
    return 'image/png'
  if (startsWith(0xff, 0xd8, 0xff)) return 'image/jpeg'
  if (ascii(0, 4) === 'GIF8') return 'image/gif'
  if (ascii(0, 4) === 'OggS') return 'audio/ogg'
  if (ascii(0, 3) === 'ID3') return 'audio/mpeg'
  return null
}

/** A Content-Type header reduced to its bare type, or '' when it says nothing. */
function bareType(value: string | null | undefined): string {
  const type = (value ?? '').split(';')[0].trim().toLowerCase()
  // `binary/octet-stream` is a common spelling of the same non-answer.
  return !type || type === OCTET_STREAM || type === 'binary/octet-stream'
    ? ''
    : type
}

/** The content type a file's NAME claims, by extension. */
export function mediaContentType(file: string): string {
  const ext = (/\.([a-z0-9]+)$/i.exec(file)?.[1] ?? '').toLowerCase()
  return TYPES_BY_EXTENSION[ext] ?? OCTET_STREAM
}

/** The extension a media type is written under ('' when it has none here). */
export function extensionFor(contentType: string): string {
  const type = (contentType ?? '').split(';')[0].trim().toLowerCase()
  if (EXTENSION_BY_TYPE[type]) return EXTENSION_BY_TYPE[type]
  const ext = Object.keys(TYPES_BY_EXTENSION).find(
    (e) => TYPES_BY_EXTENSION[e] === type,
  )
  return ext ? `.${ext}` : ''
}

export interface MediaTypeClaims {
  /** The file's first bytes — `MEDIA_HEAD_BYTES` is enough. */
  head?: Uint8Array | null
  /** What a server said it was serving. */
  declared?: string | null
  /** What the name claims. */
  filename?: string | null
}

export interface ResolvedMediaType {
  type: string
  /** Which claim won, so a caller can SAY when the bytes overruled a name. */
  from: 'bytes' | 'declared' | 'filename' | 'unknown'
}

/** The type to believe: the bytes, then the server, then the name. */
export function resolveMediaType(claims: MediaTypeClaims): ResolvedMediaType {
  const sniffed = claims.head?.length ? sniffMediaType(claims.head) : null
  if (sniffed) return { type: sniffed, from: 'bytes' }
  const declared = bareType(claims.declared)
  if (declared) return { type: declared, from: 'declared' }
  const named = mediaContentType(claims.filename ?? '')
  if (named !== OCTET_STREAM) return { type: named, from: 'filename' }
  return { type: OCTET_STREAM, from: 'unknown' }
}

/**
 * The same name wearing the extension its type earns. Unchanged when the two
 * already agree (`.jpeg` is not churned into `.jpg`) or when the type has no
 * extension here, so a correction is always a real one.
 */
export function nameForType(filename: string, type: string): string {
  const ext = extensionFor(type)
  if (!ext) return filename
  const current = /\.[a-z0-9]+$/i.exec(filename)?.[0] ?? ''
  if (current && mediaContentType(`x${current}`) === type) return filename
  return `${filename.slice(0, filename.length - current.length)}${ext}`
}

/**
 * What to say about a file whose name and bytes disagree, or null when they
 * agree or the bytes prove nothing.
 *
 * Every reader in this CLI now believes the bytes (the take server sniffs, a
 * push declares from them), so a mismatch breaks nothing here — it is still a
 * file lying about itself to every player, editor and person who opens it, and
 * the rename is one move.
 */
export function containerMismatch(
  filename: string,
  head: Uint8Array,
): string | null {
  const actual = sniffMediaType(head)
  if (!actual) return null
  const claimed = mediaContentType(filename)
  if (claimed === actual) return null
  return `${filename} is ${actual}, not the ${claimed} its name claims — rename it to ${nameForType(filename, actual)}`
}
