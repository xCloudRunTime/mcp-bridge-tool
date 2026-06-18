import "dotenv/config";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {
  gql,
  gqlPaginated,
  toAppGid,
  type ShopifyApp,
  type AppInstallation,
  type AppEvent,
  type PartnerInfo,
  type WebhookSubscription,
} from "./client.js";
import {
  LIST_APPS,
  GET_APP,
  GET_INSTALLATIONS,
  GET_APP_EVENTS,
  GET_PARTNER_INFO,
  GET_WEBHOOKS,
  UPDATE_APP,
} from "./queries.js";

// ---------------------------------------------------------------
// Server setup
// ---------------------------------------------------------------
const server = new Server(
  { name: "shopify-partners-mcp", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

// ---------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "shopify_list_apps",
      description:
        "List all apps in your Shopify Partner account. Returns id, name, type, status and contact email for each app.",
      inputSchema: {
        type: "object",
        properties: {
          limit: {
            type: "number",
            description: "Max apps to return (default 50, max 500)",
          },
        },
      },
    },
    {
      name: "shopify_get_app",
      description:
        "Get full details for a single Shopify app by its numeric ID or full GID.",
      inputSchema: {
        type: "object",
        properties: {
          appId: {
            type: "string",
            description: "Numeric app ID (e.g. 12345) or GID (gid://partners/App/12345)",
          },
        },
        required: ["appId"],
      },
    },
    {
      name: "shopify_get_installations",
      description:
        "Get all shops that have installed a given app, including active subscription info.",
      inputSchema: {
        type: "object",
        properties: {
          appId: {
            type: "string",
            description: "Numeric app ID or GID",
          },
          limit: {
            type: "number",
            description: "Max installations to return (default 100, max 500)",
          },
        },
        required: ["appId"],
      },
    },
    {
      name: "shopify_get_app_events",
      description:
        "Get recent events for an app (installs, uninstalls, subscription changes).",
      inputSchema: {
        type: "object",
        properties: {
          appId: {
            type: "string",
            description: "Numeric app ID or GID",
          },
          types: {
            type: "array",
            items: { type: "string" },
            description:
              "Filter by event types. Values: APP_INSTALLED, APP_UNINSTALLED, SUBSCRIPTION_CHARGE_ACTIVATED, SUBSCRIPTION_CHARGE_CANCELED, CREDIT_APPLIED, USAGE_CHARGE_APPLIED",
          },
          limit: {
            type: "number",
            description: "Max events to return (default 50, max 500)",
          },
        },
        required: ["appId"],
      },
    },
    {
      name: "shopify_get_partner_info",
      description:
        "Get your Shopify Partner organization details (name, email, website, created date).",
      inputSchema: {
        type: "object",
        properties: {},
      },
    },
    {
      name: "shopify_get_webhooks",
      description:
        "List all webhook subscriptions configured for a Shopify app.",
      inputSchema: {
        type: "object",
        properties: {
          appId: {
            type: "string",
            description: "Numeric app ID or GID",
          },
        },
        required: ["appId"],
      },
    },
    {
      name: "shopify_update_app",
      description:
        "Update editable fields on a Shopify app (contactEmail, draftUrl).",
      inputSchema: {
        type: "object",
        properties: {
          appId: {
            type: "string",
            description: "Numeric app ID or GID",
          },
          contactEmail: {
            type: "string",
            description: "New contact email address",
          },
          draftUrl: {
            type: "string",
            description: "New draft/development URL",
          },
        },
        required: ["appId"],
      },
    },
  ],
}));

// ---------------------------------------------------------------
// Tool handlers
// ---------------------------------------------------------------
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;

  try {
    switch (name) {
      case "shopify_list_apps":
        return await handleListApps(args);
      case "shopify_get_app":
        return await handleGetApp(args);
      case "shopify_get_installations":
        return await handleGetInstallations(args);
      case "shopify_get_app_events":
        return await handleGetAppEvents(args);
      case "shopify_get_partner_info":
        return await handleGetPartnerInfo();
      case "shopify_get_webhooks":
        return await handleGetWebhooks(args);
      case "shopify_update_app":
        return await handleUpdateApp(args);
      default:
        return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
  }
});

// ---------------------------------------------------------------
// Handlers (also exported for unit testing)
// ---------------------------------------------------------------

export async function handleListApps(
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const limit = typeof args.limit === "number" ? args.limit : 50;

  const apps = await gqlPaginated<ShopifyApp>(
    LIST_APPS,
    (data) => (data as { apps: { edges: Array<{ node: ShopifyApp }>; pageInfo: { hasNextPage: boolean; endCursor: string | null } } }).apps,
    {},
    limit
  );

  const rows = apps.map((a) => ({
    id: a.id,
    name: a.name,
    type: a.appType,
    active: a.active,
    appStoreName: a.appStoreName ?? "-",
    contactEmail: a.contactEmail ?? "-",
    created: a.createTime,
  }));

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({ total: rows.length, apps: rows }, null, 2),
      },
    ],
  };
}

