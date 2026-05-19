import { Injectable, Logger } from '@nestjs/common';

import {
  CopilotPromptNotFound,
  NoCopilotProviderAvailable,
} from '../../../base';
import { PromptService } from '../prompt';
import type { ChatPrompt } from '../prompt/chat-prompt';
import type { CopilotProvider } from '../providers';
import { CopilotProviderFactory } from '../providers/factory';
import { ModelOutputType } from '../providers/types';
import { shallowClone } from './git';
import { DESCRIBE_REPO_PROMPT_NAMES, pickModelForSubtask } from './router';
import type {
  DescribeRepoInput,
  DescribeRepoResult,
  FileSummary,
} from './types';
import { PER_FILE_CONCURRENCY } from './types';
import { type WalkedFile, walkRepo } from './walker';

interface RunOptions {
  signal?: AbortSignal;
}

@Injectable()
export class CopilotDescribeRepoService {
  private readonly logger = new Logger(CopilotDescribeRepoService.name);

  constructor(
    private readonly prompt: PromptService,
    private readonly providerFactory: CopilotProviderFactory
  ) {}

  async describeRepo(
    input: DescribeRepoInput,
    options: RunOptions = {}
  ): Promise<DescribeRepoResult> {
    const { repoUrl } = input;
    // Mockup generation is on by default: the user always wants a visual asset
    // accompanying the description. Disable explicitly with includeCoverMockup: false.
    const wantCover = input.options?.includeCoverMockup ?? true;
    const modelOverride = input.options?.modelOverride;
    const modelsUsed: DescribeRepoResult['modelsUsed'] = {};

    const clone = await shallowClone(repoUrl);
    try {
      const walk = await walkRepo(clone.dir);

      const { summaries: fileSummaries, failedCount } =
        await this.summarizeFiles(
          walk.files,
          modelOverride,
          modelsUsed,
          options.signal
        );

      const treeMarkdown = await this.summarizeTree(
        repoUrl,
        clone.commitSha,
        fileSummaries,
        walk.files,
        walk.truncated,
        modelOverride,
        modelsUsed,
        options.signal
      );

      let coverImageUrl: string | undefined;
      if (wantCover) {
        coverImageUrl = await this.generateCover(
          treeMarkdown,
          modelsUsed,
          options.signal
        ).catch(err => {
          this.logger.warn(`cover generation failed: ${err?.message ?? err}`);
          return undefined;
        });
      }

      return {
        repoUrl,
        commitSha: clone.commitSha,
        fileCount: walk.files.length,
        totalBytes: walk.totalBytes,
        markdown: treeMarkdown,
        files: fileSummaries,
        coverImageUrl,
        modelsUsed,
        failedFileCount: failedCount,
      };
    } finally {
      await clone.cleanup();
    }
  }

  private async loadPrompt(name: string): Promise<ChatPrompt> {
    const prompt = await this.prompt.get(name);
    if (!prompt) throw new CopilotPromptNotFound({ name });
    return prompt;
  }

  private async getTextProvider(modelId: string): Promise<CopilotProvider> {
    const provider = await this.providerFactory.getProvider({
      outputType: ModelOutputType.Text,
      modelId,
    });
    if (!provider) throw new NoCopilotProviderAvailable({ modelId });
    return provider;
  }

