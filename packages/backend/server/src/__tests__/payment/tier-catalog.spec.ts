import test from 'ava';

import { GaramondLicenseProvider } from '../../plugins/payment/license-provider';
import {
  getTier,
  isUnlimited,
  TIER_CATALOG,
  TIER_SKUS,
  tiersByPlan,
} from '../../plugins/payment/tier-catalog';
import {
  SubscriptionPlan,
  SubscriptionRecurring,
  SubscriptionVariant,
} from '../../plugins/payment/types';

// ---------- catalog shape ----------

test('catalog exposes all five named tiers', t => {
  t.deepEqual(
    [...TIER_SKUS].sort(),
    [
      'enterprise',
      'free',
      'pro_lifetime',
      'pro_monthly',
      'pro_yearly',
      'team_monthly',
    ].sort()
  );
});

test('free tier is $0 with finite caps', t => {
  const f = getTier('free');
  t.truthy(f);
  t.is(f!.pricing.priceCents, 0);
  t.is(f!.limits.storageBytes, 1024 ** 3); // 1 GB
  t.is(f!.limits.runsPerMonth, 5);
});

test('lifetime tier is the $299.99 one-time anchor', t => {
  const l = getTier('pro_lifetime');
  t.truthy(l);
  t.is(l!.pricing.priceCents, 29_999);
  t.is(l!.recurring, SubscriptionRecurring.Lifetime);
  t.is(l!.variant, SubscriptionVariant.Onetime);
  t.is(l!.limits.storageBytes, 1024 ** 4); // 1 TB
  t.is(l!.limits.runsPerMonth, 50);
  t.true(l!.byokWaivesRunCap === true);
});

test('team tier is per-seat with a 3-seat minimum', t => {
  const t1 = getTier('team_monthly');
  t.truthy(t1);
  t.true(t1!.pricing.perSeat === true);
  t.is(t1!.pricing.minSeats, 3);
  t.is(t1!.pricing.priceCents, 1_500);
});

test('enterprise tier is $24k/yr starting with unlimited caps', t => {
  const e = getTier('enterprise');
  t.truthy(e);
  t.is(e!.pricing.priceCents, 2_400_000);
  t.is(e!.recurring, SubscriptionRecurring.Yearly);
  t.true(isUnlimited(e!.limits.storageBytes));
  t.true(isUnlimited(e!.limits.runsPerMonth));
});

test('pro monthly vs yearly: yearly is cheaper per-month', t => {
  const m = getTier('pro_monthly')!;
  const y = getTier('pro_yearly')!;
  const monthlyEffective = y.pricing.priceCents! / 12;
  t.true(monthlyEffective < m.pricing.priceCents!);
});

test('every priced tier uses USD and has non-negative cents', t => {
  for (const tier of Object.values(TIER_CATALOG)) {
    t.is(tier.pricing.currency, 'USD');
    if (tier.pricing.priceCents !== null) {
      t.true(tier.pricing.priceCents >= 0);
    }
  }
});

test('tiersByPlan groups correctly', t => {
  const proTiers = tiersByPlan(SubscriptionPlan.Pro);
  t.deepEqual(proTiers.map(t => t.sku).sort(), [
    'pro_lifetime',
    'pro_monthly',
    'pro_yearly',
  ]);
  const ent = tiersByPlan(SubscriptionPlan.Enterprise);
  t.is(ent.length, 1);
});

test('getTier returns undefined for unknown sku', t => {
  t.is(getTier('not_a_real_sku'), undefined);
});

// ---------- garamond stub ----------

test('GaramondLicenseProvider validates as not-yet-wired', async t => {
  const p = new GaramondLicenseProvider();
  t.is(p.id, 'garamond');
  const v = await p.validateLicense('whatever');
  t.false(v.valid);
  t.regex(v.reason!, /not yet wired/i);
});

test('GaramondLicenseProvider has no self-serve checkout url', async t => {
  const p = new GaramondLicenseProvider();
  const ent = getTier('enterprise')!;
  const session = await p.createCheckoutSession(ent, 'user-1');
  t.is(session, null);
});
