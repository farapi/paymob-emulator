import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

// Full persistence model (spec section 18). JSON payload columns use
// Drizzle's `{ mode: "json" }` text columns. Timestamps are stored as ISO
// UTC strings (TEXT) for readability in a local dev tool; ids that must be
// monotonically allocated positive integers (transaction/order/owner/
// integration/token) come from `idCounters`, not sqlite AUTOINCREMENT.

export const idCounters = sqliteTable("id_counters", {
  key: text("key").primaryKey(),
  nextValue: integer("next_value").notNull(),
});

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value", { mode: "json" }).notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const integrations = sqliteTable("integrations", {
  id: integer("id").primaryKey(),
  iframeId: integer("iframe_id").unique(),
  name: text("name").notNull(),
  paymentMethod: text("payment_method").notNull().default("card"),
  sourceSubtype: text("source_subtype").notNull().default("Visa"),
  iframeCompletionMode: text("iframe_completion_mode").notNull().default("post_message_and_redirect"),
  notificationUrl: text("notification_url"),
  redirectionUrl: text("redirection_url"),
  legacyEnabled: integer("legacy_enabled", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const credentialVersions = sqliteTable(
  "credential_versions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    kind: text("kind").notNull(), // secret_key | public_key | api_key | hmac_secret
    version: integer("version").notNull(),
    value: text("value").notNull(),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    createdAt: text("created_at").notNull(),
  },
  (t) => [uniqueIndex("credential_versions_kind_version_idx").on(t.kind, t.version)],
);