  private async summarizeFiles(
    files: WalkedFile[],
    override: string | undefined,
    modelsUsed: DescribeRepoResult['modelsUsed'],
    signal?: AbortSignal
  ): Promise<{ summaries: FileSummary[]; failedCount: number }> {
    if (files.length === 0) return { summaries: [], failedCount: 0 };
    const prompt = await this.loadPrompt(
      DESCRIBE_REPO_PROMPT_NAMES['file-summary']
    );
    const modelId = pickModelForSubtask(
      'file-summary',
      [prompt.model, ...prompt.optionalModels],
      override
    );
    modelsUsed['file-summary'] = modelId;
    const provider = await this.getTextProvider(modelId);

    const out: (FileSummary | undefined)[] = Array.from({
      length: files.length,
    });
    let next = 0;
    let failedCount = 0;

    const worker = async () => {
      while (true) {
        if (signal?.aborted) return;
        const idx = next++;
        if (idx >= files.length) return;
        const f = files[idx];
        const userContent = `Path: ${f.relPath}\nLanguage: ${f.lang}\nBytes: ${f.bytes}\n\n\`\`\`${f.lang}\n${f.snippet}\n\`\`\``;
        let summary = '';
        let failed = false;
        try {
          summary = await provider.text(
            { modelId },
            [...prompt.finish({}), { role: 'user', content: userContent }],
            { signal, ...prompt.config }
          );
        } catch (err: any) {
          this.logger.warn(
            `file-summary failed for ${f.relPath}: ${err?.message ?? err}`
          );
          failed = true;
        }
        if (failed) failedCount++;
        out[idx] = {
          path: f.relPath,
          lang: f.lang,
          bytes: f.bytes,
          summary: summary.trim(),
        };
      }
    };

    await Promise.all(
      Array.from(
        { length: Math.min(PER_FILE_CONCURRENCY, files.length) },
        worker
      )
    );

    return {
      summaries: out.filter((s): s is FileSummary => !!s),
      failedCount,
    };
  }

  private async summarizeTree(
    repoUrl: string,
    commitSha: string,
    summaries: FileSummary[],
    files: WalkedFile[],
    truncated: boolean,
    override: string | undefined,
    modelsUsed: DescribeRepoResult['modelsUsed'],
    signal?: AbortSignal
  ): Promise<string> {
    const prompt = await this.loadPrompt(
      DESCRIBE_REPO_PROMPT_NAMES['tree-summary']
    );
    const modelId = pickModelForSubtask(
      'tree-summary',
      [prompt.model, ...prompt.optionalModels],
      override
    );
    modelsUsed['tree-summary'] = modelId;
    const provider = await this.getTextProvider(modelId);

    const manifests = files
      .filter(f => f.isManifest)
      .map(f => `### ${f.relPath}\n\`\`\`\n${f.snippet.slice(0, 4000)}\n\`\`\``)
      .join('\n\n');

    const perFile = summaries
      .map(s => `- \`${s.path}\` (${s.lang}, ${s.bytes}B): ${s.summary}`)
      .join('\n');

    const userContent = `Repository: ${repoUrl}\nCommit: ${commitSha}\nFiles processed: ${files.length}${truncated ? ' (truncated)' : ''}\n\n## Manifests\n${manifests || '(none found)'}\n\n## Per-file summaries\n${perFile || '(none)'}`;

    const out = await provider.text(
      { modelId },
      [...prompt.finish({}), { role: 'user', content: userContent }],
      { signal, ...prompt.config }
    );

    return out.trim();
  }

  private async generateCover(
    treeMarkdown: string,
    modelsUsed: DescribeRepoResult['modelsUsed'],
    signal?: AbortSignal
  ): Promise<string | undefined> {
    const briefPrompt = await this.prompt.get(
      DESCRIBE_REPO_PROMPT_NAMES['mockup-brief']
    );
    if (!briefPrompt) return undefined;
    const briefModelId = pickModelForSubtask('mockup-brief', [
      briefPrompt.model,
      ...briefPrompt.optionalModels,
    ]);
    modelsUsed['mockup-brief'] = briefModelId;
    const briefProvider = await this.getTextProvider(briefModelId);
    const brief = await briefProvider.text(
      { modelId: briefModelId },
      [
        ...briefPrompt.finish({}),
        { role: 'user', content: treeMarkdown.slice(0, 8000) },
      ],
      { signal, ...briefPrompt.config }
    );

    const imageProvider = await this.providerFactory.getProvider({
      outputType: ModelOutputType.Image,
    });
    if (!imageProvider) return undefined;
    modelsUsed['cover-image'] = imageProvider.type;

    const stream = imageProvider.streamImages(
      {},
      [{ role: 'user', content: brief.trim() }],
      { signal }
    );
    for await (const attachment of stream) {
      if (typeof attachment === 'string') return attachment;
    }
    return undefined;
  }
}
