import { deflateRawSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import {
  playwrightTraceEntry,
  zipEntries,
  zipEntryBytes,
} from '@vosjs/studio-core'
import {
  TRACE_ENTRY_MAX_BYTES,
  TRACE_TOTAL_MAX_BYTES,
  inflateEntry,
  traceBudget,
} from '../traceInflate'

/** A zip with one deflated entry, declared at `declaredSize` (its own word). */
function zipOf(
  name: string,
  deflated: Uint8Array,
  declaredSize: number,
): Uint8Array {
  const enc = new TextEncoder().encode(name)
  const local = new Uint8Array(30 + enc.length)
  const lv = new DataView(local.buffer)
  lv.setUint32(0, 0x04034b50, true)
  lv.setUint16(8, 8, true)
  lv.setUint32(18, deflated.length, true)
  lv.setUint32(22, declaredSize, true)
  lv.setUint16(26, enc.length, true)
  local.set(enc, 30)
  const central = new Uint8Array(46 + enc.length)
  const cv = new DataView(central.buffer)
  cv.setUint32(0, 0x02014b50, true)
  cv.setUint16(10, 8, true)
  cv.setUint32(20, deflated.length, true)
  cv.setUint32(24, declaredSize, true)
  cv.setUint16(28, enc.length, true)
  cv.setUint32(42, 0, true)
  central.set(enc, 46)
  const eocd = new Uint8Array(22)
  const ev = new DataView(eocd.buffer)
  ev.setUint32(0, 0x06054b50, true)
  ev.setUint16(10, 1, true)
  ev.setUint32(12, central.length, true)
  ev.setUint32(16, local.length + deflated.length, true)
  const out = new Uint8Array(
    local.length + deflated.length + central.length + eocd.length,
  )
  out.set(local, 0)
  out.set(deflated, local.length)
  out.set(central, local.length + deflated.length)
  out.set(eocd, local.length + deflated.length + central.length)
  return out
}

describe('a trace zip inflates under a budget', () => {
  it('reads an entry whose size is within the caps', () => {
    const text = '{"type":"context-options"}\n'
    const deflated = new Uint8Array(deflateRawSync(Buffer.from(text)))
    const zip = zipOf('trace.trace', deflated, text.length)
    const entry = playwrightTraceEntry(zipEntries(zip))!
    const out = inflateEntry(zipEntryBytes(zip, entry), entry, traceBudget())
    expect(new TextDecoder().decode(out)).toBe(text)
  })

  it('refuses an entry declared past the cap before inflating it', () => {
    const deflated = new Uint8Array(deflateRawSync(Buffer.alloc(16)))
    const zip = zipOf('trace.trace', deflated, 2048)
    const entry = playwrightTraceEntry(zipEntries(zip))!
    expect(() =>
      inflateEntry(
        zipEntryBytes(zip, entry),
        entry,
        traceBudget({ entry: 1024 }),
      ),
    ).toThrow(
      /trace\.trace inflates to 0\.0 MiB, past the 0\.0 MiB an entry may take/,
    )
  })

  it('stops a stream that inflates past the cap whatever it declared', () => {
    // 4 MiB of zeros deflate to a few KiB and declare themselves as 16 bytes.
    const deflated = new Uint8Array(
      deflateRawSync(Buffer.alloc(4 * 1024 * 1024)),
    )
    expect(deflated.length).toBeLessThan(16 * 1024)
    const zip = zipOf('trace.trace', deflated, 16)
    const entry = playwrightTraceEntry(zipEntries(zip))!
    const budget = traceBudget({ entry: 1024 * 1024 })
    expect(() =>
      inflateEntry(zipEntryBytes(zip, entry), entry, budget),
    ).toThrow(
      /inflates to more than 1\.0 MiB, past the 1\.0 MiB an entry may take/,
    )
    expect(budget.used).toBe(0)
  })

  it('holds every entry together to the total', () => {
    const bytes = new Uint8Array(600 * 1024)
    const deflated = new Uint8Array(deflateRawSync(Buffer.from(bytes)))
    const entry = { name: 'trace.trace', method: 8, size: bytes.length }
    const budget = traceBudget({ entry: 1024 * 1024, total: 1024 * 1024 })
    expect(inflateEntry(deflated, entry, budget)).toHaveLength(bytes.length)
    expect(budget.used).toBe(bytes.length)
    expect(() => inflateEntry(deflated, entry, budget)).toThrow(
      /past the 1\.0 MiB an entry may take \(1\.0 MiB for the whole trace\)/,
    )
  })

  it('a stored entry is held to the same caps', () => {
    const raw = new Uint8Array(32)
    const entry = { name: 'trace.trace', method: 0, size: 32 }
    expect(() => inflateEntry(raw, entry, traceBudget({ entry: 16 }))).toThrow(
      /past the/,
    )
    expect(inflateEntry(raw, entry, traceBudget())).toBe(raw)
  })

  it('the default caps are what the words say', () => {
    expect(TRACE_ENTRY_MAX_BYTES).toBe(64 * 1024 * 1024)
    expect(TRACE_TOTAL_MAX_BYTES).toBe(256 * 1024 * 1024)
  })
})
