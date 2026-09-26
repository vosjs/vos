import { describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  RULES_BEGIN,
  RULES_BLOCK,
  RULES_END,
  agentsFromFlag,
  applyRulesBlock,
  bundledSkillsDir,
  detectAgents,
  doctorReport,
  installedSkills,
  probeBrowser,
  rulesFileFor,
} from '../machine'
import type { BrowserProbe, DoctorFacts } from '../machine'

function tree(): string {
  return mkdtempSync(join(tmpdir(), 'vos-machine-'))
}

describe('detectAgents reads the directories agents leave behind', () => {
  it('finds project homes in a stable order, and home ones only under --global', () => {
    const root = tree()
    const home = tree()
    mkdirSync(join(root, '.cursor'))
    mkdirSync(join(root, '.claude'))
    mkdirSync(join(root, '.agents'))
    mkdirSync(join(home, '.codex'))
    const project = detectAgents(root, { home })
    expect(project.map((h) => `${h.agent}:${h.scope}`)).toEqual([
      'claude:project',
      'cursor:project',
      'codex:project',
    ])
    const all = detectAgents(root, { home, global: true })
    expect(all.map((h) => `${h.agent}:${h.scope}`)).toEqual([
      'claude:project',
      'cursor:project',
      'codex:project',
      'codex:global',
    ])
  })

  it('counts Copilot by its instructions file when it has no directory', () => {
    const root = tree()
    mkdirSync(join(root, '.github'))
    writeFileSync(join(root, '.github', 'copilot-instructions.md'), '# hi\n')
    const homes = detectAgents(root)
    expect(homes).toHaveLength(1)
    expect(homes[0].agent).toBe('copilot')
    expect(homes[0].dir).toBe(join(root, '.github', 'copilot'))
  })

  it('answers nothing for an empty tree', () => {
    expect(detectAgents(tree())).toEqual([])
  })
})

describe('--agent names homes whether or not they exist yet', () => {
  it('takes a list or all, and refuses a name it does not know', () => {
    const v = agentsFromFlag('claude, cursor', '/p')
    expect('homes' in v && v.homes.map((h) => h.dir)).toEqual([
      '/p/.claude',
      '/p/.cursor',
    ])
    const all = agentsFromFlag('all', '/p')
    expect('homes' in all && all.homes.length).toBe(4)
    const bad = agentsFromFlag('claude,vim', '/p')
    expect('error' in bad && bad.error).toContain('"vim"')
  })
})

describe('the rules block is idempotent', () => {
  it('appends once, then replaces its own text and nothing else', () => {
    const first = applyRulesBlock('# My rules\n\n- keep tests green\n')
    expect(first.changed).toBe(true)
    expect(first.text).toContain('- keep tests green')
    expect(first.text.indexOf(RULES_BEGIN)).toBeGreaterThan(0)
    expect(first.text.endsWith(`${RULES_END}\n`)).toBe(true)

    const again = applyRulesBlock(first.text)
    expect(again.changed).toBe(false)
    expect(again.text).toBe(first.text)

    // An older block (or one a person edited) gives way; the rest stays.
    const stale = first.text.replace(
      RULES_BLOCK,
      `${RULES_BEGIN}\n- an old line\n${RULES_END}`,
    )
    const fixed = applyRulesBlock(`${stale}\n## After\n\nmore\n`)
    expect(fixed.changed).toBe(true)
    expect(fixed.text).not.toContain('- an old line')
    expect(fixed.text).toContain('## After\n\nmore')
    expect(fixed.text.split(RULES_BEGIN)).toHaveLength(2)
  })

  it('a missing or empty file becomes the block alone', () => {
    expect(applyRulesBlock(null).text).toBe(`${RULES_BLOCK}\n`)
    expect(applyRulesBlock('  \n').text).toBe(`${RULES_BLOCK}\n`)
  })

  it('the block says the four things and names the reference', () => {
    for (const s of [
      'product-video',
      'vos open take',
      'Local by default',
      'never print one',
      'https://vos.so/llms-full.txt',
    ])
      expect(RULES_BLOCK).toContain(s)
    expect(RULES_BLOCK).not.toContain('—')
  })
})

describe('rulesFileFor prefers the file the project already keeps', () => {
  it('AGENTS.md, else CLAUDE.md, else a new AGENTS.md', () => {
    const has = (names: string[]) => (p: string) =>
      names.some((n) => p.endsWith(`/${n}`))
    expect(rulesFileFor('/p', has(['AGENTS.md', 'CLAUDE.md']))).toBe(
      '/p/AGENTS.md',
    )
    expect(rulesFileFor('/p', has(['CLAUDE.md']))).toBe('/p/CLAUDE.md')
    expect(rulesFileFor('/p', has([]))).toBe('/p/AGENTS.md')
  })
})

