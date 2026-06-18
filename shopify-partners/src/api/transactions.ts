import { gql, toTransactionGid } from "./client.js";
import { LIST_TRANSACTIONS, GET_TRANSACTION } from "./queries.js";
import type { Transaction, ListTransactionsOptions } from "./types.js";

// ── List Transactions ─────────────────────────────────────────

interface ListTransactionsData {
  transactions: {
    edges: Array<{ node: Transaction }>;
  };
}

export async function listTransactions(
  options: ListTransactionsOptions = {}
): Promise<Transaction[]> {
  const { first = 20, types } = options;

  const variables: Record<string, unknown> = { first };
  if (types && types.length > 0) variables.types = types;

  const data = await gql<ListTransactionsData>(LIST_TRANSACTIONS, variables);
  return data.transactions.edges.map((e) => e.node);
}

// ── Get Single Transaction ────────────────────────────────────

interface GetTransactionData {
  transaction: Transaction;
}

export async function getTransaction(id: string): Promise<Transaction> {
  const data = await gql<GetTransactionData>(GET_TRANSACTION, {
    id: toTransactionGid(id),
  });
  return data.transaction;
}
