import type { ValidationMode } from "@paymob-simulator/contracts";
import {
  billingDataSchema,
  customerSchema,
  fieldValidationError,
  integrationNotFoundError,
  intentionItemSchema,
  unmatchedItemPricesError,
  type BillingData,
  type Customer,
  type FieldValidationErrorItem,
  type IntentionItem,
} from "@paymob-simulator/contracts";
import { z } from "zod";
import { checkOutboundUrlPolicy } from "../security/url-policy.js";
import { checkRedirectOriginPolicy } from "../security/url-policy.js";
import type { AllowlistEntry } from "../security/allowlist.js";

// Validation-mode-aware business rules layered on top of the base zod shape
// in @paymob-simulator/contracts (spec section 9.1).

export interface RawIntentionInput {
  amount?: unknown;
  currency?: unknown;
  payment_methods?: unknown;
  items?: unknown;
  billing_data?: unknown;
  customer?: unknown;
  special_reference?: unknown;
  notification_url?: unknown;
  redirection_url?: unknown;
  expiration?: unknown;
  extras?: unknown;
  [key: string]: unknown;
}

export interface NormalizedIntentionInput {
  amount: number;
  currency: string;
  paymentMethodIds: number[];
  items: IntentionItem[];
  billingData: BillingData | undefined;
  customer: Customer | undefined;
  specialReference: string | undefined;
  notificationUrl: string | undefined;
  redirectionUrl: string | undefined;
  expiration: number;
  extras: Record<string, unknown> | undefined;
}

export type ValidationFailure =
  | { ok: false; status: 404; body: typeof integrationNotFoundError }
  | { ok: false; status: 406; body: typeof unmatchedItemPricesError }
  | { ok: false; status: 422; body: ReturnType<typeof fieldValidationError> };

export type ValidationResult = { ok: true; data: NormalizedIntentionInput } | ValidationFailure;

function issue(loc: (string | number)[], msg: string): FieldValidationErrorItem {
  return { loc, msg, type: "value_error" };
}

function reject422(issues: FieldValidationErrorItem[]): ValidationFailure {
  return { ok: false, status: 422, body: fieldValidationError(issues) };
}

function sumItemTotal(items: IntentionItem[]): number | "overflow" {
  let total = 0;
  for (const item of items) {
    const qty = item.quantity ?? 1;
    const lineTotal = item.amount * qty;
    if (!Number.isSafeInteger(lineTotal) || !Number.isSafeInteger(total + lineTotal)) return "overflow";
    total += lineTotal;
  }
  return total;
}

export interface IntentionValidationContext {
  mode: ValidationMode;
  configuredIntegrationIds: ReadonlySet<number>;
  webhookAllowlist: readonly AllowlistEntry[];
  allowedRedirectOrigins: readonly string[];
}

