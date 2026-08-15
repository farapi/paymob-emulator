import { and, eq, gt } from "drizzle-orm";
import type { AppDatabase } from "../database/connect.js";
import { scenarioExpectations } from "../database/schema.js";

export type ExpectationRow = typeof scenarioExpectations.$inferSelect;

interface CheckoutMatch {
  specialReference?: string;
  merchantOrderId?: string;
}

/** Oldest unexpired non-consumed checkout expectation matching a special_reference (spec 16.2, 11.5). */
export function findActiveCheckoutExpectation(
  db: AppDatabase,
  now: Date,
  specialReference: string,
): ExpectationRow | undefined {
  const nowIso = now.toISOString();
  const candidates = db
    .select()
    .from(scenarioExpectations)
    .where(
      and(
        eq(scenarioExpectations.kind, "checkout"),
        eq(scenarioExpectations.consumed, false),
        gt(scenarioExpectations.expiresAt, nowIso),
      ),
    )
    .all();

  const matching = candidates.filter((c) => (c.matchJson as CheckoutMatch).specialReference === specialReference);
  matching.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  return matching[0];
}

/** Atomically decrements times_remaining and marks consumed at zero. */
export function consumeExpectation(db: AppDatabase, expectationId: string): void {
  db.transaction((tx) => {
    const row = tx.select().from(scenarioExpectations).where(eq(scenarioExpectations.id, expectationId)).get();
    if (!row) return;
    const remaining = row.timesRemaining - 1;
    tx.update(scenarioExpectations)
      .set({ timesRemaining: remaining, consumed: remaining <= 0 })
      .where(eq(scenarioExpectations.id, expectationId))
      .run();
  });
}
