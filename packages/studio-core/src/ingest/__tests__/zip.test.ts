import { deflateRawSync, inflateRawSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { playwrightTraceEntry, zipEntries, zipEntryBytes } from '../zip'

/** A minimal zip writer for the test: stored or deflated entries, no extras. */
function makeZip(
  files: Array<{ name: string; data: Uint8Array; deflate?: boolean }>,
): Uint8Array {
  const parts: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0
  const enc = new TextEncoder()
  const u16 = (n: number) => [n & 0xff, (n >> 8) & 0xff]
  const u32 = (n: number) => [
    n & 0xff,
    (n >> 8) & 0xff,
    (n >> 16) & 0xff,
    (n >>> 24) & 0xff,
  ]
  for (const f of files) {
    const name = enc.encode(f.name)
    const body = f.deflate ? new Uint8Array(deflateRawSync(f.data)) : f.data
    const method = f.deflate ? 8 : 0
    const local = new Uint8Array([
      ...u32(0x04034b50),
      ...u16(20),
      ...u16(0),
      ...u16(method),
      ...u16(0),
      ...u16(0),
      ...u32(0),
      ...u32(body.length),
      ...u32(f.data.length),
      ...u16(name.length),
      ...u16(0),
      ...name,
    ])
    central.push(
      new Uint8Array([
        ...u32(0x02014b50),
        ...u16(20),
        ...u16(20),
        ...u16(0),
        ...u16(method),
        ...u16(0),
        ...u16(0),
        ...u32(0),
        ...u32(body.length),
        ...u32(f.data.length),
        ...u16(name.length),
        ...u16(0),
        ...u16(0),
        ...u16(0),
        ...u16(0),
        ...u32(0),
        ...u32(offset),
        ...name,
      ]),
    )
    parts.push(local, body)
    offset += local.length + body.length
  }
  const centralStart = offset
  let centralSize = 0
  for (const c of central) {
    parts.push(c)
    centralSize += c.length
  }
  parts.push(
    new Uint8Array([
      ...u32(0x06054b50),
      ...u16(0),
      ...u16(0),
      ...u16(files.length),
      ...u16(files.length),
      ...u32(centralSize),
      ...u32(centralStart),
      ...u16(0),
    ]),
  )
  const total = parts.reduce((n, p) => n + p.length, 0)
  const out = new Uint8Array(total)
  let p = 0
  for (const part of parts) {
    out.set(part, p)
    p += part.length
  }
  return out
}

describe('zipEntries', () => {
  it('lists stored and deflated entries with the data offsets a host inflates from', () => {
    const trace = new TextEncoder().encode(
      '{"type":"context-options"}\n{"type":"before"}\n'.repeat(40),
    )
    const zip = makeZip([
      { name: 'trace.network', data: new TextEncoder().encode('[]') },
      { name: 'trace.trace', data: trace, deflate: true },
    ])
    const entries = zipEntries(zip)
    expect(entries.map((e) => [e.name, e.method, e.size])).toEqual([
      ['trace.network', 0, 2],
      ['trace.trace', 8, trace.length],
    ])
    const stored = zipEntryBytes(zip, entries[0])
    expect(new TextDecoder().decode(stored)).toBe('[]')
    const deflated = zipEntryBytes(zip, entries[1])
    expect(deflated.length).toBeLessThan(trace.length)
    expect(new Uint8Array(inflateRawSync(deflated))).toEqual(trace)
    expect(playwrightTraceEntry(entries)?.name).toBe('trace.trace')
  })

  it('finds a trace under a folder and answers null for a zip of something else', () => {
    const a = zipEntries(
      makeZip([{ name: 'run-1/trace.trace', data: new Uint8Array([1]) }]),
    )
    expect(playwrightTraceEntry(a)?.name).toBe('run-1/trace.trace')
    const b = zipEntries(
      makeZip([{ name: 'readme.txt', data: new Uint8Array([1]) }]),
    )
    expect(playwrightTraceEntry(b)).toBeNull()
  })

  it('refuses bytes that are not a zip', () => {
    expect(() =>
      zipEntries(new TextEncoder().encode('hello, not a zip')),
    ).toThrow(/not a zip/)
  })
})
