import { describe, expect, it } from 'vitest'
import { UsageError } from '../args'
import {
  applyDataSets,
  parseTimes,
  setFlags,
  stillFormat,
  stillOutFor,
  videoFormat,
} from '../outputs'

describe('videoFormat', () => {
  it('lets the output name decide when no flag is given', () => {
    expect(videoFormat(undefined, 'out.mp4')).toBe('mp4')
    expect(videoFormat(undefined, 'out.webm')).toBe('webm')
    expect(videoFormat(undefined, undefined)).toBe('webm')
    expect(videoFormat(undefined, 'out')).toBe('webm')
  })

  it('refuses a flag that contradicts the name, never writing one under the other', () => {
    expect(() => videoFormat('webm', 'out.mp4')).toThrow(UsageError)
    expect(videoFormat('mp4', 'out.mp4')).toBe('mp4')
    expect(videoFormat('mp4', 'out')).toBe('mp4')
    expect(() => videoFormat('gif', 'out.gif')).toThrow(/webm or mp4/)
  })
})

describe('stillFormat', () => {
  it('reads the name', () => {
    expect(stillFormat('a.webp')).toBe('webp')
    expect(stillFormat('a.png')).toBe('png')
    expect(stillFormat('a.JPG')).toBe('jpeg')
    expect(() => stillFormat('a.gif')).toThrow(UsageError)
  })
})

describe('parseTimes', () => {
  it('reads seconds and percentages in order, clamping the end inside the last frame', () => {
    const t = parseTimes('0, 1.5 ,50%,100%', 4)
    expect(t.slice(0, 3)).toEqual([0, 1.5, 2])
    expect(t[3]).toBeLessThan(4)
    expect(() => parseTimes('soon', 4)).toThrow(UsageError)
    expect(() => parseTimes('', 4)).toThrow(UsageError)
  })

  it('names one file per time only when there are several', () => {
    expect(stillOutFor('s.png', 1.5, false)).toBe('s.png')
    expect(stillOutFor('s.png', 1.5, true)).toBe('s-1.50s.png')
  })
})

describe('--set data.* on a program', () => {
  it('collects every --set, in order, in both spellings', () => {
    expect(
      setFlags(['c.json', '--set', 'data.a=1', '--set=data.b=x', '--json']),
    ).toEqual(['data.a=1', 'data.b=x'])
  })

  it('patches data in memory, JSON when it parses and a string otherwise', () => {
    const config = { version: 2, data: { accent: '#fff', keep: true } }
    const next = applyDataSets(config, [
      'data.accent=#ff0000',
      'data.count=3',
      'data.name=ROBIN',
    ])
    expect(next.data).toEqual({
      accent: '#ff0000',
      keep: true,
      count: 3,
      name: 'ROBIN',
    })
    expect(config.data.accent).toBe('#fff')
  })

  it('refuses a path that is not a knob value', () => {
    expect(() => applyDataSets({}, ['duration=4'])).toThrow(/data\.<key>/)
    expect(() => applyDataSets({}, ['data.a'])).toThrow(UsageError)
  })
})
