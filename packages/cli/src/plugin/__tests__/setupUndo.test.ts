/**
 * `vos setup --plan`, the receipt and `vos setup --remove`, as the pure
 * functions decide them: over a file system held in memory, so what a plan
 * reads and what an undo would touch are checked without a disk.
 */
import { describe, expect, it } from 'vitest'
import {
  BROWSER_INSTALL,
  KEPT_FILE,
  KEPT_LINK,
  LEFT_LINK,
  RULES_BEGIN,
  RULES_BLOCK,
  RULES_END,
  applyRulesBlock,
  displayPath,
  planRemoval,
  planSetup,
  removalLines,
  removeRulesBlock,
  rulesAction,
  setupPlanLines,
  setupReceipt,
  skillFrontmatterName,
  keptBehindLink,
  skillsTarget,
} from '../machine'
import type {
  AgentHome,
  BrowserProbe,
  RemovalFs,
  RemovalItem,
  SetupAsk,
} from '../machine'

/**
 * A disk in memory: files by absolute path, and symbolic links by path with
 * the path each points at. `reads` records every path that was looked at.
 */
function disk(
  files: Record<string, string>,
  links: Record<string, string> = {},
): RemovalFs & { reads: string[] } {
  const reads: string[] = []
  const resolve = (path: string): string => {
    let at = path
    for (let i = 0; i < 8; i++) {
      const link = Object.keys(links).find(
        (l) => at === l || at.startsWith(`${l}/`),
      )
      if (!link) break
      at = links[link] + at.slice(link.length)
    }
    return at
  }
  const isDirAt = (path: string) =>
    [...Object.keys(files), ...Object.keys(links)].some((f) =>
      f.startsWith(`${path}/`),
    )
  const note = (path: string) => {
    reads.push(path)
    return path
  }
  return {
    reads,
    exists: (path) => {
      const at = resolve(note(path))
      return at in files || isDirAt(at)
    },
    read: (path) => files[resolve(note(path))] ?? null,
    list: (path) => {
      const at = resolve(note(path))
      const names = new Set<string>()
      for (const f of [...Object.keys(files), ...Object.keys(links)])
        if (f.startsWith(`${at}/`))
          names.add(f.slice(at.length + 1).split('/')[0])
      return [...names].sort()
    },
    isLink: (path) => note(path) in links,
    isDir: (path) => !(note(path) in links) && isDirAt(resolve(path)),
    realpath: (path) => resolve(note(path)),
  }
}

const skill = (name: string) =>
  `---\nname: ${name}\nlicense: MIT\n---\n\n# ${name}\n`

/** The package's own copy: two skills and the tag they were synced at. */
const BUNDLED = {
  '/pkg/skills/VERSION': '0.32.2\n',
  '/pkg/skills/product-video/SKILL.md': skill('product-video'),
  '/pkg/skills/product-video/references/a.md': 'a',
  '/pkg/skills/vos-cut/SKILL.md': skill('vos-cut'),
}

const CHROME: BrowserProbe = {
  kind: 'chrome',
  path: '/Applications/Chrome',
  line: 'Chrome (system)',
}
const NO_BROWSER: BrowserProbe = { kind: 'none', path: null, line: 'none' }

const CLAUDE: AgentHome = {
  agent: 'claude',
  dir: '/p/.claude',
  scope: 'project',
}

function ask(over: Partial<SetupAsk> = {}): SetupAsk {
  return {
    root: '/p',
    home: '/home/me',
    homes: [CLAUDE],
    global: false,
    skills: 'bundled',
    bundledDir: '/pkg/skills',
    catalogCommand: 'npx skills@1.7.2 add https://example.test/tree/v0.32.2 -y',
    browser: CHROME,
    installBrowser: true,
    rules: true,
    ...over,
  }
}

