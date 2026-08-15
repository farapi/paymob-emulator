import { useQuery } from "@tanstack/react-query";
import { listSettings } from "./api.js";

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "(none)";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function SettingsPage() {
  const query = useQuery({ queryKey: ["admin-settings"], queryFn: listSettings });

  if (query.isLoading) return <p>Loading...</p>;
  if (query.isError) return <p className="checkout__error">Failed to load settings.</p>;

  return (
    <section>
      <h1>Settings</h1>
      <p style={{ color: "#5b6470" }}>
        Effective configuration with provenance. Locked leaves come from an environment variable or a mounted
        config file and cannot be edited here.
      </p>
      <table className="admin-table">
        <thead>
          <tr>
            <th>Path</th>
            <th>Value</th>
            <th>Source</th>
          </tr>
        </thead>
        <tbody>
          {query.data?.data.map((row) => (
            <tr key={row.path}>
              <td>
                <code>{row.path}</code>
              </td>
              <td className="admin-truncate">{formatValue(row.value)}</td>
              <td>
                <span className={`admin-badge ${row.locked ? "admin-badge--danger" : ""}`}>{row.source}</span>
                {row.locked && <span className="admin-badge">locked</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
