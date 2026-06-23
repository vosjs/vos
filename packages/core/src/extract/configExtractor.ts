import { migrateConfig } from '../schema/migrations'
import type { VosConfigJson } from '../types'

export interface ExtractedConfig {
  config: VosConfigJson
  title?: string
  description?: string
}

/**
 * Extract VosConfigJson from a Gemini function call response.
 */
export function extractConfigFromFunctionCall(
  args: Record<string, unknown>,
): ExtractedConfig | null {
  const raw = args.config as VosConfigJson | undefined
  if (!raw || !raw.createContent || !raw.createTimeline) {
    return null
  }
  const config = migrateConfig(
    raw as unknown as Record<string, unknown>,
  ) as unknown as VosConfigJson
  return {
    config,
    title: args.title as string | undefined,
    description: args.description as string | undefined,
  }
}

/**
 * Fallback: extract VosConfigJson from text (markdown code blocks).
 */
export function extractConfigFromText(text: string): ExtractedConfig | null {
  // Try JSON code blocks first
  const codeBlockRegex = /```(?:json)?\s*\n([\s\S]*?)\n```/g
  let match

  while ((match = codeBlockRegex.exec(text)) !== null) {
    try {
      const parsed = JSON.parse(match[1])
      // Direct VosConfigJson
      if (parsed.createContent && parsed.createTimeline) {
        const config = migrateConfig(parsed) as unknown as VosConfigJson
        return { config }
      }
      // Wrapped: { config: {...}, title: "..." }
      if (parsed.config?.createContent && parsed.config?.createTimeline) {
        const config = migrateConfig(parsed.config) as unknown as VosConfigJson
        return {
          config,
          title: parsed.title,
          description: parsed.description,
        }
      }
    } catch {
      // Try next code block
    }
  }

  return null
}
