export function skillsRepoFrom(input: {
  override?: string | undefined
  gitCommonDir: string | null
  repoRoot: string
}): string

export function resolveSkillsRepo(
  repoRoot: string,
  env?: Record<string, string | undefined>,
): string
