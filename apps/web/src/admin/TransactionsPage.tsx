import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Table, TableCard } from "@/components/application/table/table";
import { BadgeWithDot } from "@/components/base/badges/badges";
import type { BadgeColors } from "@/components/base/badges/badge-types";
import { listTransactions } from "./api.js";

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

function formatAmount(amountCents: number, currency: string): string {
  return `${(amountCents / 100).toFixed(2)} ${currency}`;
}

export function TransactionsPage() {
  const navigate = useNavigate();
  const query = useQuery({ queryKey: ["admin-transactions"], queryFn: listTransactions, refetchInterval: 5000 });

  return (
    <section className="flex flex-col gap-5">
      <h1 className="text-display-xs font-semibold text-primary">Transactions</h1>

      <TableCard.Root>
        {query.isError && <p className="p-5 text-sm text-error-primary">Failed to load transactions.</p>}
        {!query.isError && (
          <Table aria-label="Transactions">
            <Table.Header>
              <Table.Head id="id" label="ID" isRowHeader />
              <Table.Head id="state" label="State" />
              <Table.Head id="amount" label="Amount" />
              <Table.Head id="order" label="Merchant order" />
              <Table.Head id="created" label="Created" />
            </Table.Header>
            <Table.Body>
              {(query.data?.data ?? []).map((t) => (
                <Table.Row
                  key={t.id}
                  id={t.id}
                  className="cursor-pointer"
                  onAction={() => navigate(`/__simulator/dashboard/transactions/${t.id}`)}
                >
                  <Table.Cell>
                    <span className="font-medium text-primary">{t.providerNumericId}</span>
                    {t.hasParentTransaction && (
                      <BadgeWithDot type="pill-color" size="sm" color="gray" className="ml-2">
                        child
                      </BadgeWithDot>
                    )}
                  </Table.Cell>
                  <Table.Cell>
                    <BadgeWithDot type="pill-color" size="sm" color={STATE_COLOR[t.state] ?? "gray"}>
                      {t.state}
                    </BadgeWithDot>
                  </Table.Cell>
                  <Table.Cell>{formatAmount(t.amountCents, t.currency)}</Table.Cell>
                  <Table.Cell>{t.merchantOrderId}</Table.Cell>
                  <Table.Cell>{t.createdAt}</Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        )}
        {!query.isError && query.data?.data.length === 0 && (
          <p className="p-5 text-sm text-tertiary">No transactions yet.</p>
        )}
      </TableCard.Root>
    </section>
  );
}
