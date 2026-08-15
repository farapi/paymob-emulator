import { createHash } from "node:crypto";

// Deterministic fast hashing for high-entropy simulator secrets that must be
// looked up by value (client secrets, legacy auth/payment tokens). These are
// already unguessable random ids, so a keyed SHA-256 digest -- rather than
// Argon2id, which would make every checkout page load slow -- is sufficient
// to avoid storing them recoverably in the database (spec section 18.2).

export function hashOpaqueSecret(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
