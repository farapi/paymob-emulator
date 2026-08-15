import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { listTransactions } from "./api.js";

export function TransactionsPage() {
  const query = useQuery({ queryKey: ["admin-transactions"], queryFn: listTransactions, refetchInterval: 5000 });

  if (query.isLoading) return <p>Loading...</p>;
  if (query.isError) return <p className="checkout__error">Failed to load transactions.</p>;

  return (
    <section>
      <h1>Transactions</h1>
      <table className="admin-table">
        <thead>
          <tr>
            <th>ID</th>
            <th>State</th>
            <th>Amount</th>
            <th>Merchant order</th>
            <th>Created</th>
          </tr>
        </thead>
        <tbody>
          {query.data?.data.map((t) => (
            <tr key={t.id}>
              <td>
                <Link to={`/__simulator/dashboard/transactions/${t.id}`}>{t.providerNumericId}</Link>
                {t.hasParentTransaction && <span className="admin-badge">child</span>}
              </td>
              <td>
                <span className={`admin-state admin-state--${t.state}`}>{t.state}</span>
              </td>
              <td>
                {(t.amountCents / 100).toFixed(2)} {t.currency}
              </td>
              <td>{t.merchantOrderId}</td>
              <td>{t.createdAt}</td>
            </tr>
          ))}
          {query.data?.data.length === 0 && (
            <tr>
              <td colSpan={5}>No transactions yet.</td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  );
}
