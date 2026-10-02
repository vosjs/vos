import { describe, expect, it } from 'vitest'
import {
  applyAssetParam,
  applyParamValue,
  applyParamValues,
  assetParamIssues,
  paramData,
  paramValues,
  readLooks,
  readParams,
} from '../params'

/** A program with one of each: a data knob and a file knob. */
const program = () => ({
  version: 2,
  assets: {
    logo: { ref: './logo.png', kind: 'image' },
    shots: { ref: ['./a.png', './b.png'] },
    product: { ref: 'asset:11111111-1111-4111-8111-111111111111' },
  },
  params: [
    { key: 'tint', kind: 'color', default: '#ff0000' },
    { key: 'logo', kind: 'asset', label: 'Logo' },
  ] as Record<string, unknown>[],
  data: { tint: '#ff0000' } as Record<string, unknown>,
  createContent: '(ctx) => ({ objects: [], logo: ctx.assets.logo })',
})

describe('a file knob is read from the manifest', () => {
  it("takes its value from the declared file's ref", () => {
    const specs = readParams(program())
    expect(specs.map((s) => s.key)).toEqual(['tint', 'logo'])
    expect(specs[1]).toMatchObject({
      key: 'logo',
      kind: 'asset',
      label: 'Logo',
      default: './logo.png',
      accept: ['image'],
    })
    expect(paramValues(program(), specs)).toEqual({
      tint: '#ff0000',
      logo: './logo.png',
    })
  })

  it("accepts the kinds it is told to, else the file's own kind, else any", () => {
    const cfg = program()
    cfg.params = [
      { key: 'logo', kind: 'asset', accept: ['image', 'video', 'nonsense'] },
      { key: 'product', kind: 'asset' },
    ]
    const [logo, product] = readParams(cfg)
    expect(logo.accept).toEqual(['image', 'video'])
    expect(product.accept).toBeUndefined()
    cfg.params = [{ key: 'logo', kind: 'asset', accept: 'model' }]
    expect(readParams(cfg)[0].accept).toEqual(['model'])
  })

  it('drops a knob over a name that is not declared, or declares a list', () => {
    const cfg = program()
    cfg.params = [
      { key: 'missing', kind: 'asset' },
      { key: 'shots', kind: 'asset' },
      { key: 'logo', kind: 'asset' },
    ]
    expect(readParams(cfg).map((s) => s.key)).toEqual(['logo'])
  })

  it('never reads a default written on the param: the ref has one home', () => {
    const cfg = program()
    cfg.params = [{ key: 'logo', kind: 'asset', default: './other.png' }]
    expect(readParams(cfg)[0].default).toBe('./logo.png')
  })
})

describe('a file knob commits to the manifest', () => {
  it('writes the ref, and nothing into data or onto the param', () => {
    const cfg = program()
    applyParamValue(cfg, 'logo', 'asset:22222222-2222-4222-8222-222222222222')
    expect(cfg.assets.logo).toEqual({
      ref: 'asset:22222222-2222-4222-8222-222222222222',
      kind: 'image',
    })
    expect(cfg.data).toEqual({ tint: '#ff0000' })
    expect(cfg.params[1]).toEqual({ key: 'logo', kind: 'asset', label: 'Logo' })
    expect(paramValues(cfg, readParams(cfg)).logo).toBe(
      'asset:22222222-2222-4222-8222-222222222222',
    )
  })

  it('writes in place, so an equal value is no change at all', () => {
    const cfg = program()
    const manifest = cfg.assets
    const entry = cfg.assets.logo
    applyParamValue(cfg, 'logo', './logo.png')
    expect(cfg.assets).toBe(manifest)
    expect(cfg.assets.logo).toBe(entry)
  })

  it('refuses a value that is not a file reference', () => {
    const cfg = program()
    for (const bad of [7, true, '', 'x'.repeat(5000)]) {
      applyParamValue(cfg, 'logo', bad as string)
      expect(cfg.assets.logo.ref).toBe('./logo.png')
    }
  })

  it('leaves a data knob exactly as it was', () => {
    const cfg = program()
    applyParamValue(cfg, 'tint', '#00ff00')
    expect(cfg.data.tint).toBe('#00ff00')
    expect(cfg.params[0].default).toBe('#00ff00')
    expect(cfg.assets.logo.ref).toBe('./logo.png')
  })

  it('a Look can swap a file beside its other values, in one commit', () => {
    const cfg = {
      ...program(),
      presets: [
        { name: 'Night', values: { tint: '#000033', logo: './logo-dark.png' } },
      ],
    }
    const looks = readLooks(cfg, readParams(cfg))
    expect(looks[0].values).toEqual({
      tint: '#000033',
      logo: './logo-dark.png',
    })
    applyParamValues(cfg, looks[0].values)
    expect(cfg.assets.logo.ref).toBe('./logo-dark.png')
    expect(cfg.data.tint).toBe('#000033')
  })
})

