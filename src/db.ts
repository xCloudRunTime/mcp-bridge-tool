/**
 * db.ts — DynamoDB Integration
 *
 * Table Name  : mcp-mr-analysis
 * Partition Key (PK) : mr_key   → "<platform>#<repo>#<mr_id>"   e.g. "github#acme/api#42"
 * Sort Key (SK)      : analyzed_at → ISO-8601 timestamp
 *
 * Why this design?
 *  - PK se ek specific MR ke saare analyses milte hain (ek MR ko baar baar review kiya ho sakta hai).
 *  - SK se latest ya specific date ka analysis filter kar sakte hain.
 *  - GSI "analyst-index" se kisi ek user ke saare reviews dekhe ja sakte hain.
 *
 * Required .env variables:
 *   AWS_REGION          e.g. ap-south-1
 *   AWS_ACCESS_KEY_ID   IAM user ki access key
 *   AWS_SECRET_ACCESS_KEY
 *   DDB_TABLE_NAME      (optional, default: mcp-mr-analysis)
 */

import {
  DynamoDBClient,
  CreateTableCommand,
  ResourceInUseException,
} from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  QueryCommand,
  ScanCommand,
} from "@aws-sdk/lib-dynamodb";
import type { MergeRequestDetails } from "./git-tool.js";
import type { JiraTicketDetails } from "./jira-tool.js";

// ---------------------------------------------------------------
// Types
// ---------------------------------------------------------------
export interface AnalysisRecord {
  mr_key: string;          // PK  — "github#owner/repo#42"
  analyzed_at: string;     // SK  — ISO timestamp
  platform: string;
  repo: string;
  mr_id: string;
  mr_title: string;
  jira_key: string | null;
  jira_summary: string | null;
  review_summary: string;     // AI ka final review text
  ready_to_merge: boolean;
  analyst: string;            // Kaun tha jisne analyze kiya (env se / default "AI")
  mr_snapshot: MergeRequestDetails;
  jira_snapshot: JiraTicketDetails | null;
  ttl?: number;              // Optional: epoch seconds — DDB auto-delete ke liye
}

export interface ListAnalysesOptions {
  limit?: number;            // kitne records chahiye (default 20)
  analyst?: string;          // filter by analyst name
  repo?: string;             // filter by repo
}

// ---------------------------------------------------------------
// Projection — list/search queries mein heavy snapshot fields skip karo
// mr_snapshot and jira_snapshot combined can be 60KB+ per record
// ---------------------------------------------------------------
const SUMMARY_FIELDS = [
  "mr_key", "analyzed_at", "analyst",
  "#repo", "platform", "mr_id", "mr_title",
  "jira_key", "jira_summary", "ready_to_merge", "review_summary",
];

const SUMMARY_PROJECTION = {
  ProjectionExpression: SUMMARY_FIELDS.join(", "),
  ExpressionAttributeNames: { "#repo": "repo" } as Record<string, string>,
};

// ---------------------------------------------------------------
// DynamoDB Client (singleton)
// ---------------------------------------------------------------
function buildClient(): DynamoDBDocumentClient {
  const region = process.env.AWS_REGION;
  if (!region) throw new Error("AWS_REGION .env mein set nahi hai.");

  const raw = new DynamoDBClient({
    region,
    // Agar local DynamoDB (for testing) use karna ho:
    ...(process.env.DDB_ENDPOINT
      ? { endpoint: process.env.DDB_ENDPOINT }
      : {}),
  });

  return DynamoDBDocumentClient.from(raw, {
    marshallOptions: {
      removeUndefinedValues: true,   // undefined fields ignore karo
    },
  });
}

// Lazy singleton — pehli request par hi client banta hai
let _client: DynamoDBDocumentClient | null = null;
function getClient(): DynamoDBDocumentClient {
  if (!_client) _client = buildClient();
  return _client;
}

const TABLE = () => process.env.DDB_TABLE_NAME ?? "mcp-mr-analysis";

