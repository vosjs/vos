/**
 * `vos look` over a REAL browser, on a fixture page served in-process: the
 * proposals as the recorder's own engine counts them (a dialog's "Continue"
 * scoped and UNIQUE beside the one behind it), the disabled flag, the
 * screenshot, the words withheld, a click that is refused before it is
 * pressed, steps that run in order, and the wall. Skipped, and said, where
 * no browser launches.
 */
import { createServer } from 'node:http'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { LookRefusal, lookAt } from '../look'
import type { LookControl } from '../look'
import type { Browser } from 'playwright'
import type { Server } from 'node:http'

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>Fixture</title>
<style>body{margin:0;font:16px system-ui}button,input{margin:6px;padding:6px 10px}
dialog{position:fixed;inset:auto 20px 20px auto;margin:0}</style></head><body>
<header><nav aria-label="Primary"><a href="/docs?token=abc#top">Docs</a></nav></header>
<main>
  <button data-testid="new-project">New project</button>
  <button aria-label="Settings"><svg width="16" height="16"><rect width="16" height="16"/></svg></button>
  <button>Continue</button>
  <button disabled>Archive</button>
  <button id="danger" onclick="window.__deleted = true">Delete</button>
  <button id="reveal" onclick="document.getElementById('panel').hidden = false">Show panel</button>
  <div id="panel" hidden><button data-testid="panel-ok">Panel button</button></div>
  <input name="title" placeholder="Title">
  <button>jane@realmail.com</button>
  <p>signed in as jane@realmail.com</p>
</main>
<dialog open aria-label="Rename"><button>Continue</button></dialog>
</body></html>`

const LOGIN = `<!doctype html><html><body><form><input name="user"><input type="password" name="pw"><button>Sign in</button></form></body></html>`

let server: Server | undefined
let base = ''
let browser: Browser | null = null
let skipReason = ''

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === '/app') {
      res.writeHead(302, { location: '/login' })
      res.end()
      return
    }
    res.writeHead(200, { 'content-type': 'text/html' })
    res.end(req.url === '/login' ? LOGIN : PAGE)
  })
  await new Promise<void>((r) => server!.listen(0, '127.0.0.1', () => r()))
  const addr = server.address()
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`
  try {
    const { launchBrowser } = await import('../../browser')
    browser = await launchBrowser()
  } catch (e) {
    skipReason = e instanceof Error ? e.message.split('\n')[0] : String(e)
  }
}, 60_000)

afterAll(async () => {
  await browser?.close()
  server?.close()
})

async function look(
  path: string,
  steps: Parameters<typeof lookAt>[2]['steps'] = [],
) {
  const ctx = await browser!.newContext({
    viewport: { width: 1000, height: 700 },
  })
  const page = await ctx.newPage()
  const outDir = mkdtempSync(join(tmpdir(), 'vos-look-'))
  try {
    const result = await lookAt(page, `${base}${path}`, { steps, outDir })
    return { result, page, ctx }
  } catch (e) {
    return { error: e, page, ctx }
  }
}

const byName = (controls: LookControl[], name: string) =>
  controls.filter((c) => c.name === name)

