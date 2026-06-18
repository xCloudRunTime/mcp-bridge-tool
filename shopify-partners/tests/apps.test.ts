import { describe, it, expect, vi, beforeEach } from "vitest";
import axios from "axios";

vi.mock("axios");
const mockedAxios = vi.mocked(axios);

import { getApp, getAppEvents } from "../src/api/apps";
import { handleGetApp, handleGetAppEvents } from "../src/tools/apps";

// ── Env setup ─────────────────────────────────────────────────
function setEnv() {
  process.env.SHOPIFY_PARTNER_ID = "851712";
  process.env.SHOPIFY_PARTNER_ACCESS_TOKEN = "prtapi_test";
}

// ── Fixtures ──────────────────────────────────────────────────
const APP_FIXTURE = {
  id: "gid://partners/App/322642771969",
  name: "xRuntime AI Product Description",
  apiKey: "abc123clientid",
};

const INSTALL_EVENT = {
  type: "RELATIONSHIP_INSTALLED",
  occurredAt: "2025-06-01T00:00:00Z",
  shop: { name: "Acme Store", myshopifyDomain: "acme.myshopify.com" },
};

const UNINSTALL_EVENT = {
  type: "RELATIONSHIP_UNINSTALLED",
  occurredAt: "2025-07-01T00:00:00Z",
  shop: { name: "Acme Store", myshopifyDomain: "acme.myshopify.com" },
};

function gqlOk<T>(data: T) {
  return { data: { data } };
}

function eventsPage(
  events: typeof INSTALL_EVENT[],
  hasNextPage: boolean,
  cursors?: string[]
) {
  return gqlOk({
    app: {
      events: {
        edges: events.map((node, i) => ({ cursor: cursors?.[i] ?? `cur-${i}`, node })),
        pageInfo: { hasNextPage, hasPreviousPage: false },
      },
    },
  });
}

// ── API layer: getApp ─────────────────────────────────────────
describe("API: getApp", () => {
  beforeEach(() => { vi.clearAllMocks(); setEnv(); });

  it("returns app with id, name, apiKey", async () => {
    mockedAxios.post.mockResolvedValueOnce(gqlOk({ app: APP_FIXTURE }));

    const app = await getApp("322642771969");
    expect(app.name).toBe("xRuntime AI Product Description");
    expect(app.apiKey).toBe("abc123clientid");
  });

  it("sends GID to the API", async () => {
    mockedAxios.post.mockResolvedValueOnce(gqlOk({ app: APP_FIXTURE }));

    await getApp("322642771969");

    const body = mockedAxios.post.mock.calls[0][1] as { variables: { id: string } };
    expect(body.variables.id).toBe("gid://partners/App/322642771969");
  });

  it("passes a full GID through unchanged", async () => {
    mockedAxios.post.mockResolvedValueOnce(gqlOk({ app: APP_FIXTURE }));

    await getApp("gid://partners/App/322642771969");

    const body = mockedAxios.post.mock.calls[0][1] as { variables: { id: string } };
    expect(body.variables.id).toBe("gid://partners/App/322642771969");
  });

  it("uses correct Partners API endpoint with 2026-01 version", async () => {
    mockedAxios.post.mockResolvedValueOnce(gqlOk({ app: APP_FIXTURE }));

    await getApp("12345");

    const url = mockedAxios.post.mock.calls[0][0] as string;
    expect(url).toContain("partners.shopify.com/851712/api/2026-01");
  });

  it("throws on GraphQL errors", async () => {
    mockedAxios.post.mockResolvedValueOnce({
      data: { errors: [{ message: "App not found" }] },
    });

    await expect(getApp("9999")).rejects.toThrow("App not found");
  });

  it("throws when SHOPIFY_PARTNER_ID is missing", async () => {
    delete process.env.SHOPIFY_PARTNER_ID;
    await expect(getApp("123")).rejects.toThrow("SHOPIFY_PARTNER_ID");
  });
});

// ── API layer: getAppEvents ───────────────────────────────────
describe("API: getAppEvents", () => {
  beforeEach(() => { vi.clearAllMocks(); setEnv(); });

  it("returns events array", async () => {
    mockedAxios.post.mockResolvedValueOnce(eventsPage([INSTALL_EVENT], false));

    const events = await getAppEvents("12345");
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("RELATIONSHIP_INSTALLED");
  });

  it("sends types filter to the API", async () => {
    mockedAxios.post.mockResolvedValueOnce(eventsPage([INSTALL_EVENT], false));

    await getAppEvents("12345", { types: ["RELATIONSHIP_INSTALLED"] });

    const body = mockedAxios.post.mock.calls[0][1] as { variables: Record<string, unknown> };
    expect(body.variables.types).toEqual(["RELATIONSHIP_INSTALLED"]);
  });

  it("sends date range filters (occurredAtMin / occurredAtMax)", async () => {
    mockedAxios.post.mockResolvedValueOnce(eventsPage([], false));

    await getAppEvents("12345", { from: "2025-01-01T00:00:00Z", to: "2025-12-31T23:59:59Z" });

    const body = mockedAxios.post.mock.calls[0][1] as { variables: Record<string, unknown> };
    expect(body.variables.occurredAtMin).toBe("2025-01-01T00:00:00Z");
    expect(body.variables.occurredAtMax).toBe("2025-12-31T23:59:59Z");
  });

  it("paginates using edge cursor (not pageInfo.endCursor)", async () => {
    mockedAxios.post
      .mockResolvedValueOnce(eventsPage([INSTALL_EVENT], true, ["cursor-page1"]))
      .mockResolvedValueOnce(eventsPage([UNINSTALL_EVENT], false, ["cursor-page2"]));

    const events = await getAppEvents("12345", { limit: 100 });

    expect(events).toHaveLength(2);
    // Second call must use the cursor from the last edge of page 1
    const secondCallVars = (mockedAxios.post.mock.calls[1][1] as { variables: Record<string, unknown> }).variables;
    expect(secondCallVars.after).toBe("cursor-page1");
  });

  it("stops when hasNextPage is false", async () => {
    mockedAxios.post.mockResolvedValueOnce(eventsPage([INSTALL_EVENT], false));

    await getAppEvents("12345");

    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
  });
});

// ── MCP tool handler: handleGetApp ────────────────────────────
describe("Tool: handleGetApp", () => {
  beforeEach(() => { vi.clearAllMocks(); setEnv(); });

  it("returns JSON with app details", async () => {
    mockedAxios.post.mockResolvedValueOnce(gqlOk({ app: APP_FIXTURE }));

    const result = await handleGetApp({ appId: "322642771969" });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.name).toBe("xRuntime AI Product Description");
    expect(parsed.apiKey).toBe("abc123clientid");
  });

  it("throws when appId is missing", async () => {
    await expect(handleGetApp({})).rejects.toThrow("appId is required");
  });
});

// ── MCP tool handler: handleGetAppEvents ─────────────────────
describe("Tool: handleGetAppEvents", () => {
  beforeEach(() => { vi.clearAllMocks(); setEnv(); });

  it("returns events with summary counts", async () => {
    mockedAxios.post.mockResolvedValueOnce(
      eventsPage([INSTALL_EVENT, UNINSTALL_EVENT], false)
    );

    const result = await handleGetAppEvents({ appId: "12345" });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.total).toBe(2);
    expect(parsed.summary.RELATIONSHIP_INSTALLED).toBe(1);
    expect(parsed.summary.RELATIONSHIP_UNINSTALLED).toBe(1);
  });

  it("throws when appId is missing", async () => {
    await expect(handleGetAppEvents({})).rejects.toThrow("appId is required");
  });
});
