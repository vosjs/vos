import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deflateRawSync } from 'node:zlib'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { cmdIngest, readTraceFile } from '../ingest'

let dir: string
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'vos-ingest-'))
})
afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
})

/** One deflated entry in a zip, enough for a Playwright trace.zip. */
function zipOf(name: string, data: Uint8Array): Uint8Array {
  const body = new Uint8Array(deflateRawSync(data))
  const nm = new TextEncoder().encode(name)
  const u16 = (n: number) => [n & 0xff, (n >> 8) & 0xff]
  const u32 = (n: number) => [
    n & 0xff,
    (n >> 8) & 0xff,
    (n >> 16) & 0xff,
    (n >>> 24) & 0xff,
  ]
  const local = new Uint8Array([
    ...u32(0x04034b50),
    ...u16(20),
    ...u16(0),
    ...u16(8),
    ...u16(0),
    ...u16(0),
    ...u32(0),
    ...u32(body.length),
    ...u32(data.length),
    ...u16(nm.length),
    ...u16(0),
    ...nm,
  ])
  const central = new Uint8Array([
    ...u32(0x02014b50),
    ...u16(20),
    ...u16(20),
    ...u16(0),
    ...u16(8),
    ...u16(0),
    ...u16(0),
    ...u32(0),
    ...u32(body.length),
    ...u32(data.length),
    ...u16(nm.length),
    ...u16(0),
    ...u16(0),
    ...u16(0),
    ...u16(0),
    ...u32(0),
    ...u32(0),
    ...nm,
  ])
  const eocd = new Uint8Array([
    ...u32(0x06054b50),
    ...u16(0),
    ...u16(0),
    ...u16(1),
    ...u16(1),
    ...u32(central.length),
    ...u32(local.length + body.length),
    ...u16(0),
  ])
  const out = new Uint8Array(
    local.length + body.length + central.length + eocd.length,
  )
  out.set(local, 0)
  out.set(body, local.length)
  out.set(central, local.length + body.length)
  out.set(eocd, local.length + body.length + central.length)
  return out
}

const PW = [
  `{"version":8,"type":"context-options","options":{"viewport":{"width":1280,"height":720}},"wallTime":1790451422831,"monotonicTime":1556.297}`,
  `{"type":"before","callId":"c6","startTime":1556.991,"class":"BrowserContext","method":"newPage","params":{}}`,
  `{"type":"before","callId":"c16","startTime":2397.017,"class":"Frame","method":"click","params":{"selector":"#a"}}`,
  `{"type":"after","callId":"c16","endTime":2432.754,"point":{"x":260,"y":220}}`,
].join('\n')

describe('readTraceFile', () => {
  it('opens a Playwright trace.zip for its trace.trace', async () => {
    const zip = join(dir, 'trace.zip')
    await writeFile(zip, zipOf('trace.trace', new TextEncoder().encode(PW)))
    const r = await readTraceFile(zip, 0)
    expect(r.kind).toBe('playwright')
    expect(r.viewport).toEqual({ width: 1280, height: 720 })
    expect(r.events.filter((e) => e.type === 'down')).toHaveLength(1)
  })

  it('reads a CSV and stamped records by their names, with the offset applied', async () => {
    const csv = join(dir, 'cursor.csv')
    await writeFile(csv, 't,x,y,type\n100,10,20,click\n')
    const c = await readTraceFile(csv, 50)
    expect(c.kind).toBe('csv')
    expect(c.events[0]).toMatchObject({ t: 150, x: 10, y: 20, type: 'move' })
    const jsonl = join(dir, 'steps.jsonl')
    await writeFile(
      jsonl,
      '{"ts":5,"command":["click","@e1"],"point":{"x":1,"y":2}}\n',
    )
    const j = await readTraceFile(jsonl, 0)
    expect(j.kind).toBe('records')
    expect(j.placed).toBe(1)
  })

  it('refuses a file no adapter reads, and a zip without a trace, in words', async () => {
    const other = join(dir, 'notes.txt')
    await writeFile(other, 'hello')
    await expect(readTraceFile(other, 0)).rejects.toThrow(
      /not a trace the recorder reads/,
    )
    const zip = join(dir, 'other.zip')
    await writeFile(zip, zipOf('readme.txt', new TextEncoder().encode('x')))
    await expect(readTraceFile(zip, 0)).rejects.toThrow(/no trace.trace inside/)
  })
})

describe('cmdIngest', () => {
  it('asks for a video, and names a missing one', async () => {
    await expect(cmdIngest([])).rejects.toThrow(/vos ingest <video/)
    await expect(cmdIngest([join(dir, 'missing.webm')])).rejects.toThrow(
      /no such file/,
    )
  })

  it('refuses a bad trace before touching the output directory', async () => {
    const video = join(dir, 'fake.webm')
    await writeFile(video, 'not a video')
    const out = join(dir, 'take-untouched')
    await expect(
      cmdIngest([
        video,
        '--cursor',
        join(dir, 'notes.txt'),
        '--out',
        out,
        '--background',
        'none',
      ]),
    ).rejects.toThrow()
    const { existsSync } = await import('node:fs')
    expect(existsSync(out)).toBe(false)
  })
})
