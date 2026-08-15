#!/usr/bin/env bash
# Release smoke test (spec section 22.6 + the four demo-merchant proof
# points): builds and runs the real Docker Compose stack, then drives it
# entirely over HTTP exactly as an external CI job would -- no internal
# package imports, no in-process test harness.
#
# Usage: ./scripts/release-smoke-test.sh
# Requires: docker, curl, node (for JSON parsing only).
set -euo pipefail

HOST_SIM_PORT="${HOST_SIM_PORT:-8080}"
HOST_MERCHANT_PORT="${HOST_MERCHANT_PORT:-3000}"
SIM_URL="http://localhost:${HOST_SIM_PORT}"
MERCHANT_URL="http://localhost:${HOST_MERCHANT_PORT}"
ADMIN_TOKEN="${SIM_ADMIN_TOKEN:-ci_smoke_test_admin_token}"
export HOST_SIM_PORT HOST_MERCHANT_PORT

# The shipped config.example.yaml hardcodes localhost:3000 in its
# browser-origin allowlists. When running on a non-default
# HOST_MERCHANT_PORT (e.g. to avoid colliding with other services on this
# machine), generate a port-substituted copy so the smoke test is portable
# regardless of which host ports happen to be free -- the checked-in
# config.example.yaml itself is never modified.
SMOKE_CONFIG_DIR="$(mktemp -d)"
sed "s/localhost:3000/localhost:${HOST_MERCHANT_PORT}/g" config/config.example.yaml > "$SMOKE_CONFIG_DIR/config.yaml"
COMPOSE="docker compose -f docker-compose.example.yml -f /dev/stdin"
OVERRIDE_YAML="services:
  paymob-simulator:
    volumes:
      - ${SMOKE_CONFIG_DIR}/config.yaml:/config/config.yaml:ro"

compose() {
  echo "$OVERRIDE_YAML" | $COMPOSE "$@"
}

pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1" >&2; exit 1; }
jqget() { node -pe "JSON.parse(require('fs').readFileSync(0))$1" 2>/dev/null; }

cleanup() {
  echo "--- compose logs (last 60 lines each) on exit ---"
  compose logs --tail=60 paymob-simulator demo-merchant || true
  compose down -v || true
  rm -rf "$SMOKE_CONFIG_DIR"
}
trap cleanup EXIT

echo "=== Building images ==="
compose build

echo "=== Starting stack ==="
SIM_ADMIN_TOKEN="$ADMIN_TOKEN" compose up -d

echo "=== Waiting for paymob-simulator health ==="
for i in $(seq 1 30); do
  STATUS=$(compose ps --format json paymob-simulator | node -pe "JSON.parse(require('fs').readFileSync(0)).Health" 2>/dev/null || echo "")
  [ "$STATUS" = "healthy" ] && break
  sleep 2
done
[ "$STATUS" = "healthy" ] || fail "paymob-simulator did not become healthy"
pass "paymob-simulator is healthy"

curl -sf "$SIM_URL/healthz" > /dev/null || fail "GET /healthz failed"
pass "GET /healthz == 200"

READY=$(curl -s "$SIM_URL/readyz")
echo "$READY" | grep -q '"ready":true' || fail "GET /readyz did not report ready (headless SIM_ADMIN_TOKEN config): $READY"
pass "GET /readyz == ready:true (headless admin-token configuration works without the setup wizard)"

echo "=== Waiting for demo-merchant ==="
for i in $(seq 1 15); do
  curl -sf "$MERCHANT_URL/orders" > /dev/null 2>&1 && break
  sleep 1
done
curl -sf "$MERCHANT_URL/orders" > /dev/null || fail "demo-merchant not reachable"
pass "demo-merchant is reachable"

echo "=== Container hardening checks ==="
SIM_USER=$(compose exec -T paymob-simulator whoami)
[ "$SIM_USER" = "simulator" ] || fail "paymob-simulator container is not running as non-root (got: $SIM_USER)"
pass "paymob-simulator runs as non-root ($SIM_USER)"

