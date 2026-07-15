import { describe, expect, it } from 'vitest'
import { parseArgs, numFlag, UsageError } from '../args'

const BOOLS = new Set(['json', 'help'])

describe('parseArgs', () => {
  it('separates positionals and flags', () => {
    const p = parseArgs(['config.json', 'out.webm', '--width', '1920', '--json'], BOOLS)
    expect(p.positionals).toEqual(['config.json', 'out.webm'])
    expect(p.flags).toEqual({ width: '1920', json: true })
  })

  it('supports --flag=value', () => {
    expect(parseArgs(['--fps=60'], BOOLS).flags).toEqual({ fps: '60' })
  })

  it('throws when a value flag has no value', () => {
    expect(() => parseArgs(['--width'], BOOLS)).toThrow(UsageError)
    expect(() => parseArgs(['--width', '--json'], BOOLS)).toThrow(UsageError)
  })

  it('passes through everything after --', () => {
    const p = parseArgs(['--json', '--', '--not-a-flag'], BOOLS)
    expect(p.positionals).toEqual(['--not-a-flag'])
  })
})

describe('numFlag', () => {
  it('parses numbers and falls back', () => {
    expect(numFlag({ fps: '60' }, 'fps', 30)).toBe(60)
    expect(numFlag({}, 'fps', 30)).toBe(30)
  })

  it('rejects non-numeric values', () => {
    expect(() => numFlag({ fps: 'fast' }, 'fps', 30)).toThrow(UsageError)
  })
})
