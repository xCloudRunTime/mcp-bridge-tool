import { describe, it, expect, vi, beforeEach } from "vitest";
import axios from "axios";

vi.mock("axios");
const mockedAxios = vi.mocked(axios);

import {
  handleListApps,
  handleGetApp,
  handleGetInstallations,
  handleGetAppEvents,
  handleGetPartnerInfo,
  handleGetWebhooks,
  handleUpdateApp,
} from "../src/index";

// ── Fixtures ──────────────────────────────────────────────────
const APP_NODE = {
  id: "gid://partners/App/12345",
  name: "xRuntime AI Product Description",
  appType: "public",
  createTime: "2024-01-15T10:00:00Z",
  active: true,
  draftUrl: "https://dev.example.com",
  appStoreName: "xRuntime AI",
  contactEmail: "hello@xcloudruntime.com",
};

const INSTALL_NODE = {
  id: "gid://partners/Installation/99",
  installedAt: "2025-06-01T00:00:00Z",
  uninstalledAt: null,
  shop: {
    name: "Acme Store",
    myshopifyDomain: "acme-store.myshopify.com",
    plan: { displayName: "Shopify" },
  },
  activeSubscriptions: [{ name: "Pro Plan", test: false, status: "ACTIVE" }],
};

const EVENT_NODE = {
  type: "APP_INSTALLED",
  occurredAt: "2025-06-01T00:00:00Z",
  shop: { name: "Acme Store", myshopifyDomain: "acme-store.myshopify.com" },
};

const PARTNER_INFO_NODE = {
  id: "gid://partners/Organization/851712",
  name: "xCloudRunTime",
  email: "xcloudruntime@gmail.com",
  website: "https://xcloudruntime.com",
  createdAt: "2023-01-01T00:00:00Z",
};

const WEBHOOK_NODE = {
  id: "gid://partners/WebhookSubscription/1",
  topic: "APP_PURCHASES_ONE_TIME_UPDATE",
  format: "JSON",
  endpoint: { __typename: "WebhookHttpEndpoint", callbackUrl: "https://app.example.com/webhooks" },
};

// ── Helper: build paginated GQL response ──────────────────────
function pageResponse<T>(nodes: T[], hasNextPage = false) {
  return {
    data: {
      data: {
        edges: nodes.map((node) => ({ node })),
        pageInfo: { hasNextPage, endCursor: hasNextPage ? "cursor123" : null },
      },
    },
  };
}

function appPageResponse(nodes: typeof APP_NODE[], hasNextPage = false) {
  return {
    data: {
      data: {
        apps: {
          edges: nodes.map((node) => ({ node })),
          pageInfo: { hasNextPage, endCursor: hasNextPage ? "cursor123" : null },
        },
      },
    },
  };
}

function installPageResponse(nodes: typeof INSTALL_NODE[], hasNextPage = false) {
  return {
    data: {
      data: {
        app: {
          installations: {
            edges: nodes.map((node) => ({ node })),
            pageInfo: { hasNextPage, endCursor: hasNextPage ? "cursor123" : null },
          },
        },
      },
    },
  };
}

function eventPageResponse(nodes: typeof EVENT_NODE[], hasNextPage = false) {
  return {
    data: {
      data: {
        app: {
          events: {
            edges: nodes.map((node) => ({ node })),
            pageInfo: { hasNextPage, endCursor: null },
          },
        },
      },
    },
  };
}

