import { describe, expect, it } from 'vitest'
import { compileVosConfig } from '../compiler/compileVosConfig'
import { vosConfigJsonSchema } from '../schema/configJsonSchema'
import { lintVosFonts } from '../lint/fonts'
import type { VosConfigJson } from '../types'

const base: VosConfigJson = {
  version: 2,
  duration: 3,
  camera: { preset: 'perspective' },
  createContent: '() => ({ objects: [] })',
  createTimeline:
    '(ctx, content, duration) => { const tl = ctx.gsap.timeline(); tl.to({}, { duration }); return tl }',
}

const LEXEND = {
  family: 'Lexend',
  url: 'https://assets.vos.so/fonts/lexend/600.woff2',
  weight: 600,
}

describe('config.fonts compilation', () => {
  it('emits FontFace registration awaited before element render', () => {
    const output = compileVosConfig({
      ...base,
      fonts: [LEXEND],
      elements: [
        {
          id: 't',
          type: 'text',
          content: 'Hi',
          position: 'center',
          font: { family: 'Lexend, sans-serif', size: 64, weight: 600 },
        },
      ],
    })
    expect(output).toContain('new FontFace(f.family')
    expect(output).toContain('assets.vos.so/fonts/lexend/600.woff2')
    expect(output).toContain('document.fonts.add(face)')
    // Fail-open cap present.
    expect(output).toContain('setTimeout(resolve, 4000)')
    // Fonts load BEFORE elements render.
    expect(output.indexOf('fontFaceDecls')).toBeLessThan(
      output.indexOf('renderElements'),
    )
  })

  it('emits the registrar even without a fonts block (data.fonts must work)', () => {
    const output = compileVosConfig(base)
    expect(output).toContain('const fontFaceDecls = []')
    expect(output).toContain('__vosRegisterFonts(__vosData.fonts)')
  })

  it('boot awaits BOTH config and data faces; setData re-registers + re-rasters', () => {
    const output = compileVosConfig({ ...base, fonts: [LEXEND] })
    // one dedup'd registrar feeds both sources at boot
    expect(output).toContain('__vosRegisterFonts(fontFaceDecls)')
    expect(output).toContain('__vosRegisterFonts(__vosData.fonts)')
    expect(output).toContain('__vosFontSeen')
    // setData: lazy registration whose completion re-rasters text elements,
    // so a late-landing face replaces the fallback that painted first
    const setDataBlock = output.slice(output.indexOf('setData:'))
    expect(setDataBlock).toContain('__vosRegisterFonts(__vosData.fonts')
    expect(setDataBlock).toContain('rerasterAll(elements)')
  })

  it('schema keeps the fonts block (nothing stripped)', () => {
    const parsed = vosConfigJsonSchema.parse({
      ...base,
      fonts: [{ ...LEXEND, custom: 'kept' }],
    })
    expect(parsed.fonts).toEqual([{ ...LEXEND, custom: 'kept' }])
  })

  it('schema rejects a fonts entry without a url', () => {
    const result = vosConfigJsonSchema.safeParse({
      ...base,
      fonts: [{ family: 'Lexend' }],
    })
    expect(result.success).toBe(false)
  })
})

describe('lintVosFonts', () => {
  const textElement = (family: string) => ({
    id: 'headline',
    type: 'text',
    content: 'Hi',
    font: { family },
  })

  it('warns on a non-generic family with no declaration', () => {
    const issues = lintVosFonts({
      ...base,
      elements: [textElement('Inter, system-ui, sans-serif')],
    })
    expect(issues).toHaveLength(1)
    expect(issues[0].rule).toBe('undeclared-family')
    expect(issues[0].family).toBe('Inter')
    expect(issues[0].severity).toBe('warn')
  })

  it('passes when the family is declared (case-insensitive)', () => {
    const issues = lintVosFonts({
      ...base,
      fonts: [
        { family: 'inter', url: 'https://assets.vos.so/fonts/inter/400.woff2' },
      ],
      elements: [textElement('Inter, sans-serif')],
    })
    expect(issues).toHaveLength(0)
  })

  it('passes on generic families and quoted names', () => {
    expect(
      lintVosFonts({
        ...base,
        elements: [textElement('system-ui, sans-serif')],
      }),
    ).toHaveLength(0)
    const quoted = lintVosFonts({
      ...base,
      fonts: [
        {
          family: 'Space Grotesk',
          url: 'https://assets.vos.so/fonts/space-grotesk/400.woff2',
        },
      ],
      elements: [textElement("'Space Grotesk', sans-serif")],
    })
    expect(quoted).toHaveLength(0)
  })

  it('ignores non-text elements and empty stacks', () => {
    expect(
      lintVosFonts({
        ...base,
        elements: [
          { id: 'i', type: 'image', src: 'x.png' },
          { id: 't', type: 'text', content: 'Hi' },
        ],
      }),
    ).toHaveLength(0)
  })
})