describe('vos look on a real page', () => {
  it('proposes a stable selector per control, scoped to the dialog and counted', async () => {
    if (!browser)
      return void console.warn(`skipped: no browser (${skipReason})`)
    const { result, ctx } = await look('/')
    try {
      expect(result).toBeDefined()
      const r = result!
      expect(existsSync(r.screenshot)).toBe(true)
      expect(readFileSync(r.screenshot).subarray(1, 4).toString()).toBe('PNG')

      const [newProject] = byName(r.controls, 'New project')
      expect(newProject.selector).toBe('[data-testid="new-project"]')
      expect(newProject.match).toBe('unique')

      const [settings] = byName(r.controls, 'Settings')
      expect(settings.selector).toBe('[aria-label="Settings"]')
      expect(settings.match).toBe('unique')

      const continues = byName(r.controls, 'Continue')
      expect(continues).toHaveLength(2)
      const inDialog = continues.find((c) => c.inDialog)!
      const behind = continues.find((c) => !c.inDialog)!
      expect(inDialog.selector).toBe(
        'dialog[open][aria-label="Rename"] >> role=button[name="Continue"]',
      )
      expect(inDialog.match).toBe('unique')
      // The bare role + name reaches both; the landmark around it reaches one.
      expect(behind.selector).toBe('main >> role=button[name="Continue"]')
      expect(behind.match).toBe('unique')

      const [archive] = byName(r.controls, 'Archive')
      expect(archive.disabled).toBe(true)
      expect(newProject.disabled).toBe(false)

      const [docs] = byName(r.controls, 'Docs')
      expect(docs.href).toBe('/docs')
      expect(docs.role).toBe('link')

      // A field named only by its placeholder is still reached by role + name.
      const [title] = r.controls.filter((c) => c.tag === 'input')
      expect(title.selector).toBe('role=textbox[name="Title"]')
      expect(title.match).toBe('unique')

      // The hidden panel's button is not on screen, so it is not listed.
      expect(byName(r.controls, 'Panel button')).toHaveLength(0)

      // An address in a control's words is withheld, and seen as an exposure.
      const withheld = r.controls.filter((c) => c.redacted?.includes('email'))
      expect(withheld).toHaveLength(1)
      expect(JSON.stringify(r.controls)).not.toContain('realmail')
      expect(r.exposures.some((e) => e.kind === 'email')).toBe(true)
      expect(JSON.stringify(r.exposures)).not.toContain('realmail')

      expect(r.wall).toBeNull()
      // The stamps a look puts on the page come off again.
      expect(
        r.controls.every((c) => !c.selector?.includes('data-vos-look')),
      ).toBe(true)
    } finally {
      await ctx.close()
    }
  }, 60_000)

  it('refuses a --click on a delete word before pressing it', async () => {
    if (!browser)
      return void console.warn(`skipped: no browser (${skipReason})`)
    const { error, page, ctx } = await look('/', [
      { do: 'click', selector: '#danger' },
    ])
    try {
      expect(error).toBeInstanceOf(LookRefusal)
      expect((error as Error).message).toContain('"delete"')
      expect(await page.evaluate('window.__deleted === true')).toBe(false)
    } finally {
      await ctx.close()
    }
  }, 60_000)

  it('runs --click and --type in order, then looks at what they left', async () => {
    if (!browser)
      return void console.warn(`skipped: no browser (${skipReason})`)
    const { result, page, ctx } = await look('/', [
      { do: 'click', selector: '#reveal' },
      { do: 'type', selector: 'input[name="title"]', text: 'Q3 plan' },
    ])
    try {
      expect(result!.steps.map((s) => s.do)).toEqual(['click', 'type'])
      const [ok] = byName(result!.controls, 'Panel button')
      expect(ok.selector).toBe('[data-testid="panel-ok"]')
      expect(await page.inputValue('input[name="title"]')).toBe('Q3 plan')
      expect(await page.locator('[data-vos-look]').count()).toBe(0)
    } finally {
      await ctx.close()
    }
  }, 60_000)

  it('says the wall, and does not run the steps behind it', async () => {
    if (!browser)
      return void console.warn(`skipped: no browser (${skipReason})`)
    const { result, ctx } = await look('/app', [
      { do: 'click', selector: 'button' },
    ])
    try {
      expect(result!.wall?.kind).toBe('signin')
      expect(result!.wall?.level).toBe('hard')
      expect(result!.steps).toEqual([])
      // The sign-in form is listed: it is what a setup step scripts past.
      expect(
        result!.controls.some((c) => c.selector === 'input[name="user"]'),
      ).toBe(true)
    } finally {
      await ctx.close()
    }
  }, 60_000)
})

describe('the verb', () => {
  it('prints one JSON object and exits 2 on a refused click', async () => {
    if (!browser)
      return void console.warn(`skipped: no browser (${skipReason})`)
    const { run } = await import('../run')
    const out: string[] = []
    const spy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation((chunk) => {
        out.push(String(chunk))
        return true
      })
    const dir = mkdtempSync(join(tmpdir(), 'vos-look-run-'))
    try {
      const ok = await run([
        'look',
        `${base}/`,
        '--out',
        dir,
        '--viewport',
        '900x600',
        '--json',
      ])
      expect(ok).toBe(0)
      const done = JSON.parse(out.join('').trim().split('\n').at(-1)!)
      expect(done.event).toBe('done')
      expect(done.screenshot).toBe(join(dir, 'look.png'))
      expect(done.viewport).toEqual({ width: 900, height: 600 })
      expect(Array.isArray(done.controls)).toBe(true)
      expect(Array.isArray(done.exposures)).toBe(true)

      out.length = 0
      const refused = await run([
        'look',
        `${base}/`,
        '--out',
        dir,
        '--click',
        'text=Delete',
        '--json',
      ])
      expect(refused).toBe(2)
      expect(JSON.parse(out.join('').trim()).refused).toBe(true)
    } finally {
      spy.mockRestore()
    }
  }, 90_000)
})
