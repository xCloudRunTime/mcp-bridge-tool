import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock googleapis ───────────────────────────────────────────
const mockFilesCreate = vi.fn();

vi.mock("googleapis", () => ({
  google: {
    auth: {
      GoogleAuth: vi.fn(function MockGoogleAuth(this: unknown) {
        return { getClient: vi.fn() };
      }),
    },
    drive: vi.fn(() => ({
      files: { create: mockFilesCreate },
    })),
  },
}));

import { saveReportToDrive } from "../src/drive-tool";
import type { AnalysisRecord } from "../src/db";

// ── Fixtures ──────────────────────────────────────────────────
const serviceAccountJson = JSON.stringify({
  type: "service_account",
  project_id: "test-project",
  private_key: "-----BEGIN RSA PRIVATE KEY-----\ntest\n-----END RSA PRIVATE KEY-----",
  client_email: "test@test-project.iam.gserviceaccount.com",
});

function makeRecord(overrides: Partial<AnalysisRecord> = {}): AnalysisRecord {
  return {
    mr_key: "github#acme/backend#42",
    analyzed_at: "2026-04-01T10:00:00.000Z",
    platform: "github",
    repo: "acme/backend",
    mr_id: "42",
    mr_title: "feat: add authentication",
    jira_key: "DEMO-1",
    jira_summary: "User auth feature",
    review_summary: "All acceptance criteria covered. Code quality is good.",
    ready_to_merge: true,
    analyst: "ravi.sharma",
    mr_snapshot: null,
    jira_snapshot: null,
    ...overrides,
  };
}

describe("saveReportToDrive", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON = serviceAccountJson;
    process.env.GOOGLE_DRIVE_FOLDER_ID = "folder-id-abc123";

    mockFilesCreate.mockResolvedValue({
      data: {
        id: "file-id-xyz",
        name: "review-github_acme_backend_42-2026-04-01.md",
        webViewLink: "https://drive.google.com/file/d/file-id-xyz/view",
      },
    });
  });

  it("uploads a file and returns fileId + webViewLink", async () => {
    const result = await saveReportToDrive(makeRecord());

    expect(result.fileId).toBe("file-id-xyz");
    expect(result.webViewLink).toBe("https://drive.google.com/file/d/file-id-xyz/view");
    expect(result.folderId).toBe("folder-id-abc123");
  });

  it("uploads to the correct folder ID", async () => {
    await saveReportToDrive(makeRecord());

    const createCall = mockFilesCreate.mock.calls[0][0];
    expect(createCall.requestBody.parents).toContain("folder-id-abc123");
  });

  it("uses provided folderId over env var", async () => {
    await saveReportToDrive(makeRecord(), "custom-folder-id");

    const createCall = mockFilesCreate.mock.calls[0][0];
    expect(createCall.requestBody.parents).toContain("custom-folder-id");
  });

  it("sets mimeType to text/markdown", async () => {
    await saveReportToDrive(makeRecord());

    const createCall = mockFilesCreate.mock.calls[0][0];
    expect(createCall.requestBody.mimeType).toBe("text/markdown");
    expect(createCall.media.mimeType).toBe("text/markdown");
  });

  it("generates a file name from mr_key and date", async () => {
    await saveReportToDrive(makeRecord());

    const createCall = mockFilesCreate.mock.calls[0][0];
    const fileName: string = createCall.requestBody.name;
    expect(fileName).toMatch(/^review-/);
    expect(fileName).toContain("2026-04-01");
    expect(fileName).toMatch(/\.md$/);
  });

  it("includes MR title in the report body", async () => {
    await saveReportToDrive(makeRecord());

    const createCall = mockFilesCreate.mock.calls[0][0];
    // Collect stream content
    const chunks: Buffer[] = [];
    for await (const chunk of createCall.media.body) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const content = Buffer.concat(chunks).toString();
    expect(content).toContain("feat: add authentication");
    expect(content).toContain("READY TO MERGE");
  });

  it("includes NEEDS CHANGES verdict when ready_to_merge is false", async () => {
    await saveReportToDrive(makeRecord({ ready_to_merge: false }));

    const createCall = mockFilesCreate.mock.calls[0][0];
    const chunks: Buffer[] = [];
    for await (const chunk of createCall.media.body) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const content = Buffer.concat(chunks).toString();
    expect(content).toContain("NEEDS CHANGES");
  });

  it("throws if GOOGLE_SERVICE_ACCOUNT_JSON is not set", async () => {
    delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON;

    await expect(saveReportToDrive(makeRecord())).rejects.toThrow(
      "GOOGLE_SERVICE_ACCOUNT_JSON"
    );
  });

  it("throws if GOOGLE_DRIVE_FOLDER_ID is not set", async () => {
    delete process.env.GOOGLE_DRIVE_FOLDER_ID;

    await expect(saveReportToDrive(makeRecord())).rejects.toThrow(
      "GOOGLE_DRIVE_FOLDER_ID"
    );
  });
});