describe('removeRulesBlock is the inverse of applyRulesBlock', () => {
  const roundTrip = (x: string) =>
    removeRulesBlock(applyRulesBlock(x).text).text

  it('an absent or empty file comes back empty', () => {
    expect(removeRulesBlock(applyRulesBlock(null).text).text).toBe('')
    expect(roundTrip('')).toBe('')
  })

  it('a file with content and a trailing newline comes back byte for byte', () => {
    const x = '# My rules\n\n- keep tests green\n'
    expect(applyRulesBlock(x).text).toBe(`${x}\n${RULES_BLOCK}\n`)
    expect(roundTrip(x)).toBe(x)
  })

  it('a file with no trailing newline keeps having none, before and after', () => {
    const x = '# My rules\n\n- keep tests green'
    const applied = applyRulesBlock(x).text
    expect(applied).toBe(`${x}\n\n${RULES_BLOCK}`)
    expect(roundTrip(x)).toBe(x)
    // And the block is still found and replaced in place on the next run.
    expect(applyRulesBlock(applied).changed).toBe(false)
  })

  it('a file ending in blank lines, or in CRLF, keeps every byte', () => {
    for (const x of ['a\n\n\n', 'a\r\nb\r\n', 'a\n  '])
      expect(roundTrip(x), JSON.stringify(x)).toBe(x)
  })

  it('a block a person edited goes whole, and the file is what it was', () => {
    const x = '# My rules\n\n- keep tests green\n'
    const edited = applyRulesBlock(x).text.replace(
      RULES_BLOCK,
      `${RULES_BEGIN}\n- a line the person wrote\n- another\n${RULES_END}`,
    )
    expect(removeRulesBlock(edited)).toEqual({ text: x, changed: true })
    // Through a second setup, which replaces the edit with the current block.
    expect(roundTrip(edited)).toBe(x)
  })

  it('text a person added after the block stays, one blank line apart', () => {
    const x = '# My rules\n'
    const later = `${applyRulesBlock(x).text}\n## After\n\nmore\n`
    expect(removeRulesBlock(later).text).toBe(
      '# My rules\n\n## After\n\nmore\n',
    )
    const top = `${RULES_BLOCK}\n\n## After\n`
    expect(removeRulesBlock(top).text).toBe('## After\n')
  })

  it('a file with no block is not changed', () => {
    expect(removeRulesBlock('# mine\n')).toEqual({
      text: '# mine\n',
      changed: false,
    })
    // An end marker with no begin before it is not a block.
    const stray = `${RULES_END}\ntext\n${RULES_BEGIN}\n`
    expect(removeRulesBlock(stray).changed).toBe(false)
  })

  it('rulesAction names what a run would do', () => {
    expect(rulesAction(null)).toBe('write')
    expect(rulesAction('# mine\n')).toBe('write')
    expect(rulesAction(applyRulesBlock('# mine\n').text)).toBe('current')
    expect(rulesAction(`# mine\n\n${RULES_BEGIN}\n- old\n${RULES_END}\n`)).toBe(
      'replace',
    )
  })
})

