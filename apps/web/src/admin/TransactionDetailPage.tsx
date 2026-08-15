import { useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { BadgeWithDot } from "@/components/base/badges/badges";
import type { BadgeColors } from "@/components/base/badges/badge-types";
import { AdminApiError, captureTransaction, getTransaction, refundTransaction, voidTransaction } from "./api.js";

const STATE_COLOR: Record<string, BadgeColors> = {
  succeeded: "success",
  captured: "success",
  refunded: "success",
  voided: "gray",
  partially_refunded: "warning",
  pending: "warning",
  processing: "warning",
  failed: "error",
};

function DetailRow(props: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-secondary py-3 first:pt-0 last:border-b-0">
      <dt className="text-sm text-tertiary">{props.label}</dt>
      <dd className="text-sm font-medium text-primary">{props.children}</dd>
    </div>
  );
}

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
  if (query.isLoading) return <p className="text-secondary">Loading...</p>;
  if (query.isError || !query.data) return <p className="text-sm text-error-primary">Transaction not found.</p>;

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
    <section className="flex flex-col gap-6">
      <h1 className="text-display-xs font-semibold text-primary">Transaction {txn.providerNumericId}</h1>

      <div className="rounded-xl border border-secondary bg-primary p-5 shadow-xs">
        <dl>
          <DetailRow label="State">
            <BadgeWithDot type="pill-color" size="sm" color={STATE_COLOR[txn.state] ?? "gray"}>
              {txn.state}
            </BadgeWithDot>
          </DetailRow>
          <DetailRow label="Amount">
            {(txn.amountCents / 100).toFixed(2)} {txn.currency}
          </DetailRow>
          <DetailRow label="Refunded">{(txn.refundedAmountCents / 100).toFixed(2)}</DetailRow>
          <DetailRow label="Captured">{(txn.capturedAmountCents / 100).toFixed(2)}</DetailRow>
          <DetailRow label="Merchant order">{txn.merchantOrderId}</DetailRow>
          <DetailRow label="Created">{txn.createdAt}</DetailRow>
          {txn.parentTransactionId && <DetailRow label="Parent transaction">{txn.parentTransactionId}</DetailRow>}
        </dl>
      </div>

      <div className="rounded-xl border border-secondary bg-primary p-5 shadow-xs">
        <h2 className="mb-4 text-sm font-semibold text-primary">Actions</h2>
        <div className="flex flex-wrap items-end gap-3">
          <Input
            size="sm"
            label="Amount"
            type="number"
            placeholder="0.00"
            value={amount}
            onChange={setAmount}
            wrapperClassName="w-32"
          />
          <Button
            size="sm"
            color="secondary"
            isDisabled={busy || !amountCents}
            onPress={() => void runAction(() => refundTransaction(id, amountCents))}
          >
            Refund
          </Button>
          <Button
            size="sm"
            color="secondary"
            isDisabled={busy || !amountCents}
            onPress={() => void runAction(() => captureTransaction(id, amountCents))}
          >
            Capture
          </Button>
          <Button size="sm" color="secondary" isDisabled={busy} onPress={() => void runAction(() => voidTransaction(id))}>
            Void
          </Button>
        </div>
        {actionError && <p className="mt-3 text-sm text-error-primary">{actionError}</p>}
      </div>

      <div className="rounded-xl border border-secondary bg-primary p-5 shadow-xs">
        <h2 className="mb-3 text-sm font-semibold text-primary">Callback payload (obj)</h2>
        <pre className="max-h-96 overflow-auto rounded-lg bg-secondary p-4 text-xs text-secondary">
          {JSON.stringify(txn.obj, null, 2)}
        </pre>
      </div>
    </section>
  );
}