export async function handleGetApp(
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const appId = String(args.appId ?? "");
  if (!appId) throw new Error("appId is required");

  const data = await gql<{ app: ShopifyApp }>(GET_APP, { id: toAppGid(appId) });

  return {
    content: [{ type: "text", text: JSON.stringify(data.app, null, 2) }],
  };
}

export async function handleGetInstallations(
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const appId = String(args.appId ?? "");
  if (!appId) throw new Error("appId is required");
  const limit = typeof args.limit === "number" ? args.limit : 100;

  const installations = await gqlPaginated<AppInstallation>(
    GET_INSTALLATIONS,
    (data) => {
      const d = data as { app: { installations: { edges: Array<{ node: AppInstallation }>; pageInfo: { hasNextPage: boolean; endCursor: string | null } } } };
      return d.app.installations;
    },
    { appId: toAppGid(appId) },
    limit
  );

  const rows = installations.map((i) => ({
    id: i.id,
    shop: i.shop.myshopifyDomain,
    shopName: i.shop.name,
    plan: i.shop.plan?.displayName ?? "-",
    installedAt: i.installedAt,
    uninstalledAt: i.uninstalledAt ?? null,
    subscriptions: i.activeSubscriptions.map((s) => s.name),
    isTestInstall: i.activeSubscriptions.some((s) => s.test),
  }));

  const active = rows.filter((r) => !r.uninstalledAt).length;

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(
          { total: rows.length, active_installs: active, installations: rows },
          null,
          2
        ),
      },
    ],
  };
}

export async function handleGetAppEvents(
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const appId = String(args.appId ?? "");
  if (!appId) throw new Error("appId is required");
  const limit = typeof args.limit === "number" ? args.limit : 50;
  const types = Array.isArray(args.types) ? args.types : undefined;

  const variables: Record<string, unknown> = { appId: toAppGid(appId) };
  if (types && types.length > 0) variables.types = types;

  const events = await gqlPaginated<AppEvent>(
    GET_APP_EVENTS,
    (data) => {
      const d = data as { app: { events: { edges: Array<{ node: AppEvent }>; pageInfo: { hasNextPage: boolean; endCursor: string | null } } } };
      return d.app.events;
    },
    variables,
    limit
  );

  const rows = events.map((e) => ({
    type: e.type,
    occurredAt: e.occurredAt,
    shop: e.shop?.myshopifyDomain ?? null,
    shopName: e.shop?.name ?? null,
  }));

  const summary: Record<string, number> = {};
  for (const e of rows) {
    summary[e.type] = (summary[e.type] ?? 0) + 1;
  }

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({ total: rows.length, summary, events: rows }, null, 2),
      },
    ],
  };
}

export async function handleGetPartnerInfo(): Promise<{
  content: Array<{ type: string; text: string }>;
}> {
  const data = await gql<{ currentUserAccount: PartnerInfo }>(GET_PARTNER_INFO);

  return {
    content: [{ type: "text", text: JSON.stringify(data.currentUserAccount, null, 2) }],
  };
}

export async function handleGetWebhooks(
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const appId = String(args.appId ?? "");
  if (!appId) throw new Error("appId is required");

  const data = await gql<{
    app: {
      webhookSubscriptions: {
        edges: Array<{ node: WebhookSubscription }>;
      };
    };
  }>(GET_WEBHOOKS, { appId: toAppGid(appId) });

  const webhooks = data.app.webhookSubscriptions.edges.map((e) => e.node);

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({ total: webhooks.length, webhooks }, null, 2),
      },
    ],
  };
}

export async function handleUpdateApp(
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const appId = String(args.appId ?? "");
  if (!appId) throw new Error("appId is required");

  const appInput: Record<string, unknown> = {};
  if (args.contactEmail) appInput.contactEmail = args.contactEmail;
  if (args.draftUrl) appInput.draftUrl = args.draftUrl;

  if (Object.keys(appInput).length === 0) {
    throw new Error("Provide at least one field to update: contactEmail or draftUrl");
  }

  const data = await gql<{
    appUpdate: {
      app: { id: string; name: string; contactEmail: string | null; draftUrl: string | null };
      userErrors: Array<{ field: string[]; message: string }>;
    };
  }>(UPDATE_APP, { id: toAppGid(appId), appInput });

  if (data.appUpdate.userErrors.length > 0) {
    const errs = data.appUpdate.userErrors.map((e) => `${e.field.join(".")}: ${e.message}`).join("; ");
    throw new Error(`Update failed: ${errs}`);
  }

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({ success: true, app: data.appUpdate.app }, null, 2),
      },
    ],
  };
}

// ---------------------------------------------------------------
// Start server
// ---------------------------------------------------------------
const transport = new StdioServerTransport();
await server.connect(transport);