describe('planSetup says what setup would do and reads only', () => {
  it('lists each skills directory, what is new and what would be overwritten', () => {
    const fs = disk({
      ...BUNDLED,
      '/p/.claude/skills/vos-cut/SKILL.md': 'an older copy',
      '/p/AGENTS.md': '# Rules\n',
    })
    const plan = planSetup(ask(), fs)
    expect(plan).toEqual({
      agents: ['claude'],
      global: false,
      skills: {
        via: 'bundled',
        version: '0.32.2',
        command: null,
        targets: [
          {
            dir: '/p/.claude/skills',
            names: ['product-video', 'vos-cut'],
            existing: ['vos-cut'],
            kept: [],
          },
        ],
      },
      browser: { kind: 'chrome', path: '/Applications/Chrome', install: null },
      rules: { file: '/p/AGENTS.md', action: 'write', block: RULES_BLOCK },
    })
    const words = setupPlanLines(plan, '/p').join('\n')
    expect(words).toContain('into .claude/skills')
    expect(words).toContain('new: product-video')
    expect(words).toContain('already there, would be overwritten: vos-cut')
    expect(words).toContain('this block would be added at the end of AGENTS.md')
    expect(words).toContain(RULES_BLOCK)
    expect(words).toContain('nothing would be installed')
    expect(words.split('\n').at(-1)).toBe(
      'Nothing was changed. npx vos setup does it; npx vos setup --remove undoes it.',
    )
  })

  it('no agent found: the .agents fallback, and a new AGENTS.md', () => {
    const plan = planSetup(ask({ homes: [] }), disk(BUNDLED))
    expect(plan.agents).toEqual([])
    expect(plan.skills.targets).toEqual([
      {
        dir: '/p/.agents/skills',
        names: ['product-video', 'vos-cut'],
        existing: [],
        kept: [],
      },
    ])
    expect(plan.rules).toMatchObject({ file: '/p/AGENTS.md', action: 'write' })
    expect(setupPlanLines(plan, '/p').join('\n')).toContain(
      'agents: none detected here',
    )
  })

  it('no browser: the exact command that would run, or none under --no-browser', () => {
    const would = planSetup(ask({ browser: NO_BROWSER }), disk(BUNDLED))
    expect(would.browser).toEqual({
      kind: 'none',
      path: null,
      install: 'npx playwright install chromium',
    })
    expect(setupPlanLines(would, '/p').join('\n')).toContain(
      `would run ${BROWSER_INSTALL}`,
    )
    const not = planSetup(
      ask({ browser: NO_BROWSER, installBrowser: false }),
      disk(BUNDLED),
    )
    expect(not.browser.install).toBeNull()
    expect(setupPlanLines(not, '/p').join('\n')).toContain('--no-browser')
  })

  it('the rules file: CLAUDE.md when only that exists; replaced, or already current', () => {
    const stale = planSetup(
      ask(),
      disk({
        ...BUNDLED,
        '/p/CLAUDE.md': `# mine\n\n${RULES_BEGIN}\n- old\n${RULES_END}\n`,
      }),
    )
    expect(stale.rules).toMatchObject({
      file: '/p/CLAUDE.md',
      action: 'replace',
    })
    const current = planSetup(
      ask(),
      disk({ ...BUNDLED, '/p/AGENTS.md': applyRulesBlock('# mine\n').text }),
    )
    expect(current.rules?.action).toBe('current')
    expect(setupPlanLines(current, '/p').join('\n')).toContain(
      'already carries this block',
    )
  })

  it('--no-skills and --no-rules plan neither', () => {
    const plan = planSetup(
      ask({ skills: 'skipped', rules: false }),
      disk(BUNDLED),
    )
    expect(plan.skills).toEqual({
      via: 'skipped',
      version: null,
      command: null,
      targets: [],
    })
    expect(plan.rules).toBeNull()
  })

  it('--skills-from-catalog names the command it would spawn', () => {
    const plan = planSetup(ask({ skills: 'skills.sh' }), disk(BUNDLED))
    expect(plan.skills.via).toBe('skills.sh')
    expect(plan.skills.command).toBe(
      'npx skills@1.7.2 add https://example.test/tree/v0.32.2 -y',
    )
    expect(setupPlanLines(plan, '/p').join('\n')).toContain(
      'by running npx skills@1.7.2 add',
    )
  })
})

