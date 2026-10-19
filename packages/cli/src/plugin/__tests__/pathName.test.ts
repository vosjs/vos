import { describe, expect, it } from 'vitest'
import { safePathName } from '../pathName'

describe("a server's name as a path segment", () => {
  it('keeps a plain slug as it is', () => {
    expect(safePathName('my-launch_v2.1', 'id')).toBe('my-launch_v2.1')
    expect(safePathName('CUT.md', 'id')).toBe('CUT.md')
  })

  it('drops every separator and a parent reference', () => {
    expect(safePathName('../x', 'id')).toBe('x')
    expect(safePathName('a/b', 'id')).toBe('a-b')
    expect(safePathName('a\\b', 'id')).toBe('a-b')
    expect(safePathName('../../etc/passwd', 'id')).toBe('etc-passwd')
    expect(safePathName('..', 'abc123')).toBe('abc123')
    expect(safePathName('/', 'abc123')).toBe('abc123')
  })

  it('strips a leading dot, so no name is hidden or a parent', () => {
    expect(safePathName('.hidden', 'id')).toBe('hidden')
    expect(safePathName('...', 'abc123')).toBe('abc123')
    expect(safePathName('.', 'abc123')).toBe('abc123')
  })

  it('removes control characters and collapses the rest', () => {
    expect(safePathName('a\u0000b\nc\u007fd', 'id')).toBe('abcd')
    expect(safePathName('Hello world! (v2)', 'id')).toBe('Hello-world-v2')
    expect(safePathName('ünïcode', 'id')).toBe('n-code')
  })

  it('falls back to the id when nothing is left, shaped the same way', () => {
    expect(safePathName('', 'abc123')).toBe('abc123')
    expect(safePathName(undefined, 'abc123')).toBe('abc123')
    expect(safePathName('///', '../bad id')).toBe('bad-id')
    expect(safePathName('', '')).toBe('file')
  })

  it('caps the length', () => {
    expect(safePathName('x'.repeat(200), 'id')).toHaveLength(80)
  })
})
