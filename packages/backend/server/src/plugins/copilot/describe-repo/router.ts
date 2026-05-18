import type { SubtaskKind } from './types';

export const DESCRIBE_REPO_PROMPT_NAMES: Record<SubtaskKind, string> = {
  'file-summary': 'Describe Repo: file summary',
  'tree-summary': 'Describe Repo: tree summary',
  'mockup-brief': 'Describe Repo: mockup brief',
  'cover-image': 'Generate image',
};

const FALLBACK_TEXT_MODELS: Record<SubtaskKind, string[]> = {
  'file-summary': ['gpt-5-mini', 'gemini-2.5-flash', 'claude-haiku-4-5'],
  'tree-summary': ['claude-sonnet-4-5@20250929', 'gpt-5', 'gemini-2.5-pro'],
  'mockup-brief': ['gpt-5-mini', 'gemini-2.5-flash'],
  'cover-image': ['fal-imagen', 'gpt-image-1'],
};

export function preferredModelsFor(subtask: SubtaskKind): string[] {
  return FALLBACK_TEXT_MODELS[subtask];
}

export function pickModelForSubtask(
  subtask: SubtaskKind,
  optionalModels: string[] | null | undefined,
  override?: string
): string {
  const choices = optionalModels ?? [];
  if (override && choices.includes(override)) return override;
  for (const candidate of preferredModelsFor(subtask)) {
    if (choices.includes(candidate)) return candidate;
  }
  return choices[0] ?? preferredModelsFor(subtask)[0];
}
