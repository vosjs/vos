import { describe, expect, it } from 'vitest'
import {
  alignRows,
  bytesWords,
  hostedFile,
  listRow,
  manifestLine,
  manifestName,
  nameFromUrl,
  probeLine,
} from '../assetWords'

const file = (over: Record<string, unknown>) => ({
  id: 'a1',
  kind: 'image',
  filename: 'hero.png',
  size: 2048,
  ...over,
})

describe('what the platform read', () => {
  it('says a clip as its kind, size, codec, length and sound', () => {
    expect(
      probeLine(
        file({
          kind: 'video',
          duration: 34.2,
          metadata: {
            width: 1920,
            height: 1080,
            videoCodec: 'avc',
            hasAudio: true,
          },
        }),
      ),
    ).toBe('video 1920×1080 avc 34.2 s, audio')
  })

  it('says only what was measured', () => {
    expect(probeLine(file({ metadata: { width: 800, height: 600 } }))).toBe(
      'image 800×600',
    )
    expect(probeLine(file({ kind: 'font', metadata: null }))).toBe('font')
    expect(
      probeLine(
        file({
          kind: 'audio',
          duration: 3.5,
          metadata: { audioCodec: 'opus' },
        }),
      ),
    ).toBe('audio opus 3.50 s')
    expect(probeLine(file({ kind: 'model', metadata: { meshCount: 1 } }))).toBe(
      'model 1 mesh',
    )
  })
})

describe('the line that declares a file in a program', () => {
  it('names it with an identifier and its asset reference', () => {
    expect(manifestLine(file({}))).toBe(
      '"hero": { "ref": "asset:a1", "kind": "image" }',
    )
  })

  it('makes any file name an identifier', () => {
    expect(manifestName('My Logo (v2).svg')).toBe('My_Logo_v2')
    expect(manifestName('2024-cover.jpg')).toBe('_2024_cover')
    expect(manifestName('.hidden')).toBe('file')
  })

  it('calls an svg an image, and leaves out a kind the manifest has no word for', () => {
    expect(
      manifestLine(file({ kind: 'vector', filename: 'mark.svg' })),
    ).toContain('"kind": "image"')
    expect(manifestLine(file({ kind: 'captions', filename: 'subs.vtt' }))).toBe(
      '"subs": { "ref": "asset:a1" }',
    )
  })
})

describe('a list on a terminal', () => {
  it('puts the facts in a fixed order', () => {
    expect(listRow(file({ uses: 2 }))).toEqual([
      'a1',
      'image',
      '2.0 KB',
      'used in 2',
      'library',
      'hero.png',
    ])
    expect(listRow(file({ intent: 'attached' }))[3]).toBe('not used')
    expect(listRow(file({ intent: 'attached' }))[4]).toBe('attached')
    // A recipe binds a project; nothing "uses" it.
    expect(listRow(file({ kind: 'recipe' }))[3]).toBe('')
  })

  it('aligns columns and leaves the name ragged', () => {
    expect(
      alignRows([
        ['a', 'image', 'x.png'],
        ['bbb', 'font', 'a long name.woff2'],
      ]),
    ).toEqual(['a    image  x.png', 'bbb  font   a long name.woff2'])
    expect(alignRows([])).toEqual([])
  })

  it('says sizes the way people do', () => {
    expect(bytesWords(0)).toBe('0 B')
    expect(bytesWords(1023)).toBe('1023 B')
    expect(bytesWords(1536)).toBe('1.5 KB')
    expect(bytesWords(5 * 1024 ** 3)).toBe('5.0 GB')
    expect(bytesWords(250 * 1024 ** 2)).toBe('250 MB')
  })
})

describe('a name for bytes fetched from an address', () => {
  it('is the last path segment, made safe', () => {
    expect(nameFromUrl('https://example.com/a/b/photo%20one.jpg?x=1')).toBe(
      'photo one.jpg',
    )
    expect(nameFromUrl('https://example.com/')).toBe('download')
    expect(nameFromUrl('not a url')).toBe('download')
    expect(
      nameFromUrl('https://example.com/..%2F..%2Fetc%2Fpasswd'),
    ).not.toContain('/')
  })
})

describe('a row as the platform lists it', () => {
  it('reads the kind under either name', () => {
    expect(
      hostedFile({ id: 'a', category: 'font', filename: 'x', size: 1 }).kind,
    ).toBe('font')
    expect(
      hostedFile({
        id: 'a',
        kind: 'image',
        category: 'x',
        filename: 'x',
        size: 1,
      }).kind,
    ).toBe('image')
  })

  it('never leaves a hole a table would throw on', () => {
    const row = hostedFile({})
    expect(listRow(row).every((cell) => typeof cell === 'string')).toBe(true)
    expect(alignRows([listRow(row)])).toHaveLength(1)
    expect(hostedFile(null).filename).toBe('unnamed')
  })
})
