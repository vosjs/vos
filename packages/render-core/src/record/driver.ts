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
  /** what an `expect` and an `await` read, and the disabled-click report */
  isVisible(): Promise<boolean>
  isEnabled(opts?: { timeout?: number }): Promise<boolean>
}

/** A browser download, as Playwright's `Download` answers it. */
export interface RecorderDownload {
  suggestedFilename(): string
  // A Node Readable on Playwright; any async stream of byte chunks will do.
  createReadStream(): Promise<AsyncIterable<unknown> | null>
}

/** The page's own request context (its cookies), as Playwright's `APIResponse` answers. */
export interface RecorderApiResponse {
  ok(): boolean
  status(): number
  headers(): Record<string, string>
  body(): Promise<Uint8Array>
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
  /** An `await` with `reload: true`; absent, the recorder opens the page's URL again. */
  reload?(opts: {
    waitUntil: 'networkidle'
    timeout: number
  }): Promise<RecorderResponse | null>
  /** A `download` step's click; absent, the recorder says the browser reports none. */
  waitForEvent?(
    event: 'download',
    opts: { timeout: number },
  ): Promise<RecorderDownload>
  /** A `download` step's `src` fetch, with the page's cookies; absent, it fetches in the page. */
  request?: {
    get(url: string, opts?: { timeout?: number }): Promise<RecorderApiResponse>
  }
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

/** One intercepted request, as Playwright's `Route` answers it. */
export interface RecorderRoute {
  request(): { url(): string; headers(): Record<string, string> }
  continue(opts?: { headers?: Record<string, string> }): Promise<unknown>
}

export interface RecorderContext {
  newPage(): Promise<RecorderPage>
  addInitScript(script: string): Promise<unknown>
  setExtraHTTPHeaders(headers: Record<string, string>): Promise<unknown>
  /**
   * Request interception, when the driver has it: how a job's headers are
   * sent to the recorded origin alone. A driver without it gets them on
   * every request through `setExtraHTTPHeaders`, and the recorder says so.
   */
  route?(
    pattern: string,
    handler: (route: RecorderRoute) => Promise<unknown> | unknown,
  ): Promise<unknown>
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

/**
 * Where a `download` step's file goes: the CLI writes `outputs/<name>` in
 * the take directory. A host that hands in none cannot keep a download,
 * and the recorder refuses such a script before capturing anything.
 */
export interface OutputSink {
  save(
    name: string,
    bytes: Uint8Array,
    contentType?: string,
  ): Promise<void> | void
}

/** The clock and the pauses, injectable so a rehearsal runs fast. */
export interface RecorderClock {
  now(): number
  sleep(ms: number): Promise<void>
}

export const realSleep = (ms: number): Promise<void> =>
  new Promise<void>((r) => setTimeout(r, ms))