// ── Tests ─────────────────────────────────────────────────────
describe("shopify_list_apps", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SHOPIFY_PARTNER_ID = "851712";
    process.env.SHOPIFY_PARTNER_ACCESS_TOKEN = "prtapi_test";
  });

  it("returns list of apps", async () => {
    mockedAxios.post.mockResolvedValueOnce(appPageResponse([APP_NODE]));

    const result = await handleListApps({});
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.total).toBe(1);
    expect(parsed.apps[0].name).toBe("xRuntime AI Product Description");
    expect(parsed.apps[0].active).toBe(true);
  });

  it("sends correct auth header", async () => {
    mockedAxios.post.mockResolvedValueOnce(appPageResponse([APP_NODE]));

    await handleListApps({});

    const call = mockedAxios.post.mock.calls[0];
    const config = call[2] as { headers: Record<string, string> };
    expect(config.headers["X-Shopify-Access-Token"]).toBe("prtapi_test");
  });

  it("uses correct Partners API endpoint", async () => {
    mockedAxios.post.mockResolvedValueOnce(appPageResponse([APP_NODE]));

    await handleListApps({});

    const url = mockedAxios.post.mock.calls[0][0] as string;
    expect(url).toContain("partners.shopify.com/851712/api");
  });

  it("throws when SHOPIFY_PARTNER_ID is missing", async () => {
    delete process.env.SHOPIFY_PARTNER_ID;
    await expect(handleListApps({})).rejects.toThrow("SHOPIFY_PARTNER_ID");
  });

  it("throws when SHOPIFY_PARTNER_ACCESS_TOKEN is missing", async () => {
    delete process.env.SHOPIFY_PARTNER_ACCESS_TOKEN;
    await expect(handleListApps({})).rejects.toThrow("SHOPIFY_PARTNER_ACCESS_TOKEN");
  });

  it("paginates across multiple pages", async () => {
    const app1 = { ...APP_NODE, id: "gid://partners/App/1", name: "App One" };
    const app2 = { ...APP_NODE, id: "gid://partners/App/2", name: "App Two" };

    mockedAxios.post
      .mockResolvedValueOnce(appPageResponse([app1], true))  // page 1 with next
      .mockResolvedValueOnce(appPageResponse([app2], false)); // page 2 last

    const result = await handleListApps({ limit: 500 });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.total).toBe(2);
    expect(parsed.apps[0].name).toBe("App One");
    expect(parsed.apps[1].name).toBe("App Two");
  });
});

describe("shopify_get_app", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SHOPIFY_PARTNER_ID = "851712";
    process.env.SHOPIFY_PARTNER_ACCESS_TOKEN = "prtapi_test";
  });

  it("returns app details for a numeric ID", async () => {
    mockedAxios.post.mockResolvedValueOnce({
      data: { data: { app: APP_NODE } },
    });

    const result = await handleGetApp({ appId: "12345" });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.name).toBe("xRuntime AI Product Description");
    expect(parsed.contactEmail).toBe("hello@xcloudruntime.com");
  });

  it("converts numeric ID to GID in the request", async () => {
    mockedAxios.post.mockResolvedValueOnce({
      data: { data: { app: APP_NODE } },
    });

    await handleGetApp({ appId: "12345" });

    const body = mockedAxios.post.mock.calls[0][1] as { variables: { id: string } };
    expect(body.variables.id).toBe("gid://partners/App/12345");
  });

  it("passes through an existing GID unchanged", async () => {
    mockedAxios.post.mockResolvedValueOnce({
      data: { data: { app: APP_NODE } },
    });

    await handleGetApp({ appId: "gid://partners/App/12345" });

    const body = mockedAxios.post.mock.calls[0][1] as { variables: { id: string } };
    expect(body.variables.id).toBe("gid://partners/App/12345");
  });

  it("throws when appId is missing", async () => {
    await expect(handleGetApp({})).rejects.toThrow("appId is required");
  });

  it("throws on GraphQL errors", async () => {
    mockedAxios.post.mockResolvedValueOnce({
      data: { errors: [{ message: "App not found" }] },
    });

    await expect(handleGetApp({ appId: "999" })).rejects.toThrow("App not found");
  });
});

describe("shopify_get_installations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SHOPIFY_PARTNER_ID = "851712";
    process.env.SHOPIFY_PARTNER_ACCESS_TOKEN = "prtapi_test";
  });

  it("returns installation details", async () => {
    mockedAxios.post.mockResolvedValueOnce(installPageResponse([INSTALL_NODE]));

    const result = await handleGetInstallations({ appId: "12345" });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.total).toBe(1);
    expect(parsed.active_installs).toBe(1);
    expect(parsed.installations[0].shop).toBe("acme-store.myshopify.com");
    expect(parsed.installations[0].subscriptions).toEqual(["Pro Plan"]);
  });

  it("counts uninstalled shops correctly", async () => {
    const uninstalledNode = { ...INSTALL_NODE, uninstalledAt: "2025-07-01T00:00:00Z" };
    mockedAxios.post.mockResolvedValueOnce(
      installPageResponse([INSTALL_NODE, uninstalledNode])
    );

    const result = await handleGetInstallations({ appId: "12345" });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.total).toBe(2);
    expect(parsed.active_installs).toBe(1);
  });

  it("throws when appId is missing", async () => {
    await expect(handleGetInstallations({})).rejects.toThrow("appId is required");
  });
});

