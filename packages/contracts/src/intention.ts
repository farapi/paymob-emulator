import { z } from "zod";

// Modern Intention API request/response subset (spec section 9.1).

export const intentionItemSchema = z.object({
  name: z.string().max(4096),
  amount: z.number().int().nonnegative(),
  description: z.string().max(4096).optional(),
  quantity: z.number().int().positive().optional().default(1),
});
export type IntentionItem = z.infer<typeof intentionItemSchema>;

export const billingDataSchema = z
  .object({
    first_name: z.string().max(4096).optional(),
    last_name: z.string().max(4096).optional(),
    email: z.string().max(4096).optional(),
    phone_number: z.string().max(4096).optional(),
    apartment: z.string().max(4096).optional(),
    floor: z.string().max(4096).optional(),
    street: z.string().max(4096).optional(),
    building: z.string().max(4096).optional(),
    shipping_method: z.string().max(4096).optional(),
    postal_code: z.string().max(4096).optional(),
    city: z.string().max(4096).optional(),
    country: z.string().max(4096).optional(),
    state: z.string().max(4096).optional(),
  })
  .passthrough();
export type BillingData = z.infer<typeof billingDataSchema>;

export const customerSchema = z
  .object({
    first_name: z.string().max(4096).optional(),
    last_name: z.string().max(4096).optional(),
    email: z.string().max(4096).optional(),
  })
  .passthrough();
export type Customer = z.infer<typeof customerSchema>;

// Base shape shared by create and update. Validation-mode-specific
// requiredness is enforced in the server layer, not here.
export const createIntentionRequestSchema = z
  .object({
    amount: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/, "currency must be an uppercase three-letter ASCII code"),
    payment_methods: z.array(z.number().int().positive()),
    items: z.array(intentionItemSchema).optional(),
    billing_data: billingDataSchema.optional(),
    customer: customerSchema.optional(),
    special_reference: z.string().max(4096).optional(),
    notification_url: z.string().max(4096).nullable().optional(),
    redirection_url: z.string().max(4096).nullable().optional(),
    expiration: z.number().int().min(60).max(86400).optional().default(3600),
    extras: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();
export type CreateIntentionRequest = z.infer<typeof createIntentionRequestSchema>;

export const updateIntentionRequestSchema = createIntentionRequestSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  { message: "update request body must not be empty" },
);
export type UpdateIntentionRequest = z.infer<typeof updateIntentionRequestSchema>;

export const intentionDetailSchema = z.object({
  amount: z.number().int().nonnegative(),
  currency: z.string(),
});

export const createIntentionResponseSchema = z.object({
  id: z.string(),
  client_secret: z.string(),
  intention_detail: intentionDetailSchema,
});
export type CreateIntentionResponse = z.infer<typeof createIntentionResponseSchema>;

// Simulator extension: GET /v1/intention/:id (spec section 9.1).
export const intentionExtensionResponseSchema = createIntentionResponseSchema.extend({
  status: z.string(),
  special_reference: z.string().optional(),
  created_at: z.string(),
  expires_at: z.string(),
});
export type IntentionExtensionResponse = z.infer<typeof intentionExtensionResponseSchema>;

// Public checkout projection: GET /v1/intention/element/:publicKey/:clientSecret/
export const intentionElementResponseSchema = z.object({
  id: z.string(),
  amount: z.number().int().nonnegative(),
  currency: z.string(),
  status: z.string(),
  special_reference: z.string().optional(),
  expires_at: z.string(),
  payment_methods: z.array(z.number().int().positive()),
});
export type IntentionElementResponse = z.infer<typeof intentionElementResponseSchema>;

// Frozen simulator compatibility error bodies (spec section 9.1).
export const incorrectCredentialsError = { detail: "incorrect credentials" } as const;
export const integrationNotFoundError = { detail: "Integration not found" } as const;
export const unmatchedItemPricesError = {
  detail: "unmatched_item_prices",
  code: "unmatched_item_prices",
} as const;

export interface FieldValidationErrorItem {
  loc: (string | number)[];
  msg: string;
  type: string;
}

export function fieldValidationError(items: FieldValidationErrorItem[]) {
  return { detail: items };
}
