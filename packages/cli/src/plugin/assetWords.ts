/**
 * How a hosted file is put into words on a terminal: what the platform
 * read it to be, and the line that names it in a program. Pure.
 */

export interface HostedFile {
  id: string
  kind: string
  filename: string
  size: number
  duration?: number | null
  metadata?: Record<string, unknown> | null
  uses?: number
  intent?: string
  folderId?: string | null
}

/**
 * A file as the platform lists it, read defensively: the list has called a
 * file's kind `category` for longer than it has called it `kind`, and a
 * row missing a field must print as a gap, never throw.
 */
export function hostedFile(raw: unknown): HostedFile {
  const row = (raw && typeof raw === 'object' ? raw : {}) as Record<
    string,
    unknown
  >
  const text = (value: unknown, fallback = ''): string =>
    typeof value === 'string' ? value : fallback
  return {
    ...row,
    id: text(row.id),
    kind: text(row.kind) || text(row.category, 'file'),
    filename: text(row.filename, 'unnamed'),
    size: typeof row.size === 'number' ? row.size : 0,
  } as HostedFile
}

export function bytesWords(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B'
  if (bytes < 1024) return `${Math.round(bytes)} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value >= 100 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`
}

const num = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null

/**
 * What the platform measured, in one line: `video 1920×1080 h264 34.2 s,
 * audio`. Only what it actually read is said; a kind with nothing measured
 * is just its kind.
 */
export function probeLine(file: HostedFile): string {
  const meta = file.metadata ?? {}
  const parts: string[] = [file.kind]
  const width = num(meta.width)
  const height = num(meta.height)
  if (width && height) parts.push(`${width}×${height}`)
  if (typeof meta.videoCodec === 'string') parts.push(meta.videoCodec)
  else if (typeof meta.audioCodec === 'string' && file.kind === 'audio') {
    parts.push(meta.audioCodec)
  }
  const seconds = num(file.duration)
  if (seconds && seconds > 0) {
    parts.push(`${seconds >= 10 ? seconds.toFixed(1) : seconds.toFixed(2)} s`)
  }
  let line = parts.join(' ')
  if (file.kind === 'video' && meta.hasAudio === true) line += ', audio'
  if (file.kind === 'model') {
    const meshes = num(meta.meshCount)
    if (meshes !== null) line += ` ${meshes} mesh${meshes === 1 ? '' : 'es'}`
  }
  return line
}

/** A manifest name from a file name: an identifier, as `ctx.assets.<name>` needs. */
export function manifestName(filename: string): string {
  const stem = filename.replace(/\.[^.]+$/, '')
  const name = stem
    .replace(/[^A-Za-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/^(\d)/, '_$1')
  return name || 'file'
}

/** The kinds a manifest's `kind` hint knows. */
const MANIFEST_KINDS = new Set([
  'image',
  'video',
  'audio',
  'model',
  'font',
  'hdr',
])

/** The line that declares the file in a program's `assets`. */
export function manifestLine(file: HostedFile): string {
  const kind = file.kind === 'vector' ? 'image' : file.kind
  const hint = MANIFEST_KINDS.has(kind) ? `, "kind": "${kind}"` : ''
  return `"${manifestName(file.filename)}": { "ref": "asset:${file.id}"${hint} }`
}

/** One row of `vos assets ls`: aligned by the caller, facts in a fixed order. */
export function listRow(file: HostedFile): string[] {
  return [
    file.id,
    file.kind,
    bytesWords(file.size),
    file.kind === 'recipe'
      ? ''
      : file.uses
        ? `used in ${file.uses}`
        : 'not used',
    file.intent === 'attached' ? 'attached' : 'library',
    file.filename,
  ]
}

/** Columns padded to the widest cell; the last column is left ragged. */
export function alignRows(rows: string[][]): string[] {
  if (rows.length === 0) return []
  const widths = rows[0].map((_, col) =>
    Math.max(...rows.map((row) => (row[col] ?? '').length)),
  )
  return rows.map((row) =>
    row
      .map((cell, col) =>
        col === row.length - 1 ? cell : cell.padEnd(widths[col]),
      )
      .join('  ')
      .trimEnd(),
  )
}

/** A file name for bytes fetched from an address: its last path segment. */
export function nameFromUrl(url: string): string {
  try {
    const last = decodeURIComponent(
      new URL(url).pathname.split('/').filter(Boolean).pop() ?? '',
    )
    const clean = last.replace(/[^\w.\- ]+/g, '_').slice(0, 120)
    return clean || 'download'
  } catch {
    return 'download'
  }
}
