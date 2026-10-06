import { describe, expect, it } from 'vitest'
import { compileVosConfig } from '../compiler/compileVosConfig'
import { bakedAssetDefaults, generateAssetsSetup } from '../compiler/generators'
import { hasAssetErrors, lintVosAssets } from '../lint'
import { codeMask } from '../lint/assets'
import { generateRenderTemplate } from '../runtime'
import { vosConfigJsonSchema } from '../schema/configJsonSchema'
import type { VosConfigJson } from '../types'

const base = {
  version: 2,
  duration: 5,
  camera: { preset: 'perspective' as const },
  createContent: '() => ({ objects: [] })',
  createTimeline: '(ctx, content, duration) => ctx.gsap.timeline()',
}

const manifest = {
  logo: { ref: 'asset:7d1e', kind: 'image' as const },
  photos: { ref: ['./a.png', './b.png'], kind: 'image' as const },
}

/** Run the emitted setup the way the compiled module does, with `deps`. */
function run(
  config: { assets?: unknown },
  deps: { assets?: Record<string, string | string[]> } | undefined,
  resolve?: (ref: string, name: string) => string,
) {
  const code = generateAssetsSetup(config, resolve)
  const warnings: string[] = []
  const console = { warn: (m: string) => warnings.push(m) }
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const out = new Function(
    'deps',
    'console',
    `${code}\n return { assets: __vosAssets, bind: typeof __vosBindAssets === 'function' ? __vosBindAssets : null };`,
  )(deps, console) as {
    assets: Record<string, string | string[]>
    bind: ((v: unknown) => unknown) | null
  }
  return { ...out, warnings }
}

describe('config.assets: the schema', () => {
  it('takes a file or a list of files under an identifier', () => {
    const parsed = vosConfigJsonSchema.safeParse({ ...base, assets: manifest })
    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data.assets).toEqual(manifest)
  })

  it('refuses a name a program could not read as ctx.assets.<name>', () => {
    for (const name of ['my logo', '1st', 'a-b', '']) {
      const parsed = vosConfigJsonSchema.safeParse({
        ...base,
        assets: { [name]: { ref: './x.png' } },
      })
      expect(parsed.success).toBe(false)
    }
  })

  it('refuses an entry with no ref, and a kind it does not know', () => {
    expect(
      vosConfigJsonSchema.safeParse({
        ...base,
        assets: { a: { kind: 'image' } },
      }).success,
    ).toBe(false)
    expect(
      vosConfigJsonSchema.safeParse({
        ...base,
        assets: { a: { ref: './x', kind: 'spreadsheet' } },
      }).success,
    ).toBe(false)
  })
})

describe('ctx.assets: resolution, nearest wins', () => {
  it('uses a ref as it is written when no host says anything', () => {
    expect(run({ assets: manifest }, undefined).assets).toEqual({
      logo: 'asset:7d1e',
      photos: ['./a.png', './b.png'],
    })
  })

  it('bakes the host’s mapping of its own scheme as the default', () => {
    const resolve = (ref: string) =>
      ref.startsWith('asset:') ? `/files/${ref.slice(6)}` : ref
    expect(bakedAssetDefaults({ assets: manifest }, resolve)).toEqual({
      logo: '/files/7d1e',
      photos: ['./a.png', './b.png'],
    })
    expect(run({ assets: manifest }, undefined, resolve).assets.logo).toBe(
      '/files/7d1e',
    )
  })

  it('lets deps.assets win per name, and keeps the default for the rest', () => {
    const got = run(
      { assets: manifest },
      { assets: { logo: 'https://render.example/logo?token=t' } },
    ).assets
    expect(got.logo).toBe('https://render.example/logo?token=t')
    expect(got.photos).toEqual(['./a.png', './b.png'])
  })

  it('is frozen, and is {} for a program that declares nothing', () => {
    const none = run({}, undefined)
    expect(none.assets).toEqual({})
    expect(Object.isFrozen(none.assets)).toBe(true)
    // No manifest, no binding code: nothing to replace.
    expect(none.bind).toBeNull()
  })
})

describe('"$assets.<name>" in a declaration', () => {
  const { bind, warnings } = run(
    { assets: manifest },
    { assets: { logo: 'https://cdn.example/logo.png' } },
  )

  it('is replaced with the resolved URL, at any depth', () => {
    expect(
      bind!([
        { id: 'mark', type: 'image', src: '$assets.logo' },
        { id: 'p', type: 'image', src: '$assets.photos[1]' },
        { id: 'first', type: 'image', src: '$assets.photos' },
        { id: 'deep', asset: { kind: 'gltf', key: '$assets.logo' } },
      ]),
    ).toEqual([
      { id: 'mark', type: 'image', src: 'https://cdn.example/logo.png' },
      { id: 'p', type: 'image', src: './b.png' },
      // A list named without an index is its first file.
      { id: 'first', type: 'image', src: './a.png' },
      {
        id: 'deep',
        asset: { kind: 'gltf', key: 'https://cdn.example/logo.png' },
      },
    ])
  })

  it('leaves everything else alone', () => {
    const el = { text: 'Costs $assets.logo dollars', n: 3, on: true, nil: null }
    expect(bind!(el)).toEqual(el)
  })

  it('says so, in words, when the name or the index does not exist', () => {
    expect(bind!('$assets.missing')).toBe('$assets.missing')
    expect(bind!('$assets.photos[9]')).toBe('$assets.photos[9]')
    expect(warnings).toHaveLength(2)
    expect(warnings[0]).toContain('names no declared file')
  })
})

