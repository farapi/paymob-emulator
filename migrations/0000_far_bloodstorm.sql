CREATE TABLE `admin_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`session_token_hash` text NOT NULL,
	`csrf_token` text NOT NULL,
	`created_at` text NOT NULL,
	`idle_expires_at` text NOT NULL,
	`absolute_expires_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `audit_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`occurred_at` text NOT NULL,
	`event_type` text NOT NULL,
	`resource_type` text,
	`resource_id` text,
	`details_json` text
);
--> statement-breakpoint
CREATE INDEX `audit_events_resource_idx` ON `audit_events` (`resource_type`,`resource_id`);--> statement-breakpoint
CREATE TABLE `bootstrap_tokens` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`token_hash` text NOT NULL,
	`consumed` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `browser_events` (
	`id` text PRIMARY KEY NOT NULL,
	`checkout_session_id` text NOT NULL,
	`transaction_id` text,
	`event_seq` integer NOT NULL,
	`type` text NOT NULL,
	`payload_json` text NOT NULL,
	`due_at` text NOT NULL,
	`status` text DEFAULT 'scheduled' NOT NULL,
	`scenario_action_id` text,
	`created_at` text NOT NULL,
	`delivered_at` text,
	`acked_at` text
);
--> statement-breakpoint
CREATE INDEX `browser_events_session_idx` ON `browser_events` (`checkout_session_id`,`event_seq`);--> statement-breakpoint
CREATE INDEX `browser_events_due_idx` ON `browser_events` (`status`,`due_at`);--> statement-breakpoint
CREATE TABLE `callback_events` (
	`id` text PRIMARY KEY NOT NULL,
	`transaction_id` text,
	`event_type` text NOT NULL,
	`canonical` integer DEFAULT true NOT NULL,
	`body_bytes` text NOT NULL,
	`content_type` text DEFAULT 'application/json' NOT NULL,
	`hmac` text NOT NULL,
	`signature_mode` text DEFAULT 'valid' NOT NULL,
	`source_snapshot_id` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `card_tokens` (
	`id` integer PRIMARY KEY NOT NULL,
	`token` text NOT NULL,
	`masked_pan` text NOT NULL,
	`merchant_id` integer NOT NULL,
	`card_subtype` text NOT NULL,
	`email` text NOT NULL,
	`order_id` text NOT NULL,
	`user_added` integer DEFAULT false NOT NULL,
	`next_payment_intention_id` text,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `card_tokens_token_unique` ON `card_tokens` (`token`);--> statement-breakpoint
CREATE TABLE `checkout_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`ticket_hash` text NOT NULL,
	`kind` text NOT NULL,
	`intention_id` text,
	`payment_token_id` text,
	`last_event_cursor` integer DEFAULT 0 NOT NULL,
	`last_heartbeat_at` text,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `clock_state` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`mode` text DEFAULT 'real' NOT NULL,
	`manual_time_ms` integer,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `credential_versions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`version` integer NOT NULL,
	`value` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `credential_versions_kind_version_idx` ON `credential_versions` (`kind`,`version`);--> statement-breakpoint
CREATE TABLE `id_counters` (
	`key` text PRIMARY KEY NOT NULL,
	`next_value` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `integrations` (
	`id` integer PRIMARY KEY NOT NULL,
	`iframe_id` integer,
	`name` text NOT NULL,
	`payment_method` text DEFAULT 'card' NOT NULL,
	`source_subtype` text DEFAULT 'Visa' NOT NULL,
	`iframe_completion_mode` text DEFAULT 'post_message_and_redirect' NOT NULL,
	`notification_url` text,
	`redirection_url` text,
	`legacy_enabled` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `integrations_iframe_id_unique` ON `integrations` (`iframe_id`);--> statement-breakpoint
CREATE TABLE `intentions` (
	`id` text PRIMARY KEY NOT NULL,
	`client_secret_hash` text NOT NULL,
	`client_secret_display_suffix` text NOT NULL,
	`special_reference` text,
	`amount` integer NOT NULL,
	`currency` text NOT NULL,
	`payment_method_ids_json` text NOT NULL,
	`billing_data_json` text,
	`customer_json` text,
	`items_json` text,
	`extras_json` text,
	`raw_request_json` text NOT NULL,
	`notification_url` text,
	`redirection_url` text,
	`integration_id` integer,
	`status` text NOT NULL,
	`scenario_id` text,
	`scenario_selection_source` text,
	`random_seed` integer,
	`idempotency_key` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`expires_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `intentions_client_secret_hash_unique` ON `intentions` (`client_secret_hash`);--> statement-breakpoint
