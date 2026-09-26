import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

/**
 * The skills this package ships (`packages/cli/skills`, the fallback
 * `vos setup` copies when skills.sh does not answer) are a COPY of the
 * public catalog, synced by `scripts/sync-skills.mjs` from the sibling
 * `vosjs/skills` checkout. Two things must hold: the copy is well formed
 * (every skill a directory with a SKILL.md whose frontmatter names it),
 * and, wherever the sibling checkout exists, byte for byte the same as it,
 * so a release never ships an older catalog than the one it names.
 */
const BUNDLED = resolve(__dirname, '..', '..', '..', 'skills')
const SIBLING = process.env.SKILLS_REPO
  ? resolve(process.env.SKILLS_REPO)
  : resolve(__dirname, '..', '..', '..', '..', '..', '..', 'skills')

function walk(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    if (name === '.DS_Store') continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...walk(p))
    else out.push(p)
  }
  return out.sort()
}

describe('the bundled skills', () => {
  it('exist, and each is a directory carrying its own SKILL.md', () => {
    expect(
      existsSync(BUNDLED),
      `${BUNDLED} is missing: run pnpm sync-skills`,
    ).toBe(true)
    const names = readdirSync(BUNDLED).filter((n) =>
      statSync(join(BUNDLED, n)).isDirectory(),
    )
    expect(names.length).toBeGreaterThanOrEqual(6)
    expect(names).toContain('product-video')
    for (const name of names) {
      const skill = readFileSync(join(BUNDLED, name, 'SKILL.md'), 'utf8')
      expect(skill, name).toMatch(new RegExp(`^name:\\s*${name}\\s*$`, 'm'))
    }
    expect(existsSync(join(BUNDLED, 'VERSION'))).toBe(true)
  })

  it('match the sibling vosjs/skills checkout byte for byte, where it exists', () => {
    const src = join(SIBLING, 'skills')
    if (!existsSync(src)) {
      // A clone without the sibling (CI) can only check the shape above.
      return
    }
    const ours = walk(BUNDLED)
      .filter((p) => !p.endsWith('/VERSION'))
      .map((p) => relative(BUNDLED, p))
    const theirs = walk(src).map((p) => relative(src, p))
    expect(ours, 'run: pnpm sync-skills').toEqual(theirs)
    for (const rel of ours) {
      expect(
        readFileSync(join(BUNDLED, rel)),
        `${rel} differs: run pnpm sync-skills`,
      ).toEqual(readFileSync(join(src, rel)))
    }
    expect(readFileSync(join(BUNDLED, 'VERSION'), 'utf8').trim()).toBe(
      readFileSync(join(SIBLING, 'version.txt'), 'utf8').trim(),
    )
  })
})
