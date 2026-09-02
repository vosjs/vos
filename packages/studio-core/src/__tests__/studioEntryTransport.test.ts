import { afterEach, describe, expect, it } from 'vitest'
import { STUDIO_SETUP } from '../lower/studioEntry'

/**
 * The entry's audio scheduler reads the transport's pause state
 * (`window.__vos__.isPaused`), which the engine's bridge toggles through
 * `setGlobalPaused` ONLY when something installed it. The card program does;
 * a bare program has no element renderers and installs nothing, so a
 * soundtrack on a program was silent in the studio (never "playing") while
 * the offline export mix carried it. The entry's setup now installs the
 * defaults itself, and leaves an installed transport alone.
 */

type Ns = {
  isPaused?: boolean
  setGlobalPaused?: (p: boolean) => void
}

async function runSetup(ns: Ns | undefined) {
  const win = { __vos__: ns } as { __vos__?: Ns }
  const g = globalThis as unknown as Record<string, unknown>
  g.window = win
  const setup = new Function(`return (${STUDIO_SETUP})`)() as (
    ctx: unknown,
  ) => Promise<void>
  await setup({ data: {} })
  return win.__vos__ as Ns
}

describe('the studio entry owns the transport when nothing else did', () => {
  afterEach(() => {
    delete (globalThis as unknown as Record<string, unknown>).window
  })

  it('installs isPaused + setGlobalPaused on a bare program', async () => {
    const ns = await runSetup(undefined)
    expect(ns.isPaused).toBe(true)
    expect(typeof ns.setGlobalPaused).toBe('function')
    ns.setGlobalPaused?.(false)
    expect(ns.isPaused).toBe(false)
  })

  it('leaves an installed transport alone (the card program, the elements bundle)', async () => {
    const calls: boolean[] = []
    const mine = (p: boolean) => {
      calls.push(p)
    }
    const ns = await runSetup({ isPaused: false, setGlobalPaused: mine })
    expect(ns.isPaused).toBe(false)
    expect(ns.setGlobalPaused).toBe(mine)
    ns.setGlobalPaused?.(true)
    expect(calls).toEqual([true])
  })
})
