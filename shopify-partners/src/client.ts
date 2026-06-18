/**
 * client.ts — Shopify Partners GraphQL API client
 *
 * Endpoint: https://partners.shopify.com/{PARTNER_ID}/api/{VERSION}/graphql.json
 * Auth:     X-Shopify-Access-Token header
 *
 * Required env vars:
 *   SHOPIFY_PARTNER_ID             e.g. 851712
 *   SHOPIFY_PARTNER_ACCESS_TOKEN   e.g. prtapi_xxxxx
 *   SHOPIFY_API_VERSION            (optional, default: 2024-10)
 */

import axios from "axios";
import { withRetry } from "./retry.js";

export interface GraphQLResponse<T> {
  data: T;
  errors?: Array<{ message: string; locations?: unknown[]; path?: unknown[] }>;
}

export interface PageInfo {
  hasNextPage: boolean;
  endCursor: string | null;
}

// ---------------------------------------------------------------
// App types
// ---------------------------------------------------------------
export interface ShopifyApp {
  id: string;
  name: string;
  appType: string;
  createTime: string;
  active: boolean;
  draftUrl: string | null;
  appStoreName: string | null;
  contactEmail: string | null;
}

export interface ShopPlan {
  displayName: string;
}

export interface Shop {
  name: string;
  myshopifyDomain: string;
  plan?: ShopPlan;
}

export interface AppSubscription {
  name: string;
  test: boolean;
  status: string;
}

export interface AppInstallation {
  id: string;
  installedAt: string;
  uninstalledAt: string | null;
  shop: Shop;
  activeSubscriptions: AppSubscription[];
}

export interface AppEvent {
  type: string;
  occurredAt: string;
  shop: Shop | null;
}

export interface PartnerInfo {
  id: string;
  name: string;
  email: string;
  website: string | null;
  createdAt: string;
}

export interface WebhookEndpoint {
  __typename: string;
  callbackUrl?: string;
  arn?: string;
  pubSubProject?: string;
  pubSubTopic?: string;
}

export interface WebhookSubscription {
  id: string;
  topic: string;
  format: string;
  endpoint: WebhookEndpoint | null;
}

// ---------------------------------------------------------------
// GraphQL client
// ---------------------------------------------------------------
function getCredentials(): { partnerId: string; token: string; version: string } {
  const partnerId = process.env.SHOPIFY_PARTNER_ID;
  const token = process.env.SHOPIFY_PARTNER_ACCESS_TOKEN;
  if (!partnerId) throw new Error("SHOPIFY_PARTNER_ID environment variable is not set.");
  if (!token) throw new Error("SHOPIFY_PARTNER_ACCESS_TOKEN environment variable is not set.");
  const version = process.env.SHOPIFY_API_VERSION ?? "2024-10";
  return { partnerId, token, version };
}

export async function gql<T>(
  query: string,
  variables: Record<string, unknown> = {}
): Promise<T> {
  const { partnerId, token, version } = getCredentials();
  const url = `https://partners.shopify.com/${partnerId}/api/${version}/graphql.json`;

  const response = await withRetry(() =>
    axios.post<GraphQLResponse<T>>(
      url,
      { query, variables },
      {
        headers: {
          "X-Shopify-Access-Token": token,
          "Content-Type": "application/json",
        },
      }
    )
  );

  const body = response.data;

  if (body.errors && body.errors.length > 0) {
    const messages = body.errors.map((e) => e.message).join("; ");
    throw new Error(`Shopify Partners API error: ${messages}`);
  }

  return body.data;
}

// ---------------------------------------------------------------
// Pagination helper — fetches all pages automatically
// ---------------------------------------------------------------
export async function gqlPaginated<TNode>(
  query: string,
  getConnection: (data: Record<string, unknown>) => {
    edges: Array<{ node: TNode }>;
    pageInfo: PageInfo;
  },
  variables: Record<string, unknown> = {},
  maxItems = 500
): Promise<TNode[]> {
  const items: TNode[] = [];
  let after: string | null = null;

  while (items.length < maxItems) {
    const data = await gql<Record<string, unknown>>(query, {
      ...variables,
      first: 50,
      after,
    });

    const connection = getConnection(data);
    for (const edge of connection.edges) {
      items.push(edge.node);
    }

    if (!connection.pageInfo.hasNextPage) break;
    after = connection.pageInfo.endCursor;
  }

  return items;
}

// ---------------------------------------------------------------
// Convenience: build a GID from a numeric Shopify app ID
// ---------------------------------------------------------------
export function toAppGid(id: string): string {
  // If it's already a full GID, pass through
  if (id.startsWith("gid://")) return id;
  return `gid://partners/App/${id}`;
}