describe('a file knob never reaches ctx.data', () => {
  it('gives a running program its data knobs and no ref', () => {
    const cfg = program()
    const specs = readParams(cfg)
    expect(paramValues(cfg, specs)).toEqual({
      tint: '#ff0000',
      logo: './logo.png',
    })
    expect(paramData(cfg, specs)).toEqual({ tint: '#ff0000' })
  })

  it('leaves a data key of the same name alone', () => {
    const cfg = program()
    cfg.data.logo = 'the wordmark'
    applyParamValue(cfg, 'logo', './other.png')
    expect(cfg.data.logo).toBe('the wordmark')
    expect(paramData(cfg, readParams(cfg))).toEqual({ tint: '#ff0000' })
  })
})

describe("a swap keeps the file's kind honest", () => {
  const two = () => {
    const cfg = program()
    cfg.params[1] = { key: 'logo', kind: 'asset', accept: ['image', 'video'] }
    return cfg
  }

  it('takes the kind the host names', () => {
    const cfg = two()
    applyAssetParam(cfg, 'logo', './reel.mp4', 'video')
    expect(cfg.assets.logo).toEqual({ ref: './reel.mp4', kind: 'video' })
  })

  it('drops a hint nobody vouches for when the knob takes several kinds', () => {
    const cfg = two()
    applyParamValue(cfg, 'logo', './reel.mp4')
    expect(cfg.assets.logo).toEqual({ ref: './reel.mp4' })
  })

  it('keeps the hint when the knob takes that one kind, named or implied', () => {
    const implied = program()
    applyParamValue(implied, 'logo', './other.png')
    expect(implied.assets.logo).toEqual({ ref: './other.png', kind: 'image' })
    const named = program()
    named.params[1] = { key: 'logo', kind: 'asset', accept: ['image'] }
    applyParamValue(named, 'logo', './other.png')
    expect(named.assets.logo.kind).toBe('image')
  })

  it('leaves the hint alone when the same file is committed again', () => {
    const cfg = two()
    applyParamValue(cfg, 'logo', './logo.png')
    expect(cfg.assets.logo).toEqual({ ref: './logo.png', kind: 'image' })
  })

  it('refuses a name that is not one declared file', () => {
    const cfg = program()
    applyAssetParam(cfg, 'shots', './c.png', 'image')
    expect(cfg.assets.shots).toEqual({ ref: ['./a.png', './b.png'] })
    applyAssetParam(cfg, 'nothing', './c.png', 'image')
    expect(Object.keys(cfg.assets)).toEqual(['logo', 'shots', 'product'])
  })
})

describe('what is wrong with a file knob, in words', () => {
  it('says nothing about one that is declared and read', () => {
    expect(assetParamIssues(program())).toEqual([])
    const bound = {
      ...program(),
      createContent: '(ctx) => ({ objects: [] })',
      elements: [{ type: 'image', src: '$assets.logo' }],
    }
    expect(assetParamIssues(bound)).toEqual([])
    const bracket = {
      ...program(),
      createContent: '(ctx) => ({ objects: [], l: ctx.assets["logo"] })',
    }
    expect(assetParamIssues(bracket)).toEqual([])
  })

  it('names an undeclared file and says how to declare it', () => {
    const cfg = program()
    cfg.params = [{ key: 'missing', kind: 'asset' }]
    const [issue] = assetParamIssues(cfg)
    expect(issue).toMatch(/"assets" declares no "missing"/)
    expect(issue).toMatch(/ctx\.assets\.missing/)
  })

  it('names a knob over a list, an unknown kind, and a file nothing reads', () => {
    const cfg = program()
    cfg.params = [
      { key: 'shots', kind: 'asset' },
      { key: 'logo', kind: 'asset', accept: ['picture'] },
      { key: 'product', kind: 'asset', accept: ['model'] },
    ]
    const issues = assetParamIssues(cfg)
    expect(issues).toHaveLength(3)
    expect(issues[0]).toMatch(/LIST of files/)
    expect(issues[1]).toMatch(/accepts "picture", which is not a kind of file/)
    expect(issues[2]).toMatch(/swaps a file the program never reads/)
  })

  it('does not mistake a longer name for the one it reads', () => {
    const cfg = {
      ...program(),
      createContent: '(ctx) => ({ objects: [], l: ctx.assets.logoDark })',
    }
    expect(assetParamIssues(cfg)[0]).toMatch(/never reads/)
  })

  it('says when a knob names no kind of file', () => {
    const cfg = program()
    cfg.params = [{ key: 'product', kind: 'asset' }]
    cfg.createContent = '(ctx) => ({ objects: [], p: ctx.assets.product })'
    expect(assetParamIssues(cfg)).toEqual([
      expect.stringMatching(/does not say what kind of file it takes/),
    ])
    cfg.params = [{ key: 'product', kind: 'asset', accept: ['model'] }]
    expect(assetParamIssues(cfg)).toEqual([])
  })

  it('is quiet about any shape that is not a file knob', () => {
    expect(assetParamIssues(null)).toEqual([])
    expect(assetParamIssues({ params: 'x' })).toEqual([])
    expect(assetParamIssues({ params: [null, 7, { kind: 'asset' }] })).toEqual(
      [],
    )
  })
})
