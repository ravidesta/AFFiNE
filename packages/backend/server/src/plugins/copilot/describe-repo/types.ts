import { z } from 'zod';

export const DescribeRepoOptionsSchema = z
  .object({
    includeCoverMockup: z.boolean().optional(),
    branch: z.string().trim().min(1).max(200).optional(),
    modelOverride: z.string().trim().min(1).max(200).optional(),
  })
  .strict();

export type DescribeRepoOptions = z.infer<typeof DescribeRepoOptionsSchema>;

export const DescribeRepoInputSchema = z
  .object({
    repoUrl: z.string().url(),
    options: DescribeRepoOptionsSchema.optional(),
  })
  .strict();

export type DescribeRepoInput = z.infer<typeof DescribeRepoInputSchema>;

export type SubtaskKind =
  | 'file-summary'
  | 'tree-summary'
  | 'mockup-brief'
  | 'cover-image';

export interface FileSummary {
  path: string;
  lang: string;
  bytes: number;
  summary: string;
}

export interface DescribeRepoResult {
  repoUrl: string;
  commitSha: string | null;
  fileCount: number;
  totalBytes: number;
  markdown: string;
  files: FileSummary[];
  coverImageUrl?: string;
  modelsUsed: Partial<Record<SubtaskKind, string>>;
}

export const SHALLOW_CLONE_SIZE_CAP_BYTES = 200 * 1024 * 1024;
export const PER_FILE_SIZE_CAP_BYTES = 256 * 1024;
export const TOTAL_SNIPPET_BUDGET_BYTES = 1_500_000;
export const CLONE_TIMEOUT_MS = 60_000;
export const MAX_FILES_PROCESSED = 200;
export const PER_FILE_CONCURRENCY = 4;
