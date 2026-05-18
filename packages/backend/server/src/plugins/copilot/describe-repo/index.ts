export { GitCloneError, shallowClone } from './git';
export { CopilotDescribeRepoResolver } from './resolver';
export {
  DESCRIBE_REPO_PROMPT_NAMES,
  pickModelForSubtask,
  preferredModelsFor,
} from './router';
export { CopilotDescribeRepoService } from './service';
export type {
  DescribeRepoInput,
  DescribeRepoOptions,
  DescribeRepoResult,
  FileSummary,
  SubtaskKind,
} from './types';
export {
  ALLOWED_REPO_HOSTS,
  RepoUrlError,
  validateRepoUrl,
} from './url-validator';
export type { WalkedFile, WalkResult } from './walker';
export { detectLang, shouldSkipDir, walkRepo } from './walker';
