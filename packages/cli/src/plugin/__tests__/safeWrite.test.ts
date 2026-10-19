import { mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { refuseSymlink, writeFileSafe, writeFileSafeSync } from '../safeWrite'

describe('a write into a take directory', () => {
  it('refuses a symbolic link at the path, and leaves its target alone', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vos-safe-write-'))
    const target = join(dir, 'elsewhere.json')
    writeFileSync(target, 'original')
    symlinkSync(target, join(dir, 'doc.json'))
    await expect(writeFileSafe(join(dir, 'doc.json'), '{}')).rejects.toThrow(
      /symbolic link/,
    )
    expect(() => writeFileSafeSync(join(dir, 'doc.json'), '{}')).toThrow(
      /symbolic link/,
    )
    await expect(refuseSymlink(join(dir, 'doc.json'))).rejects.toThrow(
      /remove the link/,
    )
    expect(readFileSync(target, 'utf8')).toBe('original')
  })

  it('overwrites a regular file, and creates a missing one', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vos-safe-write-'))
    writeFileSync(join(dir, 'doc.json'), 'old')
    await writeFileSafe(join(dir, 'doc.json'), 'new')
    expect(readFileSync(join(dir, 'doc.json'), 'utf8')).toBe('new')
    writeFileSafeSync(join(dir, 'vos.json'), '{}')
    expect(readFileSync(join(dir, 'vos.json'), 'utf8')).toBe('{}')
    await expect(refuseSymlink(join(dir, 'missing.json'))).resolves.toBe(
      undefined,
    )
  })
})
