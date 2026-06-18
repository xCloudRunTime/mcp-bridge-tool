import "dotenv/config";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { handleCheckAuth } from "./tools/auth.js";
import { handleGetApp, handleGetAppEvents } from "./tools/apps.js";
import { handleListTransactions, handleGetTransaction } from "./tools/transactions.js";

// ---------------------------------------------------------------
// Server setup
// ---------------------------------------------------------------
const server = new Server(
  { name: "shopify-partners-mcp", version: "2.0.0" },
  { capabilities: { tools: {} } }
);

// ---------------------------------------------------------------
// Tool registry
// ---------------------------------------------------------------
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "shopify_check_auth",
      description:
        "Verify that your Shopify Partner API credentials are working. Returns the list of supported API versions.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "shopify_get_app",
      description:
        "Get details for a Shopify app by its numeric ID or full GID. Returns id, name, and apiKey (Client ID).",
      inputSchema: {
        type: "object",
        properties: {
          appId: {
            type: "string",
            description: "Numeric app ID (e.g. 12345) or full GID (gid://partners/App/12345)",
          },
        },
        required: ["appId"],
      },
    },
    {
      name: "shopify_get_app_events",
      description:
        "Get events for an app: installs, uninstalls, reactivations, deactivations. Supports type and date range filters.",
      inputSchema: {
        type: "object",
        properties: {
          appId: {
            type: "string",
            description: "Numeric app ID or full GID",
          },
          types: {
            type: "array",
            items: { type: "string" },
            description:
              "Filter by event types: RELATIONSHIP_INSTALLED, RELATIONSHIP_UNINSTALLED, RELATIONSHIP_REACTIVATED, RELATIONSHIP_DEACTIVATED",
          },
          from: {
            type: "string",
            description: "Start date ISO-8601 (e.g. 2025-01-01T00:00:00Z)",
          },
          to: {
            type: "string",
            description: "End date ISO-8601 (e.g. 2025-12-31T23:59:59Z)",
          },
          limit: {
            type: "number",
            description: "Max events to return (default 50)",
          },
        },
        required: ["appId"],
      },
    },
    {
      name: "shopify_list_transactions",
      description:
        "List recent financial transactions (subscription sales, one-time sales, usage sales, adjustments, credits). Requires 'View financials' permission on the Partner API client.",
      inputSchema: {
        type: "object",
        properties: {
          first: {
            type: "number",
            description: "Number of transactions to return (default 20, max 50)",
          },
          types: {
            type: "array",
            items: { type: "string" },
            description:
              "Filter by type: APP_SUBSCRIPTION_SALE, APP_ONE_TIME_SALE, APP_USAGE_SALE, APP_SALE_ADJUSTMENT, APP_SALE_CREDIT",
          },
        },
      },
    },
    {
      name: "shopify_get_transaction",
      description:
        "Get a single transaction by its numeric ID or full GID.",
      inputSchema: {
        type: "object",
        properties: {
          id: {
            type: "string",
            description: "Numeric transaction ID or full GID (gid://partners/Transaction/xxx)",
          },
        },
        required: ["id"],
      },
    },
  ],
}));

// ---------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;

  try {
    switch (name) {
      case "shopify_check_auth":        return await handleCheckAuth();
      case "shopify_get_app":           return await handleGetApp(args);
      case "shopify_get_app_events":    return await handleGetAppEvents(args);
      case "shopify_list_transactions": return await handleListTransactions(args);
      case "shopify_get_transaction":   return await handleGetTransaction(args);
      default:
        return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
  }
});

// ---------------------------------------------------------------
// Start
// ---------------------------------------------------------------
const transport = new StdioServerTransport();
await server.connect(transport);
