import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { scaffoldSourceDir } from '../port'
import {
  scriptFontFamilies,
  scriptScenes,
  scriptStringsOf,
} from '../portInventory'
import type { Inventory } from '../portInventory'
import { keyFor, planScaffold, substituteFamily, toHex } from '../portScaffold'
import { compareVerdict, parseSsim, sampleTimes } from '../compare'

describe('reading a source script', () => {
  it('keeps the words a canvas paints and drops code, units and file ids', () => {
    const code = `
      const C = { blue: '#2436ff' }
      g.font = '900 220px "Inter Tight", Helvetica, sans-serif'
      draw('HELLO'); draw("verb — the whole point.")
      ctx.globalCompositeOperation = 'source-over'
      const s = { bg: C.blue, fg: C.cream }
      x = '-18px'; type = 'image/png'; head = 'RIFF'; id = 'panel'
    `
    const words = scriptStringsOf(code)
    expect(words).toContain('HELLO')
    expect(words).toContain('verb — the whole point.')
    for (const noise of [
      'source-over',
      '-18px',
      'image/png',
      'RIFF',
      'panel',
      '#2436ff',
    ])
      expect(words).not.toContain(noise)
    expect(words.some((w) => w.includes('Inter Tight'))).toBe(false)
  })

  it('names the faces a script paints with', () => {
    expect(
      scriptFontFamilies(
        `const A = '"Inter Tight","Helvetica Neue",Helvetica,Arial,sans-serif'; g.font = "500 40px JetBrains Mono, monospace"`,
      ),
    ).toEqual(expect.arrayContaining(['Inter Tight', 'JetBrains Mono']))
  })

  it('finds the scenes a GSAP timeline reveals, and its labels', () => {
    const code = `
      tl.set("#s2", { opacity: 1 }, 2.0)
      tl.to('#s3', { opacity: 1, duration: 0.3 }, 4.5)
      tl.addLabel('outro', 12)
    `
    expect(scriptScenes(['s1', 's2', 's3'], code, 15)).toEqual([
      { name: 's1', start: 0, duration: 2 },
      { name: 's2', start: 2, duration: 2.5 },
      { name: 's3', start: 4.5, duration: 7.5 },
      { name: 'outro', start: 12, duration: 3 },
    ])
  })
})

describe('the scaffold', () => {
  it('normalizes colours and names keys', () => {
    expect(toHex('rgb(243, 237, 228)')).toBe('#f3ede4')
    expect(toHex('rgba(0, 0, 0, 0.5)')).toBe('#00000080')
    expect(toHex('#ABC')).toBe('#aabbcc')
    const taken = new Set<string>()
    expect(keyFor('GRAPH EDITOR · y(t)', taken)).toBe('graphEditorYT')
    expect(keyFor('GRAPH EDITOR · y(t)', taken)).toBe('graphEditorYT2')
    expect(keyFor('01 / TIMING', taken)).toBe('t01Timing')
  })

  it('substitutes a missing face by what its name says', () => {
    expect(substituteFamily('Söhne Mono')).toBe('JetBrains Mono')
    expect(substituteFamily('Tiempos Serif')).toBe('Source Serif 4')
    expect(substituteFamily('Instrument Sans')).toBe('Inter')
  })

  it('binds every word and colour, scales sizes, and shows each scene in its window', () => {
    const inv: Inventory = {
      source: 'piece',
      engine: 'hyperframes',
      width: 1920,
      height: 1080,
      fps: 30,
      duration: 6,
      scenes: [
        { name: 's1', start: 0, duration: 3 },
        { name: 's2', start: 3, duration: 3 },
      ],
      texts: [
        {
          id: 'title',
          text: 'Hello',
          tag: 'h1',
          scene: 's1',
          box: { x: 192, y: 108, width: 400, height: 100 },
          font: {
            family: 'Anton',
            size: 120,
            weight: 400,
            style: 'normal',
            color: 'rgb(255, 90, 31)',
            letterSpacing: 0,
            transform: 'uppercase',
          },
        },
        {
          id: 'span-0',
          text: 'second scene',
          tag: 'span',
          scene: 's2',
          box: null,
          font: {
            family: 'Mystery Grotesk',
            size: 40,
            weight: 500,
            style: 'normal',
            color: '#f3ede4',
            letterSpacing: 2,
            transform: 'none',
          },
        },
      ],
      palette: { accent: '#ff5a1f' },
      colors: ['rgb(21, 17, 14)'],
      fonts: [],
      media: [],
      canvases: [],
      gaps: [],
      variables: {},
      scriptStrings: [],
      render: null,
      stills: [],
    }
    const plan = planScaffold(inv, { sourceDir: '/x' })
    expect(plan.program).toMatch(/"title": "HELLO"/) // text-transform applied
    expect(plan.program).toMatch(/"accent": "#ff5a1f"/)
    expect(plan.program).toMatch(/"x": "10%"/)
    expect(plan.program).toMatch(/"family": "Inter"/) // the substitute
    expect(plan.program).toMatch(/"s2": \[\s*"secondScene"\s*\]/)
    expect(plan.program).toMatch(/TODO scene "s2"/)
    expect(plan.report).toMatch(/Mystery Grotesk\*\* is not in the catalog/)
    // The title's colour is the palette's accent, bound by key.
    expect(plan.program).toMatch(/"color": \{\s*"\$data": "accent"\s*\}/)
  })
})

