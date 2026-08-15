import { useState } from "react";
import { BUILT_IN_CARDS, GENERIC_SELECTOR_CARD } from "@paymob-simulator/contracts/cards";

async function copyToClipboard(value: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    // Clipboard API may be unavailable (e.g. insecure context); ignore.
  }
}

export function ScenarioCatalog(props: { onPickCard: (cardNumber: string, cardholderName: string) => void }) {
  const [open, setOpen] = useState(false);
  const [copiedCard, setCopiedCard] = useState<string | null>(null);

  const handleCopy = async (cardNumber: string) => {
    await copyToClipboard(cardNumber);
    setCopiedCard(cardNumber);
    setTimeout(() => setCopiedCard((c) => (c === cardNumber ? null : c)), 1500);
  };

  return (
    <section className="scenario-catalog">
      <button
        type="button"
        className="scenario-catalog__toggle"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {open ? "Hide" : "Show"} test scenario cards
      </button>
      {open && (
        <ul className="scenario-catalog__list">
          <li className="scenario-catalog__item">
            <div>
              <code>{GENERIC_SELECTOR_CARD}</code>
              <span className="scenario-catalog__desc">
                generic-selector -- use cardholder name <code>SIM:&lt;scenario-id&gt;</code>
              </span>
            </div>
            <div className="scenario-catalog__actions">
              <button type="button" onClick={() => void handleCopy(GENERIC_SELECTOR_CARD)}>
                {copiedCard === GENERIC_SELECTOR_CARD ? "Copied!" : "Copy"}
              </button>
              <button
                type="button"
                onClick={() => props.onPickCard(GENERIC_SELECTOR_CARD, "SIM:success-delayed-2m")}
              >
                Use
              </button>
            </div>
          </li>
          {BUILT_IN_CARDS.filter((c) => c.scenarioId !== "generic-selector").map((card) => (
            <li key={card.cardNumber} className="scenario-catalog__item">
              <div>
                <code>{card.cardNumber}</code>
                <span className="scenario-catalog__desc">
                  {card.scenarioId} -- {card.description}
                </span>
              </div>
              <div className="scenario-catalog__actions">
                <button type="button" onClick={() => void handleCopy(card.cardNumber)}>
                  {copiedCard === card.cardNumber ? "Copied!" : "Copy"}
                </button>
                <button type="button" onClick={() => props.onPickCard(card.cardNumber, "Test Customer")}>
                  Use
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
