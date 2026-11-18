/**
 * `vos setup` on a real directory: the plan writes nothing, the receipt
 * names what a run changed, and `--remove` hands the directory back byte
 * for byte, removing only what is provably this package's.
 */
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RULES_BLOCK, bundledSkillsDir, installedSkills } from '../machine'
import { cmdSetup } from '../machineCmd'

const BUNDLED = bundledSkillsDir(join(__dirname, 'setupCmd.test.ts'))!
const NAMES = installedSkills(BUNDLED)

/** Every entry under a directory with its bytes (a link as its target). */
function snapshot(dir: string): Record<string, string> {
  const out: Record<string, string> = {}
  const walk = (at: string) => {
    for (const name of readdirSync(at).sort()) {
      const path = join(at, name)
      const rel = relative(dir, path)
      const stat = lstatSync(path)
      if (stat.isSymbolicLink()) out[rel] = '(link)'
      else if (stat.isDirectory()) {
        out[`${rel}/`] = '(dir)'
        walk(path)
      } else out[rel] = readFileSync(path, 'latin1')
    }
  }
  walk(dir)
  return out
}

let out = ''
const home = process.cwd()

beforeEach(() => {
  out = ''
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    out += String(chunk)
    return true
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  process.chdir(home)
})

/** Run the verb headless and hand back its done event. */
async function setup(...argv: string[]): Promise<Record<string, unknown>> {
  out = ''
  await cmdSetup([...argv, '--no-browser', '--json'])
  const events = out
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as Record<string, unknown>)
  const done = events.at(-1)!
  expect(done.event).toBe('done')
  return done
}

function project(): string {
  // The real path: the verb reads the working directory resolved.
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'vos-setup-')))
  mkdirSync(join(dir, '.claude'))
  writeFileSync(join(dir, '.claude', 'settings.json'), '{}\n')
  process.chdir(dir)
  return dir
}

