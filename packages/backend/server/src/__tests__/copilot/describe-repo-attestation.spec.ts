import test from 'ava';

import { DescribeRepoAttestationService } from '../../plugins/copilot/describe-repo/attestation';
import type { DescribeRepoResult } from '../../plugins/copilot/describe-repo/types';

function sampleResult(
  overrides: Partial<DescribeRepoResult> = {}
): DescribeRepoResult {
  return {
    repoUrl: 'https://github.com/octocat/Hello-World.git',
    commitSha: '0123456789abcdef0123456789abcdef01234567',
    fileCount: 2,
    totalBytes: 100,
    markdown: '# Description\n\nA tiny repo.',
    files: [
      { path: 'README.md', lang: 'markdown', bytes: 50, summary: 'Readme.' },
      {
        path: 'src/index.ts',
        lang: 'typescript',
        bytes: 50,
        summary: 'Entrypoint.',
      },
    ],
    coverImageUrl: undefined,
    modelsUsed: { 'file-summary': 'gpt-5-mini', 'tree-summary': 'gpt-5' },
    ...overrides,
  };
}

const PROMPTS = [
  'Describe Repo: file summary',
  'Describe Repo: tree summary',
  'Describe Repo: mockup brief',
];

test('record returns a record with a valid signature', t => {
  const svc = new DescribeRepoAttestationService();
  const rec = svc.record('user-a', sampleResult(), PROMPTS);
  t.truthy(rec.id);
  t.truthy(rec.signature);
  t.truthy(rec.signerPubKey);
  t.is(rec.signerPubKey, svc.signerPubKeyHex);
  t.is(rec.promptHashes.length, PROMPTS.length);
  const v = svc.verify(rec.id);
  t.true(v.valid);
});

test('get returns null for unknown id', t => {
  const svc = new DescribeRepoAttestationService();
  t.is(svc.get('nope'), null);
});

test('listForUser returns newest first', t => {
  const svc = new DescribeRepoAttestationService();
  const a = svc.record(
    'user-b',
    sampleResult({ repoUrl: 'https://github.com/a/b.git' }),
    PROMPTS
  );
  const b = svc.record(
    'user-b',
    sampleResult({ repoUrl: 'https://github.com/c/d.git' }),
    PROMPTS
  );
  const list = svc.listForUser('user-b');
  t.is(list.length, 2);
  t.is(list[0].id, b.id);
  t.is(list[1].id, a.id);
});

test('listForUser respects limit', t => {
  const svc = new DescribeRepoAttestationService();
  for (let i = 0; i < 5; i++) {
    svc.record('user-c', sampleResult(), PROMPTS);
  }
  t.is(svc.listForUser('user-c', 3).length, 3);
});

test('verifyOutput detects tampered output', t => {
  const svc = new DescribeRepoAttestationService();
  const rec = svc.record('user-d', sampleResult(), PROMPTS);
  const tampered = sampleResult({ markdown: '# Tampered\n' });
  const v = svc.verifyOutput(rec.id, tampered);
  t.false(v.valid);
  t.is(v.reason, 'output_mismatch');
});

test('verifyOutput passes when output matches', t => {
  const svc = new DescribeRepoAttestationService();
  const original = sampleResult();
  const rec = svc.record('user-e', original, PROMPTS);
  // File ordering shouldn't matter — hashOutput sorts internally.
  const reordered = sampleResult({
    ...original,
    files: [...original.files].reverse(),
  });
  const v = svc.verifyOutput(rec.id, reordered);
  t.true(v.valid);
});

test('verify of unknown id returns not_found', t => {
  const svc = new DescribeRepoAttestationService();
  const v = svc.verify('never-existed');
  t.false(v.valid);
  t.is(v.reason, 'not_found');
});

test('two service instances produce different pubkeys (process-lifetime keys)', t => {
  const a = new DescribeRepoAttestationService();
  const b = new DescribeRepoAttestationService();
  t.not(a.signerPubKeyHex, b.signerPubKeyHex);
});
