import {
  existsSync,
  mkdtempSync,
  readFileSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  prepareOutput,
  refuseSymlink,
  writeFileSafe,
  writeFileSafeSync,
  writeOutput,
  writeOutputSync,
} from '../safeWrite'

describe('a file a person named (vos render take out/demo.mp4)', () => {
  it('makes the folders it names, at any depth', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vos-output-'))
    await writeOutput(join(dir, 'out', 'cuts', 'demo.mp4'), 'bytes')
    expect(readFileSync(join(dir, 'out', 'cuts', 'demo.mp4'), 'utf8')).toBe(
      'bytes',
    )
    writeOutputSync(join(dir, 'build', 'config.json'), '{}')
    expect(readFileSync(join(dir, 'build', 'config.json'), 'utf8')).toBe('{}')
  })

  it('makes the folder BEFORE the work, so a render never ends in ENOENT', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vos-output-'))
    await prepareOutput(join(dir, 'out', 'demo.mp4'))
    expect(statSync(join(dir, 'out')).isDirectory()).toBe(true)
    expect(existsSync(join(dir, 'out', 'demo.mp4'))).toBe(false)
    // a folder already there, and a bare file name, are fine
    await prepareOutput(join(dir, 'out', 'demo.mp4'))
    await expect(prepareOutput('demo.mp4')).resolves.toBe(undefined)
  })

  it('says in words when a file stands where the folder would go, and writes nothing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vos-output-'))
    writeFileSync(join(dir, 'out'), 'a file, not a folder')
    await expect(prepareOutput(join(dir, 'out', 'demo.mp4'))).rejects.toThrow(
      `cannot make the folder for ${join(dir, 'out', 'demo.mp4')}: a file stands where a folder on its path would go. Nothing was written.`,
    )
    expect(() => writeOutputSync(join(dir, 'out', 'x.json'), '{}')).toThrow(
      /a file stands where a folder on its path would go/,
    )
    expect(readFileSync(join(dir, 'out'), 'utf8')).toBe('a file, not a folder')
  })
})

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
