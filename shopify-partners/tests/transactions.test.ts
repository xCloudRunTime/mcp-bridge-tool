import { describe, it, expect, vi, beforeEach } from "vitest";
import axios from "axios";

vi.mock("axios");
const mockedAxios = vi.mocked(axios);

import { listTransactions, getTransaction } from "../src/api/transactions";
import { handleListTransactions, handleGetTransaction } from "../src/tools/transactions";

// ── Env setup ─────────────────────────────────────────────────
function setEnv() {
  process.env.SHOPIFY_PARTNER_ID = "851712";
  process.env.SHOPIFY_PARTNER_ACCESS_TOKEN = "prtapi_test";
}

// ── Fixtures ──────────────────────────────────────────────────
const SUBSCRIPTION_SALE = {
  id: "gid://partners/Transaction/1001",
  createdAt: "2025-06-15T10:00:00Z",
  __typename: "AppSubscriptionSale",
  netAmount: { amount: "22.50", currencyCode: "USD" },
  grossAmount: { amount: "29.00", currencyCode: "USD" },
  shopifyFee: { amount: "6.50", currencyCode: "USD" },
  app: { name: "xRuntime AI Product Description", apiKey: "abc123" },
  shop: { name: "Acme Store", myshopifyDomain: "acme.myshopify.com" },
};

const CREDIT = {
  id: "gid://partners/Transaction/1002",
  createdAt: "2025-06-20T10:00:00Z",
  __typename: "AppSaleCredit",
  netAmount: { amount: "5.00", currencyCode: "USD" },
  grossAmount: { amount: "5.00", currencyCode: "USD" },
  app: { name: "xRuntime AI Product Description", apiKey: "abc123" },
  shop: { name: "Acme Store", myshopifyDomain: "acme.myshopify.com" },
};

function gqlOk<T>(data: T) {
  return { data: { data } };
}

function txnListResponse(txns: unknown[]) {
  return gqlOk({
    transactions: { edges: txns.map((node) => ({ node })) },
  });
}

// ── API layer: listTransactions ───────────────────────────────
describe("API: listTransactions", () => {
  beforeEach(() => { vi.clearAllMocks(); setEnv(); });

  it("returns list of transactions", async () => {
    mockedAxios.post.mockResolvedValueOnce(txnListResponse([SUBSCRIPTION_SALE, CREDIT]));

    const txns = await listTransactions();
    expect(txns).toHaveLength(2);
    expect(txns[0].__typename).toBe("AppSubscriptionSale");
    expect(txns[1].__typename).toBe("AppSaleCredit");
  });

  it("sends types filter to the API", async () => {
    mockedAxios.post.mockResolvedValueOnce(txnListResponse([SUBSCRIPTION_SALE]));

    await listTransactions({ types: ["APP_SUBSCRIPTION_SALE"] });

    const body = mockedAxios.post.mock.calls[0][1] as { variables: Record<string, unknown> };
    expect(body.variables.types).toEqual(["APP_SUBSCRIPTION_SALE"]);
  });

  it("defaults to first: 20", async () => {
    mockedAxios.post.mockResolvedValueOnce(txnListResponse([]));

    await listTransactions();

    const body = mockedAxios.post.mock.calls[0][1] as { variables: { first: number } };
    expect(body.variables.first).toBe(20);
  });

  it("uses correct X-Shopify-Access-Token header", async () => {
    mockedAxios.post.mockResolvedValueOnce(txnListResponse([]));

    await listTransactions();

    const config = mockedAxios.post.mock.calls[0][2] as { headers: Record<string, string> };
    expect(config.headers["X-Shopify-Access-Token"]).toBe("prtapi_test");
  });

  it("throws when SHOPIFY_PARTNER_ACCESS_TOKEN is missing", async () => {
    delete process.env.SHOPIFY_PARTNER_ACCESS_TOKEN;
    await expect(listTransactions()).rejects.toThrow("SHOPIFY_PARTNER_ACCESS_TOKEN");
  });
});

// ── API layer: getTransaction ─────────────────────────────────
describe("API: getTransaction", () => {
  beforeEach(() => { vi.clearAllMocks(); setEnv(); });

  it("fetches transaction by numeric ID", async () => {
    mockedAxios.post.mockResolvedValueOnce(gqlOk({ transaction: SUBSCRIPTION_SALE }));

    const txn = await getTransaction("1001");
    expect(txn.id).toBe("gid://partners/Transaction/1001");
    expect(txn.__typename).toBe("AppSubscriptionSale");
  });

  it("converts numeric ID to GID in request", async () => {
    mockedAxios.post.mockResolvedValueOnce(gqlOk({ transaction: SUBSCRIPTION_SALE }));

    await getTransaction("1001");

    const body = mockedAxios.post.mock.calls[0][1] as { variables: { id: string } };
    expect(body.variables.id).toBe("gid://partners/Transaction/1001");
  });

  it("passes full GID through unchanged", async () => {
    mockedAxios.post.mockResolvedValueOnce(gqlOk({ transaction: SUBSCRIPTION_SALE }));

    await getTransaction("gid://partners/Transaction/1001");

    const body = mockedAxios.post.mock.calls[0][1] as { variables: { id: string } };
    expect(body.variables.id).toBe("gid://partners/Transaction/1001");
  });
});

// ── MCP tool handler: handleListTransactions ──────────────────
describe("Tool: handleListTransactions", () => {
  beforeEach(() => { vi.clearAllMocks(); setEnv(); });

  it("returns formatted transaction rows with net revenue total", async () => {
    mockedAxios.post.mockResolvedValueOnce(
      txnListResponse([SUBSCRIPTION_SALE, CREDIT])
    );

    const result = await handleListTransactions({});
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.total).toBe(2);
    expect(parsed.total_net_revenue).toBe("27.50 USD");
    expect(parsed.transactions[0].type).toBe("AppSubscriptionSale");
    expect(parsed.transactions[0].netAmount).toBe("22.50 USD");
    expect(parsed.transactions[0].shopifyFee).toBe("6.50 USD");
  });

  it("AppSaleCredit row has no shopifyFee field", async () => {
    mockedAxios.post.mockResolvedValueOnce(txnListResponse([CREDIT]));

    const result = await handleListTransactions({});
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.transactions[0].shopifyFee).toBeUndefined();
  });
});

// ── MCP tool handler: handleGetTransaction ────────────────────
describe("Tool: handleGetTransaction", () => {
  beforeEach(() => { vi.clearAllMocks(); setEnv(); });

  it("returns single transaction details", async () => {
    mockedAxios.post.mockResolvedValueOnce(gqlOk({ transaction: SUBSCRIPTION_SALE }));

    const result = await handleGetTransaction({ id: "1001" });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.type).toBe("AppSubscriptionSale");
    expect(parsed.app).toBe("xRuntime AI Product Description");
    expect(parsed.shop).toBe("acme.myshopify.com");
  });

  it("throws when id is missing", async () => {
    await expect(handleGetTransaction({})).rejects.toThrow("id is required");
  });
});
