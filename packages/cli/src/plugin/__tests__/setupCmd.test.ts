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
  readlinkSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  KEPT_FILE,
  KEPT_LINK,
  LEFT_LINK,
  RULES_BLOCK,
  bundledSkillsDir,
  installedSkills,
  keptBehindLink,
} from '../machine'
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

type Event = Record<string, unknown>

/** Run the verb headless: its exit code and every event it printed. */
async function run(
  ...argv: string[]
): Promise<{ code: number; events: Event[]; done: Event }> {
  out = ''
  const code = await cmdSetup([...argv, '--no-browser', '--json'])
  const events = out
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as Event)
  const done = events.at(-1)!
  expect(done.event).toBe('done')
  return { code, events, done }
}

/** Run the verb headless and hand back its done event. */
async function setup(...argv: string[]): Promise<Event> {
  return (await run(...argv)).done
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

  it('a skill already linked in is left as it is, and setup finishes', async () => {
    const dir = project()
    const skills = join(dir, '.claude', 'skills')
    const outside = realpathSync(mkdtempSync(join(tmpdir(), 'vos-outside-')))
    // The skill installed another way: it lives elsewhere and is linked in,
    // at an older text than the one this package ships.
    mkdirSync(join(outside, 'product-video'))
    writeFileSync(
      join(outside, 'product-video', 'SKILL.md'),
      '---\nname: product-video\n---\n\nan older copy\n',
    )
    mkdirSync(skills)
    const link = join(skills, 'product-video')
    symlinkSync(join(outside, 'product-video'), link)
    // And a file of the person's own standing where another skill would go.
    writeFileSync(join(skills, 'vos-cut'), 'my notes\n')
    const elsewhere = snapshot(outside)
    const kept = [
      { path: link, reason: KEPT_LINK },
      { path: join(skills, 'vos-cut'), reason: KEPT_FILE },
    ]
    const copied = NAMES.filter((n) => n !== 'product-video' && n !== 'vos-cut')

    // The plan says so first, per name.
    const planned = await setup('--agent', 'claude', '--plan')
    expect(
      (planned.plan as { skills: { targets: unknown[] } }).skills.targets,
    ).toEqual([
      {
        dir: skills,
        names: NAMES,
        existing: [],
        kept: [
          { name: 'product-video', reason: KEPT_LINK },
          { name: 'vos-cut', reason: KEPT_FILE },
        ],
      },
    ])

    const { code, events, done } = await run('--agent', 'claude')
    const doctor = done.doctor as {
      ok: boolean
      skills: { names: string[] }[]
    }
    // The run finishes: only a missing browser changes the exit code.
    expect(code).toBe(doctor.ok ? 0 : 3)

    // The link is still that link, and what it points at is untouched.
    expect(lstatSync(link).isSymbolicLink()).toBe(true)
    expect(readlinkSync(link)).toBe(join(outside, 'product-video'))
    expect(snapshot(outside)).toEqual(elsewhere)
    expect(readFileSync(join(skills, 'vos-cut'), 'utf8')).toBe('my notes\n')

    // Every other skill is copied, and the rules block is written.
    for (const name of copied) {
      expect(lstatSync(join(skills, name)).isDirectory(), name).toBe(true)
      expect(readFileSync(join(skills, name, 'SKILL.md'))).toEqual(
        readFileSync(join(BUNDLED, name, 'SKILL.md')),
      )
    }
    expect(readFileSync(join(dir, 'AGENTS.md'), 'utf8')).toBe(
      `${RULES_BLOCK}\n`,
    )

    // Said in the skills event and the done event, and never as changed.
    expect((done.skills as { kept: unknown }).kept).toEqual(kept)
    expect(events.find((e) => e.event === 'skills')?.kept).toEqual(kept)
    expect(done.changed).toEqual(
      [...copied.map((n) => join(skills, n)), join(dir, 'AGENTS.md')].sort(),
    )

    // A linked skill is still a skill that is there: doctor counts it.
    expect((done.skills as { names: string[] }).names).toContain(
      'product-video',
    )
    expect(doctor.skills[0].names).toContain('product-video')
    expect(doctor.skills[0].names).not.toContain('vos-cut')

    // A second run changes nothing and says the same two again.
    const again = await setup('--agent', 'claude')
    expect(again.changed).toEqual([])
    expect((again.skills as { kept: unknown }).kept).toEqual(kept)
    expect(snapshot(outside)).toEqual(elsewhere)

    // The undo takes back what setup wrote and nothing else: the link and
    // the file were there before it and are there after it.
    const gone = await setup('--agent', 'claude', '--remove')
    expect(gone.removed).toEqual([
      ...copied.map((n) => join(skills, n)),
      join(dir, 'AGENTS.md'),
    ])
    expect(gone.kept).toEqual([
      { path: link, reason: LEFT_LINK },
      { path: join(skills, 'vos-cut'), reason: expect.any(String) },
    ])
    expect(readdirSync(skills).sort()).toEqual(['product-video', 'vos-cut'])
    expect(lstatSync(link).isSymbolicLink()).toBe(true)
    expect(readlinkSync(link)).toBe(join(outside, 'product-video'))
    expect(snapshot(outside)).toEqual(elsewhere)
    expect(readFileSync(join(skills, 'vos-cut'), 'utf8')).toBe('my notes\n')
    expect(existsSync(join(dir, 'AGENTS.md'))).toBe(false)
  }, 60_000)

  it('copies nothing into a skills directory that is a link, and still finishes', async () => {
    const dir = project()
    const skills = join(dir, '.claude', 'skills')
    const outside = realpathSync(mkdtempSync(join(tmpdir(), 'vos-outside-')))
    writeFileSync(join(outside, 'keep.txt'), 'theirs\n')
    symlinkSync(outside, skills)
    const elsewhere = snapshot(outside)

    const done = await setup('--agent', 'claude')
    expect(snapshot(outside)).toEqual(elsewhere)
    expect(lstatSync(skills).isSymbolicLink()).toBe(true)
    expect((done.skills as { kept: unknown }).kept).toEqual([
      { path: skills, reason: keptBehindLink(skills) },
    ])
    expect(done.changed).toEqual([join(dir, 'AGENTS.md')])
    expect(readFileSync(join(dir, 'AGENTS.md'), 'utf8')).toContain(RULES_BLOCK)
  }, 60_000)

  it('--remove leaves what is not provably its own, and never removes a link', async () => {
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
    const link = join(skills, 'vos-cut')
    const kept = [
      {
        path: join(skills, 'launch-kit'),
        reason: expect.stringContaining('"our-launch-checklist"'),
      },
      // Setup never writes a link, so the undo never removes one.
      { path: link, reason: LEFT_LINK },
    ]
    const before = snapshot(dir)

    // The plan says the link stays, and touches nothing.
    const wouldGo = await setup('--remove', '--plan')
    expect((wouldGo.plan as { remove: string[] }).remove).toEqual([
      join(skills, 'product-video'),
    ])
    expect(wouldGo.kept).toEqual(kept)
    expect(snapshot(dir)).toEqual(before)

    const gone = await setup('--remove')
    expect(gone.removed).toEqual([join(skills, 'product-video')])
    expect(gone.kept).toEqual(kept)
    // The skills directory still holds the link, so it is not empty and stays.
    expect(readdirSync(skills).sort()).toEqual([
      'launch-kit',
      'mine',
      'vos-cut',
    ])
    expect(lstatSync(link).isSymbolicLink()).toBe(true)
    expect(readlinkSync(link)).toBe(join(outside, 'vos-cut'))
    expect(snapshot(outside)).toEqual(elsewhere)

    // Idempotent: nothing more to remove, and the link is still said.
    const after = snapshot(dir)
    const again = await setup('--remove')
    expect(again.removed).toEqual([])
    expect(again.kept).toEqual(kept)
    expect(snapshot(dir)).toEqual(after)
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
