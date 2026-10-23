/**
 * What the scan NOTICES beside the exposures: the signed-in account's own
 * name wherever the frame shows it (never the name itself, not even inside
 * a selector) and a list of the account's recent items with the mask that
 * hides it. Information only: a take that shows them is not a strict
 * failure. The probe is the recorder's own, evaluated in a REAL browser on
 * fixture pages. Skipped, and said, where no browser launches.
 */
import { createServer } from 'node:http'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  EXPOSURE_PROBE,
  NoticeLog,
  noticeAdvice,
  noticeLine,
} from '../exposure'
import { recordTake } from '@vosjs/render-core/record'
import type { Notice, ScannedNotice } from '@vosjs/render-core/record'
import { run, strictFails } from '../run'
import type { Browser } from 'playwright'
import type { Server } from 'node:http'

const SIGNED_IN = `<!doctype html><html><head><meta charset="utf-8"><title>Board</title>
<style>body{margin:0;font:14px system-ui}header{display:flex;gap:12px;padding:12px}nav{padding:12px;width:220px}a{display:block;padding:4px}</style>
</head><body>
<header>
  <p class="greeting">Welcome back, Jane Doe!</p>
  <button aria-label="Account menu for Jane Doe"><img alt="" width="24" height="24" src="data:image/gif;base64,R0lGODlhAQABAAAAACw="><span>Jane Doe</span></button>
</header>
<nav>
  <h3>Recents</h3>
  <ul id="recent-items">
    <li><a href="/b/1">Q3 roadmap</a></li>
    <li><a href="/b/2">Hiring plan</a></li>
    <li><a href="/b/3">Offsite</a></li>
    <li><a href="/b/4">Board deck</a></li>
  </ul>
</nav>
<main><h1>Q3 roadmap</h1><p>Shared with Jane Doe and two others.</p></main>
</body></html>`

const AVATAR_ONLY = `<!doctype html><html><head><meta charset="utf-8"><title>App</title></head><body>
<header><button class="avatar-button"><img class="avatar" alt="Sam Rivera" width="24" height="24" src="data:image/gif;base64,R0lGODlhAQABAAAAACw="></button></header>
<main><p class="owner">Sam Rivera</p></main>
</body></html>`

const NOTHING_PERSONAL = `<!doctype html><html><head><meta charset="utf-8"><title>Acme</title></head><body>
<nav><a href="/history">History</a><a href="/pricing">Pricing</a><a href="/docs">Docs</a><a href="/blog">Blog</a></nav>
<h2>Welcome to Acme</h2>
<button aria-label="Open menu"><img alt="Menu" width="24" height="24" src="data:image/gif;base64,R0lGODlhAQABAAAAACw="></button>
</body></html>`

let server: Server | undefined
let base = ''
let browser: Browser | null = null
let skipReason = ''

beforeAll(async () => {
  server = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' })
    res.end(req.url === '/signed-in' ? SIGNED_IN : NOTHING_PERSONAL)
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
}, 30_000)

async function scan(html: string): Promise<ScannedNotice[]> {
  const page = await browser!.newPage({
    viewport: { width: 1024, height: 640 },
  })
  try {
    await page.setContent(html)
    const out = (await page.evaluate(EXPOSURE_PROBE)) as {
      notices: ScannedNotice[]
    }
    return out.notices
  } finally {
    await page.close()
  }
}

