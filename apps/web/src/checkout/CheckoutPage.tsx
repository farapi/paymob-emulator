import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BUILT_IN_CARD_CVV, BUILT_IN_CARD_EXPIRY } from "@paymob-simulator/contracts/cards";
import { ackBrowserEvent, ApiError, eventsUrl, fetchElement, openCheckoutSession, submitCheckout } from "./api.js";
import { ScenarioCatalog } from "./ScenarioCatalog.js";

type CheckoutStatus =
  | "loading"
  | "form"
  | "processing"
  | "pending"
  | "success"
  | "failed"
  | "cancelled"
  | "expired"
  | "error";

interface BrowserActionEvent {
  actionId: string | null;
  type: string;
  payload: { status?: string; message?: string; url?: string; prompt?: string };
  dueAt: string;
}

function useQueryParams() {
  return useMemo(() => new URLSearchParams(window.location.search), []);
}

export function CheckoutPage() {
  const params = useQueryParams();
  const publicKey = params.get("publicKey") ?? "";
  const clientSecret = params.get("clientSecret") ?? "";

  const [status, setStatus] = useState<CheckoutStatus>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [displayMessage, setDisplayMessage] = useState<string | null>(null);
  const [cardNumber, setCardNumber] = useState("");
  const [cardholderName, setCardholderName] = useState("");
  const [expiry, setExpiry] = useState("");
  const [cvv, setCvv] = useState("");
  const sessionRef = useRef<{ sessionId: string; ticket: string } | null>(null);
  const idempotencyKeyRef = useRef<string>(crypto.randomUUID());

  const elementQuery = useQuery({
    queryKey: ["intention-element", publicKey, clientSecret],
    queryFn: () => fetchElement(publicKey, clientSecret),
    enabled: Boolean(publicKey && clientSecret),
    retry: false,
  });

  useEffect(() => {
    if (!publicKey || !clientSecret) {
      setStatus("error");
      setErrorMessage("Missing publicKey or clientSecret in the checkout URL.");
      return;
    }
    if (elementQuery.isError) {
      const err = elementQuery.error;
      setStatus("error");
      if (err instanceof ApiError && err.status === 410) {
        setErrorMessage("This checkout link has expired. Ask the merchant to create a new payment.");
      } else if (err instanceof ApiError && err.status === 404) {
        setErrorMessage("This checkout link is invalid or has already been used.");
      } else {
        setErrorMessage("Unable to load this checkout session.");
      }
      return;
    }
    if (elementQuery.data && status === "loading") {
      void openCheckoutSession(clientSecret).then((session) => {
        sessionRef.current = session;
        // Reopening an already-submitted checkout renders the current
        // outcome directly rather than the form again (spec 10.4 step 5) --
        // a fresh session has no events of its own to replay a stale redirect.
        setStatus(session.currentStatus ?? "form");
      });
    }
  }, [elementQuery.isError, elementQuery.error, elementQuery.data, publicKey, clientSecret, status]);

  useEffect(() => {
    if (status !== "form" && status !== "processing" && status !== "pending") return undefined;
    const session = sessionRef.current;
    if (!session) return undefined;

    const source = new EventSource(eventsUrl(session.sessionId, session.ticket));
    source.addEventListener("browser.action", (evt) => {
      const message = evt as MessageEvent<string>;
      const parsed = JSON.parse(message.data) as BrowserActionEvent;

      switch (parsed.type) {
        case "browser.redirect": {
          if (parsed.payload.url) {
            void ackBrowserEvent(session.sessionId, session.ticket, Number((evt as MessageEvent).lastEventId), "applied");
            window.location.href = parsed.payload.url;
          } else {
            setStatus((parsed.payload.status as CheckoutStatus) ?? "success");
          }
          break;
        }
        case "browser.show_result": {
          setStatus((parsed.payload.status as CheckoutStatus) ?? "processing");
          if (parsed.payload.message) setDisplayMessage(parsed.payload.message);
          break;
        }
        case "three_ds.open": {
          setDisplayMessage(parsed.payload.prompt ?? "3-D Secure challenge (interactive completion not yet available)");
          break;
        }
        default:
          break;
      }
    });

    return () => source.close();
  }, [status]);

  const handleSubmit = async (evt: React.FormEvent) => {
    evt.preventDefault();
    setStatus("processing");
    setErrorMessage(null);
    try {
      await submitCheckout(clientSecret, {
        cardNumber: cardNumber.replace(/\s|-/g, ""),
        cardholderName,
        idempotencyKey: idempotencyKeyRef.current,
      });
    } catch (err) {
      setStatus("form");
      if (err instanceof ApiError) {
        setErrorMessage(err.message || "Payment could not be submitted.");
      } else {
        setErrorMessage("Payment could not be submitted.");
      }
    }
  };

  const handlePickCard = (card: string, name: string) => {
    setCardNumber(card);
    setCardholderName(name);
    setExpiry(BUILT_IN_CARD_EXPIRY);
    setCvv(BUILT_IN_CARD_CVV);
  };

  return (
    <main className="checkout">
      <div className="checkout__banner" role="status">
        SIMULATOR -- NO REAL PAYMENT
      </div>

      {status === "error" && (
        <div className="checkout__card">
          <p className="checkout__error">{errorMessage}</p>
        </div>
      )}

      {status === "loading" && (
        <div className="checkout__card">
          <p>Loading checkout...</p>
        </div>
      )}

      {elementQuery.data && status !== "error" && status !== "loading" && (
        <div className="checkout__card">
          <dl className="checkout__summary">
            {elementQuery.data.special_reference && (
              <>
                <dt>Reference</dt>
                <dd>{elementQuery.data.special_reference}</dd>
              </>
            )}
            <dt>Amount</dt>
            <dd>
              {(elementQuery.data.amount / 100).toFixed(2)} {elementQuery.data.currency}
            </dd>
          </dl>

          {(status === "form" || status === "processing") && (
            <form onSubmit={(e) => void handleSubmit(e)} className="checkout__form">
              <label htmlFor="cardNumber">Card number</label>
              <input
                id="cardNumber"
                name="cardNumber"
                autoComplete="off"
                value={cardNumber}
                onChange={(e) => setCardNumber(e.target.value)}
                placeholder="9900 0000 0000 0010"
                required
                disabled={status === "processing"}
              />

              <label htmlFor="cardholderName">Cardholder name</label>
              <input
                id="cardholderName"
                name="cardholderName"
                autoComplete="off"
                value={cardholderName}
                onChange={(e) => setCardholderName(e.target.value)}
                placeholder="Test Customer"
                disabled={status === "processing"}
              />

              <div className="checkout__row">
                <div>
                  <label htmlFor="expiry">Expiry</label>
                  <input
                    id="expiry"
                    name="expiry"
                    autoComplete="off"
                    value={expiry}
                    onChange={(e) => setExpiry(e.target.value)}
                    placeholder="01/39"
                    disabled={status === "processing"}
                  />
                </div>
                <div>
                  <label htmlFor="cvv">CVV</label>
                  <input
                    id="cvv"
                    name="cvv"
                    autoComplete="off"
                    value={cvv}
                    onChange={(e) => setCvv(e.target.value)}
                    placeholder="123"
                    disabled={status === "processing"}
                  />
                </div>
              </div>

              {errorMessage && <p className="checkout__error">{errorMessage}</p>}

              <button type="submit" disabled={status === "processing"}>
                {status === "processing" ? "Processing..." : "Pay"}
              </button>
              <button type="button" className="checkout__cancel" disabled={status === "processing"}>
                Cancel
              </button>
            </form>
          )}

          {(status === "pending" ||
            status === "success" ||
            status === "failed" ||
            status === "cancelled" ||
            status === "expired") && (
            <div className="checkout__result" role="status">
              <p>Payment status: {status}</p>
              {displayMessage && <p>{displayMessage}</p>}
            </div>
          )}

          {status !== "processing" && <ScenarioCatalog onPickCard={handlePickCard} />}
        </div>
      )}
    </main>
  );
}
