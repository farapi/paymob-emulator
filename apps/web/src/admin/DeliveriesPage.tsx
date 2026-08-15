import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Table, TableCard } from "@/components/application/table/table";
import { BadgeWithDot } from "@/components/base/badges/badges";
import type { BadgeColors } from "@/components/base/badges/badge-types";
import { listDeliveries } from "./api.js";

const STATUS_COLOR: Record<string, BadgeColors> = {
  delivered: "success",
  scheduled: "warning",
  retry_scheduled: "warning",
  exhausted: "error",
  failed: "error",
  cancelled: "gray",
};

export function DeliveriesPage() {
  const navigate = useNavigate();
  const query = useQuery({ queryKey: ["admin-deliveries"], queryFn: listDeliveries, refetchInterval: 5000 });

  return (
    <section className="flex flex-col gap-5">
      <h1 className="text-display-xs font-semibold text-primary">Deliveries</h1>

      <TableCard.Root>
        {query.isError && <p className="p-5 text-sm text-error-primary">Failed to load deliveries.</p>}
        {!query.isError && (
          <Table aria-label="Deliveries">
            <Table.Header>
              <Table.Head id="id" label="ID" isRowHeader />
              <Table.Head id="type" label="Type" />
              <Table.Head id="status" label="Status" />
              <Table.Head id="target" label="Target" />
              <Table.Head id="created" label="Created" />
            </Table.Header>
            <Table.Body>
              {(query.data?.data ?? []).map((d) => (
                <Table.Row
                  key={d.id}
                  id={d.id}
                  className="cursor-pointer"
                  onAction={() => navigate(`/__simulator/dashboard/deliveries/${d.id}`)}
                >
                  <Table.Cell>
                    <span className="font-medium text-primary">{d.id.slice(0, 12)}</span>
                  </Table.Cell>
                  <Table.Cell>{d.eventType}</Table.Cell>
                  <Table.Cell>
                    <BadgeWithDot type="pill-color" size="sm" color={STATUS_COLOR[d.status] ?? "gray"}>
                      {d.status}
                    </BadgeWithDot>
                  </Table.Cell>
                  <Table.Cell>
                    <span className="block max-w-80 truncate">{d.targetUrl}</span>
                  </Table.Cell>
                  <Table.Cell>{d.createdAt}</Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        )}
        {!query.isError && query.data?.data.length === 0 && (
          <p className="p-5 text-sm text-tertiary">No deliveries yet.</p>
        )}
      </TableCard.Root>
    </section>
  );
}
