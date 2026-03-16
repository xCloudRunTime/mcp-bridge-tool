import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock AWS SDK before importing db.ts ───────────────────────
const mockSend = vi.fn();

vi.mock("@aws-sdk/client-dynamodb", () => ({
  // Regular function (not arrow) so `new DynamoDBClient()` works
  DynamoDBClient: vi.fn(function MockDDBClient(this: unknown) {
    return { send: mockSend };
  }),
  CreateTableCommand: vi.fn(function MockCreateTable(this: unknown, input: unknown) {
    return { input };
  }),
  ResourceInUseException: class ResourceInUseException extends Error {
    constructor() {
      super("ResourceInUseException");
      this.name = "ResourceInUseException";
    }
  },
}));

vi.mock("@aws-sdk/lib-dynamodb", () => ({
  DynamoDBDocumentClient: {
    from: vi.fn(() => ({ send: mockSend })),
  },
  PutCommand: vi.fn(function MockPut(this: unknown, input: unknown) { return { input }; }),
  GetCommand: vi.fn(function MockGet(this: unknown, input: unknown) { return { input }; }),
  QueryCommand: vi.fn(function MockQuery(this: unknown, input: unknown) { return { input }; }),
  ScanCommand: vi.fn(function MockScan(this: unknown, input: unknown) { return { input }; }),
}));

import {
  buildMrKey,
  saveAnalysis,
  getLatestAnalysis,
  getMrHistory,
  listRecentAnalyses,
  searchAnalyses,
  ensureTableExists,
  type AnalysisRecord,
} from "../src/db";

// ── Fixtures ──────────────────────────────────────────────────
function makeRecord(overrides: Partial<AnalysisRecord> = {}): AnalysisRecord {
  return {
    mr_key: "github#acme/backend-api#42",
    analyzed_at: "2026-03-10T10:00:00.000Z",
    platform: "github",
    repo: "acme/backend-api",
    mr_id: "42",
    mr_title: "feat: add authentication",
    jira_key: "PROJ-123",
    jira_summary: "Add JWT authentication",
    review_summary: "All acceptance criteria covered. Ready to merge.",
    ready_to_merge: true,
    analyst: "ravi.sharma",
    mr_snapshot: {} as never,
    jira_snapshot: null,
    ...overrides,
  };
}

// ── Unit Tests ────────────────────────────────────────────────
describe("buildMrKey", () => {
  it("creates composite key in platform#repo#id format", () => {
    expect(buildMrKey("github", "acme/api", "42")).toBe("github#acme/api#42");
    expect(buildMrKey("gitlab", "org/payments", "7")).toBe("gitlab#org/payments#7");
  });

  it("preserves repo slashes", () => {
    const key = buildMrKey("github", "my-org/my-repo", "100");
    expect(key).toBe("github#my-org/my-repo#100");
  });
});

describe("saveAnalysis", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.AWS_REGION = "ap-south-1";
    delete process.env.DDB_ENDPOINT;
  });

  it("calls PutCommand with the record", async () => {
    mockSend.mockResolvedValueOnce({});

    await saveAnalysis(makeRecord());

    expect(mockSend).toHaveBeenCalledTimes(1);
    const call = mockSend.mock.calls[0][0];
    expect(call.input.Item.mr_key).toBe("github#acme/backend-api#42");
    expect(call.input.Item.ready_to_merge).toBe(true);
  });

  it("throws when DDB send fails", async () => {
    mockSend.mockRejectedValueOnce(new Error("ProvisionedThroughputExceeded"));

    await expect(saveAnalysis(makeRecord())).rejects.toThrow("ProvisionedThroughputExceeded");
  });
});

describe("getLatestAnalysis", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.AWS_REGION = "ap-south-1";
  });

  it("returns the latest record when found", async () => {
    const record = makeRecord();
    mockSend.mockResolvedValueOnce({ Items: [record] });

    const result = await getLatestAnalysis("github", "acme/backend-api", "42");

    expect(result).toEqual(record);
    // Should query with ScanIndexForward: false (latest first)
    const call = mockSend.mock.calls[0][0];
    expect(call.input.ScanIndexForward).toBe(false);
    expect(call.input.Limit).toBe(1);
  });

  it("returns null when no record found", async () => {
    mockSend.mockResolvedValueOnce({ Items: [] });

    const result = await getLatestAnalysis("github", "acme/backend-api", "999");

    expect(result).toBeNull();
  });

  it("queries by correct mr_key", async () => {
    mockSend.mockResolvedValueOnce({ Items: [] });

    await getLatestAnalysis("gitlab", "org/payments", "7");

    const call = mockSend.mock.calls[0][0];
    expect(call.input.ExpressionAttributeValues[":pk"]).toBe("gitlab#org/payments#7");
  });
});

