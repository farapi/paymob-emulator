import { eq } from "drizzle-orm";
import { z } from "zod";
import type { AppDatabase } from "../database/connect.js";
import { scenarioExpectations } from "../database/schema.js";
import { generateOpaqueId } from "./ids.js";
import { parseExpiresIn } from "./duration-limits.js";
import type { Clock } from "./clock.js";

export type ExpectationRow = typeof scenarioExpectations.$inferSelect;

export const createCheckoutExpectationSchema = z.object({
  match: z.object({ specialReference: z.string().min(1) }),
  scenarioId: z.string().min(1),
  times: z.number().int().min(1).max(100).optional().default(1),
  expiresIn: z.string().optional(),
});
export type CreateCheckoutExpectationInput = z.infer<typeof createCheckoutExpectationSchema>;

export const createApiFaultExpectationSchema = z.object({
  match: z.object({
    operation: z.enum(["intention.create", "intention.update"]),
    specialReference: z.string().min(1),
  }),
  response: z.object({
    status: z.number().int().min(100).max(599).optional(),
    delay: z.string().optional(),
    body: z.record(z.string(), z.unknown()).optional(),
    connectionClose: z.boolean().optional(),
    timeout: z.boolean().optional(),
  }),
  times: z.number().int().min(1).max(100).optional().default(1),
  expiresIn: z.string().optional(),
});
export type CreateApiFaultExpectationInput = z.infer<typeof createApiFaultExpectationSchema>;

export class ExpectationValidationError extends Error {}

/** Spec 16.2: a create request that could match multiple different match shapes is rejected as ambiguous. */
function assertNotAmbiguous(db: AppDatabase, kind: string, matchKey: string, matchValue: string, now: Date): void {
  const existing = db.select().from(scenarioExpectations).where(eq(scenarioExpectations.kind, kind)).all();
  const nowMs = now.getTime();
  const conflict = existing.some((row) => {
    if (row.consumed || new Date(row.expiresAt).getTime() <= nowMs) return false;
    const match = row.matchJson as Record<string, unknown>;
    return match[matchKey] === matchValue;
  });
  if (conflict) {
    throw new ExpectationValidationError(
      `an active ${kind} expectation already matches ${matchKey}="${matchValue}"`,
    );
  }
}

export function createCheckoutExpectation(
  db: AppDatabase,
  clock: Clock,
  input: CreateCheckoutExpectationInput,
): ExpectationRow {
  const now = clock.now();
  assertNotAmbiguous(db, "checkout", "specialReference", input.match.specialReference, now);

  const expiresInMs = parseExpiresIn(input.expiresIn);
  const id = generateOpaqueId("exp");
  db.insert(scenarioExpectations)
    .values({
      id,
      kind: "checkout",
      matchJson: input.match,
      scenarioId: input.scenarioId,
      timesTotal: input.times,
      timesRemaining: input.times,
      consumed: false,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + expiresInMs).toISOString(),
    })
    .run();

  const row = db.select().from(scenarioExpectations).where(eq(scenarioExpectations.id, id)).get();
  if (!row) throw new Error("failed to read back created expectation");
  return row;
}

export function createApiFaultExpectation(
  db: AppDatabase,
  clock: Clock,
  input: CreateApiFaultExpectationInput,
): ExpectationRow {
  const now = clock.now();
  assertNotAmbiguous(db, "api_fault", "specialReference", input.match.specialReference, now);

  const expiresInMs = parseExpiresIn(input.expiresIn);
  const id = generateOpaqueId("exp");
  db.insert(scenarioExpectations)
    .values({
      id,
      kind: "api_fault",
      matchJson: input.match,
      scenarioId: null,
      responseJson: input.response,
      timesTotal: input.times,
      timesRemaining: input.times,
      consumed: false,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + expiresInMs).toISOString(),
    })
    .run();

  const row = db.select().from(scenarioExpectations).where(eq(scenarioExpectations.id, id)).get();
  if (!row) throw new Error("failed to read back created expectation");
  return row;
}

export function listExpectations(db: AppDatabase): ExpectationRow[] {
  return db.select().from(scenarioExpectations).all();
}

export function cancelExpectation(db: AppDatabase, id: string): boolean {
  const existing = db.select().from(scenarioExpectations).where(eq(scenarioExpectations.id, id)).get();
  if (!existing) return false;
  db.delete(scenarioExpectations).where(eq(scenarioExpectations.id, id)).run();
  return true;
}

/** Finds and atomically consumes a matching, non-expired, non-consumed API-fault expectation. */
export function findAndConsumeApiFaultExpectation(
  db: AppDatabase,
  clock: Clock,
  operation: string,
  specialReference: string | undefined,
): ExpectationRow | undefined {
  if (!specialReference) return undefined;
  const now = clock.now();
  const candidates = db
    .select()
    .from(scenarioExpectations)
    .where(eq(scenarioExpectations.kind, "api_fault"))
    .all()
    .filter((row) => {
      if (row.consumed || new Date(row.expiresAt).getTime() <= now.getTime()) return false;
      const match = row.matchJson as { operation: string; specialReference: string };
      return match.operation === operation && match.specialReference === specialReference;
    })
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  const match = candidates[0];
  if (!match) return undefined;

  db.transaction((tx) => {
    const remaining = match.timesRemaining - 1;
    tx.update(scenarioExpectations)
      .set({ timesRemaining: remaining, consumed: remaining <= 0 })
      .where(eq(scenarioExpectations.id, match.id))
      .run();
  });

  return match;
}
