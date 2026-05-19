import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import test from 'ava';

import {
  DESCRIBE_REPO_PROMPT_NAMES,
  pickModelForSubtask,
  preferredModelsFor,
} from '../../plugins/copilot/describe-repo/router';
import {
  ALLOWED_REPO_HOSTS,
  RepoUrlError,
  validateRepoUrl,
} from '../../plugins/copilot/describe-repo/url-validator';
import {
  detectLang,
  shouldSkipDir,
  walkRepo,
} from '../../plugins/copilot/describe-repo/walker';

// ---------- url-validator ----------

test('validateRepoUrl accepts known hosts and normalizes to .git', t => {
  const r = validateRepoUrl('https://github.com/octocat/Hello-World');
  t.is(r.host, 'github.com');
  t.is(r.normalized, 'https://github.com/octocat/Hello-World.git');
});

test('validateRepoUrl preserves trailing .git', t => {
  const r = validateRepoUrl('https://gitlab.com/group/proj.git');
  t.is(r.normalized, 'https://gitlab.com/group/proj.git');
});

test('validateRepoUrl rejects http://', t => {
  const err = t.throws(() =>
    validateRepoUrl('http://github.com/octocat/Hello-World')
  ) as RepoUrlError;
  t.is(err.reason, 'unsupported_protocol');
});

test('validateRepoUrl rejects credentials in url', t => {
  const err = t.throws(() =>
    validateRepoUrl('https://user:pw@github.com/o/r')
  ) as RepoUrlError;
  t.is(err.reason, 'unsupported_protocol');
});

test('validateRepoUrl rejects hosts not in allow-list (SSRF guard)', t => {
  const err = t.throws(() =>
    validateRepoUrl('https://169.254.169.254/aws/metadata')
  ) as RepoUrlError;
  t.is(err.reason, 'host_not_allowed');
});

test('validateRepoUrl rejects malformed paths', t => {
  const err = t.throws(() =>
    validateRepoUrl('https://github.com/just-one-segment')
  ) as RepoUrlError;
  t.is(err.reason, 'malformed_path');
});

test('validateRepoUrl rejects garbage input', t => {
  const err = t.throws(() =>
    validateRepoUrl('not a url at all')
  ) as RepoUrlError;
  t.is(err.reason, 'invalid_url');
});

test('ALLOWED_REPO_HOSTS contains the common forges', t => {
  for (const h of ['github.com', 'gitlab.com', 'codeberg.org']) {
    t.true(ALLOWED_REPO_HOSTS.has(h));
  }
});

// ---------- walker helpers ----------

test('detectLang maps common extensions', t => {
  t.is(detectLang('src/foo.ts'), 'typescript');
  t.is(detectLang('src/foo.tsx'), 'tsx');
  t.is(detectLang('app/main.py'), 'python');
  t.is(detectLang('cmd/x/main.go'), 'go');
  t.is(detectLang('README.md'), 'markdown');
  t.is(detectLang('package.json'), 'config');
  t.is(detectLang('LICENSE'), 'text');
  t.is(detectLang('image.png'), null);
  t.is(detectLang('unknown.xyz'), null);
});

test('shouldSkipDir skips vendored / hidden trees', t => {
  t.true(shouldSkipDir('node_modules'));
  t.true(shouldSkipDir('.git'));
  t.true(shouldSkipDir('dist'));
  t.true(shouldSkipDir('.venv'));
  t.false(shouldSkipDir('src'));
  t.false(shouldSkipDir('packages'));
});

test('walkRepo collects code files, skips vendored dirs, and surfaces manifests first', async t => {
  const root = await fs.mkdtemp(join(tmpdir(), 'walker-test-'));
  try {
    await fs.writeFile(join(root, 'package.json'), '{"name":"x"}');
    await fs.writeFile(join(root, 'README.md'), '# hi');
    await fs.mkdir(join(root, 'src'));
    await fs.writeFile(join(root, 'src', 'index.ts'), 'export const x = 1;\n');
    await fs.mkdir(join(root, 'node_modules'));
    await fs.writeFile(
      join(root, 'node_modules', 'should-be-skipped.ts'),
      'export const skipped = true;\n'
    );
    await fs.writeFile(join(root, 'image.png'), Buffer.from([1, 2, 3]));

    const result = await walkRepo(root);
    const paths = result.files.map(f => f.relPath).sort();
    t.deepEqual(paths.sort(), ['README.md', 'package.json', 'src/index.ts']);
    // manifests sort first
    t.true(result.files[0].isManifest);
    t.false(result.truncated);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

// ---------- router ----------

test('preferredModelsFor returns non-empty lists per subtask', t => {
  for (const s of [
    'file-summary',
    'tree-summary',
    'mockup-brief',
    'cover-image',
  ] as const) {
    t.true(preferredModelsFor(s).length > 0);
  }
});

test('pickModelForSubtask honors override when present in optionalModels', t => {
  const chosen = pickModelForSubtask(
    'file-summary',
    ['gpt-5-mini', 'gemini-2.5-flash'],
    'gemini-2.5-flash'
  );
  t.is(chosen, 'gemini-2.5-flash');
});

test('pickModelForSubtask ignores override not in optionalModels', t => {
  const chosen = pickModelForSubtask(
    'file-summary',
    ['gpt-5-mini'],
    'some-other-model'
  );
  t.is(chosen, 'gpt-5-mini');
});

test('pickModelForSubtask falls back to first preferred model present', t => {
  const chosen = pickModelForSubtask('tree-summary', [
    'gemini-2.5-pro',
    'claude-sonnet-4-5@20250929',
  ]);
  // claude-sonnet appears first in preferred list
  t.is(chosen, 'claude-sonnet-4-5@20250929');
});

test('pickModelForSubtask returns first available when no preferred match', t => {
  const chosen = pickModelForSubtask('tree-summary', ['some-exotic-model']);
  t.is(chosen, 'some-exotic-model');
});

test('DESCRIBE_REPO_PROMPT_NAMES covers all text subtasks', t => {
  t.is(typeof DESCRIBE_REPO_PROMPT_NAMES['file-summary'], 'string');
  t.is(typeof DESCRIBE_REPO_PROMPT_NAMES['tree-summary'], 'string');
  t.is(typeof DESCRIBE_REPO_PROMPT_NAMES['mockup-brief'], 'string');
});