describe('probeBrowser resolves in the recorder’s order', () => {
  const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  const base = {
    platform: 'darwin' as const,
    env: {} as Record<string, string | undefined>,
    exists: (p: string) => p === chrome,
    bundled: () => null,
  }
  it('VOS_BROWSER_PATH first, and says when it points nowhere', () => {
    const ok = probeBrowser({
      ...base,
      env: { VOS_BROWSER_PATH: '/x/chrome' },
      exists: (p) => p === '/x/chrome',
    })
    expect(ok.kind).toBe('env')
    const gone = probeBrowser({ ...base, env: { VOS_BROWSER_PATH: '/nope' } })
    expect(gone.kind).toBe('none')
    expect(gone.line).toContain('/nope')
  })
  it('then the system Chrome, then the bundled Chromium, then none', () => {
    expect(probeBrowser(base).kind).toBe('chrome')
    const chromium = probeBrowser({
      ...base,
      exists: () => false,
      bundled: () => '/pw/chromium',
    })
    expect(chromium).toMatchObject({ kind: 'chromium', path: '/pw/chromium' })
    const none = probeBrowser({ ...base, exists: () => false })
    expect(none.kind).toBe('none')
    expect(none.line).toContain('npx playwright install chromium')
  })
})

describe('installedSkills lists every <name>/SKILL.md', () => {
  it('reads a skills directory and ignores strays', () => {
    const dir = tree()
    mkdirSync(join(dir, 'product-video'))
    writeFileSync(join(dir, 'product-video', 'SKILL.md'), '---\nname: x\n---\n')
    mkdirSync(join(dir, 'half'))
    writeFileSync(join(dir, 'notes.txt'), 'x')
    expect(installedSkills(dir)).toEqual(['product-video'])
    expect(installedSkills(join(dir, 'missing'))).toEqual([])
  })
})

describe('doctorReport says what is ready and what to do next', () => {
  const browser: BrowserProbe = {
    kind: 'chrome',
    path: '/c',
    line: 'Chrome (system)',
  }
  const ready: DoctorFacts = {
    node: '22.4.0',
    browser,
    ffmpeg: null,
    skills: [{ agent: 'claude', scope: 'project', names: ['product-video'] }],
    credential: false,
  }
  it('a ready machine: ok, and the next step is to record', () => {
    const rep = doctorReport(ready)
    expect(rep.ok).toBe(true)
    expect(rep.lines.join('\n')).toContain('node        22.4.0 ✓')
    expect(rep.lines.join('\n')).toContain('Chrome (system) ✓')
    expect(rep.lines.join('\n')).toContain('absent (optional)')
    expect(rep.lines.join('\n')).toContain('product-video (claude) ✓')
    expect(rep.lines.join('\n')).toContain(
      'absent (vos login when you need hosting)',
    )
    expect(rep.next_step).toContain('vos record')
  })
  it('no browser is the one thing that fails it, and the next step says the fix', () => {
    const rep = doctorReport({
      ...ready,
      browser: { kind: 'none', path: null, line: 'none' },
    })
    expect(rep.ok).toBe(false)
    expect(rep.next_step).toContain('npx playwright install chromium')
  })
  it('no skills points at setup; a dead dev server points at starting it', () => {
    expect(doctorReport({ ...ready, skills: [] }).next_step).toBe(
      'Run: npx vos setup',
    )
    const rep = doctorReport({
      ...ready,
      devServer: {
        url: 'http://localhost:3000',
        ok: false,
        status: null,
        error: 'ECONNREFUSED',
      },
    })
    expect(rep.lines.join('\n')).toContain('does not answer ✗  (ECONNREFUSED)')
    expect(rep.next_step).toContain('Start the dev server')
    expect(rep.ok).toBe(true)
  })
  it('an old node fails it in words', () => {
    const rep = doctorReport({ ...ready, node: '16.20.0' })
    expect(rep.ok).toBe(false)
    expect(rep.next_step).toContain('Node 18')
  })
  it('never carries a credential value', () => {
    const rep = doctorReport({ ...ready, credential: true })
    expect(JSON.stringify(rep)).not.toMatch(/vos_sk_/)
    expect(rep.lines.join('\n')).toContain('credential  present ✓')
  })
})

describe('bundledSkillsDir finds the copy this package ships', () => {
  it('walks up from a module path to packages/cli/skills', () => {
    const dir = bundledSkillsDir(join(__dirname, 'machine.test.ts'))
    expect(dir).toBe(join(__dirname, '..', '..', '..', 'skills'))
    expect(installedSkills(dir!)).toContain('product-video')
  })
  it('answers null outside the package', () => {
    expect(bundledSkillsDir(join(tmpdir(), 'x', 'y.js'))).toBeNull()
  })
})
