import { useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/base/buttons/button";
import { BadgeWithDot } from "@/components/base/badges/badges";
import type { BadgeColors } from "@/components/base/badges/badge-types";
import { Table, TableCard } from "@/components/application/table/table";
import { AdminApiError, cancelDelivery, getDelivery, replayDelivery } from "./api.js";

const STATUS_COLOR: Record<string, BadgeColors> = {
  delivered: "success",
  scheduled: "warning",
  retry_scheduled: "warning",
  exhausted: "error",
  failed: "error",
  cancelled: "gray",
};

function DetailRow(props: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-secondary py-3 first:pt-0 last:border-b-0">
      <dt className="text-sm text-tertiary">{props.label}</dt>
      <dd className="max-w-[70%] truncate text-sm font-medium text-primary">{props.children}</dd>
    </div>
  );
}

export function DeliveryDetailPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const query = useQuery({
    queryKey: ["admin-delivery", id],
    queryFn: () => getDelivery(id as string),
    enabled: Boolean(id),
    refetchInterval: 4000,
  });

  if (!id) return null;
  if (query.isLoading) return <p className="text-secondary">Loading...</p>;
  if (query.isError || !query.data) return <p className="text-sm text-error-primary">Delivery not found.</p>;

  const { delivery, event, attempts } = query.data;

  const runAction = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setActionError(null);
    try {
      await fn();
      await queryClient.invalidateQueries({ queryKey: ["admin-delivery", id] });
    } catch (err) {
      setActionError(err instanceof AdminApiError ? err.message : "Action failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="flex flex-col gap-6">
      <h1 className="text-display-xs font-semibold text-primary">Delivery {delivery.id.slice(0, 12)}</h1>

      <div className="rounded-xl border border-secondary bg-primary p-5 shadow-xs">
        <dl>
          <DetailRow label="Status">
            <BadgeWithDot type="pill-color" size="sm" color={STATUS_COLOR[delivery.status] ?? "gray"}>
              {delivery.status}
            </BadgeWithDot>
          </DetailRow>
          <DetailRow label="Type">{delivery.eventType}</DetailRow>
          <DetailRow label="Target">{delivery.targetUrl}</DetailRow>
          <DetailRow label="Created">{delivery.createdAt}</DetailRow>
          {event && (
            <DetailRow label="HMAC">
              <span className="font-mono">{event.hmac.slice(0, 24)}...</span>
              {event.signatureMode === "corrupt" && (
                <BadgeWithDot type="pill-color" size="sm" color="error" className="ml-2">
                  intentionally invalid
                </BadgeWithDot>
              )}
            </DetailRow>
          )}
        </dl>
      </div>

      <div className="rounded-xl border border-secondary bg-primary p-5 shadow-xs">
        <h2 className="mb-4 text-sm font-semibold text-primary">Actions</h2>
        <div className="flex gap-3">
          <Button size="sm" color="secondary" isDisabled={busy} onPress={() => void runAction(() => replayDelivery(id))}>
            Replay now
          </Button>
          <Button
            size="sm"
            color="secondary"
            isDisabled={busy || delivery.status !== "scheduled"}
            onPress={() => void runAction(() => cancelDelivery(id))}
          >
            Cancel
          </Button>
        </div>
        {actionError && <p className="mt-3 text-sm text-error-primary">{actionError}</p>}
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-primary">Attempts</h2>
        <TableCard.Root>
          <Table aria-label="Delivery attempts">
            <Table.Header>
              <Table.Head id="n" label="#" isRowHeader />
              <Table.Head id="response" label="Response" />
              <Table.Head id="error" label="Transport error" />
              <Table.Head id="decision" label="Decision" />
              <Table.Head id="duration" label="Duration" />
            </Table.Header>
            <Table.Body>
              {attempts.map((a) => (
                <Table.Row key={a.id} id={a.id}>
                  <Table.Cell>{a.attemptNumber}</Table.Cell>
                  <Table.Cell>{a.responseStatus ?? "-"}</Table.Cell>
                  <Table.Cell>{a.transportErrorCode ?? "-"}</Table.Cell>
                  <Table.Cell>{a.retryDecision ?? "-"}</Table.Cell>
                  <Table.Cell>{a.durationMs ?? "-"}ms</Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
          {attempts.length === 0 && <p className="p-5 text-sm text-tertiary">No attempts yet.</p>}
        </TableCard.Root>
      </div>

      {event && (
        <div className="rounded-xl border border-secondary bg-primary p-5 shadow-xs">
          <h2 className="mb-3 text-sm font-semibold text-primary">Payload bytes</h2>
          <pre className="max-h-96 overflow-auto rounded-lg bg-secondary p-4 text-xs text-secondary">{event.bodyBytes}</pre>
        </div>
      )}
    </section>
  );
}
