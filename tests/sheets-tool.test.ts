import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock googleapis ───────────────────────────────────────────
const mockUpdate = vi.fn();
const mockGet = vi.fn();
const mockBatchUpdate = vi.fn();

vi.mock("googleapis", () => ({
  google: {
    auth: {
      GoogleAuth: vi.fn(function MockGoogleAuth(this: unknown) {
        return { getClient: vi.fn() };
      }),
    },
    sheets: vi.fn(() => ({
      spreadsheets: {
        get: mockGet,
        values: { update: mockUpdate },
        batchUpdate: mockBatchUpdate,
      },
    })),
  },
}));

import { exportRegressionToSheets, exportDashboardToSheets } from "../src/sheets-tool";
import type { RegressionSheet } from "../src/regression-tool";
import type { AnalysisRecord } from "../src/db";

// ── Fixtures ──────────────────────────────────────────────────
const serviceAccountJson = JSON.stringify({
  type: "service_account",
  project_id: "test-project",
  private_key: "-----BEGIN RSA PRIVATE KEY-----\ntest\n-----END RSA PRIVATE KEY-----",
  client_email: "test@test-project.iam.gserviceaccount.com",
});

function makeRegressionSheet(): RegressionSheet {
  return {
    mr_key: "github#acme/backend#42",
    mr_title: "feat: add auth",
    jira_key: "DEMO-1",
    generated_at: "2026-04-01T10:00:00.000Z",
    total_tests: 2,
    critical_count: 1,
    high_count: 1,
    test_cases: [
      {
        test_id: "REG-001",
        area: "Authentication",
        test_description: "Verify unauthenticated requests are rejected",
        priority: "Critical",
        category: "Auth",
        steps: "Call /api/profile without token",
        expected_result: "HTTP 401 Unauthorized",
        status: "To Test",
        source: "BLOCKING",
      },
      {
        test_id: "REG-002",
        area: "Authentication",
        test_description: "Verify authenticated requests succeed",
        priority: "High",
        category: "Auth",
        steps: "Call /api/profile with valid JWT",
        expected_result: "HTTP 200 with user object",
        status: "To Test",
        source: "BLOCKING",
      },
    ],
    csv: "id,name\nREG-001,Auth 401\nREG-002,Auth 200",
  };
}

function makeAnalysisRecord(): AnalysisRecord {
  return {
    mr_key: "github#acme/backend#42",
    analyzed_at: "2026-04-01T10:00:00.000Z",
    platform: "github",
    repo: "acme/backend",
    mr_id: "42",
    mr_title: "feat: add auth",
    jira_key: "DEMO-1",
    jira_summary: "User authentication",
    review_summary: "All criteria covered.",
    ready_to_merge: true,
    analyst: "ravi.sharma",
    mr_snapshot: null,
    jira_snapshot: null,
  };
}

describe("exportRegressionToSheets", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON = serviceAccountJson;
    process.env.GOOGLE_SHEET_ID = "spreadsheet-id-123";

    // Sheet tab already exists
    mockGet.mockResolvedValue({
      data: { sheets: [{ properties: { title: "Regression-github_acme_backend_42" } }] },
    });
    mockUpdate.mockResolvedValue({
      data: { updatedRange: "Regression-github_acme_backend_42!A1:J3" },
    });
  });

  it("writes header + data rows to the correct sheet tab", async () => {
    const sheet = makeRegressionSheet();
    const result = await exportRegressionToSheets(sheet);

    expect(result.spreadsheetId).toBe("spreadsheet-id-123");
    expect(result.rowsWritten).toBe(2);
    expect(mockUpdate).toHaveBeenCalledOnce();

    const updateCall = mockUpdate.mock.calls[0][0];
    const values: string[][] = updateCall.requestBody.values;
    // First row is header
    expect(values[0]).toContain("Test ID");
    expect(values[0]).toContain("Priority");
    // Data rows
    expect(values[1][0]).toBe("REG-001");
    expect(values[2][0]).toBe("REG-002");
  });

  it("creates a new sheet tab if it does not exist", async () => {
    mockGet.mockResolvedValue({ data: { sheets: [] } });
    mockBatchUpdate.mockResolvedValue({});

    const sheet = makeRegressionSheet();
    await exportRegressionToSheets(sheet);

    expect(mockBatchUpdate).toHaveBeenCalledOnce();
    const batchCall = mockBatchUpdate.mock.calls[0][0];
    expect(batchCall.requestBody.requests[0].addSheet).toBeDefined();
  });

  it("uses provided spreadsheetId over env var", async () => {
    const sheet = makeRegressionSheet();
    await exportRegressionToSheets(sheet, "custom-sheet-id");

    const updateCall = mockUpdate.mock.calls[0][0];
    expect(updateCall.spreadsheetId).toBe("custom-sheet-id");
  });

  it("throws if GOOGLE_SERVICE_ACCOUNT_JSON is not set", async () => {
    delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON;

    await expect(exportRegressionToSheets(makeRegressionSheet())).rejects.toThrow(
      "GOOGLE_SERVICE_ACCOUNT_JSON"
    );
  });

  it("throws if GOOGLE_SHEET_ID is not set", async () => {
    delete process.env.GOOGLE_SHEET_ID;

    await expect(exportRegressionToSheets(makeRegressionSheet())).rejects.toThrow(
      "GOOGLE_SHEET_ID"
    );
  });
});

describe("exportDashboardToSheets", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON = serviceAccountJson;
    process.env.GOOGLE_SHEET_ID = "spreadsheet-id-123";

    mockGet.mockResolvedValue({
      data: { sheets: [{ properties: { title: "Team Dashboard" } }] },
    });
    mockUpdate.mockResolvedValue({
      data: { updatedRange: "Team Dashboard!A1:H3" },
    });
  });

  it("writes header + one row per analysis record", async () => {
    const records = [makeAnalysisRecord(), { ...makeAnalysisRecord(), mr_id: "43" }];
    const result = await exportDashboardToSheets(records);

    expect(result.rowsWritten).toBe(2);
    const values: string[][] = mockUpdate.mock.calls[0][0].requestBody.values;
    expect(values[0]).toContain("MR Key");
    expect(values[0]).toContain("Ready to Merge");
    expect(values[1][5]).toBe("YES"); // ready_to_merge = true
  });

  it("writes to Team Dashboard tab", async () => {
    await exportDashboardToSheets([makeAnalysisRecord()]);

    const updateCall = mockUpdate.mock.calls[0][0];
    expect(updateCall.range).toContain("Team Dashboard");
  });
});
