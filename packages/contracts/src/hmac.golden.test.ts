import { describe, expect, it } from "vitest";
import {
  cardTokenHmacConcatenation,
  computeCardTokenHmac,
  computeTransactionHmac,
  flipLastHexNibble,
  transactionHmacConcatenation,
  type CardTokenHmacFields,
  type TransactionHmacFields,
} from "./hmac.js";

// Golden fixtures frozen in spec section 14.3, 14.5, 14.6. These MUST NOT
// change silently: any refactor that breaks these means the canonicalization
// or field order changed, which breaks every merchant integration relying on
// the documented HMAC contract.

const SECRET = "sim_hmac_secret";

const CANONICAL_SUCCESS: TransactionHmacFields = {
  amountCents: 10000,
  createdAt: "2026-08-14T12:00:00.000000",
  currency: "EGP",
  errorOccured: false,
  hasParentTransaction: false,
  id: 900001,
  integrationId: 1001,
  is3dSecure: false,
  isAuth: false,
  isCapture: false,
  isRefunded: false,
  isStandalonePayment: true,
  isVoided: false,
  orderId: 700001,
  owner: 500001,
  pending: false,
  sourceDataPan: "0010",
  sourceDataSubType: "Visa",
  sourceDataType: "card",
  success: true,
};

describe("transaction HMAC golden fixtures", () => {
  it("matches the canonical success concatenation and digest", () => {
    expect(transactionHmacConcatenation(CANONICAL_SUCCESS)).toBe(
      "100002026-08-14T12:00:00.000000EGPfalsefalse9000011001falsefalsefalsefalsetruefalse700001500001false0010Visacardtrue",
    );
    expect(computeTransactionHmac(CANONICAL_SUCCESS, SECRET)).toBe(
      "033e0bca25918ecf037674c6f9e3ed1c11ba969f16b647f39cf0c404bdcf6db767e0fbe9dc8a523cbc8d19e459c3843222d167201f4705657002eb3671f2619b",
    );
  });

  it("matches the decline projection digest", () => {
    const decline: TransactionHmacFields = {
      ...CANONICAL_SUCCESS,
      success: false,
      errorOccured: true,
    };
    expect(computeTransactionHmac(decline, SECRET)).toBe(
      "3a2ddb6a531a6e457b0ad2a8bb0d535fc87ffc97d9f8180b3037a2635c0ce380a77c8d4f9cd2840374ffd3e4c1103a75ff293b28b3643caaaf9a6f6891fb1ddc",
    );
  });

  it("matches the pending-adversarial projection digest", () => {
    const pending: TransactionHmacFields = {
      ...CANONICAL_SUCCESS,
      pending: true,
      success: false,
      errorOccured: false,
    };
    expect(computeTransactionHmac(pending, SECRET)).toBe(
      "1f8f22b11fd177b0bdbd8052e0aafce007ebe4486252daf04be26f9fe2c1de68e22f169d4e934313c372eae8690df341c8e25677cc1a6906ac4613bb0059fda4",
    );
  });

  it("flips exactly the last hex nibble for the invalid-HMAC scenario", () => {
    const valid = computeTransactionHmac(CANONICAL_SUCCESS, SECRET);
    const corrupted = flipLastHexNibble(valid);
    expect(corrupted).not.toBe(valid);
    expect(corrupted.slice(0, -1)).toBe(valid.slice(0, -1));
    expect(corrupted).toHaveLength(valid.length);
  });
});

describe("card-token HMAC golden fixture", () => {
  const TOKEN_FIELDS: CardTokenHmacFields = {
    cardSubtype: "Visa",
    createdAt: "2026-08-14T12:00:00.000000",
    email: "test@example.com",
    id: 800001,
    maskedPan: "xxxx-xxxx-xxxx-0010",
    merchantId: 500001,
    orderId: "700001",
    token: "tok_sim_01J5A7V8M8QK6R2D1N4B9C3E5F",
  };

  it("matches the documented concatenation and digest", () => {
    expect(cardTokenHmacConcatenation(TOKEN_FIELDS)).toBe(
      "Visa2026-08-14T12:00:00.000000test@example.com800001xxxx-xxxx-xxxx-0010500001700001tok_sim_01J5A7V8M8QK6R2D1N4B9C3E5F",
    );
    expect(computeCardTokenHmac(TOKEN_FIELDS, SECRET)).toBe(
      "9492bf9da9bf2d3f31ffca5a1d6cbb08f01c8149a010edac20a96bd3d2b56e933a63ad3b53d4bafdfb92d4ba6a5b4a8713461c5e7b5b3a628351196da6476c32",
    );
  });
});
