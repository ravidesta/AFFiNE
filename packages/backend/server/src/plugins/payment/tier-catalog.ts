import {
  SubscriptionPlan,
  SubscriptionRecurring,
  SubscriptionVariant,
} from './types';

const GB = 1024 ** 3;
const TB = 1024 ** 4;

export interface TierLimits {
  /** Per-account storage cap in bytes. `null` = unlimited (enterprise only). */
  storageBytes: number | null;
  /** Cap on describeRepo + asset-generation runs per calendar month. `null` = unlimited / metered. */
  runsPerMonth: number | null;
}

export interface TierPricing {
  /** Price in the smallest currency unit (USD cents). `null` = bespoke / contact sales. */
  priceCents: number | null;
  currency: 'USD';
  /** Per-seat plans charge `priceCents` per seat and require `minSeats` to subscribe. */
  perSeat?: boolean;
  minSeats?: number;
}

export interface TierEntry {
  sku: string;
  label: string;
  plan: SubscriptionPlan;
  recurring: SubscriptionRecurring;
  variant?: SubscriptionVariant;
  pricing: TierPricing;
  limits: TierLimits;
  /** Bring-your-own-key waives the runs/month cap. */
  byokWaivesRunCap?: boolean;
  /** Free-form marketing notes; not used in billing logic. */
  highlights: string[];
}

/**
 * Static tier catalog used to anchor Phase-2 storage + licensing work.
 *
 * Numbers below are the authoritative public prices; Stripe price IDs are wired
 * separately via env (`AFFINE_STRIPE_PRICE_ID_<SKU>`). This file does NOT
 * mutate the existing payment plugin's behavior — it provides typed constants
 * that downstream code (checkout UI, quota mapping, license provider) can read.
 */
export const TIER_CATALOG: Record<string, TierEntry> = {
  free: {
    sku: 'free',
    label: 'Free',
    plan: SubscriptionPlan.Free,
    recurring: SubscriptionRecurring.Monthly,
    pricing: { priceCents: 0, currency: 'USD' },
    limits: { storageBytes: 1 * GB, runsPerMonth: 5 },
    highlights: [
      'Try the describe-repo flow',
      '1 GB storage',
      '5 runs / month',
    ],
  },

  pro_lifetime: {
    sku: 'pro_lifetime',
    label: 'Lifetime',
    plan: SubscriptionPlan.Pro,
    recurring: SubscriptionRecurring.Lifetime,
    variant: SubscriptionVariant.Onetime,
    pricing: { priceCents: 29_999, currency: 'USD' },
    limits: { storageBytes: 1 * TB, runsPerMonth: 50 },
    byokWaivesRunCap: true,
    highlights: [
      '$299.99 one-time',
      '1 TB storage',
      '50 runs / month',
      'BYOK waives the run cap',
    ],
  },

  pro_monthly: {
    sku: 'pro_monthly',
    label: 'Pro (monthly)',
    plan: SubscriptionPlan.Pro,
    recurring: SubscriptionRecurring.Monthly,
    pricing: { priceCents: 1_900, currency: 'USD' },
    limits: { storageBytes: 1 * TB, runsPerMonth: 250 },
    byokWaivesRunCap: true,
    highlights: ['$19 / month', '1 TB storage', '250 runs / month'],
  },

  pro_yearly: {
    sku: 'pro_yearly',
    label: 'Pro (annual)',
    plan: SubscriptionPlan.Pro,
    recurring: SubscriptionRecurring.Yearly,
    pricing: { priceCents: 19_000, currency: 'USD' },
    limits: { storageBytes: 1 * TB, runsPerMonth: 250 },
    byokWaivesRunCap: true,
    highlights: [
      '$190 / year (≈ $15.83 / month)',
      '1 TB storage',
      '250 runs / month',
    ],
  },

  team_monthly: {
    sku: 'team_monthly',
    label: 'Team',
    plan: SubscriptionPlan.Team,
    recurring: SubscriptionRecurring.Monthly,
    pricing: {
      priceCents: 1_500,
      currency: 'USD',
      perSeat: true,
      minSeats: 3,
    },
    limits: { storageBytes: 5 * TB, runsPerMonth: 1_000 },
    highlights: [
      '$15 / seat / month, 3 seat minimum',
      '5 TB pooled storage',
      '1,000 runs / month pooled',
      'Shared attestation log + workspace audit',
    ],
  },

  enterprise: {
    sku: 'enterprise',
    label: 'Enterprise',
    plan: SubscriptionPlan.Enterprise,
    recurring: SubscriptionRecurring.Yearly,
    pricing: { priceCents: 2_400_000, currency: 'USD' },
    limits: { storageBytes: null, runsPerMonth: null },
    highlights: [
      'Starts at $24,000 / year',
      'Unlimited storage',
      'Metered AI at cost + margin',
      'BYOK or self-hosted LLM',
      'SSO, SLA, custom contract via garamond.ink',
    ],
  },
};

export const TIER_SKUS = Object.keys(TIER_CATALOG) as Array<
  keyof typeof TIER_CATALOG
>;

export function getTier(sku: string): TierEntry | undefined {
  return TIER_CATALOG[sku];
}

export function tiersByPlan(plan: SubscriptionPlan): TierEntry[] {
  return Object.values(TIER_CATALOG).filter(t => t.plan === plan);
}

export function isUnlimited(value: number | null): boolean {
  return value === null;
}
