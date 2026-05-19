import test from 'ava';

import { DescribeRepoQuotaService } from '../../plugins/copilot/describe-repo/quota';

function makeService(): DescribeRepoQuotaService {
  // Bypass NestJS DI for the pure policy logic.
  return new DescribeRepoQuotaService();
}

test('first run is allowed on the free tier', async t => {
  const q = makeService();
  const result = await q.checkAndRecord('user-a');
  t.true(result.allowed);
  if (result.allowed) {
    t.is(result.tier.sku, 'free');
    t.is(result.runsAllowed, 5);
    t.is(result.runsUsed, 1);
  }
});

test('peek does not consume a run', async t => {
  const q = makeService();
  const peek1 = await q.peek('user-b');
  t.is(peek1.runsUsed, 0);
  const peek2 = await q.peek('user-b');
  t.is(peek2.runsUsed, 0);
});

test('hitting the cap blocks further runs', async t => {
  const q = makeService();
  for (let i = 0; i < 5; i++) {
    const r = await q.checkAndRecord('user-c');
    t.true(r.allowed, `run ${i + 1} should be allowed`);
  }
  const sixth = await q.checkAndRecord('user-c');
  t.false(sixth.allowed);
  if (!sixth.allowed) {
    t.is(sixth.reason, 'monthly_cap_reached');
    t.is(sixth.runsUsed, 5);
    t.is(sixth.runsAllowed, 5);
  }
});

test('quota is per-user, not global', async t => {
  const q = makeService();
  for (let i = 0; i < 5; i++) {
    await q.checkAndRecord('user-d');
  }
  // user-d is now at cap, but user-e starts fresh
  const userE = await q.checkAndRecord('user-e');
  t.true(userE.allowed);
  if (userE.allowed) t.is(userE.runsUsed, 1);
});

test('peek after exhausting cap reports denied without recording', async t => {
  const q = makeService();
  for (let i = 0; i < 5; i++) await q.checkAndRecord('user-f');
  const peek = await q.peek('user-f');
  t.false(peek.allowed);
  if (!peek.allowed) {
    t.is(peek.runsUsed, 5);
    t.is(peek.reason, 'monthly_cap_reached');
  }
  // Another peek still shows 5/5 — not 6/5 — because peek doesn't record.
  const peek2 = await q.peek('user-f');
  if (!peek2.allowed) t.is(peek2.runsUsed, 5);
});

test('BYOK has no effect on a tier without byokWaivesRunCap (free)', async t => {
  const q = makeService();
  for (let i = 0; i < 5; i++) await q.checkAndRecord('user-g', { byok: true });
  const sixth = await q.checkAndRecord('user-g', { byok: true });
  // Free tier does not waive on BYOK — still capped.
  t.false(sixth.allowed);
});

test('peek with BYOK on a non-waiving tier still reports a cap', async t => {
  const q = makeService();
  const peek = await q.peek('user-h', { byok: true });
  t.true(peek.allowed);
  // Free tier reports runsAllowed=5 even when byok=true (free doesn't waive).
  if (peek.allowed) t.is(peek.runsAllowed, 5);
});
