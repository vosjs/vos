import { describe, expect, it } from 'vitest'
import { inlineScriptSafe } from '../runtime/inlineScript'
import { generateSceneSetup } from '../compiler/generators/generateSceneSetup'
import { generateRenderTemplate } from '../runtime/renderTemplate'

describe('code inlined into a <script> cannot end it', () => {
  it('escapes the closing tag and the comment opener, case apart', () => {
    const code = `const s = "</script><script>alert(1)</script>"; // <!-- x\nconst r = /<\\/SCRIPT/;`
    const out = inlineScriptSafe(code)
    expect(out).not.toMatch(/<\/script/i)
    expect(out).not.toContain('<!--')
    // What JavaScript reads back is the same program.
    expect(new Function(`${out}; return s + r.source`)()).toBe(
      '</script><script>alert(1)</script><\\/SCRIPT',
    )
  })

  it('reaches both capture templates', () => {
    const code = `export async function initVos(){ return "</script>" }`
    for (const mode of ['capture-video', 'capture-thumbnail'] as const) {
      const html = generateRenderTemplate(code, {
        mode,
        capture: { width: 64, height: 64, duration: 1, fps: 1 },
      })
      // The program's own closing tag never reaches the page as such; its
      // escaped form does, inside the module script.
      expect(html).not.toContain('return "</script>"')
      expect(html).toContain('return "<\\/script>"')
    }
  })
})

describe('a colour is data in generated code', () => {
  it('writes a string background as a JSON literal', () => {
    const out = generateSceneSetup({
      background: '"); fetch("https://evil"); ("',
      fog: { type: 'linear', color: 'x"y', near: 1, far: 2 },
    } as never)
    expect(out).toContain(
      `scene.background = new THREE.Color(${JSON.stringify('"); fetch("https://evil"); ("')});`,
    )
    expect(out).toContain(`THREE.Fog(${JSON.stringify('x"y')}`)
    expect(out).not.toContain('Color("")')
  })
})
