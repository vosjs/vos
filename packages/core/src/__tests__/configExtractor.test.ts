import { describe, expect, it } from 'vitest'
import {
  extractConfigFromFunctionCall,
  extractConfigFromText,
} from '../extract/configExtractor'

const validConfig = {
  version: 2,
  duration: 5,
  camera: { preset: 'perspective' },
  createContent: '(ctx) => { return {}; }',
  createTimeline: '(ctx, content, duration) => { return ctx.gsap.timeline(); }',
}

describe('extractConfigFromFunctionCall', () => {
  it('extracts config from valid function call args', () => {
    const result = extractConfigFromFunctionCall({
      config: validConfig,
      title: 'My Animation',
      description: 'A test animation',
    })
    expect(result).not.toBeNull()
    expect(result!.config).toEqual(validConfig)
    expect(result!.title).toBe('My Animation')
    expect(result!.description).toBe('A test animation')
  })

  it('returns null when config is missing', () => {
    expect(extractConfigFromFunctionCall({})).toBeNull()
  })

  it('returns null when createContent is missing', () => {
    const result = extractConfigFromFunctionCall({
      config: { ...validConfig, createContent: undefined },
    })
    expect(result).toBeNull()
  })

  it('returns null when createTimeline is missing', () => {
    const result = extractConfigFromFunctionCall({
      config: { ...validConfig, createTimeline: undefined },
    })
    expect(result).toBeNull()
  })

  it('refuses a v1 config out loud', () => {
    // A structured caller handed us a config object, so an unsupported schema
    // era is worth a reason. `null` here would read as "no config found".
    const v1Config = {
      version: 1,
      duration: 5,
      repeat: -1,
      camera: { preset: 'perspective' },
      createContent: '(ctx) => { return {}; }',
      createTimeline:
        '(ctx, content, duration) => { return ctx.gsap.timeline(); }',
    }
    expect(() =>
      extractConfigFromFunctionCall({ config: v1Config, title: 'V1 Test' }),
    ).toThrow(/No migration from config version 1/)
  })
})

describe('extractConfigFromText', () => {
  it('extracts config from JSON code block', () => {
    const text = `Here is the animation:
\`\`\`json
${JSON.stringify(validConfig, null, 2)}
\`\`\`
`
    const result = extractConfigFromText(text)
    expect(result).not.toBeNull()
    expect(result!.config.createContent).toBe(validConfig.createContent)
  })

  it('extracts wrapped config with title', () => {
    const wrapped = {
      config: validConfig,
      title: 'Wrapped Title',
      description: 'Wrapped Desc',
    }
    const text = `\`\`\`json
${JSON.stringify(wrapped, null, 2)}
\`\`\``
    const result = extractConfigFromText(text)
    expect(result).not.toBeNull()
    expect(result!.title).toBe('Wrapped Title')
    expect(result!.description).toBe('Wrapped Desc')
  })

  it('returns null for text with no code blocks', () => {
    expect(extractConfigFromText('Just some text')).toBeNull()
  })

  it('returns null for code blocks with invalid JSON', () => {
    const text = '```json\nnot valid json\n```'
    expect(extractConfigFromText(text)).toBeNull()
  })

  it('skips non-config code blocks and finds the right one', () => {
    const text = `\`\`\`json
{"foo": "bar"}
\`\`\`

\`\`\`json
${JSON.stringify(validConfig, null, 2)}
\`\`\``
    const result = extractConfigFromText(text)
    expect(result).not.toBeNull()
    expect(result!.config.duration).toBe(5)
  })

  it('skips a v1 config rather than throwing at a text scan', () => {
    // Scanning prose is best-effort: an unreadable block is "no config here",
    // and the next block still gets its chance.
    const v1Config = {
      version: 1,
      duration: 5,
      repeat: -1,
      camera: { preset: 'perspective' },
      createContent: '(ctx) => { return {}; }',
      createTimeline:
        '(ctx, content, duration) => { return ctx.gsap.timeline(); }',
    }
    const text = `\`\`\`json
${JSON.stringify(v1Config, null, 2)}
\`\`\``
    expect(extractConfigFromText(text)).toBeNull()
  })
})