# --- Proof 1: browser redirect and webhook independence ------------------
echo "=== Proof 1: webhook independently fulfills an order (success-immediate) ==="
LOCATION=$(curl -s -D - -o /dev/null -X POST "$MERCHANT_URL/orders/new" -d "card=9900000000000010" -H "Content-Type: application/x-www-form-urlencoded" | grep -i "^location:" | tr -d '\r' | sed 's/location: //I')
CLIENT_SECRET=$(echo "$LOCATION" | grep -oE 'clientSecret=[^&]*' | cut -d= -f2)
ORDER_ID=$(curl -s "$MERCHANT_URL/orders" | jqget "[0].id")

curl -sf -X POST "$SIM_URL/__simulator/checkout/$CLIENT_SECRET/open" > /dev/null
curl -sf -X POST "$SIM_URL/__simulator/checkout/$CLIENT_SECRET/submit" \
  -H "Content-Type: application/json" -d '{"cardNumber":"9900000000000010","cardholderName":"Test Customer"}' > /dev/null
sleep 1

STATUS=$(curl -s "$MERCHANT_URL/orders/$ORDER_ID" -H "Accept: application/json" | jqget ".status")
[ "$STATUS" = "succeeded" ] || fail "order not fulfilled via webhook alone (status=$STATUS)"
pass "order fulfilled by the webhook channel with no browser redirect involved"

# --- Proof 2: delayed success through manual time -------------------------
echo "=== Proof 2: success-delayed-2m stays pending until the clock advances ==="
LOCATION=$(curl -s -D - -o /dev/null -X POST "$MERCHANT_URL/orders/new" -d "card=9900000000000036" -H "Content-Type: application/x-www-form-urlencoded" | grep -i "^location:" | tr -d '\r' | sed 's/location: //I')
CLIENT_SECRET=$(echo "$LOCATION" | grep -oE 'clientSecret=[^&]*' | cut -d= -f2)
ORDER_ID=$(curl -s "$MERCHANT_URL/orders" | jqget "[0].id")

curl -sf -X POST "$SIM_URL/__simulator/checkout/$CLIENT_SECRET/open" > /dev/null
curl -sf -X POST "$SIM_URL/__simulator/checkout/$CLIENT_SECRET/submit" \
  -H "Content-Type: application/json" -d '{"cardNumber":"9900000000000036","cardholderName":"Test Customer"}' > /dev/null

STATUS=$(curl -s "$MERCHANT_URL/orders/$ORDER_ID" -H "Accept: application/json" | jqget ".status")
[ "$STATUS" = "pending" ] || fail "delayed order should still be pending before clock advance (status=$STATUS)"
pass "order correctly still pending before clock advance"

curl -sf -X POST "$SIM_URL/__simulator/api/clock/advance" \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" -d '{"by":"2m","drain":true}' > /dev/null
sleep 1

STATUS=$(curl -s "$MERCHANT_URL/orders/$ORDER_ID" -H "Accept: application/json" | jqget ".status")
[ "$STATUS" = "succeeded" ] || fail "order did not succeed after advancing the clock 2 minutes (status=$STATUS)"
pass "order fulfilled after advancing the simulator's manual clock by 2 minutes"

# --- Proof 3: missing-webhook inquiry recovery -----------------------------
echo "=== Proof 3: success-no-webhook recovers via transaction inquiry ==="
LOCATION=$(curl -s -D - -o /dev/null -X POST "$MERCHANT_URL/orders/new" -d "card=9900000000000069" -H "Content-Type: application/x-www-form-urlencoded" | grep -i "^location:" | tr -d '\r' | sed 's/location: //I')
CLIENT_SECRET=$(echo "$LOCATION" | grep -oE 'clientSecret=[^&]*' | cut -d= -f2)
ORDER_ID=$(curl -s "$MERCHANT_URL/orders" | jqget "[0].id")

