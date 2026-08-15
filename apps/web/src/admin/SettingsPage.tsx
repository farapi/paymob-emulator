import { useQuery } from "@tanstack/react-query";
import { Table, TableCard } from "@/components/application/table/table";
import { BadgeWithDot } from "@/components/base/badges/badges";
import type { BadgeColors } from "@/components/base/badges/badge-types";
import { listSettings } from "./api.js";

const SOURCE_COLOR: Record<string, BadgeColors> = {
  env: "blue",
  file: "brand",
  database: "warning",
  default: "gray",
};

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "(none)";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function SettingsPage() {
  const query = useQuery({ queryKey: ["admin-settings"], queryFn: listSettings });

  if (query.isLoading) return <p className="text-secondary">Loading...</p>;
  if (query.isError) return <p className="text-sm text-error-primary">Failed to load settings.</p>;

  return (
    <section className="flex flex-col gap-5">
      <div>
        <h1 className="text-display-xs font-semibold text-primary">Settings</h1>
        <p className="mt-1 text-sm text-tertiary">
          Effective configuration with provenance. Locked leaves come from an environment variable or a mounted
          config file and cannot be edited here.
        </p>
      </div>

      <TableCard.Root>
        <Table aria-label="Settings">
          <Table.Header>
            <Table.Head id="path" label="Path" isRowHeader />
            <Table.Head id="value" label="Value" />
            <Table.Head id="source" label="Source" />
          </Table.Header>
          <Table.Body>
            {(query.data?.data ?? []).map((row) => (
              <Table.Row key={row.path} id={row.path}>
                <Table.Cell>
                  <code className="text-xs text-primary">{row.path}</code>
                </Table.Cell>
                <Table.Cell>
                  <span className="block max-w-96 truncate">{formatValue(row.value)}</span>
                </Table.Cell>
                <Table.Cell>
                  <div className="flex items-center gap-2">
                    <BadgeWithDot type="pill-color" size="sm" color={SOURCE_COLOR[row.source] ?? "gray"}>
                      {row.source}
                    </BadgeWithDot>
                    {row.locked && (
                      <BadgeWithDot type="pill-color" size="sm" color="error">
                        locked
                      </BadgeWithDot>
                    )}
                  </div>
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table>
        {query.data?.data.length === 0 && <p className="p-5 text-sm text-tertiary">No settings found.</p>}
      </TableCard.Root>
    </section>
  );
}
