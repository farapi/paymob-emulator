// Minimal JSON-file order store. Proves restart persistence without pulling
// in a database dependency: orders survive a container restart as long as
// DATA_DIR is a mounted volume.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const DATA_DIR = process.env.DATA_DIR ?? "./data";
const ORDERS_FILE = join(DATA_DIR, "orders.json");

function ensureDir() {
  mkdirSync(dirname(ORDERS_FILE), { recursive: true });
}

function readAll() {
  if (!existsSync(ORDERS_FILE)) return {};
  try {
    return JSON.parse(readFileSync(ORDERS_FILE, "utf-8"));
  } catch {
    return {};
  }
}

function writeAll(orders) {
  ensureDir();
  // Write to a temp file then rename, so a crash mid-write never leaves
  // orders.json truncated/corrupt (rename is atomic on the same filesystem).
  const tmp = `${ORDERS_FILE}.tmp`;
  writeFileSync(tmp, JSON.stringify(orders, null, 2));
  renameSync(tmp, ORDERS_FILE);
}

export function getOrder(id) {
  return readAll()[id];
}

export function listOrders() {
  return Object.values(readAll()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function createOrder(order) {
  const orders = readAll();
  orders[order.id] = order;
  writeAll(orders);
  return order;
}

/**
 * Applies a status update from either channel (webhook or inquiry
 * reconciliation) idempotently: fulfillment only happens once, and a
 * duplicate/late update for an already-terminal order is a no-op. This is
 * the single place order state changes, called from both the webhook
 * handler and the inquiry-recovery path -- proving the two channels are
 * independent inputs to one source of truth, not two competing ones.
 */
export function applyTransactionUpdate(orderId, source, transactionObj) {
  const orders = readAll();
  const order = orders[orderId];
  if (!order) return undefined;

  if (order.status === "succeeded" || order.status === "failed") {
    order.history.push({ at: new Date().toISOString(), source, note: "ignored (already terminal)" });
    writeAll(orders);
    return order;
  }

  const status = transactionObj.pending ? "pending" : transactionObj.success ? "succeeded" : "failed";
  order.status = status;
  order.transactionId = transactionObj.id;
  order.lastUpdatedAt = new Date().toISOString();
  order.history.push({ at: order.lastUpdatedAt, source, status });
  orders[orderId] = order;
  writeAll(orders);
  return order;
}

export function recordRedirectSeen(orderId, transactionId, redirectSuccessHint) {
  const orders = readAll();
  const order = orders[orderId];
  if (!order) return undefined;
  order.redirectTransactionId = transactionId;
  order.redirectSeenAt = new Date().toISOString();
  order.history.push({ at: order.redirectSeenAt, source: "browser_redirect", note: `hint=${redirectSuccessHint}` });
  orders[orderId] = order;
  writeAll(orders);
  return order;
}