export const intentions = sqliteTable(
  "intentions",
  {
    id: text("id").primaryKey(),
    clientSecretHash: text("client_secret_hash").notNull().unique(),
    clientSecretDisplaySuffix: text("client_secret_display_suffix").notNull(),
    specialReference: text("special_reference"),
    amount: integer("amount").notNull(),
    currency: text("currency").notNull(),
    paymentMethodIdsJson: text("payment_method_ids_json", { mode: "json" }).notNull(),
    billingDataJson: text("billing_data_json", { mode: "json" }),
    customerJson: text("customer_json", { mode: "json" }),
    itemsJson: text("items_json", { mode: "json" }),
    extrasJson: text("extras_json", { mode: "json" }),
    rawRequestJson: text("raw_request_json", { mode: "json" }).notNull(),
    notificationUrl: text("notification_url"),
    redirectionUrl: text("redirection_url"),
    integrationId: integer("integration_id"),
    status: text("status").notNull(),
    scenarioId: text("scenario_id"),
    scenarioSelectionSource: text("scenario_selection_source"),
    randomSeed: integer("random_seed"),
    idempotencyKey: text("idempotency_key"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    expiresAt: text("expires_at").notNull(),
  },
  (t) => [index("intentions_special_reference_idx").on(t.specialReference)],
);

export const legacyAuthTokens = sqliteTable("legacy_auth_tokens", {
  id: text("id").primaryKey(),
  tokenHash: text("token_hash").notNull().unique(),
  profileId: integer("profile_id").notNull(),
  expiresAt: text("expires_at").notNull(),
  createdAt: text("created_at").notNull(),
});

export const legacyOrders = sqliteTable("legacy_orders", {
  id: integer("id").primaryKey(),
  merchantOrderId: text("merchant_order_id").notNull(),
  amountCents: integer("amount_cents").notNull(),
  currency: text("currency").notNull(),
  deliveryNeeded: integer("delivery_needed", { mode: "boolean" }).notNull().default(false),
  itemsJson: text("items_json", { mode: "json" }).notNull(),
  createdAt: text("created_at").notNull(),
});

export const paymentTokens = sqliteTable("payment_tokens", {
  id: text("id").primaryKey(),
  tokenHash: text("token_hash").notNull().unique(),
  orderId: integer("order_id").notNull(),
  integrationId: integer("integration_id").notNull(),
  amountCents: integer("amount_cents").notNull(),
  currency: text("currency").notNull(),
  status: text("status").notNull().default("intended"),
  scenarioId: text("scenario_id"),
  scenarioSelectionSource: text("scenario_selection_source"),
  randomSeed: integer("random_seed"),
  idempotencyKey: text("idempotency_key"),
  createdAt: text("created_at").notNull(),
  expiresAt: text("expires_at").notNull(),
});

export const checkoutSessions = sqliteTable("checkout_sessions", {
  id: text("id").primaryKey(),
  ticketHash: text("ticket_hash").notNull(),
  kind: text("kind").notNull(), // modern | legacy | embed
  intentionId: text("intention_id"),
  paymentTokenId: text("payment_token_id"),
  lastEventCursor: integer("last_event_cursor").notNull().default(0),
  lastHeartbeatAt: text("last_heartbeat_at"),
  createdAt: text("created_at").notNull(),
  expiresAt: text("expires_at").notNull(),
});

export const transactions = sqliteTable(
  "transactions",
  {
    id: text("id").primaryKey(),
    providerNumericId: integer("provider_numeric_id").notNull().unique(),
    intentionId: text("intention_id"),
    legacyOrderId: integer("legacy_order_id"),
    parentTransactionId: text("parent_transaction_id"),
    state: text("state").notNull(),
    amountCents: integer("amount_cents").notNull(),
    currency: text("currency").notNull(),
    integrationId: integer("integration_id").notNull(),
    profileId: integer("profile_id").notNull(),
    ownerId: integer("owner_id").notNull(),
    orderId: integer("order_id").notNull(),
    merchantOrderId: text("merchant_order_id").notNull(),
    sourceType: text("source_type").notNull().default("card"),
    sourceSubType: text("source_sub_type").notNull().default("Visa"),
    sourceLastFour: text("source_last_four").notNull(),
    is3dSecure: integer("is_3d_secure", { mode: "boolean" }).notNull().default(false),
    isStandalonePayment: integer("is_standalone_payment", { mode: "boolean" }).notNull().default(false),
    authorizedAmountCents: integer("authorized_amount_cents"),
    capturedAmountCents: integer("captured_amount_cents").notNull().default(0),
    refundedAmountCents: integer("refunded_amount_cents").notNull().default(0),
    hasParentTransaction: integer("has_parent_transaction", { mode: "boolean" }).notNull().default(false),
    operationType: text("operation_type"), // null | capture | refund | void
    declineMessage: text("decline_message"),
    scenarioRunId: text("scenario_run_id"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    paidAt: text("paid_at"),
    failedAt: text("failed_at"),
  },
  (t) => [
    index("transactions_intention_id_idx").on(t.intentionId),
    index("transactions_merchant_order_id_idx").on(t.merchantOrderId),
    index("transactions_parent_transaction_id_idx").on(t.parentTransactionId),
  ],
);

export const transactionSnapshots = sqliteTable("transaction_snapshots", {
  id: text("id").primaryKey(),
  transactionId: text("transaction_id").notNull(),
  canonical: integer("canonical", { mode: "boolean" }).notNull(),
  state: text("state").notNull(),
  payloadJson: text("payload_json", { mode: "json" }).notNull(),
  sourceActionId: text("source_action_id"),
  createdAt: text("created_at").notNull(),
});

export const cardTokens = sqliteTable("card_tokens", {
  id: integer("id").primaryKey(),
  token: text("token").notNull().unique(),
  maskedPan: text("masked_pan").notNull(),
  merchantId: integer("merchant_id").notNull(),
  cardSubtype: text("card_subtype").notNull(),
  email: text("email").notNull(),
  legacyOrderId: text("order_id").notNull(),
  userAdded: integer("user_added", { mode: "boolean" }).notNull().default(false),
  nextPaymentIntentionId: text("next_payment_intention_id"),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull(),
});

export const scenarioDefinitions = sqliteTable("scenario_definitions", {
  id: text("id").primaryKey(),
  source: text("source").notNull(), // builtin | file | database
  displayName: text("display_name").notNull(),
  classification: text("classification").notNull(),
  definitionJson: text("definition_json", { mode: "json" }).notNull(),
  filePath: text("file_path"),
  overrideBuiltIn: integer("override_built_in", { mode: "boolean" }).notNull().default(false),
  overrideDatabase: integer("override_database", { mode: "boolean" }).notNull().default(false),
  writable: integer("writable", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const scenarioRevisions = sqliteTable("scenario_revisions", {
  id: text("id").primaryKey(),
  scenarioId: text("scenario_id").notNull(),
  revisionHash: text("revision_hash").notNull(),
  definitionJson: text("definition_json", { mode: "json" }).notNull(),
  createdAt: text("created_at").notNull(),
});

export const scenarioRuns = sqliteTable("scenario_runs", {
  id: text("id").primaryKey(),
  intentionId: text("intention_id"),
  paymentTokenId: text("payment_token_id"),
  transactionId: text("transaction_id"),
  scenarioId: text("scenario_id").notNull(),
  scenarioRevisionId: text("scenario_revision_id").notNull(),
  notificationUrl: text("notification_url"),
  redirectionUrl: text("redirection_url"),
  integrationId: integer("integration_id"),
  hmacSecretVersion: integer("hmac_secret_version").notNull(),
  clockMode: text("clock_mode").notNull(),
  randomSeed: integer("random_seed").notNull(),
  selectionSource: text("selection_source").notNull(),
  submittedAt: text("submitted_at").notNull(),
  createdAt: text("created_at").notNull(),
});

export const scenarioExpectations = sqliteTable("scenario_expectations", {
  id: text("id").primaryKey(),
  kind: text("kind").notNull(), // checkout | api_fault
  matchJson: text("match_json", { mode: "json" }).notNull(),
  scenarioId: text("scenario_id"),
  responseJson: text("response_json", { mode: "json" }),
  timesTotal: integer("times_total").notNull().default(1),
  timesRemaining: integer("times_remaining").notNull().default(1),
  consumed: integer("consumed", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull(),
  expiresAt: text("expires_at").notNull(),
});

export const scheduledActions = sqliteTable(
  "scheduled_actions",
  {
    id: text("id").primaryKey(),
    transactionId: text("transaction_id"),
    scenarioRunId: text("scenario_run_id"),
    scenarioActionId: text("scenario_action_id").notNull(),
    actionType: text("action_type").notNull(),
    payloadJson: text("payload_json", { mode: "json" }).notNull(),
    dueAt: text("due_at").notNull(),
    status: text("status").notNull().default("scheduled"),
    leaseOwner: text("lease_owner"),
    leaseExpiresAt: text("lease_expires_at"),
    attemptCount: integer("attempt_count").notNull().default(0),
    stepIndex: integer("step_index").notNull().default(0),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    index("scheduled_actions_due_idx").on(t.status, t.dueAt),
    index("scheduled_actions_transaction_id_idx").on(t.transactionId),
  ],
);

export const callbackEvents = sqliteTable("callback_events", {
  id: text("id").primaryKey(),
  transactionId: text("transaction_id"),
  eventType: text("event_type").notNull(), // transaction | token
  canonical: integer("canonical", { mode: "boolean" }).notNull().default(true),
  bodyBytes: text("body_bytes").notNull(),
  contentType: text("content_type").notNull().default("application/json"),
  hmac: text("hmac").notNull(),
  signatureMode: text("signature_mode").notNull().default("valid"), // valid | corrupt
  sourceSnapshotId: text("source_snapshot_id"),
  createdAt: text("created_at").notNull(),
});

export const webhookDeliveries = sqliteTable(
  "webhook_deliveries",
  {
    id: text("id").primaryKey(),
    transactionId: text("transaction_id"),
    callbackEventId: text("callback_event_id").notNull(),
    eventType: text("event_type").notNull(),
    targetUrl: text("target_url").notNull(),
    scheduledActionId: text("scheduled_action_id"),
    originalDeliveryId: text("original_delivery_id"),
    status: text("status").notNull().default("scheduled"),
    nextAttemptAt: text("next_attempt_at"),
    createdAt: text("created_at").notNull(),
    completedAt: text("completed_at"),
  },
  (t) => [index("webhook_deliveries_transaction_id_idx").on(t.transactionId)],
);

export const webhookAttempts = sqliteTable(
  "webhook_attempts",
  {
    id: text("id").primaryKey(),
    deliveryId: text("delivery_id").notNull(),
    attemptNumber: integer("attempt_number").notNull(),
    startedAt: text("started_at").notNull(),
    finishedAt: text("finished_at"),
    requestHeadersJson: text("request_headers_json", { mode: "json" }),
    responseStatus: integer("response_status"),
    responseHeadersJson: text("response_headers_json", { mode: "json" }),
    responseBodyExcerpt: text("response_body_excerpt"),
    transportErrorCode: text("transport_error_code"),
    durationMs: integer("duration_ms"),
    retryDecision: text("retry_decision"),
  },
  (t) => [index("webhook_attempts_delivery_id_idx").on(t.deliveryId)],
);

export const paymentOperations = sqliteTable("payment_operations", {
  id: text("id").primaryKey(),
  transactionId: text("transaction_id").notNull(),
  childTransactionId: text("child_transaction_id").notNull(),
  operationType: text("operation_type").notNull(), // capture | refund | void
  amountCents: integer("amount_cents").notNull(),
  idempotencyKey: text("idempotency_key"),
  requestHash: text("request_hash"),
  createdAt: text("created_at").notNull(),
});

export const browserEvents = sqliteTable(
  "browser_events",
  {
    id: text("id").primaryKey(),
    checkoutSessionId: text("checkout_session_id").notNull(),
    transactionId: text("transaction_id"),
    eventSeq: integer("event_seq").notNull(),
    type: text("type").notNull(),
    payloadJson: text("payload_json", { mode: "json" }).notNull(),
    dueAt: text("due_at").notNull(),
    status: text("status").notNull().default("scheduled"),
    scenarioActionId: text("scenario_action_id"),
    createdAt: text("created_at").notNull(),
    deliveredAt: text("delivered_at"),
    ackedAt: text("acked_at"),
  },
  (t) => [
    index("browser_events_session_idx").on(t.checkoutSessionId, t.eventSeq),
    index("browser_events_due_idx").on(t.status, t.dueAt),
  ],
);

export const auditEvents = sqliteTable(
  "audit_events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    occurredAt: text("occurred_at").notNull(),
    eventType: text("event_type").notNull(),
    resourceType: text("resource_type"),
    resourceId: text("resource_id"),
    detailsJson: text("details_json", { mode: "json" }),
  },
  (t) => [index("audit_events_resource_idx").on(t.resourceType, t.resourceId)],
);

export const clockState = sqliteTable("clock_state", {
  id: integer("id").primaryKey().default(1),
  mode: text("mode").notNull().default("real"),
  manualTimeMs: integer("manual_time_ms"),
  updatedAt: text("updated_at").notNull(),
});

export const adminSessions = sqliteTable("admin_sessions", {
  id: text("id").primaryKey(),
  sessionTokenHash: text("session_token_hash").notNull(),
  csrfToken: text("csrf_token").notNull(),
  createdAt: text("created_at").notNull(),
  idleExpiresAt: text("idle_expires_at").notNull(),
  absoluteExpiresAt: text("absolute_expires_at").notNull(),
});

export const bootstrapTokens = sqliteTable("bootstrap_tokens", {
  id: integer("id").primaryKey().default(1),
  tokenHash: text("token_hash").notNull(),
  consumed: integer("consumed", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull(),
});

export const schemaCreatedAtDefault = sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`;