OPEN_RES=$(curl -s -X POST "$SIM_URL/__simulator/checkout/$CLIENT_SECRET/open")
SESSION_ID=$(echo "$OPEN_RES" | jqget ".sessionId")
TICKET=$(echo "$OPEN_RES" | jqget ".ticket")

SSE_TMP=$(mktemp)
curl -s -N "$SIM_URL/__simulator/checkout-sessions/$SESSION_ID/events?ticket=$TICKET" > "$SSE_TMP" &
SSE_PID=$!
sleep 0.5

curl -sf -X POST "$SIM_URL/__simulator/checkout/$CLIENT_SECRET/submit" \
  -H "Content-Type: application/json" -d '{"cardNumber":"9900000000000069","cardholderName":"Test Customer"}' > /dev/null
curl -sf -X POST "$SIM_URL/__simulator/api/clock/advance" \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" -d '{"by":"1s","drain":true}' > /dev/null
sleep 0.5
kill "$SSE_PID" 2>/dev/null || true

REDIRECT_LINE=$(grep -o '"url":"[^"]*"' "$SSE_TMP" | head -1 | sed 's/"url":"//; s/"$//' | sed 's/\\u0026/\&/g')
rm -f "$SSE_TMP"
[ -n "$REDIRECT_LINE" ] || fail "no browser.redirect event with a url was received over SSE"

curl -sf "$REDIRECT_LINE" > /dev/null || fail "following the redirect URL to the merchant failed"

STATUS=$(curl -s "$MERCHANT_URL/orders/$ORDER_ID" -H "Accept: application/json" | jqget ".status")
[ "$STATUS" = "pending" ] || fail "order should still be pending immediately after redirect (no webhook fired) (status=$STATUS)"
pass "order correctly still pending after redirect alone (no webhook for this scenario)"

curl -sf -X POST "$MERCHANT_URL/orders/$ORDER_ID/reconcile" > /dev/null
STATUS=$(curl -s "$MERCHANT_URL/orders/$ORDER_ID" -H "Accept: application/json" | jqget ".status")
[ "$STATUS" = "succeeded" ] || fail "order did not recover via transaction inquiry (status=$STATUS)"
pass "order recovered to succeeded via transaction inquiry using the transaction id learned from the redirect"

# --- Proof 4: restart persistence ------------------------------------------
echo "=== Proof 4: restart persistence ==="
ORDER_COUNT_BEFORE=$(curl -s "$MERCHANT_URL/orders" | jqget ".length")

compose restart paymob-simulator demo-merchant

for i in $(seq 1 30); do
  STATUS=$(compose ps --format json paymob-simulator | node -pe "JSON.parse(require('fs').readFileSync(0)).Health" 2>/dev/null || echo "")
  [ "$STATUS" = "healthy" ] && break
  sleep 2
done
[ "$STATUS" = "healthy" ] || fail "paymob-simulator did not become healthy again after restart"

for i in $(seq 1 15); do
  curl -sf "$MERCHANT_URL/orders" > /dev/null 2>&1 && break
  sleep 1
done

ORDER_COUNT_AFTER=$(curl -s "$MERCHANT_URL/orders" | jqget ".length")
[ "$ORDER_COUNT_BEFORE" = "$ORDER_COUNT_AFTER" ] || fail "order count changed across restart ($ORDER_COUNT_BEFORE -> $ORDER_COUNT_AFTER)"

READY=$(curl -s "$SIM_URL/readyz")
echo "$READY" | grep -q '"ready":true' || fail "simulator not ready after restart"

FINAL_STATUS=$(curl -s "$MERCHANT_URL/orders/$ORDER_ID" -H "Accept: application/json" | jqget ".status")
[ "$FINAL_STATUS" = "succeeded" ] || fail "order status did not survive restart (status=$FINAL_STATUS)"
pass "order data (count=$ORDER_COUNT_AFTER) and status survived a full stack restart"

echo ""
echo "=================================================="
echo " ALL SMOKE TEST PROOF POINTS PASSED"
echo "=================================================="
