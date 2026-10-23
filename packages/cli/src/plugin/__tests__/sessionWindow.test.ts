import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  cookieAppliesTo,
  cookieReport,
  cookieWatch,
  readCookieRows,
  chromeTree,
  parseProcessTable,
  runSessionWindow,
  waitForFinish,
} from '../sessionWindow'
import type { SessionWatch } from '../sessionWindow'

const PS = `
  100     1 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome --user-data-dir=/x
  101   100 /Applications/Google Chrome.app/.../Google Chrome Helper --type=gpu-process
  102   100 /Applications/Google Chrome.app/.../Google Chrome Helper (Renderer) --type=renderer --renderer-client-id=6
  103   100 /Applications/Google Chrome.app/.../Google Chrome Helper (Renderer) --type=renderer --extension-process --renderer-client-id=10
  104   100 /Applications/Google Chrome.app/.../Google Chrome Helper --type=utility --utility-sub-type=network.mojom.NetworkService
  200     1 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome
  201   200 /Applications/Google Chrome.app/.../Google Chrome Helper (Renderer) --type=renderer --renderer-client-id=4
`

describe('the page renderers of one Chrome, off the process table', () => {
  it('counts the pages this Chrome draws, never an extension and never another Chrome', () => {
    const rows = parseProcessTable(PS)
    expect(rows).toHaveLength(7)
    expect(chromeTree(rows, 100)).toEqual({
      pages: 1,
      pids: expect.arrayContaining([101, 102, 103, 104]) as number[],
    })
    expect(chromeTree(rows, 100).pids).toHaveLength(4)
    // the person's everyday Chrome is another process tree
    expect(chromeTree(rows, 200).pages).toBe(1)
    expect(chromeTree(rows, 999)).toEqual({ pages: 0, pids: [] })
  })

  it('walks every descendant, where renderers hang off a zygote', () => {
    const rows = parseProcessTable(`
  10   1 /opt/google/chrome/chrome --user-data-dir=/x
  11  10 /opt/google/chrome/chrome --type=zygote
  12  11 /opt/google/chrome/chrome --type=zygote
  13  12 /opt/google/chrome/chrome --type=renderer --renderer-client-id=7
  14  12 /opt/google/chrome/chrome --type=renderer --renderer-client-id=8
`)
    expect(chromeTree(rows, 10).pages).toBe(2)
  })
})

/** A browser whose page count follows a script, then holds its last value. */
function fakeBrowser(counts: (number | null)[]) {
  let exit!: () => void
  let enter!: () => void
  const exited = new Promise<void>((r) => (exit = r))
  const entered = new Promise<void>((r) => (enter = r))
  let i = 0
  const watch: SessionWatch = {
    pages: async () => counts[Math.min(i++, counts.length - 1)],
    exited,
    enter: entered,
    sleep: () => new Promise((r) => setTimeout(r, 1)),
    pollMs: 1,
  }
  const kill = vi.fn((_pid: number, signal: NodeJS.Signals) => {
    // a SIGTERM is a clean quit: the process goes
    if (signal === 'SIGTERM' || signal === 'SIGKILL') exit()
  })
  return { watch, kill, exit, enter }
}

describe('waitForFinish', () => {
  it('calls the window closed when the pages it saw are gone for two polls', async () => {
    const b = fakeBrowser([0, 1, 1, 0, 0])
    await expect(waitForFinish(b.watch)).resolves.toBe('window-closed')
  })

  it('does not call a window closed that was never seen open', async () => {
    const b = fakeBrowser([0, 0, 0, 0, 0, 0])
    const finish = waitForFinish(b.watch)
    setTimeout(() => b.exit(), 30)
    await expect(finish).resolves.toBe('quit')
  })

  it('reads one empty poll as a navigation swapping its renderer, not a close', async () => {
    const b = fakeBrowser([1, 0, 1, 1, 1])
    const finish = waitForFinish(b.watch)
    setTimeout(() => b.enter(), 30)
    await expect(finish).resolves.toBe('enter')
  })

  it('waits on quit and Enter alone where the platform cannot count pages', async () => {
    const b = fakeBrowser([null])
    const finish = waitForFinish(b.watch)
    setTimeout(() => b.exit(), 20)
    await expect(finish).resolves.toBe('quit')
  })
})

