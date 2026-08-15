import { describe, expect, it } from "vitest";
import { parseAllowlist } from "../security/allowlist.js";
import { validateCreateIntentionInput, type IntentionValidationContext } from "./intention-validation.js";

const baseCtx: IntentionValidationContext = {
  mode: "realistic",
  configuredIntegrationIds: new Set([1001]),
  webhookAllowlist: parseAllowlist(["backend", "host.docker.internal", "localhost"]),
  allowedRedirectOrigins: ["http://localhost:3000"],
};

describe("validateCreateIntentionInput (realistic)", () => {
  it("accepts the minimal documented shape", () => {
    const result = validateCreateIntentionInput(
      { amount: 10_000, currency: "EGP", payment_methods: [1001] },
      baseCtx,
    );
    expect(result.ok).toBe(true);
  });

  it("rejects missing amount/currency/payment_methods with 422", () => {
    const result = validateCreateIntentionInput({}, baseCtx);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(422);
  });

  it("rejects an unknown integration id with 404", () => {
    const result = validateCreateIntentionInput(
      { amount: 10_000, currency: "EGP", payment_methods: [9999] },
      baseCtx,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(404);
  });

  it("rejects mismatched item totals with 406", () => {
    const result = validateCreateIntentionInput(
      {
        amount: 10_000,
        currency: "EGP",
        payment_methods: [1001],
        items: [{ name: "Order item", amount: 5_000, quantity: 1 }],
      },
      baseCtx,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(406);
  });

  it("accepts matching item totals with quantity applied", () => {
    const result = validateCreateIntentionInput(
      {
        amount: 10_000,
        currency: "EGP",
        payment_methods: [1001],
        items: [{ name: "Order item", amount: 5_000, quantity: 2 }],
      },
      baseCtx,
    );
    expect(result.ok).toBe(true);
  });

  it("does not require items/billing_data/customer", () => {
    const result = validateCreateIntentionInput(
      { amount: 10_000, currency: "EGP", payment_methods: [1001] },
      baseCtx,
    );
    expect(result.ok).toBe(true);
  });

  it("rejects a notification_url outside the allowlist", () => {
    const result = validateCreateIntentionInput(
      {
        amount: 10_000,
        currency: "EGP",
        payment_methods: [1001],
        notification_url: "http://evil.example.com/hook",
      },
      baseCtx,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(422);
  });

  it("rejects a redirection_url outside allowedRedirectOrigins", () => {
    const result = validateCreateIntentionInput(
      {
        amount: 10_000,
        currency: "EGP",
        payment_methods: [1001],
        redirection_url: "http://evil.example.com/result",
      },
      baseCtx,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(422);
  });
});

describe("validateCreateIntentionInput (strict_docs)", () => {
  const strictCtx: IntentionValidationContext = { ...baseCtx, mode: "strict_docs" };

  it("requires at least one item and full billing/customer fields", () => {
    const result = validateCreateIntentionInput(
      { amount: 10_000, currency: "EGP", payment_methods: [1001] },
      strictCtx,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(422);
  });

  it("accepts a fully-populated strict_docs request", () => {
    const result = validateCreateIntentionInput(
      {
        amount: 10_000,
        currency: "EGP",
        payment_methods: [1001],
        items: [{ name: "Order item", amount: 10_000, quantity: 1 }],
        billing_data: {
          first_name: "Test",
          last_name: "Customer",
          email: "test@example.com",
          phone_number: "+201000000000",
          apartment: "NA",
          floor: "NA",
          street: "NA",
          building: "NA",
          shipping_method: "NA",
          postal_code: "NA",
          city: "Cairo",
          country: "EG",
          state: "Cairo",
        },
        customer: { first_name: "Test", last_name: "Customer", email: "test@example.com" },
      },
      strictCtx,
    );
    expect(result.ok).toBe(true);
  });
});

describe("validateCreateIntentionInput (permissive)", () => {
  const permissiveCtx: IntentionValidationContext = { ...baseCtx, mode: "permissive" };

  it("only requires amount and currency", () => {
    const result = validateCreateIntentionInput({ amount: 10_000, currency: "EGP" }, permissiveCtx);
    expect(result.ok).toBe(true);
  });

  it("ignores unknown integration ids", () => {
    const result = validateCreateIntentionInput(
      { amount: 10_000, currency: "EGP", payment_methods: [424242] },
      permissiveCtx,
    );
    expect(result.ok).toBe(true);
  });
});