describe('a skill already there another way is left as it is', () => {
  const NAMES = ['product-video', 'vos-cut']
  const BASES = { root: '/p', home: '/home/me' }

  it('a skill that is a link is kept, not copied over, and the rest still copy', () => {
    const fs = disk(
      {
        ...BUNDLED,
        '/elsewhere/product-video/SKILL.md': skill('product-video'),
        '/p/.claude/skills/vos-cut/SKILL.md': 'an older copy',
      },
      { '/p/.claude/skills/product-video': '/elsewhere/product-video' },
    )
    const target = skillsTarget(CLAUDE, NAMES, BASES, fs)
    expect(target).toEqual({
      dir: '/p/.claude/skills',
      names: NAMES,
      // A plain directory is still overwritten.
      existing: ['vos-cut'],
      kept: [{ name: 'product-video', reason: KEPT_LINK }],
    })
    // The decision is made at the link: nothing behind it is read.
    expect(fs.reads.some((p) => p.startsWith('/elsewhere'))).toBe(false)
    expect(
      fs.reads.some((p) => p.startsWith('/p/.claude/skills/product-video/')),
    ).toBe(false)

    const plan = planSetup(ask(), fs)
    expect(plan.skills.targets).toEqual([target])
    const words = setupPlanLines(plan, '/p').join('\n')
    expect(words).toContain(
      'left as it is (a symbolic link, so this skill was installed another way): product-video',
    )
    expect(words).toContain('already there, would be overwritten: vos-cut')
    expect(words).not.toContain('new:')
  })

  it('a dangling link is kept too', () => {
    const target = skillsTarget(
      CLAUDE,
      NAMES,
      BASES,
      disk(BUNDLED, { '/p/.claude/skills/vos-cut': '/gone/vos-cut' }),
    )
    expect(target.existing).toEqual([])
    expect(target.kept).toEqual([{ name: 'vos-cut', reason: KEPT_LINK }])
  })

  it('a file standing where a skill would go is kept', () => {
    const fs = disk({ ...BUNDLED, '/p/.claude/skills/vos-cut': 'my notes' })
    const target = skillsTarget(CLAUDE, NAMES, BASES, fs)
    expect(target.existing).toEqual([])
    expect(target.kept).toEqual([{ name: 'vos-cut', reason: KEPT_FILE }])
    const words = setupPlanLines(planSetup(ask(), fs), '/p').join('\n')
    expect(words).toContain('new: product-video')
    expect(words).toContain(`left as it is (${KEPT_FILE}): vos-cut`)
  })

  it('a skills directory reached through a link takes nothing, at any depth', () => {
    for (const link of ['/p/.claude', '/p/.claude/skills']) {
      const fs = disk(
        {
          ...BUNDLED,
          '/shared/skills/vos-cut/SKILL.md': skill('vos-cut'),
          '/shared/vos-cut/SKILL.md': skill('vos-cut'),
        },
        { [link]: '/shared' },
      )
      const target = skillsTarget(CLAUDE, NAMES, BASES, fs)
      const reason = keptBehindLink(link)
      expect(target, link).toEqual({
        dir: '/p/.claude/skills',
        names: NAMES,
        existing: [],
        kept: NAMES.map((name) => ({ name, reason })),
      })
      expect(fs.reads.some((p) => p.startsWith(`${link}/`))).toBe(false)
      const words = setupPlanLines(planSetup(ask(), fs), '/p').join('\n')
      expect(words).toContain(
        `left as it is (${reason}): product-video, vos-cut`,
      )
      expect(words).not.toContain('new:')
    }
  })

  it('a --global home is walked from the home directory down', () => {
    const home: AgentHome = {
      agent: 'claude',
      dir: '/home/me/.claude',
      scope: 'global',
    }
    const linked = skillsTarget(
      home,
      NAMES,
      BASES,
      disk(BUNDLED, { '/home/me/.claude': '/dotfiles/claude' }),
    )
    expect(linked.kept).toHaveLength(2)
    expect(linked.kept[0].reason).toBe(keptBehindLink('/home/me/.claude'))
    // The home directory itself being a link is the person's own layout.
    const plain = skillsTarget(
      home,
      NAMES,
      BASES,
      disk(BUNDLED, { '/home/me': '/Users/me' }),
    )
    expect(plain.kept).toEqual([])
  })

  it('nothing in the way: every skill is new', () => {
    expect(skillsTarget(CLAUDE, NAMES, BASES, disk(BUNDLED))).toEqual({
      dir: '/p/.claude/skills',
      names: NAMES,
      existing: [],
      kept: [],
    })
  })
})

