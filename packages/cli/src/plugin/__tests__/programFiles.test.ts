import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createReporter } from '../output'
import {
  codeFileWarnings,
  liftNamedFiles,
  localDataRefs,
} from '../programFiles'

function dirWith(files: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'vos-files-'))
  for (const f of files) writeFileSync(join(dir, f), 'x')
  return dir
}

describe('the files a program names outside its manifest', () => {
  it('lifts element and font files into the manifest, with unique names', () => {
    const dir = dirWith(['logo.png', 'logo.svg', 'face.woff2'])
    const config: Record<string, unknown> = {
      assets: { logo: { ref: 'https://x/y.png' } },
      elements: [
        { id: 'a', type: 'image', src: 'logo.png' },
        { id: 'b', type: 'svg', src: 'logo.svg' },
        { id: 'c', type: 'text', text: 'logo.png' },
        { id: 'd', type: 'image', src: '$assets.logo' },
        { id: 'e', type: 'image', src: 'missing.png' },
      ],
      fonts: [{ family: 'Mine', url: 'face.woff2' }],
    }
    const lifted = liftNamedFiles(config, dir)
    expect(lifted).toHaveLength(3)
    const els = config.elements as { src?: string }[]
    expect(els[0].src).toBe('$assets.logo_2')
    expect(els[1].src).toBe('$assets.logo_3')
    expect(els[3].src).toBe('$assets.logo')
    // A path naming no file is left for the platform to refuse in words.
    expect(els[4].src).toBe('missing.png')
    expect((config.fonts as { url: string }[])[0].url).toBe('$assets.face')
    expect((config.assets as Record<string, unknown>).face).toEqual({
      ref: 'face.woff2',
      kind: 'font',
    })
  })

  it("refuses a file outside the program's directory, as the manifest does", () => {
    const outside = dirWith(['far.png'])
    const dir = dirWith([])
    expect(() =>
      liftNamedFiles(
        {
          elements: [{ id: 'a', type: 'image', src: join(outside, 'far.png') }],
        },
        dir,
      ),
    ).toThrow(/outside the program's directory/)
  })

  it('finds file paths in data, never words', () => {
    const dir = dirWith(['bed.mp3', 'cover.jpg'])
    const config: Record<string, unknown> = {
      data: {
        score: 'bed.mp3',
        title: 'cover.jpg is a nice name',
        shots: ['cover.jpg', 'https://x/y.jpg'],
        n: 3,
      },
    }
    const refs = localDataRefs(config, dir)
    expect(refs.map((r) => r.where)).toEqual(['data.score', 'data.shots[0]'])
    refs[0].set('/api/assets/a/file')
    expect((config.data as { score: string }).score).toBe('/api/assets/a/file')
  })

  it('says when a function names a local file', () => {
    const dir = dirWith(['model.glb'])
    const lines = codeFileWarnings(
      {
        createContent:
          "(ctx) => { ctx.loaders.GLTFLoader.load('model.glb'); load('absent.glb') }",
      },
      dir,
    )
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('createContent names model.glb in code')
  })
})

describe('a warning under --json', () => {
  afterEach(() => vi.restoreAllMocks())

  it('is an event, not a silent log line', () => {
    const out: string[] = []
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      out.push(String(chunk))
      return true
    })
    const err = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    createReporter(true).warn('a file was left out')
    expect(JSON.parse(out[0])).toEqual({
      event: 'warning',
      message: 'a file was left out',
    })
    expect(err).not.toHaveBeenCalled()
  })
})
