import { describe, expect, it } from 'vitest'
import { detectHostAgent, slugFromAiAgent } from '../hostAgent'

const none = () => false

describe('detectHostAgent', () => {
  it('is null outside an agent', () => {
    expect(detectHostAgent({}, none)).toBeNull()
  })

  it('reads the AI_AGENT convention first, as a slug', () => {
    expect(
      detectHostAgent(
        { AI_AGENT: 'claude-code_2-1-284_agent', CURSOR_TRACE_ID: 'x' },
        none,
      ),
    ).toBe('claude-code')
    expect(detectHostAgent({ AI_AGENT: 'github-copilot-cli' }, none)).toBe(
      'github-copilot',
    )
    expect(detectHostAgent({ AI_AGENT: 'v0' }, none)).toBe('v0')
  })

  it('ignores an AI_AGENT that is not a slug and falls through', () => {
    expect(
      detectHostAgent({ AI_AGENT: 'Rm -rf /', CLAUDECODE: '1' }, none),
    ).toBe('claude-code')
    expect(detectHostAgent({ AI_AGENT: '   ' }, none)).toBeNull()
  })

  it.each([
    [{ CLAUDECODE: '1' }, 'claude-code'],
    [{ CLAUDE_CODE: '1' }, 'claude-code'],
    [{ CLAUDECODE: '1', CLAUDE_CODE_IS_COWORK: '1' }, 'claude-cowork'],
    [{ CURSOR_TRACE_ID: 't' }, 'cursor'],
    [{ CURSOR_AGENT: '1' }, 'cursor-cli'],
    [{ CURSOR_EXTENSION_HOST_ROLE: 'agent-exec' }, 'cursor-cli'],
    [{ GEMINI_CLI: '1' }, 'gemini-cli'],
    [{ CODEX_SANDBOX: 'seatbelt' }, 'codex'],
    [{ CODEX_THREAD_ID: 'x' }, 'codex'],
    [{ ANTIGRAVITY_AGENT: '1' }, 'antigravity'],
    [{ AUGMENT_AGENT: '1' }, 'augment-cli'],
    [{ OPENCODE_CLIENT: 'x' }, 'opencode'],
    [{ REPL_ID: 'x' }, 'replit'],
    [{ COPILOT_MODEL: 'x' }, 'github-copilot'],
  ])('%o is %s', (env, slug) => {
    expect(detectHostAgent(env, none)).toBe(slug)
  })

  it('finds Devin by its local path, and survives an unreadable one', () => {
    expect(detectHostAgent({}, (p) => p === '/opt/.devin')).toBe('devin')
    expect(
      detectHostAgent({}, () => {
        throw new Error('EACCES')
      }),
    ).toBeNull()
  })
})

describe('slugFromAiAgent', () => {
  it('keeps the name and drops versions and roles', () => {
    expect(slugFromAiAgent('Claude-Code_2-1-284_agent')).toBe('claude-code')
    expect(slugFromAiAgent('opencode')).toBe('opencode')
    expect(slugFromAiAgent('x'.repeat(41))).toBeNull()
  })
})