CREATE INDEX `intentions_special_reference_idx` ON `intentions` (`special_reference`);--> statement-breakpoint
CREATE TABLE `legacy_auth_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`profile_id` integer NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `legacy_auth_tokens_token_hash_unique` ON `legacy_auth_tokens` (`token_hash`);--> statement-breakpoint
CREATE TABLE `legacy_orders` (
	`id` integer PRIMARY KEY NOT NULL,
	`merchant_order_id` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`currency` text NOT NULL,
	`delivery_needed` integer DEFAULT false NOT NULL,
	`items_json` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `payment_operations` (
	`id` text PRIMARY KEY NOT NULL,
	`transaction_id` text NOT NULL,
	`child_transaction_id` text NOT NULL,
	`operation_type` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`idempotency_key` text,
	`request_hash` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `payment_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`order_id` integer NOT NULL,
	`integration_id` integer NOT NULL,
	`amount_cents` integer NOT NULL,
	`currency` text NOT NULL,
	`status` text DEFAULT 'intended' NOT NULL,
	`scenario_id` text,
	`scenario_selection_source` text,
	`random_seed` integer,
	`idempotency_key` text,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payment_tokens_token_hash_unique` ON `payment_tokens` (`token_hash`);--> statement-breakpoint
CREATE TABLE `scenario_definitions` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`display_name` text NOT NULL,
	`classification` text NOT NULL,
	`definition_json` text NOT NULL,
	`file_path` text,
	`override_built_in` integer DEFAULT false NOT NULL,
	`override_database` integer DEFAULT false NOT NULL,
	`writable` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `scenario_expectations` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`match_json` text NOT NULL,
	`scenario_id` text,
	`response_json` text,
	`times_total` integer DEFAULT 1 NOT NULL,
	`times_remaining` integer DEFAULT 1 NOT NULL,
	`consumed` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `scenario_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`scenario_id` text NOT NULL,
	`revision_hash` text NOT NULL,
	`definition_json` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `scenario_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`intention_id` text,
	`payment_token_id` text,
	`transaction_id` text,
	`scenario_id` text NOT NULL,
	`scenario_revision_id` text NOT NULL,
	`notification_url` text,
	`redirection_url` text,
	`integration_id` integer,
	`hmac_secret_version` integer NOT NULL,
	`clock_mode` text NOT NULL,
	`random_seed` integer NOT NULL,
	`selection_source` text NOT NULL,
	`submitted_at` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `scheduled_actions` (
	`id` text PRIMARY KEY NOT NULL,
	`transaction_id` text,
	`scenario_run_id` text,
	`scenario_action_id` text NOT NULL,
	`action_type` text NOT NULL,
	`payload_json` text NOT NULL,
	`due_at` text NOT NULL,
	`status` text DEFAULT 'scheduled' NOT NULL,
	`lease_owner` text,
	`lease_expires_at` text,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`step_index` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `scheduled_actions_due_idx` ON `scheduled_actions` (`status`,`due_at`);--> statement-breakpoint
CREATE INDEX `scheduled_actions_transaction_id_idx` ON `scheduled_actions` (`transaction_id`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `transaction_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`transaction_id` text NOT NULL,
	`canonical` integer NOT NULL,
	`state` text NOT NULL,
	`payload_json` text NOT NULL,
	`source_action_id` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`provider_numeric_id` integer NOT NULL,
	`intention_id` text,
	`legacy_order_id` integer,
	`parent_transaction_id` text,
	`state` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`currency` text NOT NULL,
	`integration_id` integer NOT NULL,
	`profile_id` integer NOT NULL,
	`owner_id` integer NOT NULL,
	`order_id` integer NOT NULL,
	`merchant_order_id` text NOT NULL,
	`source_type` text DEFAULT 'card' NOT NULL,
	`source_sub_type` text DEFAULT 'Visa' NOT NULL,
	`source_last_four` text NOT NULL,
	`is_3d_secure` integer DEFAULT false NOT NULL,
	`is_standalone_payment` integer DEFAULT false NOT NULL,
	`authorized_amount_cents` integer,
	`captured_amount_cents` integer DEFAULT 0 NOT NULL,
	`refunded_amount_cents` integer DEFAULT 0 NOT NULL,
	`has_parent_transaction` integer DEFAULT false NOT NULL,
	`operation_type` text,
	`decline_message` text,
	`scenario_run_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`paid_at` text,
	`failed_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `transactions_provider_numeric_id_unique` ON `transactions` (`provider_numeric_id`);--> statement-breakpoint
CREATE INDEX `transactions_intention_id_idx` ON `transactions` (`intention_id`);--> statement-breakpoint
CREATE INDEX `transactions_merchant_order_id_idx` ON `transactions` (`merchant_order_id`);--> statement-breakpoint
CREATE INDEX `transactions_parent_transaction_id_idx` ON `transactions` (`parent_transaction_id`);--> statement-breakpoint
CREATE TABLE `webhook_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`delivery_id` text NOT NULL,
	`attempt_number` integer NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text,
	`request_headers_json` text,
	`response_status` integer,
	`response_headers_json` text,
	`response_body_excerpt` text,
	`transport_error_code` text,
	`duration_ms` integer,
	`retry_decision` text
);
--> statement-breakpoint
CREATE INDEX `webhook_attempts_delivery_id_idx` ON `webhook_attempts` (`delivery_id`);--> statement-breakpoint
CREATE TABLE `webhook_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`transaction_id` text,
	`callback_event_id` text NOT NULL,
	`event_type` text NOT NULL,
	`target_url` text NOT NULL,
	`scheduled_action_id` text,
	`original_delivery_id` text,
	`status` text DEFAULT 'scheduled' NOT NULL,
	`next_attempt_at` text,
	`created_at` text NOT NULL,
	`completed_at` text
);
--> statement-breakpoint
CREATE INDEX `webhook_deliveries_transaction_id_idx` ON `webhook_deliveries` (`transaction_id`);