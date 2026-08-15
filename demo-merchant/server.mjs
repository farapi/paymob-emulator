// Minimal demo merchant backend. Talks to Paymob Simulator only through
// documented Paymob-compatible HTTP endpoints -- no emulator-specific
// fields, no internal package imports. Proves:
//   1. Browser redirect and backend webhook are independent inputs to one
//      fulfillment path (lib/store.js's applyTransactionUpdate).
//   2. A delayed-success order stays pending until the simulator's manual
//      clock is advanced and the webhook actually arrives.
//   3. When a webhook never arrives, the merchant recovers the true status
//      by calling transaction inquiry using the transaction id learned from
//      the browser redirect.
//   4. Orders survive a container restart (lib/store.js's JSON file).
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { computeTransactionHmac, verifyHmac, verifyRedirectHmac } from "./lib/hmac.mjs";
import { applyTransactionUpdate, createOrder, getOrder, listOrders, recordRedirectSeen } from "./lib/store.mjs";

const PORT = Number(process.env.PORT ?? 3000);
const PAYMOB_BASE_URL = process.env.PAYMOB_BASE_URL ?? "http://localhost:8080";
const PAYMOB_PUBLIC_BASE_URL = process.env.PAYMOB_PUBLIC_BASE_URL ?? PAYMOB_BASE_URL;
const PAYMOB_SECRET_KEY = process.env.PAYMOB_SECRET_KEY ?? "sk_sim_local";
const PAYMOB_PUBLIC_KEY = process.env.PAYMOB_PUBLIC_KEY ?? "pk_sim_local";
const PAYMOB_API_KEY = process.env.PAYMOB_API_KEY ?? "api_sim_local";
const PAYMOB_HMAC_SECRET = process.env.PAYMOB_HMAC_SECRET ?? "sim_hmac_secret";
const SELF_BASE_URL = process.env.SELF_BASE_URL ?? `http://localhost:${PORT}`;
const SELF_PUBLIC_BASE_URL = process.env.SELF_PUBLIC_BASE_URL ?? SELF_BASE_URL;

const SCENARIOS = [
  { card: "9900000000000010", name: "Success (immediate)", note: "Webhook + redirect both fire right away." },
  { card: "9900000000000036", name: "Success (delayed 2m)", note: "Stays pending until the simulator's clock advances 2 minutes." },
  { card: "9900000000000069", name: "Success, no webhook", note: "Redirect looks successful but no webhook ever arrives -- exercises inquiry recovery." },
  { card: "9900000000000028", name: "Decline (immediate)", note: "Fails immediately." },
];

let cachedAuthToken = null;
let cachedAuthTokenExpiresAt = 0;

async function getLegacyAuthToken() {
  if (cachedAuthToken && Date.now() < cachedAuthTokenExpiresAt) return cachedAuthToken;
  const res = await fetch(`${PAYMOB_BASE_URL}/api/auth/tokens`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ api_key: PAYMOB_API_KEY }),
  });
  if (!res.ok) throw new Error(`auth token request failed: ${res.status}`);
  const body = await res.json();
  cachedAuthToken = body.token;
  cachedAuthTokenExpiresAt = Date.now() + 50 * 60 * 1000; // tokens live 60m; refresh a bit early
  return cachedAuthToken;
}

