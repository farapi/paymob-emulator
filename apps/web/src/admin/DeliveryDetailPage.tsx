import { useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AdminApiError, cancelDelivery, getDelivery, replayDelivery } from "./api.js";

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
  if (query.isLoading) return <p>Loading...</p>;
  if (query.isError || !query.data) return <p className="checkout__error">Delivery not found.</p>;

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
    <section>
      <h1>Delivery {delivery.id.slice(0, 12)}</h1>
      <dl className="admin-detail">
        <dt>Status</dt>
        <dd>
          <span className={`admin-state admin-state--${delivery.status}`}>{delivery.status}</span>
        </dd>
        <dt>Type</dt>
        <dd>{delivery.eventType}</dd>
        <dt>Target</dt>
        <dd>{delivery.targetUrl}</dd>
        <dt>Created</dt>
        <dd>{delivery.createdAt}</dd>
        {event && (
          <>
            <dt>HMAC</dt>
            <dd className="admin-truncate">
              {event.hmac} {event.signatureMode === "corrupt" && <span className="admin-badge admin-badge--danger">intentionally invalid</span>}
            </dd>
          </>
        )}
      </dl>

      <h2>Actions</h2>
      <div className="admin-actions">
        <button type="button" disabled={busy} onClick={() => void runAction(() => replayDelivery(id))}>
          Replay now
        </button>
        <button
          type="button"
          disabled={busy || delivery.status !== "scheduled"}
          onClick={() => void runAction(() => cancelDelivery(id))}
        >
          Cancel
        </button>
      </div>
      {actionError && <p className="checkout__error">{actionError}</p>}

      <h2>Attempts</h2>
      <table className="admin-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Response</th>
            <th>Transport error</th>
            <th>Decision</th>
            <th>Duration</th>
          </tr>
        </thead>
        <tbody>
          {attempts.map((a) => (
            <tr key={a.id}>
              <td>{a.attemptNumber}</td>
              <td>{a.responseStatus ?? "-"}</td>
              <td>{a.transportErrorCode ?? "-"}</td>
              <td>{a.retryDecision ?? "-"}</td>
              <td>{a.durationMs ?? "-"}ms</td>
            </tr>
          ))}
          {attempts.length === 0 && (
            <tr>
              <td colSpan={5}>No attempts yet.</td>
            </tr>
          )}
        </tbody>
      </table>

      {event && (
        <>
          <h2>Payload bytes</h2>
          <pre className="admin-json">{event.bodyBytes}</pre>
        </>
      )}
    </section>
  );
}
