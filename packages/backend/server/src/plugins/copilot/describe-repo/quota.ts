import { Injectable, Logger } from '@nestjs/common';

import { getTier, type TierEntry } from '../../payment/tier-catalog';

export interface QuotaCheckAllowed {
  allowed: true;
  tier: TierEntry;
  runsUsed: number;
  /** `null` = unlimited (enterprise). */
  runsAllowed: number | null;
}

export interface QuotaCheckDenied {
  allowed: false;
  tier: TierEntry;
  runsUsed: number;
  runsAllowed: number;
  reason: 'monthly_cap_reached';
}

export type QuotaCheckResult = QuotaCheckAllowed | QuotaCheckDenied;

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Enforces the per-tier `runsPerMonth` cap on describeRepo calls.
 *
 * Run counts are tracked in-memory for this Phase-2-anchor commit. A
 * follow-up will persist runs (e.g. an `AiJobType.describeRepo` row in the
 * existing `copilotJob` table) so the cap survives process restarts.
 *
 * Tier resolution is also a stub: every user currently maps to the `free`
 * tier. Once the payment plugin exposes a clean `getUserPlan(userId)` we
 * swap that in here.
 */
@Injectable()
export class DescribeRepoQuotaService {
  private readonly logger = new Logger(DescribeRepoQuotaService.name);
  private readonly recentRuns = new Map<string, number[]>();

  async checkAndRecord(userId: string): Promise<QuotaCheckResult> {
    const tier = await this.getUserTier(userId);
    const cap = tier.limits.runsPerMonth;

    if (cap === null) {
      this.recordRun(userId);
      return {
        allowed: true,
        tier,
        runsUsed: this.runsInLastMonth(userId),
        runsAllowed: null,
      };
    }

    const used = this.runsInLastMonth(userId);
    if (used >= cap) {
      this.logger.log(
        `quota denied for user=${userId}: ${used}/${cap} on tier=${tier.sku}`
      );
      return {
        allowed: false,
        tier,
        runsUsed: used,
        runsAllowed: cap,
        reason: 'monthly_cap_reached',
      };
    }

    this.recordRun(userId);
    return {
      allowed: true,
      tier,
      runsUsed: used + 1,
      runsAllowed: cap,
    };
  }

  /** Inspect quota without recording a run (used by GraphQL quota queries). */
  async peek(userId: string): Promise<QuotaCheckAllowed | QuotaCheckDenied> {
    const tier = await this.getUserTier(userId);
    const cap = tier.limits.runsPerMonth;
    const used = this.runsInLastMonth(userId);
    if (cap === null) {
      return { allowed: true, tier, runsUsed: used, runsAllowed: null };
    }
    if (used >= cap) {
      return {
        allowed: false,
        tier,
        runsUsed: used,
        runsAllowed: cap,
        reason: 'monthly_cap_reached',
      };
    }
    return { allowed: true, tier, runsUsed: used, runsAllowed: cap };
  }

  private async getUserTier(_userId: string): Promise<TierEntry> {
    // TODO: read the user's active subscription via the payment plugin and
    // map it to the corresponding TIER_CATALOG entry. For now every user is
    // on the free tier — which is the right default if no subscription has
    // been recorded yet.
    return getTier('free') as TierEntry;
  }

  private recordRun(userId: string): void {
    const now = Date.now();
    const list = this.recentRuns.get(userId) ?? [];
    list.push(now);
    this.recentRuns.set(userId, list);
    this.pruneOldRuns(userId);
  }

  private runsInLastMonth(userId: string): number {
    this.pruneOldRuns(userId);
    return this.recentRuns.get(userId)?.length ?? 0;
  }

  private pruneOldRuns(userId: string): void {
    const cutoff = Date.now() - THIRTY_DAYS_MS;
    const list = this.recentRuns.get(userId);
    if (!list) return;
    const pruned = list.filter(ts => ts >= cutoff);
    if (pruned.length === 0) {
      this.recentRuns.delete(userId);
    } else {
      this.recentRuns.set(userId, pruned);
    }
  }
}