/** Missing-webhook recovery: ask the simulator directly using the transaction id learned from the redirect. */
async function reconcileViaInquiry(order) {
  if (!order.redirectTransactionId) return order;
  const token = await getLegacyAuthToken();
  const res = await fetch(`${PAYMOB_BASE_URL}/api/acceptance/transactions/${order.redirectTransactionId}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) return order;
  const transactionObj = await res.json();
  return applyTransactionUpdate(order.id, "inquiry", transactionObj);
}

function html(strings, ...values) {
  return strings.reduce((acc, s, i) => acc + s + (values[i] ?? ""), "");
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function layout(body) {
  return html`<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Demo Merchant (Paymob Simulator fixture)</title>
    <style>
      body { font-family: system-ui, sans-serif; max-width: 720px; margin: 40px auto; padding: 0 16px; color: #1a1d21; }
      .banner { background: #fff3cd; color: #7a5b00; padding: 10px; border-radius: 8px; font-weight: 700; margin-bottom: 20px; }
      .card { border: 1px solid #d7dbe0; border-radius: 10px; padding: 16px; margin-bottom: 12px; }
      .status-pending { color: #7a5b00; }
      .status-succeeded { color: #1a7f37; }
      .status-failed { color: #b3261e; }
      button { padding: 8px 12px; border-radius: 6px; border: 1px solid #d7dbe0; background: #2f6feb; color: white; cursor: pointer; }
      table { width: 100%; border-collapse: collapse; }
      td, th { text-align: left; padding: 6px 4px; border-bottom: 1px solid #eee; font-size: 0.9rem; }
      code { background: #f4f5f7; padding: 2px 4px; border-radius: 4px; }
    </style>
  </head>
  <body>
    <div class="banner">DEMO MERCHANT -- fixture app for Paymob Simulator, not a real store</div>
    ${body}
  </body>
</html>`;
}

async function handleIndex(_req, res) {
  const orders = listOrders();
  const scenarioButtons = SCENARIOS.map(
    (s) => html`<div class="card">
      <form method="POST" action="/orders/new">
        <input type="hidden" name="card" value="${s.card}" />
        <strong>${escapeHtml(s.name)}</strong>
        <p style="color:#5b6470;font-size:0.85rem">${escapeHtml(s.note)} Test card: <code>${s.card}</code></p>
        <button type="submit">Create order + open checkout</button>
      </form>
    </div>`,
  ).join("\n");

  const rows = orders
    .map(
      (o) => html`<tr>
        <td><a href="/orders/${o.id}">${o.id.slice(0, 8)}</a></td>
        <td class="status-${o.status}">${o.status}</td>
        <td>${o.transactionId ?? "-"}</td>
        <td>${o.createdAt}</td>
      </tr>`,
    )
    .join("\n");

  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(
    layout(html`
      <h1>Demo Merchant</h1>
      <p>Pick a scenario, complete checkout with the matching test card, and watch order status update.</p>
      ${scenarioButtons}
      <h2>Orders</h2>
      <table>
        <tr><th>Order</th><th>Status</th><th>Txn</th><th>Created</th></tr>
        ${rows || "<tr><td colspan=4>No orders yet.</td></tr>"}
      </table>
    `),
  );
}

async function handleNewOrder(req, res) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const params = new URLSearchParams(Buffer.concat(chunks).toString("utf-8"));
  const card = params.get("card") ?? "9900000000000010";

  const orderId = randomUUID();
  const order = {
    id: orderId,
    status: "pending",
    card,
    createdAt: new Date().toISOString(),
    lastUpdatedAt: null,
    transactionId: null,
    redirectTransactionId: null,
    redirectSeenAt: null,
    history: [{ at: new Date().toISOString(), source: "merchant", note: "order created" }],
  };
  createOrder(order);

  const intentionRes = await fetch(`${PAYMOB_BASE_URL}/v1/intention/`, {
    method: "POST",
    headers: { authorization: `Token ${PAYMOB_SECRET_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      amount: 10_000,
      currency: "EGP",
      payment_methods: [1001],
      special_reference: orderId,
      notification_url: `${SELF_BASE_URL}/webhooks/paymob`,
      redirection_url: `${SELF_PUBLIC_BASE_URL}/payment/result?ref=${orderId}`,
    }),
  });

  if (!intentionRes.ok) {
    res.writeHead(502, { "content-type": "text/plain" });
    res.end(`Failed to create intention: ${intentionRes.status} ${await intentionRes.text()}`);
    return;
  }

  const intention = await intentionRes.json();
  const checkoutUrl = `${PAYMOB_PUBLIC_BASE_URL}/unifiedcheckout/?publicKey=${encodeURIComponent(PAYMOB_PUBLIC_KEY)}&clientSecret=${encodeURIComponent(intention.client_secret)}`;

  res.writeHead(302, { location: checkoutUrl });
  res.end();
}

async function handleGetOrder(req, res, id) {
  const order = getOrder(id);
  if (!order) {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "order not found" }));
    return;
  }

  const accept = req.headers.accept ?? "";
  if (accept.includes("application/json")) {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(order));
    return;
  }

  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(
    layout(html`
      <h1>Order ${order.id.slice(0, 8)}</h1>
      <p>Status: <strong class="status-${order.status}">${order.status}</strong></p>
      <p>Transaction id: ${order.transactionId ?? "(none yet)"}</p>
      <h3>History</h3>
      <ul>
        ${order.history.map((h) => `<li>${h.at} -- ${h.source}${h.status ? ` -> ${h.status}` : ""}${h.note ? ` (${escapeHtml(h.note)})` : ""}</li>`).join("")}
      </ul>
      <p><a href="/">Back</a></p>
      <script>
        setInterval(async () => {
          const res = await fetch(window.location.pathname, { headers: { accept: "application/json" } });
          const order = await res.json();
          if (order.status !== "${order.status}") window.location.reload();
        }, 3000);
      </script>
    `),
  );
}

async function handleWebhook(req, res) {
  const url = new URL(req.url, SELF_BASE_URL);
  const providedHmac = url.searchParams.get("hmac");

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks).toString("utf-8"));

  if (body.type !== "TRANSACTION") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ignored: true }));
    return;
  }

  const expectedHmac = computeTransactionHmac(body.obj, PAYMOB_HMAC_SECRET);
  if (!verifyHmac(expectedHmac, providedHmac)) {
    // A merchant must reject an invalid signature and make no state change
    // (spec 5.4). Still return 200 so the simulator doesn't treat this as a
    // retryable transport failure -- we deliberately received and rejected it.
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ rejected: "invalid_hmac" }));
    return;
  }

  const orderId = body.obj.order?.merchant_order_id;
  const order = orderId ? applyTransactionUpdate(orderId, "webhook", body.obj) : undefined;

  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ received: true, orderFound: Boolean(order) }));
}

