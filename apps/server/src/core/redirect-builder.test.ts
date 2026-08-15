import { describe, expect, it } from "vitest";
import type { TransactionObj } from "@paymob-simulator/contracts";
import { buildRedirectUrl } from "./redirect-builder.js";

const CANONICAL_OBJ: TransactionObj = {
  id: 900001,
  pending: false,
  amount_cents: 10000,
  success: true,
  is_auth: false,
  is_capture: false,
  is_standalone_payment: true,
  is_voided: false,
  is_refunded: false,
  is_3d_secure: false,
  integration_id: 1001,
  profile_id: 500001,
  has_parent_transaction: false,
  order: {
    id: 700001,
    created_at: "2026-08-14T12:00:00.000000",
    delivery_needed: false,
    merchant: { id: 500001 },
    collector: null,
    amount_cents: 10000,
    shipping_data: null,
    currency: "EGP",
    is_payment_locked: false,
    merchant_order_id: "ORDER-123",
    wallet_notification: null,
    paid_amount_cents: 10000,
    notify_user_with_email: false,
    items: [],
  },
  created_at: "2026-08-14T12:00:00.000000",
  currency: "EGP",
  source_data: { type: "card", pan: "0010", sub_type: "Visa" },
  api_source: "OTHER",
  terminal_id: null,
  merchant_commission: 0,
  installment: null,
  discount_details: [],
  is_void: false,
  is_refund: false,
  data: { message: "Approved" },
  is_hidden: false,
  payment_key_claims: {},
  error_occured: false,
  is_live: false,
  other_endpoint_reference: null,
  refunded_amount_cents: 0,
  source_id: -1,
  is_captured: false,
  captured_amount: 0,
  merchant_staff_tag: null,
  owner: 500001,
  parent_transaction: null,
};

const SECRET = "sim_hmac_secret";
const GOLDEN_HMAC =
  "033e0bca25918ecf037674c6f9e3ed1c11ba969f16b647f39cf0c404bdcf6db767e0fbe9dc8a523cbc8d19e459c3843222d167201f4705657002eb3671f2619b";

describe("buildRedirectUrl", () => {
  it("both order/order_id profiles produce the same golden HMAC with the documented key label", () => {
    const orderUrl = buildRedirectUrl({
      baseUrl: "http://localhost:3000/payment/result",
      mode: "paymob_query_order",
      obj: CANONICAL_OBJ,
      browserStatus: "success",
      hmacSecret: SECRET,
    });
    const orderIdUrl = buildRedirectUrl({
      baseUrl: "http://localhost:3000/payment/result",
      mode: "paymob_query_order_id",
      obj: CANONICAL_OBJ,
      browserStatus: "success",
      hmacSecret: SECRET,
    });

    const orderParsed = new URL(orderUrl);
    const orderIdParsed = new URL(orderIdUrl);

    expect(orderParsed.searchParams.get("order")).toBe("700001");
    expect(orderParsed.searchParams.has("order_id")).toBe(false);
    expect(orderIdParsed.searchParams.get("order_id")).toBe("700001");
    expect(orderIdParsed.searchParams.has("order")).toBe(false);

    expect(orderParsed.searchParams.get("hmac")).toBe(GOLDEN_HMAC);
    expect(orderIdParsed.searchParams.get("hmac")).toBe(GOLDEN_HMAC);
  });

  it("preserves unrelated merchant query parameters and removes pre-existing owned keys", () => {
    const url = buildRedirectUrl({
      baseUrl: "http://localhost:3000/payment/result?utm_source=ad&hmac=stale&amount=999",
      mode: "paymob_query_order",
      obj: CANONICAL_OBJ,
      browserStatus: "success",
      hmacSecret: SECRET,
    });
    const parsed = new URL(url);
    expect(parsed.searchParams.get("utm_source")).toBe("ad");
    expect(parsed.searchParams.getAll("hmac")).toHaveLength(1);
    expect(parsed.searchParams.get("hmac")).toBe(GOLDEN_HMAC);
    expect(parsed.searchParams.has("amount")).toBe(false);
  });

  it("minimal_status appends only simulator_status and transaction_id, unsigned", () => {
    const url = buildRedirectUrl({
      baseUrl: "http://localhost:3000/payment/result",
      mode: "minimal_status",
      obj: CANONICAL_OBJ,
      browserStatus: "pending",
      hmacSecret: SECRET,
    });
    const parsed = new URL(url);
    expect(parsed.searchParams.get("simulator_status")).toBe("pending");
    expect(parsed.searchParams.get("transaction_id")).toBe("900001");
    expect(parsed.searchParams.has("hmac")).toBe(false);
  });

  it("no_parameters navigates to the configured URL unchanged", () => {
    const url = buildRedirectUrl({
      baseUrl: "http://localhost:3000/payment/result?x=1",
      mode: "no_parameters",
      obj: CANONICAL_OBJ,
      browserStatus: "success",
      hmacSecret: SECRET,
    });
    expect(url).toBe("http://localhost:3000/payment/result?x=1");
  });
});
