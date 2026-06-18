/**
 * GraphQL HTTP executor for the Shopify Partners API.
 * No MCP or tool-layer concepts here — pure API client.
 *
 * Endpoint: https://partners.shopify.com/{PARTNER_ID}/api/{VERSION}/graphql.json
 * Auth:     X-Shopify-Access-Token header
 *
 * Required env vars:
 *   SHOPIFY_PARTNER_ID             e.g. 851712
 *   SHOPIFY_PARTNER_ACCESS_TOKEN   prtapi_xxxxx
 *   SHOPIFY_API_VERSION            (optional, default: 2026-01)
 */

import axios from "axios";
import { withRetry } from "../retry.js";

export interface GraphQLResponse<T> {
  data?: T;
  errors?: Array<{ message: string; extensions?: Record<string, unknown> }>;
}

export function getCredentials(): { partnerId: string; token: string; version: string } {
  const partnerId = process.env.SHOPIFY_PARTNER_ID;
  const token = process.env.SHOPIFY_PARTNER_ACCESS_TOKEN;
  if (!partnerId) throw new Error("SHOPIFY_PARTNER_ID environment variable is not set.");
  if (!token) throw new Error("SHOPIFY_PARTNER_ACCESS_TOKEN environment variable is not set.");
  return {
    partnerId,
    token,
    version: process.env.SHOPIFY_API_VERSION ?? "2026-01",
  };
}

export function buildEndpoint(partnerId: string, version: string): string {
  return `https://partners.shopify.com/${partnerId}/api/${version}/graphql.json`;
}

export async function gql<T>(
  query: string,
  variables: Record<string, unknown> = {}
): Promise<T> {
  const { partnerId, token, version } = getCredentials();
  const url = buildEndpoint(partnerId, version);

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
    const msg = body.errors.map((e) => e.message).join("; ");
    throw new Error(`Shopify Partners API error: ${msg}`);
  }

  if (!body.data) {
    throw new Error("Shopify Partners API returned empty data.");
  }

  return body.data;
}

// Convert a numeric app ID to a Shopify GID.
// Passes full GIDs through unchanged.
export function toAppGid(id: string): string {
  return id.startsWith("gid://") ? id : `gid://partners/App/${id}`;
}

export function toTransactionGid(id: string): string {
  return id.startsWith("gid://") ? id : `gid://partners/Transaction/${id}`;
}
