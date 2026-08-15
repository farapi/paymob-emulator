import { z } from "zod";
import { BROWSER_COMPLETION_MODES, INTERNAL_STATES, SCENARIO_CLASSIFICATIONS } from "@paymob-simulator/contracts";

// Scenario YAML schema (spec section 12.2-12.3). Built-ins and custom
// scenarios share this exact schema.

const durationInputSchema = z.union([z.number().int().nonnegative(), z.string().min(1)]);

const internalStateSchema = z.enum(INTERNAL_STATES);

export const FRAME_EVENTS = [
  "checkout.ready",
  "checkout.resized",
  "card.validation_changed",
  "payment.processing",
  "payment.pending",
  "payment.succeeded",
  "payment.failed",
  "payment.cancelled",
  "three_ds.opened",
  "three_ds.completed",
  "payment.blocked",
] as const;
const frameEventSchema = z.enum(FRAME_EVENTS);

// Allowed JSON merge-patch destination paths and their required primitive
// type (spec section 12.3). Anything else is a compile-time rejection.
export const ALLOWED_MERGE_PATCH_FIELDS = {
  "/obj/amount_cents": "number",
  "/obj/currency": "string",
  "/obj/integration_id": "number",
  "/obj/order/id": "number",
  "/obj/order/merchant_order_id": "string",
  "/obj/pending": "boolean",
  "/obj/success": "boolean",
  "/obj/error_occured": "boolean",
  "/obj/data/message": "string",
  "/obj/source_data/pan": "string",
} as const;
export type AllowedMergePatchPath = keyof typeof ALLOWED_MERGE_PATCH_FIELDS;

const mergePatchValueSchema = z.union([z.string().max(256), z.number(), z.boolean()]);

const mergePatchSchema = z
  .record(z.string(), mergePatchValueSchema)
  .refine(
    (patch) => Object.keys(patch).every((path) => path in ALLOWED_MERGE_PATCH_FIELDS),
    { message: "mergePatch contains a path outside the frozen allowlist" },
  )
  .refine(
    (patch) =>
      Object.entries(patch).every(([path, value]) => {
        const expected = ALLOWED_MERGE_PATCH_FIELDS[path as AllowedMergePatchPath];
        return typeof value === expected;
      }),
    { message: "mergePatch value type does not match the destination field type" },
  );

const transactionTransitionAction = z.object({
  id: z.string().min(1),
  after: durationInputSchema,
  action: z.literal("transaction.transition"),
  params: z.object({ to: internalStateSchema }),
});

const transactionSnapshotAction = z.object({
  id: z.string().min(1),
  after: durationInputSchema,
  action: z.literal("transaction.snapshot"),
  params: z.object({ state: internalStateSchema, canonical: z.literal(false) }),
});

const browserRedirectAction = z.object({
  id: z.string().min(1),
  after: durationInputSchema,
  action: z.literal("browser.redirect"),
  params: z.object({
    status: z.enum(["success", "failed", "pending", "cancelled", "expired"]),
    mode: z.enum(BROWSER_COMPLETION_MODES).optional(),
  }),
});

const browserPostMessageAction = z.object({
  id: z.string().min(1),
  after: durationInputSchema,
  action: z.literal("browser.post_message"),
  params: z.object({ event: frameEventSchema, payload: z.record(z.string(), z.unknown()).optional() }),
});

const browserShowResultAction = z.object({
  id: z.string().min(1),
  after: durationInputSchema,
  action: z.literal("browser.show_result"),
  params: z.object({
    status: z.enum(["success", "failed", "pending", "cancelled", "expired"]),
    message: z.string().max(2048).optional(),
  }),
});

const threeDsOpenAction = z.object({
  id: z.string().min(1),
  after: durationInputSchema,
  action: z.literal("three_ds.open"),
  params: z.object({ prompt: z.string().max(2048).optional() }),
});

const threeDsCompleteAction = z.object({
  id: z.string().min(1),
  after: durationInputSchema,
  action: z.literal("three_ds.complete"),
  params: z.object({ result: z.enum(["success", "failure"]) }),
});

const webhookTransactionAction = z.object({
  id: z.string().min(1),
  after: durationInputSchema,
  action: z.literal("webhook.transaction"),
  params: z.object({ snapshot: z.string().min(1), signature: z.literal("valid") }),
});

const webhookTokenAction = z.object({
  id: z.string().min(1),
  after: durationInputSchema,
  action: z.literal("webhook.token"),
  params: z.object({ tokenId: z.literal("generated"), signature: z.literal("valid") }),
});

const webhookRepeatAction = z.object({
  id: z.string().min(1),
  after: durationInputSchema,
  action: z.literal("webhook.repeat"),
  params: z.object({ sourceActionId: z.string().min(1), exactPayload: z.literal(true) }),
});

const webhookOmitAction = z.object({
  id: z.string().min(1),
  after: durationInputSchema,
  action: z.literal("webhook.omit"),
  params: z.object({ event: z.enum(["transaction", "token"]), reason: z.string().max(2048) }),
});