describe('setupReceipt names every path a run changed', () => {
  it('sorted, absolute in the data and relative in words, with the undo', () => {
    const receipt = setupReceipt(
      {
        skills: [
          { path: '/p/.claude/skills/vos-cut', replaced: true },
          { path: '/p/.claude/skills/product-video', replaced: false },
        ],
        rules: { file: '/p/AGENTS.md', action: 'write', created: false },
        kept: [],
        browser: { ran: false, path: null },
      },
      '/p',
    )
    expect(receipt.changed).toEqual([
      '/p/.claude/skills/product-video',
      '/p/.claude/skills/vos-cut',
      '/p/AGENTS.md',
    ])
    expect(receipt.lines).toEqual([
      'changed:',
      '  .claude/skills/product-video (new)',
      '  .claude/skills/vos-cut (replaced)',
      '  AGENTS.md (the vos block added)',
      'undo: npx vos setup --remove',
    ])
  })

  it('a second run says nothing changed, in words', () => {
    const receipt = setupReceipt(
      {
        skills: [],
        kept: [],
        rules: null,
        browser: { ran: false, path: null },
      },
      '/p',
    )
    expect(receipt.changed).toEqual([])
    expect(receipt.lines).toEqual([
      'changed: nothing (what vos setup writes was already in place)',
      'undo: npx vos setup --remove',
    ])
  })

  it('says a browser install ran, and where it left the browser', () => {
    const installed = setupReceipt(
      {
        skills: [],
        kept: [],
        rules: { file: '/p/AGENTS.md', action: 'write', created: true },
        browser: { ran: true, path: '/cache/ms-playwright/chromium/chrome' },
      },
      '/p',
    )
    expect(installed.changed).toEqual([
      '/cache/ms-playwright/chromium/chrome',
      '/p/AGENTS.md',
    ])
    expect(installed.lines.join('\n')).toContain(
      '/cache/ms-playwright/chromium/chrome (Chromium, installed by npx playwright install chromium; vos setup --remove leaves it)',
    )
    expect(installed.lines.join('\n')).toContain(
      'AGENTS.md (created, holding the vos block)',
    )
    const failed = setupReceipt(
      {
        skills: [],
        kept: [],
        rules: null,
        browser: { ran: true, path: null },
      },
      '/p',
    )
    expect(failed.lines).toContain(
      'ran: npx playwright install chromium (no browser was found after it)',
    )
  })

  it('says what it left as it was, and never lists that as changed', () => {
    const receipt = setupReceipt(
      {
        skills: [
          { path: '/p/.claude/skills/vos-cut', replaced: false },
          // Never both: a path that was left is not a path that changed.
          { path: '/p/.claude/skills/product-video', replaced: true },
        ],
        kept: [
          { path: '/p/.claude/skills/product-video', reason: KEPT_LINK },
          { path: '/p/.cursor/skills', reason: keptBehindLink('/p/.cursor') },
        ],
        rules: null,
        browser: { ran: false, path: null },
      },
      '/p',
    )
    expect(receipt.changed).toEqual(['/p/.claude/skills/vos-cut'])
    expect(receipt.lines).toEqual([
      'changed:',
      '  .claude/skills/vos-cut (new)',
      'left as it was:',
      '  .claude/skills/product-video (a symbolic link, so this skill was installed another way)',
      '  .cursor/skills (reached through a symbolic link (/p/.cursor), and vos setup copies nothing through one)',
      'undo: npx vos setup --remove',
    ])
  })

  it('a path outside the working directory is said whole', () => {
    expect(displayPath('/home/me/.claude/skills/x', '/p')).toBe(
      '/home/me/.claude/skills/x',
    )
    expect(displayPath('/p/AGENTS.md', '/p')).toBe('AGENTS.md')
  })
})

describe('skillFrontmatterName reads the name a SKILL.md gives', () => {
  it('from the frontmatter only', () => {
    expect(skillFrontmatterName(skill('product-video'))).toBe('product-video')
    expect(skillFrontmatterName('---\nname: "vos-cut"\n---\n')).toBe('vos-cut')
    expect(skillFrontmatterName('# no frontmatter\nname: x\n')).toBeNull()
    expect(skillFrontmatterName('---\nlicense: MIT\n---\nname: x\n')).toBeNull()
  })
})

