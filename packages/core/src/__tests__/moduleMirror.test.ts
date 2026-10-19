import { describe, expect, it } from 'vitest'
import {
  DEFAULT_GSAP_VERSION,
  DEFAULT_THREE_VERSION,
  EXTERNAL_PACKAGES,
  MEDIABUNNY_VERSION,
  MP4BOX_VERSION,
  engineMirrorLayout,
  engineModules,
  esmShModules,
  mirroredModules,
} from '../addons/cdn'
import { generateRenderTemplate } from '../runtime/renderTemplate'

const BASE = 'https://assets.example/esm'

describe('module sources', () => {
  it('names esm.sh for everything by default', () => {
    const m = esmShModules()
    expect(m.source).toBe('esm.sh')
    expect(m.origin).toBe('https://esm.sh')
    for (const url of [
      m.three,
      m.threeAddons,
      m.gsap,
      m.draco,
      m.mediabunny,
      m.mp4box,
      ...m.preload,
      ...Object.values(m.imports),
    ]) {
      expect(url).toMatch(/^https:\/\/esm\.sh\//)
    }
    expect(m.imports.three).toContain(`three@${DEFAULT_THREE_VERSION}`)
    expect(m.imports.gsap).toContain(`gsap@${DEFAULT_GSAP_VERSION}`)
    expect(m.mediabunny).toContain(`mediabunny@${MEDIABUNNY_VERSION}`)
    expect(m.mp4box).toContain(`mp4box@${MP4BOX_VERSION}`)
  })

  it('lays a mirror out as <base>/<name>@<version>/<file>', () => {
    const m = mirroredModules(`${BASE}/`)
    expect(m.source).toBe('mirror')
    expect(m.origin).toBe('https://assets.example')
    expect(m.three).toBe(
      `${BASE}/three@${DEFAULT_THREE_VERSION}/build/three.module.js`,
    )
    expect(m.threeAddons).toBe(
      `${BASE}/three@${DEFAULT_THREE_VERSION}/examples/jsm/`,
    )
    expect(m.imports['three/tsl']).toBe(
      `${BASE}/three@${DEFAULT_THREE_VERSION}/build/three.tsl.js`,
    )
    expect(m.imports['three/webgpu']).toBe(
      `${BASE}/three@${DEFAULT_THREE_VERSION}/build/three.webgpu.js`,
    )
    expect(m.gsap).toBe(`${BASE}/gsap@${DEFAULT_GSAP_VERSION}/index.js`)
    expect(m.draco).toBe(
      `${BASE}/three@${DEFAULT_THREE_VERSION}/examples/jsm/libs/draco/`,
    )
    expect(m.mediabunny).toBe(
      `${BASE}/mediabunny@${MEDIABUNNY_VERSION}/dist/bundles/mediabunny.mjs`,
    )
    expect(m.mp4box).toBe(`${BASE}/mp4box@${MP4BOX_VERSION}/dist/mp4box.esm.js`)
    expect(m.preload).toEqual([
      m.three,
      `${BASE}/three@${DEFAULT_THREE_VERSION}/build/three.core.js`,
    ])
    for (const url of [...Object.values(m.imports), ...m.preload]) {
      expect(url).not.toContain('esm.sh')
    }
  })

  it('takes the versions a host passes', () => {
    const m = mirroredModules(BASE, {
      threeVersion: '0.170.0',
      gsapVersion: '3.11.0',
    })
    expect(m.three).toContain('three@0.170.0/')
    expect(m.gsap).toContain('gsap@3.11.0/')
    expect(esmShModules({ threeVersion: '0.170.0' }).three).toContain(
      'three@0.170.0',
    )
  })

  it('refuses a mirror base that is not an absolute URL', () => {
    expect(() => mirroredModules('/esm')).toThrow(/absolute URL/)
  })

  it('picks the mirror when a host names one, esm.sh otherwise', () => {
    expect(engineModules(null).source).toBe('esm.sh')
    expect(engineModules(undefined).source).toBe('esm.sh')
    expect(engineModules('').source).toBe('esm.sh')
    expect(engineModules(BASE).source).toBe('mirror')
  })

  it('describes what a mirror must hold, one package per pin', () => {
    const layout = engineMirrorLayout()
    const byName = Object.fromEntries(layout.map((p) => [p.name, p]))
    expect(byName.three.version).toBe(DEFAULT_THREE_VERSION)
    expect(byName.three.files).toContain('build/three.module.js')
    expect(byName.three.files).toContain('build/three.core.js')
    expect(byName.three.prefixes).toEqual(['examples/jsm/'])
    expect(byName.gsap.version).toBe(DEFAULT_GSAP_VERSION)
    expect(byName.mediabunny.version).toBe(MEDIABUNNY_VERSION)
    expect(byName.mp4box.build).toEqual({
      entry: 'dist/mp4box.all.js',
      out: 'dist/mp4box.esm.js',
    })
    for (const [name, pkg] of Object.entries(EXTERNAL_PACKAGES)) {
      expect(byName[name].version).toBe(pkg.version)
      expect(byName[name].files).toEqual([pkg.file])
    }
    // Every URL a mirror answers is a file the layout names, or sits under
    // a prefix it names.
    const m = mirroredModules(BASE)
    const held = (url: string) => {
      const rel = url.slice(`${BASE}/`.length)
      return layout.some(
        (p) =>
          rel.startsWith(`${p.name}@${p.version}/`) &&
          (p.files.some((f) => rel === `${p.name}@${p.version}/${f}`) ||
            p.prefixes.some((pre) =>
              rel.startsWith(`${p.name}@${p.version}/${pre}`),
            ) ||
            (p.build && rel === `${p.name}@${p.version}/${p.build.out}`)),
      )
    }
    for (const url of [
      ...Object.values(m.imports),
      m.draco,
      m.mediabunny,
      m.mp4box,
      ...m.preload,
    ]) {
      expect(held(url), url).toBe(true)
    }
  })
})

describe('generateRenderTemplate with a module mirror', () => {
  const code =
    'export const initVos = async () => ({ timeline: null, cleanup() {} })'

  it('names no third party in the page', () => {
    const html = generateRenderTemplate(code, {
      mode: 'capture-video',
      capture: { width: 640, height: 360, duration: 1, fps: 30 },
      moduleMirror: BASE,
    })
    expect(html).not.toContain('esm.sh')
    expect(html).toContain(
      `<link rel="preconnect" href="https://assets.example" crossorigin="anonymous">`,
    )
    expect(html).toContain(
      `"three": "${BASE}/three@${DEFAULT_THREE_VERSION}/build/three.module.js"`,
    )
    expect(html).toContain(`"three/addons/": "${BASE}/three@`)
    expect(html).toContain(`"three/tsl": "${BASE}/three@`)
    expect(html).toContain(
      `"mediabunny": "${BASE}/mediabunny@${MEDIABUNNY_VERSION}/dist/bundles/mediabunny.mjs"`,
    )
    expect(html).toContain(
      `window.__THREE_DRACO_PATH__ = '${BASE}/three@${DEFAULT_THREE_VERSION}/examples/jsm/libs/draco/'`,
    )
    expect(html).toContain(
      `<link rel="modulepreload" href="${BASE}/three@${DEFAULT_THREE_VERSION}/build/three.core.js">`,
    )
  })

  it('tells the program where the runtime modules load from', () => {
    const html = generateRenderTemplate(code, {
      mode: 'playback',
      moduleMirror: BASE,
    })
    const line = html.match(/window\.__vos__\.modules = (\{.*\});/)
    expect(line).not.toBeNull()
    expect(JSON.parse(line![1])).toEqual({
      source: 'mirror',
      mediabunny: `${BASE}/mediabunny@${MEDIABUNNY_VERSION}/dist/bundles/mediabunny.mjs`,
      mp4box: `${BASE}/mp4box@${MP4BOX_VERSION}/dist/mp4box.esm.js`,
      draco: `${BASE}/three@${DEFAULT_THREE_VERSION}/examples/jsm/libs/draco/`,
    })
    const esm = generateRenderTemplate(code, { mode: 'playback' })
    const esmLine = esm.match(/window\.__vos__\.modules = (\{.*\});/)
    expect(JSON.parse(esmLine![1]).source).toBe('esm.sh')
    expect(JSON.parse(esmLine![1]).mp4box).toBe(
      `https://esm.sh/mp4box@${MP4BOX_VERSION}`,
    )
  })

  it('sets the runtime modules before the module scripts run', () => {
    const html = generateRenderTemplate(code, { mode: 'playback' })
    expect(html.indexOf('window.__vos__.modules =')).toBeLessThan(
      html.indexOf('<script type="module">'),
    )
  })
})