describe('the compiled module', () => {
  const config: VosConfigJson = {
    ...base,
    assets: manifest,
    elements: [{ id: 'mark', type: 'image', src: '$assets.logo' }],
    fonts: [{ family: 'Brand', url: '$assets.logo' }],
    setup: 'async (ctx) => ({ url: ctx.assets.logo })',
  }
  const code = compileVosConfig(config, {
    resolveAssetRef: (ref) =>
      ref.startsWith('asset:') ? `/files/${ref.slice(6)}` : ref,
  })

  it('exposes ctx.assets to setup and to the program', () => {
    const setupCtx = code.slice(code.indexOf('const setupContext = {'))
    expect(setupCtx.slice(0, setupCtx.indexOf('};'))).toContain(
      'assets: __vosAssets',
    )
    const ctx = code.slice(code.indexOf('const context = {'))
    expect(ctx.slice(0, ctx.indexOf('};'))).toContain('assets: __vosAssets')
  })

  it('bakes the mapped default, never the raw scheme, and binds declarations', () => {
    expect(code).toContain('"logo":"/files/7d1e"')
    expect(code).toContain('const elementsConfig = __vosBindAssets(')
    expect(code).toContain('const fontFaceDecls = __vosBindAssets(')
    // The table exists before anything that reads it is built.
    expect(code.indexOf('const __vosAssets')).toBeLessThan(
      code.indexOf('const fontFaceDecls'),
    )
  })

  it('emits no binding for a program with no manifest', () => {
    const plain = compileVosConfig({
      ...base,
      elements: [{ id: 't', type: 'image', src: './x.png' }],
    })
    expect(plain).not.toContain('__vosBindAssets')
    expect(plain).toContain('const __vosAssets = Object.freeze(')
    expect(plain).toContain('assets: __vosAssets')
  })
})

describe('a capture page hands the host’s URLs to the program', () => {
  const code =
    'export const initVos = async () => ({ timeline: null, cleanup: () => {} })'
  const assets = { logo: 'https://app.example/files/7d1e?rt=tok' }

  it('in the video template and in the still template', () => {
    for (const mode of ['capture-video', 'capture-thumbnail'] as const) {
      const html = generateRenderTemplate(code, {
        mode,
        capture: { width: 320, height: 180, duration: 1, fps: 30, assets },
      })
      expect(html).toContain(JSON.stringify(assets))
      expect(html).toContain('deps.assets = __captureAssets')
    }
  })

  it('and nothing when the host passed none', () => {
    const html = generateRenderTemplate(code, {
      mode: 'capture-thumbnail',
      capture: { width: 320, height: 180, duration: 1, fps: 30 },
    })
    expect(html).toContain('const __captureAssets = null;')
  })
})

