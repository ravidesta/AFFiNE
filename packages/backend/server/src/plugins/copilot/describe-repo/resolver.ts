import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  Args,
  Field,
  ID,
  InputType,
  Int,
  Mutation,
  ObjectType,
  Query,
  Resolver,
} from '@nestjs/graphql';
import { GraphQLJSON } from 'graphql-scalars';

import { CallMetric, Throttle } from '../../../base';
import { CurrentUser } from '../../../core/auth';
import { CopilotType } from '../resolver';
import {
  type AttestationRecord,
  DescribeRepoAttestationService,
} from './attestation';
import { GitCloneError } from './git';
import { DescribeRepoQuotaService } from './quota';
import { DESCRIBE_REPO_PROMPT_NAMES } from './router';
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

  @Field(() => ID, {
    description:
      'Identifier of the signed attestation record produced for this run.',
  })
  attestationId!: string;
}

@ObjectType('DescribeRepoAttestation')
class DescribeRepoAttestationType implements AttestationRecord {
  @Field(() => ID)
  id!: string;

  @Field(() => ID)
  userId!: string;

  @Field(() => String)
  repoUrl!: string;

  @Field(() => String, { nullable: true })
  commitSha!: string | null;

  @Field(() => GraphQLJSON)
  modelIds!: Record<string, string>;

  @Field(() => [String])
  promptHashes!: string[];

  @Field(() => String)
  outputHash!: string;

  @Field(() => String)
  signature!: string;

  @Field(() => String)
  signerPubKey!: string;

  @Field(() => String)
  signedAt!: string;

  @Field(() => Boolean, {
    description:
      'True if the signature verifies against the recorded outputHash + pubkey.',
  })
  signatureValid!: boolean;
}

@Injectable()
@Throttle()
@Resolver(() => CopilotType)
export class CopilotDescribeRepoResolver {
  private readonly logger = new Logger(CopilotDescribeRepoResolver.name);

  constructor(
    private readonly service: CopilotDescribeRepoService,
    private readonly quota: DescribeRepoQuotaService,
    private readonly attestation: DescribeRepoAttestationService
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
  ): Promise<DescribeRepoResult & { attestationId: string }> {
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
    let result: DescribeRepoResult;
    try {
      result = await this.service.describeRepo(parsed);
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
    const record = this.attestation.record(
      user.id,
      result,
      Object.values(DESCRIBE_REPO_PROMPT_NAMES)
    );
    return { ...result, attestationId: record.id };
  }

  @Query(() => DescribeRepoAttestationType, {
    description:
      'Look up a describeRepo attestation by id; signatureValid reflects an in-process re-verification.',
  })
  async describeRepoAttestation(
    @CurrentUser() _user: CurrentUser,
    @Args('id', { type: () => ID }) id: string
  ): Promise<DescribeRepoAttestationType> {
    const record = this.attestation.get(id);
    if (!record) {
      throw new NotFoundException(`attestation ${id} not found`);
    }
    const verification = this.attestation.verify(id);
    return { ...record, signatureValid: verification.valid };
  }
}