describe('planRemoval takes back only what setup wrote', () => {
  const removal = (
    fs: RemovalFs,
    over: Partial<Parameters<typeof planRemoval>[0]> = {},
  ) =>
    planRemoval(
      {
        root: '/p',
        home: '/home/me',
        homes: [CLAUDE],
        skills: true,
        rules: true,
        bundledDir: '/pkg/skills',
        ...over,
      },
      fs,
    )
  const paths = (items: RemovalItem[]) =>
    items.map((i) => `${i.kind} ${i.path}`)

  it('removes the bundled skills, the emptied skills directory and the block', () => {
    const original = '# Rules\n\n- mine\n'
    const plan = removal(
      disk({
        ...BUNDLED,
        '/p/.claude/settings.json': '{}',
        '/p/.claude/skills/product-video/SKILL.md': skill('product-video'),
        '/p/.claude/skills/product-video/references/a.md': 'a',
        '/p/.claude/skills/vos-cut/SKILL.md': skill('vos-cut'),
        '/p/AGENTS.md': applyRulesBlock(original).text,
      }),
    )
    expect(plan.kept).toEqual([])
    expect(plan.remove).toEqual([
      { kind: 'skill', path: '/p/.claude/skills/product-video' },
      { kind: 'skill', path: '/p/.claude/skills/vos-cut' },
      { kind: 'dir', path: '/p/.claude/skills' },
      { kind: 'rules', path: '/p/AGENTS.md', text: original },
    ])
  })

  it('keeps a directory that only shares a skill’s name, and says why', () => {
    const plan = removal(
      disk({
        ...BUNDLED,
        // The person's own skill, under a name the catalog also uses.
        '/p/.claude/skills/product-video/SKILL.md': skill('my-product-video'),
        // No SKILL.md at all.
        '/p/.claude/skills/vos-cut/notes.txt': 'mine',
        // A skill the catalog does not ship is never looked at.
        '/p/.claude/skills/their-own/SKILL.md': skill('their-own'),
      }),
    )
    expect(plan.remove).toEqual([])
    expect(plan.kept).toEqual([
      {
        path: '/p/.claude/skills/product-video',
        reason:
          'its SKILL.md names "my-product-video", not "product-video", so it is not the one vos ships',
      },
      {
        path: '/p/.claude/skills/vos-cut',
        reason: 'it holds no SKILL.md, so vos setup did not write it',
      },
    ])
  })

  it('leaves the skills directory when anything else lives in it', () => {
    const plan = removal(
      disk({
        ...BUNDLED,
        '/p/.claude/skills/vos-cut/SKILL.md': skill('vos-cut'),
        '/p/.claude/skills/their-own/SKILL.md': skill('their-own'),
      }),
    )
    expect(paths(plan.remove)).toEqual(['skill /p/.claude/skills/vos-cut'])
  })

  it('a skill that is a link is never removed: setup did not write it', () => {
    // The very skill this package ships, living elsewhere and linked in.
    const fs = disk(
      {
        ...BUNDLED,
        '/elsewhere/product-video/SKILL.md': skill('product-video'),
        '/p/.claude/skills/their-own/SKILL.md': skill('their-own'),
      },
      { '/p/.claude/skills/product-video': '/elsewhere/product-video' },
    )
    const plan = removal(fs)
    expect(plan.remove).toEqual([])
    expect(plan.kept).toEqual([
      { path: '/p/.claude/skills/product-video', reason: LEFT_LINK },
    ])
    expect(LEFT_LINK).toBe(
      'a symbolic link, so vos setup did not write it: this skill was installed another way',
    )
    // Decided at the link: nothing beneath it is read, nothing behind it named.
    expect(
      fs.reads.some((p) => p.startsWith('/p/.claude/skills/product-video/')),
    ).toBe(false)
    expect(JSON.stringify(plan)).not.toContain('/elsewhere')
  })

  it('a link to anything else, or to nothing, is kept the same way', () => {
    const behind: Record<string, string>[] = [
      { '/elsewhere/thing/readme.md': 'x' },
      {},
    ]
    for (const files of behind) {
      const plan = removal(
        disk(
          { ...BUNDLED, ...files },
          { '/p/.claude/skills/product-video': '/elsewhere/thing' },
        ),
      )
      expect(plan.remove).toEqual([])
      expect(plan.kept).toEqual([
        { path: '/p/.claude/skills/product-video', reason: LEFT_LINK },
      ])
    }
  })

  it('a skills directory that still holds a kept link is not empty, so it stays', () => {
    const plan = removal(
      disk(
        {
          ...BUNDLED,
          '/elsewhere/product-video/SKILL.md': skill('product-video'),
          // The only other entry is a skill setup did write.
          '/p/.claude/skills/vos-cut/SKILL.md': skill('vos-cut'),
        },
        { '/p/.claude/skills/product-video': '/elsewhere/product-video' },
      ),
    )
    expect(plan.remove).toEqual([
      { kind: 'skill', path: '/p/.claude/skills/vos-cut' },
    ])
    expect(plan.kept).toEqual([
      { path: '/p/.claude/skills/product-video', reason: LEFT_LINK },
    ])
    const words = removalLines(
      { removed: plan.remove, kept: plan.kept, manual: [], plan: true },
      '/p',
    ).join('\n')
    expect(words).toContain(`  .claude/skills/product-video: ${LEFT_LINK}`)
    expect(words).not.toContain('.claude/skills (')
  })

  it('a skills directory reached through a link is left alone, unread', () => {
    for (const link of ['/p/.claude', '/p/.claude/skills']) {
      const fs = disk(
        {
          ...BUNDLED,
          '/shared/skills/product-video/SKILL.md': skill('product-video'),
          '/shared/product-video/SKILL.md': skill('product-video'),
        },
        { [link]: '/shared' },
      )
      const plan = removal(fs)
      expect(plan.remove, link).toEqual([])
      expect(plan.kept, link).toEqual([
        { path: link, reason: expect.stringContaining('a symbolic link') },
      ])
      expect(fs.reads.some((p) => p.startsWith(`${link}/`))).toBe(false)
    }
  })

  it('never builds a path from what the skills directory holds', () => {
    const fs = disk({
      ...BUNDLED,
      '/p/.claude/skills/../../../etc/SKILL.md': skill('product-video'),
      '/p/.claude/skills/vos-cut/SKILL.md': skill('vos-cut'),
    })
    const plan = removal(fs)
    for (const item of plan.remove)
      expect(item.path.startsWith('/p/.claude/skills')).toBe(true)
    expect(paths(plan.remove)).toEqual(['skill /p/.claude/skills/vos-cut'])
  })

  it('a home under --global is looked at from the home directory down', () => {
    const globalHome: AgentHome = {
      agent: 'claude',
      dir: '/home/me/.claude',
      scope: 'global',
    }
    const plan = removal(
      disk({
        ...BUNDLED,
        '/home/me/.claude/skills/vos-cut/SKILL.md': skill('vos-cut'),
        '/home/me/.claude/skills/their-own/SKILL.md': skill('their-own'),
      }),
      { homes: [globalHome] },
    )
    expect(paths(plan.remove)).toEqual([
      'skill /home/me/.claude/skills/vos-cut',
    ])
  })

  it('says when a home is left empty, and never removes it', () => {
    const plan = removal(
      disk({
        ...BUNDLED,
        '/p/.agents/skills/vos-cut/SKILL.md': skill('vos-cut'),
      }),
      { homes: [{ agent: 'codex', dir: '/p/.agents', scope: 'project' }] },
    )
    expect(paths(plan.remove)).toEqual([
      'skill /p/.agents/skills/vos-cut',
      'dir /p/.agents/skills',
    ])
    expect(plan.kept).toEqual([
      {
        path: '/p/.agents',
        reason: expect.stringContaining('empty directory'),
      },
    ])
  })

  it('a rules file that was only ever the block is deleted; both names are checked', () => {
    const plan = removal(
      disk({
        ...BUNDLED,
        '/p/AGENTS.md': `${RULES_BLOCK}\n`,
        '/p/CLAUDE.md': applyRulesBlock('# Claude\n').text,
      }),
    )
    expect(plan.remove).toEqual([
      { kind: 'rules-file', path: '/p/AGENTS.md' },
      { kind: 'rules', path: '/p/CLAUDE.md', text: '# Claude\n' },
    ])
  })

  it('a rules file that is a second name for the other is handled once', () => {
    const plan = removal(
      disk(
        { ...BUNDLED, '/p/AGENTS.md': applyRulesBlock('# Rules\n').text },
        { '/p/CLAUDE.md': '/p/AGENTS.md' },
      ),
    )
    expect(plan.remove).toEqual([
      { kind: 'rules', path: '/p/AGENTS.md', text: '# Rules\n' },
    ])
    expect(plan.kept).toEqual([])
  })

  it('a rules file that links out of the repo is kept, with the reason', () => {
    const plan = removal(
      disk(
        { ...BUNDLED, '/shared/AGENTS.md': applyRulesBlock('# Shared\n').text },
        { '/p/AGENTS.md': '/shared/AGENTS.md' },
      ),
    )
    expect(plan.remove).toEqual([])
    expect(plan.kept).toEqual([
      {
        path: '/p/AGENTS.md',
        reason: expect.stringContaining('symbolic link'),
      },
    ])
  })

  it('--no-skills and --no-rules each leave their half; nothing to do is nothing', () => {
    const files = {
      ...BUNDLED,
      '/p/.claude/skills/vos-cut/SKILL.md': skill('vos-cut'),
      '/p/AGENTS.md': applyRulesBlock('# Rules\n').text,
    }
    expect(paths(removal(disk(files), { skills: false }).remove)).toEqual([
      'rules /p/AGENTS.md',
    ])
    expect(paths(removal(disk(files), { rules: false }).remove)).toEqual([
      'skill /p/.claude/skills/vos-cut',
      'dir /p/.claude/skills',
    ])
    expect(removal(disk({ ...BUNDLED, '/p/AGENTS.md': '# Rules\n' }))).toEqual({
      remove: [],
      kept: [],
    })
  })

  it('a build with no bundled copy removes no skill', () => {
    const plan = removal(
      disk({ '/p/.claude/skills/vos-cut/SKILL.md': skill('vos-cut') }),
      { bundledDir: null },
    )
    expect(plan.remove).toEqual([])
  })
})