describe("shopify_get_app_events", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SHOPIFY_PARTNER_ID = "851712";
    process.env.SHOPIFY_PARTNER_ACCESS_TOKEN = "prtapi_test";
  });

  it("returns events with summary counts", async () => {
    const uninstallEvent = { ...EVENT_NODE, type: "APP_UNINSTALLED" };
    mockedAxios.post.mockResolvedValueOnce(
      eventPageResponse([EVENT_NODE, uninstallEvent])
    );

    const result = await handleGetAppEvents({ appId: "12345" });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.total).toBe(2);
    expect(parsed.summary.APP_INSTALLED).toBe(1);
    expect(parsed.summary.APP_UNINSTALLED).toBe(1);
  });

  it("passes event type filters to the query", async () => {
    mockedAxios.post.mockResolvedValueOnce(eventPageResponse([EVENT_NODE]));

    await handleGetAppEvents({ appId: "12345", types: ["APP_INSTALLED"] });

    const body = mockedAxios.post.mock.calls[0][1] as { variables: Record<string, unknown> };
    expect(body.variables.types).toEqual(["APP_INSTALLED"]);
  });
});

describe("shopify_get_partner_info", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SHOPIFY_PARTNER_ID = "851712";
    process.env.SHOPIFY_PARTNER_ACCESS_TOKEN = "prtapi_test";
  });

  it("returns partner organization details", async () => {
    mockedAxios.post.mockResolvedValueOnce({
      data: { data: { currentUserAccount: PARTNER_INFO_NODE } },
    });

    const result = await handleGetPartnerInfo();
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.name).toBe("xCloudRunTime");
    expect(parsed.email).toBe("xcloudruntime@gmail.com");
  });
});

describe("shopify_get_webhooks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SHOPIFY_PARTNER_ID = "851712";
    process.env.SHOPIFY_PARTNER_ACCESS_TOKEN = "prtapi_test";
  });

  it("returns webhook subscriptions", async () => {
    mockedAxios.post.mockResolvedValueOnce({
      data: {
        data: {
          app: {
            webhookSubscriptions: {
              edges: [{ node: WEBHOOK_NODE }],
            },
          },
        },
      },
    });

    const result = await handleGetWebhooks({ appId: "12345" });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.total).toBe(1);
    expect(parsed.webhooks[0].topic).toBe("APP_PURCHASES_ONE_TIME_UPDATE");
    expect(parsed.webhooks[0].endpoint.callbackUrl).toBe("https://app.example.com/webhooks");
  });

  it("throws when appId is missing", async () => {
    await expect(handleGetWebhooks({})).rejects.toThrow("appId is required");
  });
});

describe("shopify_update_app", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SHOPIFY_PARTNER_ID = "851712";
    process.env.SHOPIFY_PARTNER_ACCESS_TOKEN = "prtapi_test";
  });

  it("updates app fields and returns updated app", async () => {
    mockedAxios.post.mockResolvedValueOnce({
      data: {
        data: {
          appUpdate: {
            app: { ...APP_NODE, contactEmail: "new@xcloudruntime.com" },
            userErrors: [],
          },
        },
      },
    });

    const result = await handleUpdateApp({ appId: "12345", contactEmail: "new@xcloudruntime.com" });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.success).toBe(true);
    expect(parsed.app.contactEmail).toBe("new@xcloudruntime.com");
  });

  it("throws when no fields provided", async () => {
    await expect(handleUpdateApp({ appId: "12345" })).rejects.toThrow(
      "Provide at least one field"
    );
  });

  it("throws on userErrors from GraphQL mutation", async () => {
    mockedAxios.post.mockResolvedValueOnce({
      data: {
        data: {
          appUpdate: {
            app: null,
            userErrors: [{ field: ["contactEmail"], message: "Invalid email format" }],
          },
        },
      },
    });

    await expect(
      handleUpdateApp({ appId: "12345", contactEmail: "not-an-email" })
    ).rejects.toThrow("Invalid email format");
  });

  it("throws when appId is missing", async () => {
    await expect(handleUpdateApp({})).rejects.toThrow("appId is required");
  });
});
