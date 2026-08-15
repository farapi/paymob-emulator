import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { listDeliveries } from "./api.js";

export function DeliveriesPage() {
  const query = useQuery({ queryKey: ["admin-deliveries"], queryFn: listDeliveries, refetchInterval: 5000 });

  if (query.isLoading) return <p>Loading...</p>;
  if (query.isError) return <p className="checkout__error">Failed to load deliveries.</p>;

  return (
    <section>
      <h1>Deliveries</h1>
      <table className="admin-table">
        <thead>
          <tr>
            <th>ID</th>
            <th>Type</th>
            <th>Status</th>
            <th>Target</th>
            <th>Created</th>
          </tr>
        </thead>
        <tbody>
          {query.data?.data.map((d) => (
            <tr key={d.id}>
              <td>
                <Link to={`/__simulator/dashboard/deliveries/${d.id}`}>{d.id.slice(0, 12)}</Link>
              </td>
              <td>{d.eventType}</td>
              <td>
                <span className={`admin-state admin-state--${d.status}`}>{d.status}</span>
              </td>
              <td className="admin-truncate">{d.targetUrl}</td>
              <td>{d.createdAt}</td>
            </tr>
          ))}
          {query.data?.data.length === 0 && (
            <tr>
              <td colSpan={5}>No deliveries yet.</td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  );
}