describe('the score', () => {
  it('resolves media against the folder the inventory read, wherever the scaffold runs', () => {
    expect(scaffoldSourceDir({ source: '.', root: '/work/reel' })).toBe(
      '/work/reel',
    )
    expect(scaffoldSourceDir({ source: 'reel/index.html' })).toBe(
      join(process.cwd(), 'reel'),
    )
  })

  it('places a page audio as a doc.json track and says so only when it did', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vos-port-'))
    writeFileSync(join(dir, 'score.wav'), '')
    const inv = {
      source: '.',
      root: dir,
      engine: 'hyperframes',
      width: 1920,
      height: 1080,
      fps: 30,
      duration: 15,
      scenes: [],
      texts: [],
      palette: {},
      colors: [],
      fonts: [],
      canvases: [],
      gaps: [],
      variables: {},
      scriptStrings: [],
      render: null,
      stills: [],
      media: [
        {
          kind: 'audio',
          src: 'score.wav',
          start: 0,
          duration: 15,
          volume: 0.8,
          mediaStart: null,
        },
      ],
    } as unknown as Inventory
    const placed = planScaffold(inv, {
      sourceDir: dir,
      probeDuration: () => 15,
    })
    expect(
      (placed.doc.audio as { key: string; gain: number }[])[0],
    ).toMatchObject({ key: 'score.wav', gain: 0.8 })
    expect(placed.report).toMatch(/score as a doc\.json track \(score\.wav/)
    const missing = planScaffold(inv, { sourceDir: join(dir, 'nowhere') })
    expect(missing.doc.audio).toEqual([])
    expect(missing.report).not.toMatch(/score as a doc\.json track/)
    expect(missing.report).toMatch(/not in the source folder/)
  })
})

describe('compare', () => {
  it('samples, parses and judges per frame', () => {
    expect(sampleTimes(3, 1)).toEqual([0.5, 1.5, 2.5])
    expect(
      parseSsim('[Parsed_ssim_0] SSIM Y:0.9 U:0.9 V:0.9 All:0.937953 (12.1)'),
    ).toBe(0.937953)
    expect(parseSsim('nothing')).toBeNull()
    const v = compareVerdict(
      [
        { t: 0.5, ssim: 0.99, sheet: 'a' },
        { t: 1.5, ssim: 0.6, sheet: 'b' },
      ],
      0.95,
    )
    expect(v.pass).toBe(false)
    expect(v.failing).toEqual([1.5])
    expect(v.min).toBe(0.6)
  })
})