describe('every way of finishing saves', () => {
  it('the last window closed: quit this Chrome by its PID with SIGTERM, then save', async () => {
    const b = fakeBrowser([1, 1, 0, 0])
    const save = vi.fn(async () => 'saved')
    const log: string[] = []
    const afterExit = vi.fn(async () => {})
    const result = await runSessionWindow({
      pid: 4242,
      watch: b.watch,
      kill: b.kill,
      save,
      afterExit,
      log: (l) => log.push(l),
    })
    expect(result).toEqual({
      finish: 'window-closed',
      forced: false,
      saved: 'saved',
    })
    expect(b.kill).toHaveBeenCalledTimes(1)
    expect(b.kill).toHaveBeenCalledWith(4242, 'SIGTERM')
    expect(save).toHaveBeenCalledTimes(1)
    // the save reads a profile Chrome finished writing
    expect(b.kill.mock.invocationCallOrder[0]).toBeLessThan(
      afterExit.mock.invocationCallOrder[0],
    )
    // and only once the helpers that write it are gone
    expect(afterExit.mock.invocationCallOrder[0]).toBeLessThan(
      save.mock.invocationCallOrder[0],
    )
    expect(log.join('\n')).toContain('the window closed')
  })

  it('Enter: the same quit, the same save', async () => {
    const b = fakeBrowser([1])
    const save = vi.fn(async () => 'saved')
    const run = runSessionWindow({
      pid: 77,
      watch: b.watch,
      kill: b.kill,
      save,
      log: () => {},
    })
    setTimeout(() => b.enter(), 10)
    expect((await run).finish).toBe('enter')
    expect(b.kill).toHaveBeenCalledWith(77, 'SIGTERM')
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('Chrome quit (⌘Q): save, and nothing to kill', async () => {
    const b = fakeBrowser([1])
    const save = vi.fn(async () => 'saved')
    const run = runSessionWindow({
      pid: 77,
      watch: b.watch,
      kill: b.kill,
      save,
      log: () => {},
    })
    setTimeout(() => b.exit(), 10)
    expect((await run).finish).toBe('quit')
    expect(b.kill).not.toHaveBeenCalled()
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('a Chrome that will not go is stopped after the grace, and says so', async () => {
    let exit!: () => void
    const exited = new Promise<void>((r) => (exit = r))
    const kill = vi.fn((_pid: number, signal: NodeJS.Signals) => {
      if (signal === 'SIGKILL') exit()
    })
    const log: string[] = []
    const result = await runSessionWindow({
      pid: 9,
      watch: {
        pages: async () => 1,
        exited,
        enter: Promise.resolve(),
        sleep: () => new Promise((r) => setTimeout(r, 1)),
        pollMs: 1,
      },
      kill,
      save: async () => null,
      log: (l) => log.push(l),
      graceMs: 5,
    })
    expect(result.forced).toBe(true)
    expect(kill.mock.calls.map((c) => c[1])).toEqual(['SIGTERM', 'SIGKILL'])
    expect(log.at(-1)).toContain('may not be saved')
  })
})

describe('the cookie report says counts, never a value', () => {
  it('matches a cookie to the host it is sent to', () => {
    expect(cookieAppliesTo('.example.com', 'app.example.com')).toBe(true)
    expect(cookieAppliesTo('app.example.com', 'app.example.com')).toBe(true)
    expect(cookieAppliesTo('example.com', 'badexample.com')).toBe(false)
    expect(cookieAppliesTo('accounts.google.com', 'app.example.com')).toBe(
      false,
    )
  })

  it('stays quiet on the first read and speaks once they change', () => {
    const state = { last: null as string | null, said: false }
    const host = 'app.example.com'
    const before = [{ host: '.example.com', name: 'ab', expires: '1' }]
    expect(cookieReport(state, before, host)).toBeNull()
    expect(cookieReport(state, before, host)).toBeNull()
    const after = [
      ...before,
      { host: 'app.example.com', name: 'session', expires: '2' },
      { host: 'accounts.google.com', name: 'SID', expires: '3' },
    ]
    const line = cookieReport(state, after, host)
    expect(line).toContain('app.example.com saved 2 cookies')
    expect(line).toContain('close it')
    expect(cookieReport(state, after, host)).toBeNull()
    expect(
      cookieReport(
        state,
        [...after, { host: '.example.com', name: 'ws', expires: '4' }],
        host,
      ),
    ).toBe('app.example.com: 3 cookies now')
  })
})

/** Chrome's own cookies table, as a current build writes it. */
const CHROME_COOKIES_SCHEMA =
  'CREATE TABLE cookies(creation_utc INTEGER NOT NULL,host_key TEXT NOT NULL,top_frame_site_key TEXT NOT NULL,name TEXT NOT NULL,value TEXT NOT NULL,encrypted_value BLOB NOT NULL,path TEXT NOT NULL,expires_utc INTEGER NOT NULL,is_secure INTEGER NOT NULL,is_httponly INTEGER NOT NULL,last_access_utc INTEGER NOT NULL,has_expires INTEGER NOT NULL,is_persistent INTEGER NOT NULL,priority INTEGER NOT NULL,samesite INTEGER NOT NULL,source_scheme INTEGER NOT NULL,source_port INTEGER NOT NULL,last_update_utc INTEGER NOT NULL,source_type INTEGER NOT NULL,has_cross_site_ancestor INTEGER NOT NULL)'

type SqliteDb = {
  exec(sql: string): void
  close(): void
}
const sqlite = (
  process as { getBuiltinModule?: (id: string) => unknown }
).getBuiltinModule?.('node:sqlite') as
  | { DatabaseSync: new (path: string) => SqliteDb }
  | undefined

/** A profile whose cookie store holds these rows, in Chrome's schema. */
function profileWith(rows: [string, string, string][]): string {
  const dir = mkdtempSync(join(tmpdir(), 'vos-cookies-'))
  mkdirSync(join(dir, 'Default'))
  const db = new sqlite!.DatabaseSync(join(dir, 'Default', 'Cookies'))
  db.exec(CHROME_COOKIES_SCHEMA)
  for (const [host, name, expires] of rows)
    db.exec(
      `INSERT INTO cookies VALUES (13437270822404878,'${host}','','${name}','',x'763130','/',${expires},1,1,13437270822404878,1,1,1,0,2,443,13437270822404878,0,0)`,
    )
  db.close()
  return dir
}

describe('the cookie store, as Chrome writes it', () => {
  it('reads a persistent cookie, whose expiry is past a safe JavaScript integer', async () => {
    if (!sqlite) {
      console.warn('skipped: this Node has no node:sqlite')
      return
    }
    // Microseconds since 1601: a cookie that lasts a year is near 1.34e16.
    const year = '13469306181000000'
    expect(Number(year)).toBeGreaterThan(Number.MAX_SAFE_INTEGER)
    const dir = profileWith([
      ['.example.com', 'session', year],
      ['app.example.com', 'ws', '0'],
    ])
    await expect(readCookieRows(dir)).resolves.toEqual([
      { host: '.example.com', name: 'session', expires: year },
      { host: 'app.example.com', name: 'ws', expires: '0' },
    ])
  })

  it('so the watch speaks when a sign-in saves one', async () => {
    if (!sqlite) return
    const empty = profileWith([])
    const log: string[] = []
    const tick = cookieWatch(empty, 'app.example.com', (l) => log.push(l))
    await tick()
    expect(log).toEqual([])
    // the same profile, after the sign-in: the store now holds two
    const db = new sqlite.DatabaseSync(join(empty, 'Default', 'Cookies'))
    db.exec(
      "INSERT INTO cookies VALUES (1,'.example.com','','session','',x'00','/',13469306181000000,1,1,1,1,1,1,0,2,443,1,0,0)",
    )
    db.exec(
      "INSERT INTO cookies VALUES (1,'app.example.com','','csrf','',x'00','/',13469306181000001,1,1,1,1,1,1,0,2,443,1,0,0)",
    )
    db.close()
    await tick()
    expect(log).toHaveLength(1)
    expect(log[0]).toMatch(/^app\.example\.com saved 2 cookies/)
  })
})
