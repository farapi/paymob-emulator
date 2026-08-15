import { randomBytes } from "node:crypto";
import { ulid } from "ulid";

// Fictional simulator id formats. Never resemble real Paymob credentials.

export function generateIntentionId(): string {
  return `pi_sim_${ulid()}`;
}

export function generateClientSecret(): string {
  return `csk_test_sim_${ulid()}`;
}

export function generateSavedClientSecret(): string {
  return `csk_test_sim_saved_${ulid()}`;
}

export function generateLegacyAuthToken(): string {
  return `auth_sim_${ulid()}`;
}

export function generatePaymentToken(): string {
  return `pt_sim_${ulid()}`;
}

export function generateCardToken(): string {
  return `tok_sim_${ulid()}`;
}

export function generateDeliveryId(): string {
  return `whd_sim_${ulid()}`;
}

export function generateOpaqueId(prefix: string): string {
  return `${prefix}_${ulid()}`;
}

export function generateChannelNonce(): string {
  return randomBytes(16).toString("base64url");
}

export function clientSecretDisplaySuffix(clientSecret: string): string {
  return clientSecret.slice(-6);
}
