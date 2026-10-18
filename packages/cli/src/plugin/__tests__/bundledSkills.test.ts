import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import {
  resolveSkillsRepo,
  skillsRepoFrom,
} from '../../../scripts/skillsRepo.mjs'

/**
 * The skills this package ships (`packages/cli/skills`, the fallback
 * `vos setup` copies when skills.sh does not answer) are a COPY of the
 * public catalog, synced by `scripts/sync-skills.mjs` from the sibling
 * `vosjs/skills` checkout (beside the MAIN checkout, so a git worktree finds
 * it too; `scripts/skillsRepo.mjs` is the one rule, SKILLS_REPO overrides). Two things must hold: the copy is well formed
 * (every skill a directory with a SKILL.md whose frontmatter names it),
 * and, wherever the sibling checkout exists, byte for byte the same as it,
 * so a release never ships an older catalog than the one it names.
 */
const BUNDLED = resolve(__dirname, '..', '..', '..', 'skills')
const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..', '..')
const SIBLING = resolveSkillsRepo(REPO_ROOT)

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

describe('where the sibling skills checkout is looked for', () => {
  it('is SKILLS_REPO when it is set', () => {
    expect(
      skillsRepoFrom({
        override: '/elsewhere/skills',
        gitCommonDir: '/code/vos/.git',
        repoRoot: '/code/vos',
      }),
    ).toBe('/elsewhere/skills')
  })

  it('is beside the main checkout, from the main checkout or a worktree', () => {
    for (const repoRoot of ['/code/vos', '/code/vos/.claude/worktrees/x']) {
      expect(skillsRepoFrom({ gitCommonDir: '/code/vos/.git', repoRoot })).toBe(
        '/code/skills',
      )
    }
  })

  it('falls back to beside this checkout when git cannot say', () => {
    expect(skillsRepoFrom({ gitCommonDir: null, repoRoot: '/code/vos' })).toBe(
      '/code/skills',
    )
    expect(
      skillsRepoFrom({ gitCommonDir: '/srv/vos.git', repoRoot: '/code/vos' }),
    ).toBe('/code/skills')
  })

  it('agrees with git for this checkout', () => {
    const common = execFileSync(
      'git',
      ['rev-parse', '--path-format=absolute', '--git-common-dir'],
      { cwd: REPO_ROOT, encoding: 'utf8' },
    ).trim()
    expect(resolveSkillsRepo(REPO_ROOT, {})).toBe(
      join(dirname(common), '..', 'skills'),
    )
  })
})
