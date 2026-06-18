import { getApp, getAppEvents } from "../api/apps.js";
import type { AppEventType } from "../api/types.js";

type ToolResult = { content: Array<{ type: string; text: string }> };

export async function handleGetApp(args: Record<string, unknown>): Promise<ToolResult> {
  const appId = String(args.appId ?? "");
  if (!appId) throw new Error("appId is required");

  const app = await getApp(appId);
  return {
    content: [{ type: "text", text: JSON.stringify(app, null, 2) }],
  };
}

export async function handleGetAppEvents(
  args: Record<string, unknown>
): Promise<ToolResult> {
  const appId = String(args.appId ?? "");
  if (!appId) throw new Error("appId is required");

  const types = Array.isArray(args.types)
    ? (args.types as AppEventType[])
    : undefined;
  const from = typeof args.from === "string" ? args.from : undefined;
  const to = typeof args.to === "string" ? args.to : undefined;
  const limit = typeof args.limit === "number" ? args.limit : 50;

  const events = await getAppEvents(appId, { types, from, to, limit });

  // Build summary counts per event type
  const summary: Record<string, number> = {};
  for (const e of events) {
    summary[e.type] = (summary[e.type] ?? 0) + 1;
  }

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({ total: events.length, summary, events }, null, 2),
      },
    ],
  };
}
