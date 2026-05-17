import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CLONE_TIMEOUT_MS, SHALLOW_CLONE_SIZE_CAP_BYTES } from './types';
import { validateRepoUrl } from './url-validator';

export class GitCloneError extends Error {
  constructor(
    public readonly reason:
      | 'spawn_failed'
      | 'timeout'
      | 'non_zero_exit'
      | 'too_large'
      | 'no_commit',
    message: string
  ) {
    super(message);
    this.name = 'GitCloneError';
  }
}

export interface CloneResult {
  dir: string;
  commitSha: string;
  cleanup: () => Promise<void>;
}

async function dirSize(dir: string): Promise<number> {
  let total = 0;
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop() as string;
    let entries;
    try {
      entries = await fs.readdir(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const p = join(cur, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.isFile()) {
        try {
          const s = await fs.stat(p);
          total += s.size;
          if (total > SHALLOW_CLONE_SIZE_CAP_BYTES) return total;
        } catch {
          /* ignore */
        }
      }
    }
  }
  return total;
}

function runGit(
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new GitCloneError('timeout', `git ${args[0]} timed out`));
    }, CLONE_TIMEOUT_MS);

    child.stdout.on('data', d => {
      stdout += d.toString();
    });
    child.stderr.on('data', d => {
      stderr += d.toString();
    });
    child.on('error', err => {
      clearTimeout(timer);
      reject(new GitCloneError('spawn_failed', err.message));
    });
    child.on('close', code => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout.trim());
      else
        reject(
          new GitCloneError(
            'non_zero_exit',
            `git ${args[0]} exited with ${code}: ${stderr.trim().slice(0, 500)}`
          )
        );
    });
  });
}

export async function shallowClone(repoUrl: string): Promise<CloneResult> {
  const { normalized } = validateRepoUrl(repoUrl);

  const workRoot = await fs.mkdtemp(join(tmpdir(), 'affine-describe-repo-'));
  const targetDir = join(workRoot, 'repo');

  const cleanup = async () => {
    await fs.rm(workRoot, { recursive: true, force: true }).catch(() => {});
  };

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    GIT_TERMINAL_PROMPT: '0',
    GIT_ASKPASS: 'echo',
    GIT_LFS_SKIP_SMUDGE: '1',
    GCM_INTERACTIVE: 'never',
  };

  try {
    await runGit(
      [
        'clone',
        '--depth=1',
        '--single-branch',
        '--no-tags',
        '--filter=blob:limit=512k',
        normalized,
        targetDir,
      ],
      workRoot,
      env
    );

    const size = await dirSize(targetDir);
    if (size > SHALLOW_CLONE_SIZE_CAP_BYTES) {
      await cleanup();
      throw new GitCloneError(
        'too_large',
        `Repository exceeds ${SHALLOW_CLONE_SIZE_CAP_BYTES} bytes (got ${size})`
      );
    }

    const commitSha = await runGit(['rev-parse', 'HEAD'], targetDir, env);
    if (!/^[0-9a-f]{40}$/i.test(commitSha)) {
      await cleanup();
      throw new GitCloneError(
        'no_commit',
        `Unexpected HEAD value: ${commitSha}`
      );
    }

    return { dir: targetDir, commitSha, cleanup };
  } catch (err) {
    await cleanup();
    throw err;
  }
}
