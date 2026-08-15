// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFastifyInstance = import("fastify").FastifyInstance<any, any, any, any, any>;
import {
  incorrectCredentialsError,
  type CreateIntentionResponse,
  type IntentionElementResponse,
} from "@paymob-simulator/contracts";
import type { AppDatabase } from "../../database/connect.js";
import type { Clock } from "../../core/clock.js";
import type { EffectiveConfig } from "../../config/loader.js";
import { verifyActiveCredential } from "../../core/credentials.js";
import { getConfiguredIntegrationIds } from "../../database/integrations-repository.js";
import {
  validateCreateIntentionInput,
  type IntentionValidationContext,
  type RawIntentionInput,
} from "../../core/intention-validation.js";
import {
  createIntention,
  findIntentionByClientSecret,
  getIntentionById,
  updateIntention,
  type IntentionRow,
} from "../../core/intention-service.js";
import { findAndConsumeApiFaultExpectation } from "../../core/expectations-service.js";
import { applyApiFault, type ApiFaultResponse } from "../../core/api-fault.js";
import type { AllowlistEntry } from "../../security/allowlist.js";

export interface ModernRouteDeps {
  db: AppDatabase;
  clock: Clock;
  config: EffectiveConfig;
  webhookAllowlist: readonly AllowlistEntry[];
  publicUrl: string;
}

function extractBearerToken(header: string | undefined): string | undefined {
  const match = /^Token\s+(.+)$/.exec(header ?? "");
  return match?.[1];
}

function validationContext(deps: ModernRouteDeps): IntentionValidationContext {
  return {
    mode: deps.config.values.defaults.validationMode,
    configuredIntegrationIds: getConfiguredIntegrationIds(deps.db),
    webhookAllowlist: deps.webhookAllowlist,
    allowedRedirectOrigins: deps.config.values.browser.allowedRedirectOrigins,
  };
}

function toCreateResponse(row: IntentionRow, clientSecret: string): CreateIntentionResponse {
  return {
    id: row.id,
    client_secret: clientSecret,
    intention_detail: { amount: row.amount, currency: row.currency },
  };
}

function checkoutUrlFor(deps: ModernRouteDeps, clientSecret: string): string {
  const publicKey = deps.config.values.credentials.publicKey;
  return `${deps.publicUrl}/unifiedcheckout/?publicKey=${encodeURIComponent(publicKey)}&clientSecret=${encodeURIComponent(clientSecret)}`;
}

function extractSpecialReference(body: unknown): string | undefined {
  const value = (body as Record<string, unknown> | null)?.special_reference;
  return typeof value === "string" ? value : undefined;
}

export function registerModernIntentionRoutes(app: AnyFastifyInstance, deps: ModernRouteDeps): void {
  app.post("/v1/intention/", async (req, reply) => {
    const fault = findAndConsumeApiFaultExpectation(
      deps.db,
      deps.clock,
      "intention.create",
      extractSpecialReference(req.body),
    );
    if (fault) {
      const handled = await applyApiFault(reply, fault.responseJson as ApiFaultResponse);
      if (handled) return;
    }

    const token = extractBearerToken(req.headers.authorization);
    if (!token || !verifyActiveCredential(deps.db, "secret_key", token)) {
      return reply.code(401).send(incorrectCredentialsError);
    }

    const validation = validateCreateIntentionInput(req.body as RawIntentionInput, validationContext(deps));
    if (!validation.ok) {
      return reply.code(validation.status).send(validation.body);
    }

    const created = createIntention(deps.db, deps.clock, validation.data, {
      defaultNotificationUrl: deps.config.values.defaults.notificationUrl,
      defaultRedirectionUrl: deps.config.values.defaults.redirectionUrl,
      rawRequest: req.body as Record<string, unknown>,
    });

    reply.header("X-Paymob-Simulator-Checkout-URL", checkoutUrlFor(deps, created.clientSecret));
    return reply.code(201).send(toCreateResponse(created.row, created.clientSecret));
  });

  app.put("/v1/intention/:clientSecret", async (req, reply) => {
    const { clientSecret } = req.params as { clientSecret: string };

    // Match against the intention's existing special_reference (the patch
    // body need not include it) as well as any override the patch supplies.
    const existing = findIntentionByClientSecret(deps.db, clientSecret);
    const specialReference = extractSpecialReference(req.body) ?? existing?.specialReference ?? undefined;
    const fault = findAndConsumeApiFaultExpectation(deps.db, deps.clock, "intention.update", specialReference);
    if (fault) {
      const handled = await applyApiFault(reply, fault.responseJson as ApiFaultResponse);
      if (handled) return;
    }

    const token = extractBearerToken(req.headers.authorization);
    if (!token || !verifyActiveCredential(deps.db, "secret_key", token)) {
      return reply.code(401).send(incorrectCredentialsError);
    }

    const rawPatch = req.body as Record<string, unknown>;

    const result = updateIntention({
      db: deps.db,
      clock: deps.clock,
      clientSecret,
      rawPatch,
      validate: (merged) => validateCreateIntentionInput(merged, validationContext(deps)),
    });

    if (!result.ok) {
      switch (result.reason) {
        case "empty_body":
          return reply.code(422).send({ detail: "update request body must not be empty" });
        case "not_found":
          return reply.code(404).send({ detail: "Intention not found" });
        case "already_submitted":
          return reply.code(409).send({ detail: "intention already submitted" });
        case "expired":
          return reply.code(410).send({ detail: "intention expired" });
        case "validation":
          return reply.code(result.status).send(result.body);
      }
    }

    return reply.code(200).send(toCreateResponse(result.row, clientSecret));
  });

  // Simulator extension (spec 9.1): never returns a recoverable client
  // secret, since only its hash is persisted (section 18.2). The suffix
  // form keeps the documented field present for tooling without ever
  // reconstructing the real secret.
  app.get("/v1/intention/:id", async (req, reply) => {
    const token = extractBearerToken(req.headers.authorization);
    if (!token || !verifyActiveCredential(deps.db, "secret_key", token)) {
      return reply.code(401).send(incorrectCredentialsError);
    }

    const { id } = req.params as { id: string };
    const row = getIntentionById(deps.db, id);
    if (!row) return reply.code(404).send({ detail: "Intention not found" });

    return reply.code(200).send({
      ...toCreateResponse(row, `***${row.clientSecretDisplaySuffix}`),
      status: row.status,
      special_reference: row.specialReference ?? undefined,
      created_at: row.createdAt,
      expires_at: row.expiresAt,
    });
  });

  app.get("/v1/intention/element/:publicKey/:clientSecret", async (req, reply) => {
    const { publicKey, clientSecret } = req.params as { publicKey: string; clientSecret: string };

    if (publicKey !== deps.config.values.credentials.publicKey) {
      return reply.code(404).send({ detail: "Not found" });
    }

    const row = findIntentionByClientSecret(deps.db, clientSecret);
    if (!row) return reply.code(404).send({ detail: "Not found" });

    const now = deps.clock.now();
    if (new Date(row.expiresAt).getTime() <= now.getTime()) {
      return reply.code(410).send({ detail: "intention expired" });
    }

    const response: IntentionElementResponse = {
      id: row.id,
      amount: row.amount,
      currency: row.currency,
      status: row.status,
      special_reference: row.specialReference ?? undefined,
      expires_at: row.expiresAt,
      payment_methods: row.paymentMethodIdsJson as number[],
    };
    return reply.code(200).send(response);
  });
}