describe('lintVosAssets', () => {
  const lint = (extra: Partial<VosConfigJson>) =>
    lintVosAssets({ ...base, ...extra } as VosConfigJson)

  it('is quiet when every name read is declared and every declared name is read', () => {
    expect(
      lint({
        assets: manifest,
        createContent:
          '(ctx) => { const { photos } = ctx.assets; return { objects: [], n: photos.length } }',
        elements: [{ id: 'mark', type: 'image', src: '$assets.logo' }],
      }),
    ).toEqual([])
  })

  it('reports a "$assets" string that names nothing, as an error', () => {
    const issues = lint({
      elements: [{ id: 'mark', type: 'image', src: '$assets.logo' }],
    })
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({
      rule: 'undeclared-asset',
      severity: 'error',
      name: 'logo',
      where: 'elements[0].src',
    })
    expect(hasAssetErrors(issues)).toBe(true)
  })

  it('warns on a function that reads a name the manifest lacks', () => {
    const issues = lint({
      assets: { logo: { ref: './logo.png' } },
      setup:
        "async (ctx) => ({ a: ctx.assets.logo, b: ctx.assets['hero'], c: ctx.assets?.bed })",
    })
    expect(issues.map((i) => `${i.severity}:${i.name}`).sort()).toEqual([
      'warn:bed',
      'warn:hero',
    ])
  })

  it('warns on a declared file nothing reads', () => {
    const issues = lint({ assets: { spare: { ref: './spare.png' } } })
    expect(issues).toEqual([
      expect.objectContaining({ rule: 'unused-asset', name: 'spare' }),
    ])
    expect(hasAssetErrors(issues)).toBe(false)
  })

  it('reads a stack entry’s functions too', () => {
    expect(
      lint({
        assets: { bed: { ref: './bed.ogg' } },
        stack: [{ id: 'layers', createContent: '(ctx) => ctx.assets.bed' }],
      }),
    ).toEqual([])
  })

  describe('only code is a read', () => {
    it('a URL on a host named assets. is text, in any kind of string', () => {
      expect(
        lint({
          setup: `async (ctx) => {
            const a = 'https://assets.vos.so/fonts/lexend/400.woff2'
            const b = "https://assets.vos.so/fonts/lexend/600.woff2"
            const c = \`https://assets.vos.so/fonts/\${ctx.data.slug}/400.woff2\`
            const d = [{"family":"Lexend","url":"https://assets.vos.so/x.woff2"}]
            return { a, b, c, d }
          }`,
        }),
      ).toEqual([])
    })

    it('a comment is not a read', () => {
      expect(
        lint({
          onFrame: `(ctx) => {
            // loops on assets.vos.so are fetched whole
            /* and so is anything under assets.cdn */
            return 1
          }`,
        }),
      ).toEqual([])
    })

    it('a template’s interpolation is code', () => {
      const issues = lint({
        setup: '(ctx) => `url(${ctx.assets.hero}) and assets.text`',
      })
      expect(issues.map((i) => i.name)).toEqual(['hero'])
    })

    it('a quote inside a regex does not hide what follows it', () => {
      const issues = lint({
        setup: `(ctx) => {
          const clean = (t) => t.replace(/["']/g, '')
          if (/'/.test(ctx.data.t)) return clean(ctx.assets.hero)
          return ctx.data.w / 2 / ctx.assets.count
        }`,
      })
      expect(issues.map((i) => i.name).sort()).toEqual(['count', 'hero'])
    })

    it('a local named assets is not the manifest', () => {
      expect(
        lint({
          setup: `async (ctx) => {
            const assets = []
            for (const u of ctx.data.uris) assets.push({ url: u })
            return { n: assets.length, first: assets[0] }
          }`,
        }),
      ).toEqual([])
    })

    it('a local that IS the manifest still reads it', () => {
      const issues = lint({
        assets: { logo: { ref: './logo.png' } },
        setup: `(ctx) => {
          const assets = ctx.assets
          const { bed } = assets
          return [assets.logo, assets.hero, bed]
        }`,
      })
      expect(issues.map((i) => i.name).sort()).toEqual(['bed', 'hero'])
    })

    it('another object’s assets property is still reported, beside a local', () => {
      const issues = lint({
        setup: `(ctx) => {
          const assets = []
          assets.push(ctx.assets.hero)
          return assets
        }`,
      })
      expect(issues.map((i) => i.name)).toEqual(['hero'])
    })

    it('a name read only in a comment leaves its declaration unused', () => {
      const issues = lint({
        assets: { logo: { ref: './logo.png' } },
        setup: '(ctx) => { /* ctx.assets.logo, later */ return 1 }',
      })
      expect(issues).toEqual([
        expect.objectContaining({ rule: 'unused-asset', name: 'logo' }),
      ])
    })
  })

  describe('codeMask', () => {
    const code = (src: string) => {
      const mask = codeMask(src)
      return [...src].map((c, i) => (mask[i] ? c : '·')).join('')
    }

    it('keeps code and blanks strings, comments and regexes', () => {
      expect(code(`a = 'x' + "y" // z`)).toBe('a = ··· + ··· ····')
      expect(code('a /* b */ c')).toBe('a ······· c')
      expect(code('t.replace(/a[/]b/g, 1)')).toBe('t.replace(········, 1)')
      expect(code('w / 2 / h')).toBe('w / 2 / h')
    })

    it('keeps a template’s interpolations, nested ones too', () => {
      expect(code('`a ${b + `c ${d}`} e`')).toBe('·····b + ·····d······')
      expect(code('`${ {k: 1}.k }` + x')).toBe('··· {k: 1}.k ·· + x')
    })

    it('an unterminated string ends at its line', () => {
      expect(code(`a = 'oops\nb = 1`)).toBe('a = ·····\nb = 1')
    })

    it('costs the length of what it is given', () => {
      // Shapes that would cost a rescan each if a failed match were retried.
      const hostile = [
        '= /'.repeat(100_000),
        "'".repeat(300_000),
        '`${'.repeat(100_000),
        '/[' + '/'.repeat(300_000),
        'assets.'.repeat(50_000),
      ]
      for (const src of hostile) {
        const t0 = performance.now()
        codeMask(src)
        lintVosAssets({ ...base, setup: src } as VosConfigJson)
        expect(performance.now() - t0).toBeLessThan(1500)
      }
    })
  })
})