// ---------------------------------------------------------------
// Auto-create table (agar pehli baar chal raha ho)
// ---------------------------------------------------------------
export async function ensureTableExists(): Promise<void> {
  const raw = new DynamoDBClient({
    region: process.env.AWS_REGION ?? "ap-south-1",
    ...(process.env.DDB_ENDPOINT ? { endpoint: process.env.DDB_ENDPOINT } : {}),
  });

  try {
    await raw.send(
      new CreateTableCommand({
        TableName: TABLE(),
        BillingMode: "PAY_PER_REQUEST",   // On-demand — no capacity planning
        AttributeDefinitions: [
          { AttributeName: "mr_key", AttributeType: "S" },
          { AttributeName: "analyzed_at", AttributeType: "S" },
          { AttributeName: "analyst", AttributeType: "S" },
        ],
        KeySchema: [
          { AttributeName: "mr_key", KeyType: "HASH" },
          { AttributeName: "analyzed_at", KeyType: "RANGE" },
        ],
        GlobalSecondaryIndexes: [
          {
            // "Kaun tha analyst?" wale queries ke liye
            IndexName: "analyst-index",
            KeySchema: [
              { AttributeName: "analyst", KeyType: "HASH" },
              { AttributeName: "analyzed_at", KeyType: "RANGE" },
            ],
            Projection: { ProjectionType: "ALL" },
          },
        ],
        // TTL attribute (agar purane records auto-delete karne hon)
        // TimeToLiveSpecification: { AttributeName: "ttl", Enabled: true },
      })
    );
    console.error(`DynamoDB table "${TABLE()}" banaya gaya ✓`);
  } catch (err) {
    if (err instanceof ResourceInUseException) {
      // Table pehle se hai — theek hai
      console.error(`DynamoDB table "${TABLE()}" pehle se exist karta hai ✓`);
    } else {
      throw err;
    }
  }
}

// ---------------------------------------------------------------
// WRITE: Analysis save karo
// ---------------------------------------------------------------
export async function saveAnalysis(record: AnalysisRecord): Promise<void> {
  await getClient().send(
    new PutCommand({
      TableName: TABLE(),
      Item: record,
    })
  );
}

// ---------------------------------------------------------------
// READ: Ek specific MR ka latest analysis laao
// ---------------------------------------------------------------
export async function getLatestAnalysis(
  platform: string,
  repo: string,
  mrId: string
): Promise<AnalysisRecord | null> {
  const mrKey = buildMrKey(platform, repo, mrId);

  const result = await getClient().send(
    new QueryCommand({
      TableName: TABLE(),
      KeyConditionExpression: "mr_key = :pk",
      ExpressionAttributeValues: { ":pk": mrKey },
      ScanIndexForward: false,   // latest first (descending SK)
      Limit: 1,
    })
  );

  if (!result.Items || result.Items.length === 0) return null;
  return result.Items[0] as AnalysisRecord;
}

// ---------------------------------------------------------------
// READ: Ek MR ke saare historical analyses laao
// ---------------------------------------------------------------
export async function getMrHistory(
  platform: string,
  repo: string,
  mrId: string,
  limit = 10
): Promise<AnalysisRecord[]> {
  const mrKey = buildMrKey(platform, repo, mrId);

  const result = await getClient().send(
    new QueryCommand({
      TableName: TABLE(),
      KeyConditionExpression: "mr_key = :pk",
      ExpressionAttributeValues: { ":pk": mrKey },
      ScanIndexForward: false,
      Limit: limit,
    })
  );

  return (result.Items ?? []) as AnalysisRecord[];
}

// ---------------------------------------------------------------
// READ: Team ke recent analyses (sabka data ek jagah)
// ---------------------------------------------------------------
export async function listRecentAnalyses(
  options: ListAnalysesOptions = {}
): Promise<AnalysisRecord[]> {
  const { limit = 20, analyst, repo } = options;

  // Analyst filter: GSI use karo
  if (analyst) {
    const result = await getClient().send(
      new QueryCommand({
        TableName: TABLE(),
        IndexName: "analyst-index",
        KeyConditionExpression: "analyst = :analyst",
        ExpressionAttributeValues: { ":analyst": analyst },
        ScanIndexForward: false,
        Limit: limit,
      })
    );
    let items = (result.Items ?? []) as AnalysisRecord[];
    if (repo) items = items.filter((r) => r.repo === repo);
    return items;
  }

  // No analyst filter: full scan with projection (mr_snapshot/jira_snapshot skip karo)
  const result = await getClient().send(
    new ScanCommand({
      TableName: TABLE(),
      Limit: limit * 3,   // Scan zyada laata hai, hum baad mein sort karke cut karenge
      ...SUMMARY_PROJECTION,
    })
  );

  let items = (result.Items ?? []) as AnalysisRecord[];

  // Optional repo filter
  if (repo) items = items.filter((r) => r.repo === repo);

  // Sort by analyzed_at descending
  items.sort((a, b) => b.analyzed_at.localeCompare(a.analyzed_at));

  return items.slice(0, limit);
}

