/* global process */
// Where the public skills catalog (github.com/vosjs/skills) is checked out:
// beside the MAIN checkout of this repo, whatever worktree the caller runs in.
// A git worktree lives somewhere else (for example under .claude/worktrees/),
// so "next to the repo root" is the wrong place from one; git's common
// directory is the main checkout's .git in both cases, and its parent is the
// main checkout. SKILLS_REPO overrides everything.
//
// Read by scripts/sync-skills.mjs and src/plugin/__tests__/bundledSkills.test.ts.
import { execFileSync } from 'node:child_process'
import { basename, dirname, join, resolve } from 'node:path'

/**
 * The pure rule. `override` is SKILLS_REPO; `gitCommonDir` is the absolute
 * path `git rev-parse --git-common-dir` printed, or null when git could not
 * answer; `repoRoot` is this checkout's root, the fallback.
 */
export function skillsRepoFrom({ override, gitCommonDir, repoRoot }) {
  if (override) return resolve(override)
  // A bare or otherwise unusual layout has no checkout beside its common
  // directory to stand next to; fall back to this checkout's root.
  const mainRoot =
    gitCommonDir && basename(gitCommonDir) === '.git'
      ? dirname(resolve(gitCommonDir))
      : repoRoot
  return join(mainRoot, '..', 'skills')
}

/** Asks git, from `repoRoot`, and applies the rule. */
export function resolveSkillsRepo(repoRoot, env = process.env) {
  let gitCommonDir = null
  try {
    gitCommonDir = execFileSync(
      'git',
      ['rev-parse', '--path-format=absolute', '--git-common-dir'],
      { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim()
  } catch {
    // Not a git checkout (an unpacked tarball): the fallback applies.
  }
  return skillsRepoFrom({
    override: env.SKILLS_REPO,
    gitCommonDir: gitCommonDir || null,
    repoRoot,
  })
}