export function validateCreateIntentionInput(
  raw: RawIntentionInput,
  ctx: IntentionValidationContext,
): ValidationResult {
  const issues: FieldValidationErrorItem[] = [];

  if (typeof raw.amount !== "number" || !Number.isInteger(raw.amount) || raw.amount <= 0) {
    issues.push(issue(["body", "amount"], "amount must be a positive integer in the smallest currency unit"));
  }
  if (typeof raw.currency !== "string" || !/^[A-Z]{3}$/.test(raw.currency)) {
    issues.push(issue(["body", "currency"], "currency must be an uppercase three-letter ASCII code"));
  }

  const paymentMethodsProvided = raw.payment_methods !== undefined;
  let paymentMethodIds: number[] = [];
  if (paymentMethodsProvided) {
    const parsed = z.array(z.number().int().positive()).safeParse(raw.payment_methods);
    if (!parsed.success) {
      issues.push(issue(["body", "payment_methods"], "payment_methods must be an array of positive integers"));
    } else {
      paymentMethodIds = parsed.data;
      if (new Set(paymentMethodIds).size !== paymentMethodIds.length) {
        issues.push(issue(["body", "payment_methods"], "payment_methods must not contain duplicates"));
      }
    }
  }

  if (ctx.mode !== "permissive" && !paymentMethodsProvided) {
    issues.push(issue(["body", "payment_methods"], "payment_methods is required"));
  } else if (ctx.mode !== "permissive" && paymentMethodIds.length === 0 && paymentMethodsProvided) {
    issues.push(issue(["body", "payment_methods"], "payment_methods must be a non-empty array"));
  }

  let items: IntentionItem[] = [];
  if (raw.items !== undefined) {
    const parsedItems = z.array(intentionItemSchema).safeParse(raw.items);
    if (!parsedItems.success) {
      issues.push(issue(["body", "items"], "items has an invalid shape"));
    } else {
      items = parsedItems.data;
    }
  }
  if (ctx.mode === "strict_docs" && items.length === 0) {
    issues.push(issue(["body", "items"], "at least one item is required in strict_docs mode"));
  }

  let billingData: BillingData | undefined;
  if (raw.billing_data !== undefined) {
    const parsedBilling = billingDataSchema.safeParse(raw.billing_data);
    if (!parsedBilling.success) {
      issues.push(issue(["body", "billing_data"], "billing_data has an invalid shape"));
    } else {
      billingData = parsedBilling.data;
    }
  }
  if (ctx.mode === "strict_docs") {
    const required: (keyof BillingData)[] = [
      "first_name",
      "last_name",
      "email",
      "phone_number",
      "apartment",
      "floor",
      "street",
      "building",
      "shipping_method",
      "postal_code",
      "city",
      "country",
      "state",
    ];
    for (const field of required) {
      const value = billingData?.[field];
      if (typeof value !== "string" || value.length === 0) {
        issues.push(issue(["body", "billing_data", field], `billing_data.${field} is required in strict_docs mode`));
      }
    }
  }

  let customer: Customer | undefined;
  if (raw.customer !== undefined) {
    const parsedCustomer = customerSchema.safeParse(raw.customer);
    if (!parsedCustomer.success) {
      issues.push(issue(["body", "customer"], "customer has an invalid shape"));
    } else {
      customer = parsedCustomer.data;
    }
  }
  if (ctx.mode === "strict_docs") {
    for (const field of ["first_name", "last_name", "email"] as const) {
      if (typeof customer?.[field] !== "string" || customer[field]?.length === 0) {
        issues.push(issue(["body", "customer", field], `customer.${field} is required in strict_docs mode`));
      }
    }
  }

  let expiration = 3600;
  if (raw.expiration !== undefined) {
    const parsedExpiration = z.number().int().min(60).max(86_400).safeParse(raw.expiration);
    if (!parsedExpiration.success) {
      issues.push(issue(["body", "expiration"], "expiration must be an integer between 60 and 86400 seconds"));
    } else {
      expiration = parsedExpiration.data;
    }
  }

  let specialReference: string | undefined;
  if (raw.special_reference !== undefined) {
    if (typeof raw.special_reference !== "string") {
      issues.push(issue(["body", "special_reference"], "special_reference must be a string"));
    } else {
      specialReference = raw.special_reference;
    }
  }

  let extras: Record<string, unknown> | undefined;
  if (raw.extras !== undefined) {
    if (typeof raw.extras !== "object" || raw.extras === null || Array.isArray(raw.extras)) {
      issues.push(issue(["body", "extras"], "extras must be an object"));
    } else {
      extras = raw.extras as Record<string, unknown>;
    }
  }

  if (issues.length > 0) {
    return reject422(issues);
  }

  // Integration existence: realistic/strict_docs require every payment method
  // id to be a configured integration; permissive tolerates unknown ids.
  if (ctx.mode !== "permissive") {
    for (const id of paymentMethodIds) {
      if (!ctx.configuredIntegrationIds.has(id)) {
        return { ok: false, status: 404, body: integrationNotFoundError };
      }
    }
  }

  if (items.length > 0) {
    const total = sumItemTotal(items);
    if (total === "overflow") {
      return reject422([issue(["body", "items"], "item total overflows the safe integer range")]);
    }
    if (typeof raw.amount === "number" && total !== raw.amount) {
      return { ok: false, status: 406, body: unmatchedItemPricesError };
    }
  }

  let notificationUrl: string | undefined;
  if (raw.notification_url !== undefined && raw.notification_url !== null) {
    if (typeof raw.notification_url !== "string") {
      return reject422([issue(["body", "notification_url"], "notification_url must be a string")]);
    }
    const policy = checkOutboundUrlPolicy(raw.notification_url, ctx.webhookAllowlist);
    if (!policy.ok) {
      return reject422([
        { loc: ["body", "notification_url"], msg: policy.reason, type: "callback_target_not_allowed" },
      ]);
    }
    notificationUrl = raw.notification_url;
  }

  let redirectionUrl: string | undefined;
  if (raw.redirection_url !== undefined && raw.redirection_url !== null) {
    if (typeof raw.redirection_url !== "string") {
      return reject422([issue(["body", "redirection_url"], "redirection_url must be a string")]);
    }
    const policy = checkRedirectOriginPolicy(raw.redirection_url, ctx.allowedRedirectOrigins);
    if (!policy.ok) {
      return reject422([
        { loc: ["body", "redirection_url"], msg: policy.reason, type: "redirect_origin_not_allowed" },
      ]);
    }
    redirectionUrl = raw.redirection_url;
  }

  return {
    ok: true,
    data: {
      amount: raw.amount as number,
      currency: raw.currency as string,
      paymentMethodIds,
      items,
      billingData,
      customer,
      specialReference,
      notificationUrl,
      redirectionUrl,
      expiration,
      extras,
    },
  };
}