describe("getMrHistory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.AWS_REGION = "ap-south-1";
  });

  it("returns multiple records in descending order", async () => {
    const records = [
      makeRecord({ analyzed_at: "2026-03-10T10:00:00Z" }),
      makeRecord({ analyzed_at: "2026-03-08T10:00:00Z" }),
      makeRecord({ analyzed_at: "2026-03-05T10:00:00Z" }),
    ];
    mockSend.mockResolvedValueOnce({ Items: records });

    const result = await getMrHistory("github", "acme/backend-api", "42");

    expect(result).toHaveLength(3);
    expect(result[0].analyzed_at).toBe("2026-03-10T10:00:00Z");
  });

  it("uses default limit of 10", async () => {
    mockSend.mockResolvedValueOnce({ Items: [] });

    await getMrHistory("github", "acme/api", "42");

    const call = mockSend.mock.calls[0][0];
    expect(call.input.Limit).toBe(10);
  });

  it("accepts custom limit", async () => {
    mockSend.mockResolvedValueOnce({ Items: [] });

    await getMrHistory("github", "acme/api", "42", 5);

    const call = mockSend.mock.calls[0][0];
    expect(call.input.Limit).toBe(5);
  });
});

describe("listRecentAnalyses", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.AWS_REGION = "ap-south-1";
  });

  it("uses GSI when analyst filter provided", async () => {
    mockSend.mockResolvedValueOnce({ Items: [makeRecord()] });

    await listRecentAnalyses({ analyst: "ravi.sharma" });

    const call = mockSend.mock.calls[0][0];
    expect(call.input.IndexName).toBe("analyst-index");
    expect(call.input.ExpressionAttributeValues[":analyst"]).toBe("ravi.sharma");
  });

  it("falls back to Scan when no analyst filter", async () => {
    mockSend.mockResolvedValueOnce({ Items: [makeRecord()] });

    await listRecentAnalyses({ limit: 10 });

    // ScanCommand has no IndexName
    const call = mockSend.mock.calls[0][0];
    expect(call.input.IndexName).toBeUndefined();
  });

  it("returns empty array when no records", async () => {
    mockSend.mockResolvedValueOnce({ Items: [] });

    const result = await listRecentAnalyses();

    expect(result).toEqual([]);
  });
});

describe("searchAnalyses", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.AWS_REGION = "ap-south-1";
  });

  it("filters by date range", async () => {
    mockSend.mockResolvedValueOnce({ Items: [makeRecord()] });

    await searchAnalyses({ from: "2026-03-01", to: "2026-03-31" });

    const call = mockSend.mock.calls[0][0];
    const filter = call.input.FilterExpression ?? "";
    expect(filter).toContain("analyzed_at >=");
    expect(filter).toContain("analyzed_at <=");
  });

  it("appends end-of-day to date-only `to` value", async () => {
    mockSend.mockResolvedValueOnce({ Items: [] });

    await searchAnalyses({ to: "2026-03-31" });

    const call = mockSend.mock.calls[0][0];
    const vals = call.input.ExpressionAttributeValues ?? {};
    expect(vals[":to"]).toBe("2026-03-31T23:59:59.999Z");
  });

  it("filters by ready_to_merge boolean", async () => {
    mockSend.mockResolvedValueOnce({ Items: [makeRecord()] });

    await searchAnalyses({ ready_to_merge: false });

    const call = mockSend.mock.calls[0][0];
    expect(call.input.FilterExpression).toContain("ready_to_merge");
    expect(call.input.ExpressionAttributeValues[":rtm"]).toBe(false);
  });

  it("uses GSI when analyst is provided", async () => {
    mockSend.mockResolvedValueOnce({ Items: [makeRecord()] });

    await searchAnalyses({ analyst: "ravi.sharma", from: "2026-03-01" });

    const call = mockSend.mock.calls[0][0];
    expect(call.input.IndexName).toBe("analyst-index");
  });

  it("returns empty array on no match", async () => {
    mockSend.mockResolvedValueOnce({ Items: [] });

    const result = await searchAnalyses({ from: "2099-01-01" });

    expect(result).toEqual([]);
  });
});

describe("ensureTableExists", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.AWS_REGION = "ap-south-1";
  });

  it("succeeds when table is created", async () => {
    mockSend.mockResolvedValueOnce({});

    await expect(ensureTableExists()).resolves.not.toThrow();
  });

  it("silently ignores ResourceInUseException (table already exists)", async () => {
    const { ResourceInUseException } = await import("@aws-sdk/client-dynamodb");
    mockSend.mockRejectedValueOnce(new ResourceInUseException());

    await expect(ensureTableExists()).resolves.not.toThrow();
  });

  it("rethrows unexpected errors", async () => {
    mockSend.mockRejectedValueOnce(new Error("AccessDeniedException"));

    await expect(ensureTableExists()).rejects.toThrow("AccessDeniedException");
  });
});
