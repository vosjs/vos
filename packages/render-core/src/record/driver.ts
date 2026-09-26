/**
 * The recorder's driver: what it needs from a browser, as a STRUCTURAL
 * contract. Playwright's own `Browser`/`BrowserContext`/`Page` satisfy it
 * unchanged, and so does `@cloudflare/playwright`'s (the same client
 * surface over Browser Rendering), so the CLI hands in a launched Node
 * browser and the fleet hands in a connected one, and the recorder never
 * imports either package. Only the members the recorder calls are named
 * here; a driver that offers more is fine, one that offers less fails to
 * type.
 *
 * Frames leave through a `FrameSink`, never through a filesystem: the CLI's
 * sink writes a take directory, the fleet's puts each JPEG to R2.
 */

export interface RecorderRect {
  x: number
  y: number
  width: number
  height: number
}

export interface RecorderLocator {
  waitFor(opts: { state: 'visible'; timeout: number }): Promise<unknown>
  scrollIntoViewIfNeeded(): Promise<unknown>
  boundingBox(): Promise<RecorderRect | null>
  click(): Promise<unknown>
  fill(value: string): Promise<unknown>
}

export interface RecorderLocatorRoot {
  first(): RecorderLocator
}

export interface RecorderResponse {
  status(): number
}

export interface RecorderConsoleMessage {
  type(): string
  text(): string
}

export interface RecorderPage {
  goto(
    url: string,
    opts: { waitUntil: 'networkidle'; timeout: number },
  ): Promise<RecorderResponse | null>
  url(): string
  title(): Promise<string>
  // Playwright's evaluate takes a function or an expression string; the
  // recorder hands it strings (the probes) and small functions.
  evaluate<T>(pageFunction: string | (() => T)): Promise<T>
  on(event: 'console', cb: (m: RecorderConsoleMessage) => void): unknown
  locator(selector: string): RecorderLocatorRoot
  mouse: {
    move(x: number, y: number): Promise<void>
    down(): Promise<void>
    up(): Promise<void>
    wheel(dx: number, dy: number): Promise<void>
  }
  keyboard: {
    type(text: string): Promise<void>
    press(key: string): Promise<void>
  }
}

export interface RecorderCdp {
  on(
    event: 'Page.screencastFrame',
    cb: (ev: {
      data: string
      sessionId: number
      metadata: { timestamp?: number }
    }) => void,
  ): unknown
  send(method: string, params?: Record<string, unknown>): Promise<unknown>
}

export interface RecorderContext {
  newPage(): Promise<RecorderPage>
  addInitScript(script: string): Promise<unknown>
  setExtraHTTPHeaders(headers: Record<string, string>): Promise<unknown>
  // The page handed back is the one `newPage()` answered; typed loosely so
  // Playwright's `Page | Frame` parameter satisfies the contract.
  newCDPSession(page: unknown): Promise<RecorderCdp>
  close(): Promise<void>
}

export interface RecorderBrowser {
  newContext(opts: {
    viewport: { width: number; height: number }
    deviceScaleFactor: number
    storageState?: string
    extraHTTPHeaders?: Record<string, string>
  }): Promise<RecorderContext>
}

/**
 * Where the screencast's frames go. `frame` is called in order with the
 * JPEG bytes; the recorder keeps the index (`file`, `tMs`) itself. The CLI
 * writes `frames/<file>`; the fleet puts to R2. A sink may be async and
 * slow: the recorder never awaits it on the screencast's own thread, so a
 * slow store costs no frames, only memory until it catches up.
 */
export interface FrameSink {
  frame(file: string, bytes: Uint8Array): Promise<void> | void
}

/** The clock and the pauses, injectable so a rehearsal runs fast. */
export interface RecorderClock {
  now(): number
  sleep(ms: number): Promise<void>
}

export const realSleep = (ms: number): Promise<void> =>
  new Promise<void>((r) => setTimeout(r, ms))
