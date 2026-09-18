/**
 * The bytes decide. A name and a Content-Type are claims that drift from what
 * a file holds, and believing one is how an mp4 gets uploaded as `video/webm`
 * and every render of that version dies in the video element.
 */
import { describe, expect, it } from 'vitest'
import {
  containerMismatch,
  extensionFor,
  mediaContentType,
  nameForType,
  resolveMediaType,
  sniffMediaType,
} from '../container'

/** A head buffer from bytes and ASCII runs, as the signatures are written. */
function head(...parts: (number | string)[]): Uint8Array {
  const bytes: number[] = []
  for (const part of parts) {
    if (typeof part === 'number') bytes.push(part)
    else for (const ch of part) bytes.push(ch.charCodeAt(0))
  }
  return new Uint8Array(bytes)
}

/** An ISO base media file: a box size, `ftyp`, then the brand. */
const iso = (brand: string): Uint8Array => head(0, 0, 0, 0x20, 'ftyp', brand)

const WEBM = head(0x1a, 0x45, 0xdf, 0xa3, 0x01, 0x00, 0x00, 0x00)

describe('sniffMediaType', () => {
  it('reads every container the CLI can hold', () => {
    expect(sniffMediaType(WEBM)).toBe('video/webm')
    expect(sniffMediaType(iso('isom'))).toBe('video/mp4')
    expect(sniffMediaType(iso('mp42'))).toBe('video/mp4')
    expect(sniffMediaType(iso('qt  '))).toBe('video/quicktime')
    expect(sniffMediaType(iso('M4A '))).toBe('audio/mp4')
    expect(sniffMediaType(iso('avif'))).toBe('image/avif')
    expect(sniffMediaType(head(0x89, 'PNG', 0x0d, 0x0a, 0x1a, 0x0a))).toBe(
      'image/png',
    )
    expect(sniffMediaType(head(0xff, 0xd8, 0xff, 0xe0))).toBe('image/jpeg')
    expect(sniffMediaType(head('GIF89a'))).toBe('image/gif')
    expect(sniffMediaType(head('RIFF', 0, 0, 0, 0, 'WEBP'))).toBe('image/webp')
    expect(sniffMediaType(head('RIFF', 0, 0, 0, 0, 'WAVE'))).toBe('audio/wav')
    expect(sniffMediaType(head('OggS', 0, 2))).toBe('audio/ogg')
    expect(sniffMediaType(head('ID3', 3, 0))).toBe('audio/mpeg')
  })

  it('says nothing rather than guessing, and never reads past the buffer', () => {
    // An SVG and a recipe carry no signature: their name is all there is.
    expect(sniffMediaType(head('<svg xmlns'))).toBeNull()
    expect(sniffMediaType(head('# CUT'))).toBeNull()
    expect(sniffMediaType(head('RIFF', 0, 0, 0, 0, 'NOPE'))).toBeNull()
    expect(sniffMediaType(new Uint8Array())).toBeNull()
    expect(sniffMediaType(head(0x1a, 0x45))).toBeNull()
    expect(sniffMediaType(head('ftyp'))).toBeNull()
  })
})

describe('resolveMediaType', () => {
  it('lets the bytes overrule both claims', () => {
    expect(
      resolveMediaType({
        head: iso('isom'),
        declared: 'video/webm',
        filename: 'recording.webm',
      }),
    ).toEqual({ type: 'video/mp4', from: 'bytes' })
  })

  it('falls back to the server, then the name, for bytes that say nothing', () => {
    const svg = head('<svg xmlns')
    expect(
      resolveMediaType({ head: svg, declared: 'image/svg+xml; charset=utf-8' }),
    ).toEqual({ type: 'image/svg+xml', from: 'declared' })
    expect(resolveMediaType({ head: svg, filename: 'mark.svg' })).toEqual({
      type: 'image/svg+xml',
      from: 'filename',
    })
  })

  it('treats an octet-stream declaration as the non-answer it is', () => {
    expect(
      resolveMediaType({
        declared: 'application/octet-stream',
        filename: 'loop.webm',
      }),
    ).toEqual({ type: 'video/webm', from: 'filename' })
    expect(
      resolveMediaType({ declared: 'binary/octet-stream', filename: 'x.bin' }),
    ).toEqual({ type: 'application/octet-stream', from: 'unknown' })
  })
})

describe('the extension table', () => {
  it('maps both ways, with one spelling out', () => {
    expect(mediaContentType('brand/mark.svg')).toBe('image/svg+xml')
    expect(mediaContentType('x.PNG')).toBe('image/png')
    expect(mediaContentType('what.bin')).toBe('application/octet-stream')
    expect(extensionFor('video/mp4')).toBe('.mp4')
    expect(extensionFor('image/jpeg')).toBe('.jpg')
    expect(extensionFor('audio/mp4')).toBe('.m4a')
    expect(extensionFor('image/svg+xml; charset=utf-8')).toBe('.svg')
    expect(extensionFor('application/x-unknown')).toBe('')
  })
})

describe('nameForType', () => {
  it('corrects a name only when the type genuinely disagrees', () => {
    expect(nameForType('recording.webm', 'video/mp4')).toBe('recording.mp4')
    expect(nameForType('my.take.webm', 'video/mp4')).toBe('my.take.mp4')
    expect(nameForType('recording', 'video/mp4')).toBe('recording.mp4')
    // `.jpeg` already means image/jpeg, so it is left alone.
    expect(nameForType('photo.jpeg', 'image/jpeg')).toBe('photo.jpeg')
    expect(nameForType('mark.svg', 'image/svg+xml')).toBe('mark.svg')
    // A type with no extension here cannot name anything better.
    expect(nameForType('notes.md', 'text/markdown')).toBe('notes.md')
  })
})

describe('containerMismatch', () => {
  it('names the file, what it is, and the rename that fixes it', () => {
    const said = containerMismatch('recording.webm', iso('isom'))
    expect(said).toContain('video/mp4')
    expect(said).toContain('recording.mp4')
  })

  it('is silent when the two agree or the bytes prove nothing', () => {
    expect(containerMismatch('recording.webm', WEBM)).toBeNull()
    expect(containerMismatch('recording.mp4', iso('isom'))).toBeNull()
    expect(containerMismatch('mark.svg', head('<svg'))).toBeNull()
  })
})