describe('removalLines says the undo in words', () => {
  const removed: RemovalItem[] = [
    { kind: 'skill', path: '/p/.claude/skills/vos-cut' },
    { kind: 'rules', path: '/p/AGENTS.md', text: '# Rules\n' },
  ]
  it('what went, what stayed and why, and the lines left to the person', () => {
    const words = removalLines(
      {
        removed,
        kept: [{ path: '/p/.claude/skills/x', reason: 'not ours' }],
        manual: ['npx vos logout', 'npm rm @vosjs/cli'],
        plan: false,
      },
      '/p',
    )
    expect(words).toEqual([
      'removed:',
      '  .claude/skills/vos-cut (the skill)',
      '  AGENTS.md (the vos block; the rest of the file stays as it was)',
      'kept:',
      '  .claude/skills/x: not ours',
      'left for you (this never removes a browser, the package, a credential or a take):',
      '  npx vos logout',
      '  npm rm @vosjs/cli',
    ])
  })
  it('a plan says would, and that nothing was changed', () => {
    const words = removalLines(
      { removed, kept: [], manual: ['npm rm @vosjs/cli'], plan: true },
      '/p',
    )
    expect(words[0]).toBe(
      'vos setup --remove would do this. Nothing has been changed.',
    )
    expect(words).toContain('would remove:')
    expect(words.at(-1)).toBe(
      'Nothing was changed. npx vos setup --remove does it.',
    )
  })
  it('a second run has nothing to remove', () => {
    expect(
      removalLines(
        { removed: [], kept: [], manual: ['npm rm @vosjs/cli'], plan: false },
        '/p',
      )[0],
    ).toBe('removed: nothing (no vos skill and no vos block is here)')
  })
})
