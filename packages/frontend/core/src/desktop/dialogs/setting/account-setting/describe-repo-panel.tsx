import { Button, Input, notify } from '@affine/component';
import { SettingRow } from '@affine/component/setting-components';
import { useAsyncCallback } from '@affine/core/components/hooks/affine-async-hooks';
import { GraphQLService } from '@affine/core/modules/cloud';
import type { GraphQLQuery } from '@affine/graphql';
import { useService } from '@toeverything/infra';
import { type FormEvent, useState } from 'react';

import * as styles from './describe-repo-panel.css';

// Inlined until codegen picks up `copilot-describe-repo.gql` from the backend
// schema regeneration. Keeps this PR independent of a backend dev-run.
const describeRepoMutation: GraphQLQuery = {
  id: 'describeRepoMutation',
  op: 'describeRepo',
  query: `mutation describeRepo($input: DescribeRepoInputType!) {
  describeRepo(input: $input) {
    repoUrl
    commitSha
    fileCount
    totalBytes
    markdown
    coverImageUrl
    modelsUsed
    files { path lang bytes summary }
  }
}`,
};

interface DescribeRepoFile {
  path: string;
  lang: string;
  bytes: number;
  summary: string;
}

interface DescribeRepoResultData {
  describeRepo: {
    repoUrl: string;
    commitSha: string | null;
    fileCount: number;
    totalBytes: number;
    markdown: string;
    coverImageUrl: string | null;
    modelsUsed: Record<string, string>;
    files: DescribeRepoFile[];
  };
}

type RunState =
  | { kind: 'idle' }
  | { kind: 'running' }
  | { kind: 'done'; result: DescribeRepoResultData['describeRepo'] }
  | { kind: 'error'; message: string };

export const DescribeRepoPanel = () => {
  const gqlService = useService(GraphQLService);
  const [repoUrl, setRepoUrl] = useState('');
  const [includeMockup, setIncludeMockup] = useState(true);
  const [state, setState] = useState<RunState>({ kind: 'idle' });

  const onSubmit = useAsyncCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!repoUrl.trim()) return;
      setState({ kind: 'running' });
      try {
        const data = (await gqlService.gql({
          query: describeRepoMutation,
          variables: {
            input: {
              repoUrl: repoUrl.trim(),
              options: { includeCoverMockup: includeMockup },
            },
          },
        })) as DescribeRepoResultData;
        setState({ kind: 'done', result: data.describeRepo });
      } catch (err: any) {
        setState({
          kind: 'error',
          message: err?.message ?? 'Unknown error',
        });
      }
    },
    [gqlService, repoUrl, includeMockup]
  );

  const onCopy = useAsyncCallback(async () => {
    if (state.kind !== 'done') return;
    try {
      await navigator.clipboard.writeText(state.result.markdown);
      notify.success({ title: 'Copied description to clipboard' });
    } catch (err: any) {
      notify.error({
        title: 'Copy failed',
        message: err?.message ?? 'Clipboard unavailable',
      });
    }
  }, [state]);

  return (
    <SettingRow
      name="Describe a repository"
      desc="Paste a public Git URL — AFFiNE clones a shallow snapshot, delegates summarization across configured AI providers, and produces a structured description plus a cover mockup."
    >
      <form onSubmit={onSubmit} className={styles.form}>
        <Input
          type="url"
          value={repoUrl}
          onChange={setRepoUrl}
          placeholder="https://github.com/owner/repo"
          disabled={state.kind === 'running'}
          required
        />
        <label className={styles.checkboxRow}>
          <input
            type="checkbox"
            checked={includeMockup}
            onChange={e => setIncludeMockup(e.target.checked)}
            disabled={state.kind === 'running'}
          />
          Generate cover mockup
        </label>
        <Button
          type="primary"
          loading={state.kind === 'running'}
          disabled={!repoUrl.trim() || state.kind === 'running'}
        >
          {state.kind === 'running' ? 'Describing…' : 'Describe'}
        </Button>
        {state.kind === 'error' && (
          <p className={styles.error}>{state.message}</p>
        )}
        {state.kind === 'done' && (
          <div className={styles.resultBox}>
            <div className={styles.resultHeader}>
              <span>
                {state.result.fileCount} files ·{' '}
                {formatBytes(state.result.totalBytes)} ·{' '}
                {state.result.commitSha?.slice(0, 7) ?? 'unknown commit'}
              </span>
              <Button onClick={onCopy} type="default">
                Copy markdown
              </Button>
            </div>
            {state.result.coverImageUrl && (
              <img
                src={state.result.coverImageUrl}
                alt="Generated cover mockup"
                className={styles.cover}
              />
            )}
            <pre className={styles.markdown}>{state.result.markdown}</pre>
            <details className={styles.metaDetails}>
              <summary>Models used / per-file summaries</summary>
              <pre className={styles.metaPre}>
                {JSON.stringify(state.result.modelsUsed, null, 2)}
              </pre>
              <ul>
                {state.result.files.map(f => (
                  <li key={f.path}>
                    <code>{f.path}</code> ({f.lang}, {formatBytes(f.bytes)}):{' '}
                    {f.summary}
                  </li>
                ))}
              </ul>
            </details>
          </div>
        )}
      </form>
    </SettingRow>
  );
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
