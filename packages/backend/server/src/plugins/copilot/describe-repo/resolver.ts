import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import {
  Args,
  Field,
  InputType,
  Int,
  Mutation,
  ObjectType,
  Resolver,
} from '@nestjs/graphql';
import { GraphQLJSON } from 'graphql-scalars';

import { CallMetric, Throttle } from '../../../base';
import { CurrentUser } from '../../../core/auth';
import { CopilotType } from '../resolver';
import { GitCloneError } from './git';
import { DescribeRepoQuotaService } from './quota';
import { CopilotDescribeRepoService } from './service';
import type { DescribeRepoResult, FileSummary } from './types';
import { DescribeRepoInputSchema } from './types';
import { RepoUrlError } from './url-validator';

@InputType()
class DescribeRepoOptionsInput {
  @Field(() => Boolean, { nullable: true })
  includeCoverMockup?: boolean;

  @Field(() => String, { nullable: true })
  branch?: string;

  @Field(() => String, { nullable: true })
  modelOverride?: string;
}

@InputType()
class DescribeRepoInputType {
  @Field(() => String)
  repoUrl!: string;

  @Field(() => DescribeRepoOptionsInput, { nullable: true })
  options?: DescribeRepoOptionsInput;
}

@ObjectType('DescribeRepoFile')
class DescribeRepoFileType implements FileSummary {
  @Field(() => String)
  path!: string;

  @Field(() => String)
  lang!: string;

  @Field(() => Int)
  bytes!: number;

  @Field(() => String)
  summary!: string;
}

@ObjectType('DescribeRepoResult')
class DescribeRepoResultType {
  @Field(() => String)
  repoUrl!: string;

  @Field(() => String, { nullable: true })
  commitSha!: string | null;

  @Field(() => Int)
  fileCount!: number;

  @Field(() => Int)
  totalBytes!: number;

  @Field(() => String)
  markdown!: string;

  @Field(() => [DescribeRepoFileType])
  files!: DescribeRepoFileType[];

  @Field(() => String, { nullable: true })
  coverImageUrl?: string;

  @Field(() => GraphQLJSON)
  modelsUsed!: Record<string, string>;
}

@Injectable()
@Throttle()
@Resolver(() => CopilotType)
export class CopilotDescribeRepoResolver {
  private readonly logger = new Logger(CopilotDescribeRepoResolver.name);

  constructor(
    private readonly service: CopilotDescribeRepoService,
    private readonly quota: DescribeRepoQuotaService
  ) {}

  @Mutation(() => DescribeRepoResultType, {
    description:
      'Describe a public Git repository by cloning a shallow snapshot and routing summaries through the configured Copilot providers.',
  })
  @CallMetric('ai', 'describe_repo')
  async describeRepo(
    @CurrentUser() user: CurrentUser,
    @Args('input', { type: () => DescribeRepoInputType })
    input: DescribeRepoInputType
  ): Promise<DescribeRepoResult> {
    let parsed;
    try {
      parsed = DescribeRepoInputSchema.parse(input);
    } catch (err: any) {
      throw new BadRequestException(err?.message ?? 'invalid input');
    }
    const quota = await this.quota.checkAndRecord(user.id);
    if (!quota.allowed) {
      throw new ForbiddenException(
        `describeRepo monthly cap reached (${quota.runsUsed}/${quota.runsAllowed} on tier "${quota.tier.label}")`
      );
    }
    try {
      return await this.service.describeRepo(parsed);
    } catch (err) {
      if (err instanceof RepoUrlError) {
        throw new BadRequestException(err.message);
      }
      if (err instanceof GitCloneError) {
        this.logger.warn(`describeRepo clone failed: ${err.message}`);
        throw new InternalServerErrorException(
          `Failed to clone repository (${err.reason})`
        );
      }
      throw err;
    }
  }
}
