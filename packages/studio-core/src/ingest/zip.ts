/**
 * A zip's table of contents, pure: enough to find `trace.trace` inside a
 * Playwright `trace.zip` and hand its bytes to the host, which inflates
 * them its own way (node:zlib, or DecompressionStream in a browser). Reads
 * the end-of-central-directory record, then each central entry, then the
 * local header for the data offset. No zip64, no encryption: a trace zip
 * is neither.
 */
export interface ZipEntry {
  name: string
  /** 0 = stored, 8 = deflate (raw). Anything else is not read. */
  method: number
  compressedSize: number
  size: number
  /** Where the entry's (compressed) bytes start. */
  dataOffset: number
}

const EOCD = 0x06054b50
const CENTRAL = 0x02014b50
const LOCAL = 0x04034b50

export function zipEntries(bytes: Uint8Array): ZipEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  // The EOCD sits at the end, before an optional comment of up to 64 KiB.
  let eocd = -1
  for (
    let i = bytes.length - 22;
    i >= Math.max(0, bytes.length - 22 - 65535);
    i--
  ) {
    if (view.getUint32(i, true) === EOCD) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('not a zip: no end-of-central-directory record')
  const count = view.getUint16(eocd + 10, true)
  let p = view.getUint32(eocd + 16, true)
  const entries: ZipEntry[] = []
  const decoder = new TextDecoder()
  for (let i = 0; i < count; i++) {
    if (view.getUint32(p, true) !== CENTRAL)
      throw new Error('not a zip: central directory entry expected')
    const method = view.getUint16(p + 10, true)
    const compressedSize = view.getUint32(p + 20, true)
    const size = view.getUint32(p + 24, true)
    const nameLen = view.getUint16(p + 28, true)
    const extraLen = view.getUint16(p + 30, true)
    const commentLen = view.getUint16(p + 32, true)
    const local = view.getUint32(p + 42, true)
    const name = decoder.decode(bytes.subarray(p + 46, p + 46 + nameLen))
    if (view.getUint32(local, true) !== LOCAL)
      throw new Error(`not a zip: local header expected for ${name}`)
    const localNameLen = view.getUint16(local + 26, true)
    const localExtraLen = view.getUint16(local + 28, true)
    entries.push({
      name,
      method,
      compressedSize,
      size,
      dataOffset: local + 30 + localNameLen + localExtraLen,
    })
    p += 46 + nameLen + extraLen + commentLen
  }
  return entries
}

/** The entry's bytes as stored: inflate them when `method` is 8. */
export function zipEntryBytes(bytes: Uint8Array, entry: ZipEntry): Uint8Array {
  return bytes.subarray(
    entry.dataOffset,
    entry.dataOffset + entry.compressedSize,
  )
}

/** The Playwright trace's own entry, or null when the zip is something else. */
export function playwrightTraceEntry(entries: ZipEntry[]): ZipEntry | null {
  return (
    entries.find((e) => e.name === 'trace.trace') ??
    entries.find((e) => /(^|\/)trace\.trace$/.test(e.name)) ??
    null
  )
}