describe('the scan notices', () => {
  it("the account's own name, every place it shows, and never says it", async () => {
    if (!browser) {
      console.warn(`skipped: no browser (${skipReason})`)
      return
    }
    const notices = await scan(SIGNED_IN)
    const name = notices.find((n) => n.kind === 'account-name')
    expect(name?.sure).toBe(true)
    // The greeting, the menu's own words, the line in the page.
    expect(name?.places).toHaveLength(3)
    // Not in a selector, not in a rect, nowhere: the selector that would
    // have quoted the menu's aria-label names the button another way.
    expect(JSON.stringify(notices)).not.toMatch(/Jane|Doe/)
    for (const p of name?.places ?? []) {
      expect(p.rect.w).toBeGreaterThan(0)
      expect(p.selector.length).toBeGreaterThan(0)
    }
    const line = noticeLine({ step: 2, seen: 1, ...name! } as Notice)
    expect(line).toMatch(/^the account's name \(3 places, from step #2\)/)
    expect(line).not.toMatch(/Jane/)
  }, 30_000)

  it('a list of recent items, with the mask that hides it', async () => {
    if (!browser) return
    const list = (await scan(SIGNED_IN)).find((n) => n.kind === 'personal-list')
    expect(list).toMatchObject({
      heading: 'Recents',
      items: 4,
      selector: 'ul#recent-items',
    })
    expect(noticeLine({ step: -1, seen: 1, ...list! } as Notice)).toBe(
      'a "Recents" list of the account\'s own items (4 items, as the page opened) in ul#recent-items; to hide it, add to "mask": {"selector":"ul#recent-items","as":"blur"}',
    )
  }, 30_000)

  it('a name-like label on an avatar as what may be the name', async () => {
    if (!browser) return
    const name = (await scan(AVATAR_ONLY)).find(
      (n) => n.kind === 'account-name',
    )
    expect(name?.sure).toBe(false)
    expect(name?.places?.map((p) => p.selector)).toEqual(['p.owner'])
    expect(noticeLine({ step: 0, seen: 1, ...name! } as Notice)).toMatch(
      /^what may be the account's name \(1 place, from step #0\): p\.owner$/,
    )
  }, 30_000)

  it('nothing on a page with no account: a History link, a welcome to the product, a menu', async () => {
    if (!browser) return
    expect(await scan(NOTHING_PERSONAL)).toEqual([])
  }, 30_000)
})

// The account menu as apps draw it: a trigger whose own words are the name.
const MENU_TRIGGER = `<!doctype html><html><head><meta charset="utf-8"><title>App</title></head><body>
<header><button aria-label="Account menu" aria-haspopup="menu"><span><img alt="" width="24" height="24" src="data:image/gif;base64,R0lGODlhAQABAAAAACw="></span><span>Robin Vale</span><span>robin@example.com</span></button></header>
<main><h1>Projects</h1></main>
</body></html>`

// A trigger with no name in it: its generic label is never a name.
const GENERIC_TRIGGER = `<!doctype html><html><head><meta charset="utf-8"><title>App</title></head><body>
<header><button aria-label="Account menu" aria-haspopup="menu"><img alt="User menu" width="24" height="24" src="data:image/gif;base64,R0lGODlhAQABAAAAACw="></button>
<button aria-label="Profile settings"><img alt="Profile" width="24" height="24" src="data:image/gif;base64,R0lGODlhAQABAAAAACw="></button></header>
<main><p>Account menu</p><p>Profile settings</p></main>
</body></html>`

describe('the account menu trigger', () => {
  it('reads the name from its own words, sure, without printing it', async () => {
    if (!browser) return
    const notices = await scan(MENU_TRIGGER)
    const name = notices.find((n) => n.kind === 'account-name')
    expect(name?.sure).toBe(true)
    expect(name?.places?.length).toBeGreaterThanOrEqual(1)
    expect(JSON.stringify(notices)).not.toMatch(/Robin|Vale/)
    expect(noticeLine({ step: -1, seen: 1, ...name! } as Notice)).not.toMatch(
      /Robin/,
    )
  }, 30_000)

  it('takes a generic label (account menu, user menu, profile settings) for no name', async () => {
    if (!browser) return
    expect(await scan(GENERIC_TRIGGER)).toEqual([])
  }, 30_000)
})

describe('the advice', () => {
  it('says the swap hint only when the name was noticed', () => {
    expect(noticeAdvice([{ kind: 'personal-list' }])).not.toMatch(/name/)
    expect(noticeAdvice([{ kind: 'account-name' }])).toMatch(
      /The name reads better swapped than blurred/,
    )
  })
})

describe('a take that shows them', () => {
  it('lists them as notices, never as exposures, and is not a strict failure', async () => {
    if (!browser) return
    const result = await recordTake(
      browser,
      `${base}/signed-in`,
      {
        viewport: { width: 1024, height: 640 },
        steps: [{ do: 'wait', ms: 50 }],
      },
      { frame: () => {} },
      () => {},
      { dryRun: true, env: {} },
    )
    expect(result.exposures).toEqual([])
    expect(result.notices.map((n) => n.kind).sort()).toEqual([
      'account-name',
      'personal-list',
    ])
    // Seen as the page opened and again after the step: one notice each.
    expect(result.notices.every((n) => n.step === -1 && n.seen === 2)).toBe(
      true,
    )
    expect(result.meta.notices).toEqual(result.notices)
    expect(strictFails(result)).toBe(false)
  }, 30_000)
})

describe('NoticeLog', () => {
  it("gathers the name's places across scans into one notice", () => {
    const log = new NoticeLog()
    const rect = { x: 0, y: 0, w: 10, h: 10 }
    log.add(-1, [
      { kind: 'account-name', sure: false, places: [{ selector: 'a', rect }] },
    ])
    log.add(3, [
      {
        kind: 'account-name',
        sure: true,
        places: [
          { selector: 'a', rect },
          { selector: 'b', rect },
        ],
      },
    ])
    expect(log.notices()).toEqual([
      {
        step: -1,
        kind: 'account-name',
        sure: true,
        places: [
          { selector: 'a', rect },
          { selector: 'b', rect },
        ],
        seen: 2,
      },
    ])
  })
})

describe('vos validate <take>', () => {
  it('prints the notices apart from the warnings, never the name', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vos-notices-'))
    const rect = { x: 10, y: 10, w: 80, h: 20 }
    await writeFile(
      join(dir, 'meta.json'),
      JSON.stringify({
        dpr: 1,
        zoom: 1,
        t0: 0,
        durationMs: 1000,
        width: 640,
        height: 360,
        fps: 30,
        notices: [
          {
            step: -1,
            kind: 'account-name',
            sure: true,
            places: [{ selector: 'header > p.greeting', rect }],
            seen: 2,
          },
        ],
      }),
    )
    const out: string[] = []
    const spy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation((s) => out.push(String(s)) > 0)
    try {
      await run(['validate', dir, '--json'])
    } finally {
      spy.mockRestore()
    }
    const done = out
      .join('')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l) as Record<string, unknown>)
      .find((e) => e.event === 'done') as {
      warnings: string[]
      notices: string[]
    }
    expect(done.notices[0]).toBe(
      "the recording shows the account's name (1 place, as the page opened): header > p.greeting",
    )
    expect(done.warnings.some((w) => w.includes("account's name"))).toBe(false)
  })
})
