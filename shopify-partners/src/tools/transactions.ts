import { listTransactions, getTransaction } from "../api/transactions.js";
import type { TransactionType, Transaction } from "../api/types.js";

type ToolResult = { content: Array<{ type: string; text: string }> };

function formatMoney(m: { amount: string; currencyCode: string } | undefined): string {
  if (!m) return "-";
  return `${m.amount} ${m.currencyCode}`;
}

function summarizeTransaction(t: Transaction): Record<string, unknown> {
  const base = {
    id: t.id,
    type: t.__typename,
    createdAt: t.createdAt,
    app: t.app?.name ?? "-",
    apiKey: t.app?.apiKey ?? "-",
    shop: t.shop?.myshopifyDomain ?? "-",
    netAmount: formatMoney(t.netAmount),
    grossAmount: formatMoney(t.grossAmount),
  };

  // AppSaleCredit has no shopifyFee
  if ("shopifyFee" in t) {
    return { ...base, shopifyFee: formatMoney(t.shopifyFee) };
  }
  return base;
}

export async function handleListTransactions(
  args: Record<string, unknown>
): Promise<ToolResult> {
  const first = typeof args.first === "number" ? args.first : 20;
  const types = Array.isArray(args.types)
    ? (args.types as TransactionType[])
    : undefined;

  const txns = await listTransactions({ first, types });
  const rows = txns.map(summarizeTransaction);

  // Revenue summary
  const totalNet = txns.reduce((sum, t) => {
    const amt = parseFloat(t.netAmount?.amount ?? "0");
    return sum + (isNaN(amt) ? 0 : amt);
  }, 0);

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(
          {
            total: rows.length,
            total_net_revenue: `${totalNet.toFixed(2)} ${txns[0]?.netAmount?.currencyCode ?? ""}`.trim(),
            transactions: rows,
          },
          null,
          2
        ),
      },
    ],
  };
}

export async function handleGetTransaction(
  args: Record<string, unknown>
): Promise<ToolResult> {
  const id = String(args.id ?? "");
  if (!id) throw new Error("id is required");

  const txn = await getTransaction(id);
  return {
    content: [{ type: "text", text: JSON.stringify(summarizeTransaction(txn), null, 2) }],
  };
}
