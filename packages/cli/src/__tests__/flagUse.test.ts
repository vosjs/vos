import { beforeEach, describe, expect, it } from 'vitest'
import { parseArgs as parseEngineArgs } from '../args'
import { hasFlag, parseArgs, strFlag } from '../plugin/args'
import {
  helpFlagsFor,
  nearestFlag,
  resetFlagUse,
  unusedFlags,
  unusedFlagsMessage,
} from '../flagUse'

const BOOL = new Set(['json', 'at-zooms'])

describe('which flags a verb read', () => {
  beforeEach(resetFlagUse)

  it('reports a flag nothing asked for', () => {
    // The case that shipped: frames reads --times, the person typed --at.
    const { flags } = parseArgs(['take', '--at', '3,5,8', '--json'], BOOL)
    strFlag(flags, 'times')
    void flags.json
    expect(unusedFlags()).toEqual(['at'])
  })

  it('counts every way a verb reads a flag', () => {
    const { flags, multi } = parseArgs(
      ['--out', 'd', '--size', '1x1', '--json', '--set', 'a=1'],
      BOOL,
      new Set(['set']),
    )
    strFlag(flags, 'out') // an index read
    hasFlag(flags, 'size') // hasOwnProperty.call
    expect('json' in flags).toBe(true) // the in operator
    expect(multi.set).toEqual(['a=1'])
    expect(unusedFlags()).toEqual([])
  })

  it('treats a spread as reading everything it hands on', () => {
    const { flags } = parseArgs(['--width', '10', '--fps', '30'], BOOL)
    const copy = { ...flags }
    expect(copy.width).toBe('10')
    expect(unusedFlags()).toEqual([])
  })

  it('never reports a flag that was read, and never --help', () => {
    const { flags } = parseArgs(['--help', '--out', 'd'], new Set(['help']))
    strFlag(flags, 'out')
    expect(unusedFlags()).toEqual([])
  })

  it('tracks the engine parser too', () => {
    const { flags } = parseEngineArgs(['cfg.json', '--tiem', '2'], BOOL)
    void flags.time
    expect(unusedFlags()).toEqual(['tiem'])
  })
})

describe('what the message offers', () => {
  beforeEach(resetFlagUse)

  const HELP = `Take pipeline
  vos render <take> [out.webm] [--width] [--fps]
  vos frames <take> [--times 0,50%] [--frame <t>] [--at-zooms]
             [--size WxH] [--out dir]
  vos open <take> [--studio <url>]
`

  it('reads a verb’s flags off its help line and its continuation', () => {
    expect(helpFlagsFor(HELP, 'frames')).toEqual([
      'times',
      'frame',
      'at-zooms',
      'size',
      'out',
    ])
    expect(helpFlagsFor(HELP, 'open')).toEqual(['studio'])
    expect(helpFlagsFor(HELP, 'nope')).toEqual([])
  })

  it('names the near flag for a slip and nothing for a stranger', () => {
    expect(nearestFlag('titel', ['title', 'slug', 'tags'])).toBe('title')
    expect(nearestFlag('body', ['body-px', 'brand'])).toBe('body-px')
    expect(nearestFlag('quality', ['title', 'slug'])).toBeNull()
  })

  it('says the command ran, what it ignored, and what it reads', () => {
    parseArgs(['take', '--tiems', '1,2'], BOOL)
    const msg = unusedFlagsMessage('frames', helpFlagsFor(HELP, 'frames'))
    expect(msg).toContain('vos frames RAN, and ignored --tiems')
    expect(msg).toContain('did you mean --times?')
    expect(msg).toContain('It reads: --times --frame --at-zooms --size --out.')
  })

  it('has nothing to say about a clean run', () => {
    const { flags } = parseArgs(['take', '--times', '1'], BOOL)
    strFlag(flags, 'times')
    expect(unusedFlagsMessage('frames', ['times'])).toBeNull()
  })
})
