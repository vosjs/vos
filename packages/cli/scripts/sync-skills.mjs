#!/usr/bin/env node
/* global process, console */
// Copies the public skills catalog (github.com/vosjs/skills, a sibling
// checkout) into packages/cli/skills, the fallback `vos setup` installs when
// skills.sh does not answer. The copy is COMMITTED: the release runs on a
// clone with no sibling, so nothing at publish time can fetch it. Run this
// after every catalog release, before the CLI's own:
//
//   pnpm --filter @vosjs/cli sync-skills        # SKILLS_REPO overrides ../skills
//
// bundledSkills.test.ts holds the copy to the sibling byte for byte.
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const pkg = resolve(here, '..')
const repoRoot = resolve(pkg, '..', '..')
const source = resolve(
  process.env.SKILLS_REPO ?? join(repoRoot, '..', 'skills'),
)
const src = join(source, 'skills')
const dest = join(pkg, 'skills')

if (!existsSync(src)) {
  console.error(
    `no skills catalog at ${src} (clone github.com/vosjs/skills beside this repo, or set SKILLS_REPO)`,
  )
  process.exit(1)
}

rmSync(dest, { recursive: true, force: true })
mkdirSync(dest, { recursive: true })
cpSync(src, dest, {
  recursive: true,
  filter: (p) => !p.endsWith('.DS_Store'),
})
const version = readFileSync(join(source, 'version.txt'), 'utf8').trim()
writeFileSync(join(dest, 'VERSION'), `${version}\n`)
console.log(`synced skills ${version} from ${src} into ${dest}`)
