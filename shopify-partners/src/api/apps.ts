import { gql, toAppGid } from "./client.js";
import { GET_APP, GET_APP_EVENTS } from "./queries.js";
import type { ShopifyApp, AppEvent, GetAppEventsOptions, Edge, PageInfo } from "./types.js";

// ── Get App ──────────────────────────────────────────────────

interface GetAppData {
  app: ShopifyApp;
}

export async function getApp(appId: string): Promise<ShopifyApp> {
  const data = await gql<GetAppData>(GET_APP, { id: toAppGid(appId) });
  return data.app;
}

// ── Get App Events ────────────────────────────────────────────
// Pagination: cursor lives on each edge (not pageInfo.endCursor).
// Pass the cursor of the last edge as `after` to fetch the next page.

interface AppEventsPage {
  app: {
    events: {
      edges: Edge<AppEvent>[];
      pageInfo: PageInfo;
    };
  };
}

export async function getAppEvents(
  appId: string,
  options: GetAppEventsOptions = {}
): Promise<AppEvent[]> {
  const { types, from, to, limit = 250 } = options;
  const events: AppEvent[] = [];
  let after: string | null = null;

  while (events.length < limit) {
    const variables: Record<string, unknown> = {
      id: toAppGid(appId),
      after,
    };
    if (types && types.length > 0) variables.types = types;
    if (from) variables.occurredAtMin = from;
    if (to) variables.occurredAtMax = to;

    const data = await gql<AppEventsPage>(GET_APP_EVENTS, variables);
    const { edges, pageInfo } = data.app.events;

    for (const edge of edges) {
      events.push(edge.node);
    }

    if (!pageInfo.hasNextPage || edges.length === 0) break;
    // cursor-based: take the cursor from the LAST edge
    after = edges[edges.length - 1].cursor;
  }

  return events.slice(0, limit);
}