// ---------------------------------------------------------------
// SEARCH: Date range + status filter
// ---------------------------------------------------------------
export interface SearchAnalysesOptions {
  from?: string;            // ISO-8601 start date e.g. "2026-01-01"
  to?: string;              // ISO-8601 end date   e.g. "2026-03-31"
  ready_to_merge?: boolean; // filter by verdict
  repo?: string;            // filter by repo name
  analyst?: string;         // filter by reviewer
  limit?: number;
}

export async function searchAnalyses(
  options: SearchAnalysesOptions = {}
): Promise<AnalysisRecord[]> {
  const { from, to, ready_to_merge, repo, analyst, limit = 50 } = options;

  // Build filter expression parts
  const filterParts: string[] = [];
  const exprValues: Record<string, unknown> = {};
  const exprNames: Record<string, string> = {};

  if (from) {
    filterParts.push("analyzed_at >= :from");
    exprValues[":from"] = from;
  }
  if (to) {
    // Append end-of-day so the date is inclusive
    filterParts.push("analyzed_at <= :to");
    exprValues[":to"] = to.length === 10 ? `${to}T23:59:59.999Z` : to;
  }
  if (typeof ready_to_merge === "boolean") {
    filterParts.push("ready_to_merge = :rtm");
    exprValues[":rtm"] = ready_to_merge;
  }
  if (repo) {
    filterParts.push("#repo = :repo");
    exprValues[":repo"] = repo;
    exprNames["#repo"] = "repo";  // "repo" is not a reserved word but aliased for safety
  }

  // If analyst provided, use GSI for efficient lookup
  if (analyst) {
    const keyCondition =
      from && to
        ? "analyst = :analyst AND analyzed_at BETWEEN :from AND :to"
        : from
        ? "analyst = :analyst AND analyzed_at >= :from"
        : "analyst = :analyst";

    const gsiValues: Record<string, unknown> = { ":analyst": analyst };
    if (from) gsiValues[":from"] = from;
    if (to) gsiValues[":to"] = to.length === 10 ? `${to}T23:59:59.999Z` : to;

    // Remaining filters (repo, ready_to_merge) go into FilterExpression
    const remainingFilters = filterParts.filter(
      (p) => !p.startsWith("analyzed_at")
    );

    const result = await getClient().send(
      new QueryCommand({
        TableName: TABLE(),
        IndexName: "analyst-index",
        KeyConditionExpression: keyCondition,
        ExpressionAttributeValues: {
          ...gsiValues,
          // Add remaining filter values
          ...(ready_to_merge !== undefined ? { ":rtm": ready_to_merge } : {}),
          ...(repo ? { ":repo": repo } : {}),
        },
        ...(remainingFilters.length > 0
          ? { FilterExpression: remainingFilters.join(" AND ") }
          : {}),
        ...(Object.keys(exprNames).length > 0
          ? { ExpressionAttributeNames: exprNames }
          : {}),
        ScanIndexForward: false,
        Limit: limit,
      })
    );

    return (result.Items ?? []) as AnalysisRecord[];
  }

  // No analyst — full table scan with filters (mr_snapshot/jira_snapshot skip)
  const mergedNames = { ...SUMMARY_PROJECTION.ExpressionAttributeNames, ...exprNames };
  const result = await getClient().send(
    new ScanCommand({
      TableName: TABLE(),
      ...(filterParts.length > 0
        ? { FilterExpression: filterParts.join(" AND ") }
        : {}),
      ...(Object.keys(exprValues).length > 0
        ? { ExpressionAttributeValues: exprValues }
        : {}),
      ...(Object.keys(mergedNames).length > 0
        ? { ExpressionAttributeNames: mergedNames }
        : {}),
      ProjectionExpression: SUMMARY_PROJECTION.ProjectionExpression,
    })
  );

  let items = (result.Items ?? []) as AnalysisRecord[];
  items.sort((a, b) => b.analyzed_at.localeCompare(a.analyzed_at));
  return items.slice(0, limit);
}

// ---------------------------------------------------------------
// Helper
// ---------------------------------------------------------------
export function buildMrKey(
  platform: string,
  repo: string,
  mrId: string
): string {
  return `${platform}#${repo}#${mrId}`;
}