const webhookCorruptHmacAction = z.object({
  id: z.string().min(1),
  after: durationInputSchema,
  action: z.literal("webhook.corrupt_hmac"),
  params: z.object({ sourceActionId: z.string().min(1), mutation: z.literal("flip_last_hex") }),
});

const webhookMutatePayloadAction = z.object({
  id: z.string().min(1),
  after: durationInputSchema,
  action: z.literal("webhook.mutate_payload"),
  params: z.object({
    sourceActionId: z.string().min(1),
    mergePatch: mergePatchSchema,
    signature: z.enum(["valid", "corrupt"]),
  }),
});

const clockNoteAction = z.object({
  id: z.string().min(1),
  after: durationInputSchema,
  action: z.literal("clock.note"),
  params: z.object({ message: z.string().max(2048) }),
});

export const timelineActionSchema = z.discriminatedUnion("action", [
  transactionTransitionAction,
  transactionSnapshotAction,
  browserRedirectAction,
  browserPostMessageAction,
  browserShowResultAction,
  threeDsOpenAction,
  threeDsCompleteAction,
  webhookTransactionAction,
  webhookTokenAction,
  webhookRepeatAction,
  webhookOmitAction,
  webhookCorruptHmacAction,
  webhookMutatePayloadAction,
  clockNoteAction,
]);
export type TimelineAction = z.infer<typeof timelineActionSchema>;
export type TimelineActionType = TimelineAction["action"];

export const scenarioMatchSchema = z.object({
  cardholderAliases: z.array(z.string().min(1)).optional(),
});
export type ScenarioMatch = z.infer<typeof scenarioMatchSchema>;

export const scenarioCheckoutSchema = z.object({
  initialState: z.string().optional(),
  requireThreeDS: z.boolean().optional().default(false),
  message: z.string().max(2048).optional(),
});

export const scenarioDeliveryPolicySchema = z.object({
  retryPolicy: z.string().optional().default("default"),
});

export const scenarioMetadataSchema = z
  .object({ tags: z.array(z.string()).optional() })
  .passthrough()
  .optional();

export const scenarioDefinitionSchema = z.object({
  version: z.literal(1),
  id: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[a-z0-9][a-z0-9-]*$/, "scenario id must be lowercase kebab-case"),
  displayName: z.string().min(1).max(256),
  description: z.string().max(2048).optional(),
  classification: z.enum(SCENARIO_CLASSIFICATIONS),
  match: scenarioMatchSchema.optional().default({}),
  checkout: scenarioCheckoutSchema.optional().default({ requireThreeDS: false }),
  timeline: z.array(timelineActionSchema).min(1),
  deliveryPolicy: scenarioDeliveryPolicySchema.optional().default({ retryPolicy: "default" }),
  metadata: scenarioMetadataSchema,
  overrideBuiltIn: z.boolean().optional(),
  overrideDatabase: z.boolean().optional(),
});
export type ScenarioDefinition = z.infer<typeof scenarioDefinitionSchema>;

export class ScenarioValidationError extends Error {
  constructor(
    message: string,
    public readonly issues: readonly string[] = [],
  ) {
    super(message);
  }
}

/**
 * Structural compile-time checks that don't require server-side context
 * (integration snapshots, URL allowlists). Spec section 12.3: duplicate
 * action IDs, unknown references, card/alias collisions are rejected before
 * activation. URL-allowlist and card/alias-collision checks happen in the
 * server compiler, which has access to configuration.
 */
export function validateScenarioStructure(def: ScenarioDefinition): void {
  const issues: string[] = [];
  const ids = new Set<string>();
  for (const step of def.timeline) {
    if (ids.has(step.id)) issues.push(`duplicate timeline action id "${step.id}"`);
    ids.add(step.id);
  }
  for (const step of def.timeline) {
    if (step.action === "webhook.repeat" && !ids.has(step.params.sourceActionId)) {
      issues.push(`webhook.repeat "${step.id}" references unknown action "${step.params.sourceActionId}"`);
    }
    if (step.action === "webhook.corrupt_hmac" && !ids.has(step.params.sourceActionId)) {
      issues.push(
        `webhook.corrupt_hmac "${step.id}" references unknown action "${step.params.sourceActionId}"`,
      );
    }
    if (step.action === "webhook.mutate_payload" && !ids.has(step.params.sourceActionId)) {
      issues.push(
        `webhook.mutate_payload "${step.id}" references unknown action "${step.params.sourceActionId}"`,
      );
    }
    if (
      step.action === "webhook.transaction" &&
      step.params.snapshot !== "current" &&
      !ids.has(step.params.snapshot)
    ) {
      issues.push(`webhook.transaction "${step.id}" references unknown snapshot "${step.params.snapshot}"`);
    }
  }
  if (issues.length > 0) {
    throw new ScenarioValidationError(`scenario "${def.id}" failed structural validation`, issues);
  }
}