describe('vos setup, its plan and its undo', () => {
  it('plans without writing, says what it changed, and --remove hands the directory back', async () => {
    const dir = project()
    // No final newline: the undo must hand even that back.
    writeFileSync(join(dir, 'AGENTS.md'), '# Project rules\n\n- keep it green')
    const before = snapshot(dir)
    const skills = join(dir, '.claude', 'skills')

    const planned = await setup('--plan')
    expect(snapshot(dir)).toEqual(before)
    expect(planned.changed).toEqual([])
    expect(planned.plan).toMatchObject({
      agents: ['claude'],
      global: false,
      skills: {
        via: 'bundled',
        targets: [{ dir: skills, names: NAMES, existing: [] }],
      },
      rules: {
        file: join(dir, 'AGENTS.md'),
        action: 'write',
        block: RULES_BLOCK,
      },
    })

    const first = await setup()
    expect(first.changed).toEqual(
      [...NAMES.map((n) => join(skills, n)), join(dir, 'AGENTS.md')].sort(),
    )
    expect(first.undo).toBe('npx vos setup --remove')
    expect(existsSync(join(skills, 'product-video', 'SKILL.md'))).toBe(true)
    expect(readFileSync(join(dir, 'AGENTS.md'), 'utf8')).toContain(RULES_BLOCK)

    // The same run again changes nothing, and says so.
    const second = await setup()
    expect(second.changed).toEqual([])
    // One skill edited on disk is the one a third run replaces.
    writeFileSync(join(skills, 'vos-cut', 'SKILL.md'), 'edited\n')
    expect((await setup()).changed).toEqual([join(skills, 'vos-cut')])

    const installed = snapshot(dir)
    const wouldGo = await setup('--remove', '--plan')
    expect(snapshot(dir)).toEqual(installed)
    expect(wouldGo.removed).toEqual([])
    const expected = [
      ...NAMES.map((n) => join(skills, n)),
      skills,
      join(dir, 'AGENTS.md'),
    ]
    expect((wouldGo.plan as { remove: string[] }).remove).toEqual(expected)

    const gone = await setup('--remove')
    expect(gone.removed).toEqual(expected)
    expect(gone.kept).toEqual([])
    expect((gone.manual as string[]).at(-1)).toBe('npm rm @vosjs/cli')
    expect(snapshot(dir)).toEqual(before)

    // Idempotent: nothing is left to remove.
    const again = await setup('--remove')
    expect(again.removed).toEqual([])
    expect(snapshot(dir)).toEqual(before)
  }, 60_000)

  it('a rules file that was only the block is deleted, and the fallback home is said', async () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'vos-setup-')))
    process.chdir(dir)
    await setup()
    expect(existsSync(join(dir, '.agents', 'skills', 'product-video'))).toBe(
      true,
    )
    expect(readFileSync(join(dir, 'AGENTS.md'), 'utf8')).toBe(
      `${RULES_BLOCK}\n`,
    )
    const gone = await setup('--remove')
    expect(existsSync(join(dir, 'AGENTS.md'))).toBe(false)
    expect(existsSync(join(dir, '.agents', 'skills'))).toBe(false)
    // The directory setup fell back to is left, empty, and named.
    expect(snapshot(dir)).toEqual({ '.agents/': '(dir)' })
    expect(gone.kept).toEqual([
      {
        path: join(dir, '.agents'),
        reason: expect.stringContaining('empty directory'),
      },
    ])
  }, 60_000)

  it('--remove leaves what is not provably its own, and never follows a link', async () => {
    const dir = project()
    const skills = join(dir, '.claude', 'skills')
    const outside = realpathSync(mkdtempSync(join(tmpdir(), 'vos-outside-')))
    mkdirSync(skills)
    // The package's own skill, as setup copies it.
    cpSync(join(BUNDLED, 'product-video'), join(skills, 'product-video'), {
      recursive: true,
    })
    // The same skill living elsewhere, linked in (the layout skills.sh writes).
    cpSync(join(BUNDLED, 'vos-cut'), join(outside, 'vos-cut'), {
      recursive: true,
    })
    symlinkSync(join(outside, 'vos-cut'), join(skills, 'vos-cut'))
    // The person's own skill under a name the catalog also uses.
    mkdirSync(join(skills, 'launch-kit'))
    writeFileSync(
      join(skills, 'launch-kit', 'SKILL.md'),
      '---\nname: our-launch-checklist\n---\n',
    )
    // A skill the catalog does not ship.
    mkdirSync(join(skills, 'mine'))
    writeFileSync(join(skills, 'mine', 'SKILL.md'), '---\nname: mine\n---\n')
    const elsewhere = snapshot(outside)

    const gone = await setup('--remove')
    expect(gone.removed).toEqual([
      join(skills, 'product-video'),
      join(skills, 'vos-cut'),
    ])
    expect(gone.kept).toEqual([
      {
        path: join(skills, 'launch-kit'),
        reason: expect.stringContaining('"our-launch-checklist"'),
      },
    ])
    expect(readdirSync(skills).sort()).toEqual(['launch-kit', 'mine'])
    // The link went; what it pointed at is whole.
    expect(snapshot(outside)).toEqual(elsewhere)
  }, 60_000)

  it('--remove does not reach through a linked skills directory', async () => {
    const dir = project()
    const outside = realpathSync(mkdtempSync(join(tmpdir(), 'vos-outside-')))
    cpSync(join(BUNDLED, 'product-video'), join(outside, 'product-video'), {
      recursive: true,
    })
    symlinkSync(outside, join(dir, '.claude', 'skills'))
    const elsewhere = snapshot(outside)
    const gone = await setup('--remove')
    expect(gone.removed).toEqual([])
    expect(gone.kept).toEqual([
      {
        path: join(dir, '.claude', 'skills'),
        reason: expect.stringContaining('a symbolic link'),
      },
    ])
    expect(snapshot(outside)).toEqual(elsewhere)
  }, 60_000)
})