async function handlePaymentResult(req, res) {
  const url = new URL(req.url, SELF_PUBLIC_BASE_URL);
  const orderId = url.searchParams.get("ref");
  const order = orderId ? getOrder(orderId) : undefined;

  let redirectHmacValid = null;
  let transactionId = null;
  if (url.searchParams.has("hmac")) {
    redirectHmacValid = verifyRedirectHmac(url.searchParams, PAYMOB_HMAC_SECRET);
    transactionId = url.searchParams.get("id");
    if (order && transactionId) {
      recordRedirectSeen(order.id, Number(transactionId), url.searchParams.get("success"));
    }
  }

  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(
    layout(html`
      <h1>Payment result</h1>
      <p>
        This page is a UX signal only -- the browser redirect is independently scheduled from the
        backend webhook (spec 10.4/14.5) and is <strong>not</strong> treated as authoritative here.
      </p>
      <p>Redirect HMAC valid: <strong>${redirectHmacValid === null ? "(no signed params present)" : redirectHmacValid}</strong></p>
      ${order
        ? html`<p>Order status (from the merchant's own record, updated only by webhook or inquiry): <strong class="status-${order.status}">${order.status}</strong></p>
            <p><a href="/orders/${order.id}">View order detail</a></p>
            <script>
              // If the backend webhook hasn't caught up in a few seconds, actively
              // reconcile via transaction inquiry using the id learned from this
              // very redirect (spec 9.3) -- this is the missing-webhook recovery path.
              setTimeout(async () => {
                const res = await fetch("/orders/${order.id}", { headers: { accept: "application/json" } });
                const current = await res.json();
                if (current.status === "pending") {
                  await fetch("/orders/${order.id}/reconcile", { method: "POST" });
                }
                window.location.href = "/orders/${order.id}";
              }, 4000);
            </script>`
        : `<p>No matching local order for ref=${escapeHtml(orderId ?? "")}.</p>`}
    `),
  );
}

async function handleReconcile(req, res, id) {
  const order = getOrder(id);
  if (!order) {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "order not found" }));
    return;
  }
  const updated = await reconcileViaInquiry(order);
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify(updated));
}

const server = createServer(async (req, res) => {
  try {
    const path = new URL(req.url, SELF_BASE_URL).pathname;

    if (req.method === "GET" && path === "/") return handleIndex(req, res);
    if (req.method === "POST" && path === "/orders/new") return await handleNewOrder(req, res);
    if (req.method === "GET" && path === "/orders") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(listOrders()));
      return;
    }
    if (req.method === "GET" && /^\/orders\/[^/]+$/.test(path)) {
      return await handleGetOrder(req, res, path.split("/")[2]);
    }
    if (req.method === "POST" && /^\/orders\/[^/]+\/reconcile$/.test(path)) {
      return await handleReconcile(req, res, path.split("/")[2]);
    }
    if (req.method === "POST" && path === "/webhooks/paymob") return await handleWebhook(req, res);
    if (req.method === "GET" && path === "/payment/result") return await handlePaymentResult(req, res);

    res.writeHead(404, { "content-type": "text/plain" });
    res.end("Not found");
  } catch (err) {
    console.error(err);
    res.writeHead(500, { "content-type": "text/plain" });
    res.end("Internal error");
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`demo-merchant listening on :${PORT}, simulator at ${PAYMOB_BASE_URL}`);
});
