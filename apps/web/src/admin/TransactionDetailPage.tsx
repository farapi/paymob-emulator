import { useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AdminApiError, captureTransaction, getTransaction, refundTransaction, voidTransaction } from "./api.js";

export function TransactionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const query = useQuery({
    queryKey: ["admin-transaction", id],
    queryFn: () => getTransaction(id as string),
    enabled: Boolean(id),
  });

  if (!id) return null;
  if (query.isLoading) return <p>Loading...</p>;
  if (query.isError || !query.data) return <p className="checkout__error">Transaction not found.</p>;

  const txn = query.data;
  const amountCents = Math.round(Number(amount) * 100);

  const runAction = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setActionError(null);
    try {
      await fn();
      await queryClient.invalidateQueries({ queryKey: ["admin-transaction", id] });
    } catch (err) {
      setActionError(err instanceof AdminApiError ? err.message : "Action failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section>
      <h1>Transaction {txn.providerNumericId}</h1>
      <dl className="admin-detail">
        <dt>State</dt>
        <dd>
          <span className={`admin-state admin-state--${txn.state}`}>{txn.state}</span>
        </dd>
        <dt>Amount</dt>
        <dd>
          {(txn.amountCents / 100).toFixed(2)} {txn.currency}
        </dd>
        <dt>Refunded</dt>
        <dd>{(txn.refundedAmountCents / 100).toFixed(2)}</dd>
        <dt>Captured</dt>
        <dd>{(txn.capturedAmountCents / 100).toFixed(2)}</dd>
        <dt>Merchant order</dt>
        <dd>{txn.merchantOrderId}</dd>
        <dt>Created</dt>
        <dd>{txn.createdAt}</dd>
        {txn.parentTransactionId && (
          <>
            <dt>Parent transaction</dt>
            <dd>{txn.parentTransactionId}</dd>
          </>
        )}
      </dl>

      <h2>Actions</h2>
      <div className="admin-actions">
        <input
          type="number"
          step="0.01"
          placeholder="Amount"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          style={{ width: 100 }}
        />
        <button
          type="button"
          disabled={busy || !amountCents}
          onClick={() => void runAction(() => refundTransaction(id, amountCents))}
        >
          Refund
        </button>
        <button
          type="button"
          disabled={busy || !amountCents}
          onClick={() => void runAction(() => captureTransaction(id, amountCents))}
        >
          Capture
        </button>
        <button type="button" disabled={busy} onClick={() => void runAction(() => voidTransaction(id))}>
          Void
        </button>
      </div>
      {actionError && <p className="checkout__error">{actionError}</p>}

      <h2>Callback payload (obj)</h2>
      <pre className="admin-json">{JSON.stringify(txn.obj, null, 2)}</pre>
    </section>
  );
}
