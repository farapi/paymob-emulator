import { eq } from "drizzle-orm";
import { z } from "zod";
import type { AppDatabase } from "../../database/connect.js";
import { legacyAuthTokens, transactions } from "../../database/schema.js";
import type { Clock } from "../../core/clock.js";
import { verifyActiveCredential } from "../../core/credentials.js";
import { generateLegacyAuthToken } from "../../core/ids.js";
import { hashOpaqueSecret } from "../../core/secret-hash.js";
import { SIMULATOR_PROFILE_ID } from "../../core/id-allocator.js";
import { buildTransactionObj } from "../../core/transaction-payload.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFastifyInstance = import("fastify").FastifyInstance<any, any, any, any, any>;

export interface InquiryRouteDeps {
  db: AppDatabase;
  clock: Clock;
}

const AUTH_TOKEN_TTL_MS = 60 * 60 * 1000;

function extractInquiryToken(req: {
  headers: Record<string, string | string[] | undefined>;
  query: Record<string, unknown>;
}): string | undefined {
  const auth = req.headers.authorization as string | undefined;
  const bearerMatch = /^Bearer\s+(.+)$/.exec(auth ?? "");
  if (bearerMatch) return bearerMatch[1];
  const tokenMatch = /^Token\s+(.+)$/.exec(auth ?? "");
  if (tokenMatch) return tokenMatch[1];
  const queryToken = req.query.token;
  return typeof queryToken === "string" ? queryToken : undefined;
}

export function registerInquiryRoutes(app: AnyFastifyInstance, deps: InquiryRouteDeps): void {
  const authBodySchema = z.object({ api_key: z.string().min(1) });

  app.post("/api/auth/tokens", async (req, reply) => {
    const parsed = authBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(422).send({ detail: [{ loc: ["body", "api_key"], msg: "api_key is required", type: "value_error" }] });
    }
    if (!verifyActiveCredential(deps.db, "api_key", parsed.data.api_key)) {
      return reply.code(401).send({ detail: "incorrect credentials" });
    }

    const now = deps.clock.now();
    const token = generateLegacyAuthToken();
    deps.db
      .insert(legacyAuthTokens)
      .values({
        id: token,
        tokenHash: hashOpaqueSecret(token),
        profileId: SIMULATOR_PROFILE_ID,
        expiresAt: new Date(now.getTime() + AUTH_TOKEN_TTL_MS).toISOString(),
        createdAt: now.toISOString(),
      })
      .run();

    return reply.code(201).send({ token, profile: { id: SIMULATOR_PROFILE_ID } });
  });

  app.get("/api/acceptance/transactions/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!/^\d+$/.test(id)) {
      return reply.code(422).send({ detail: "transaction id must be numeric" });
    }

    const token = extractInquiryToken(req as never);
    if (!token) return reply.code(401).send({ detail: "incorrect credentials" });

    const tokenHash = hashOpaqueSecret(token);
    const authRow = deps.db.select().from(legacyAuthTokens).where(eq(legacyAuthTokens.tokenHash, tokenHash)).get();
    const now = deps.clock.now();
    if (!authRow || new Date(authRow.expiresAt).getTime() <= now.getTime()) {
      return reply.code(401).send({ detail: "incorrect credentials" });
    }

    const txn = deps.db
      .select()
      .from(transactions)
      .where(eq(transactions.providerNumericId, Number.parseInt(id, 10)))
      .get();
    if (!txn) return reply.code(404).send({ detail: "Transaction not found" });

    return reply.code(200).send(buildTransactionObj(txn));
  });
}
