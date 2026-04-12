import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock axios ────────────────────────────────────────────────
const { mockPost } = vi.hoisted(() => ({ mockPost: vi.fn() }));

vi.mock("axios", () => ({
  default: { post: mockPost },
}));

import { postReviewToSlack } from "../src/slack-tool";

// ── Fixtures ──────────────────────────────────────────────────
const basePayload = {
  mr_title: "feat: add user authentication",
  mr_url: "https://github.com/acme/backend/pull/42",
  repo: "acme/backend",
  mr_id: "42",
  analyst: "ravi.sharma",
  ready_to_merge: true,
  review_summary: "All acceptance criteria covered. Code is clean.",
  platform: "github" as const,
};

describe("postReviewToSlack", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SLACK_WEBHOOK_URL = "https://hooks.slack.com/services/TEST/HOOK/url";
  });

  it("posts a Block Kit message to the webhook URL", async () => {
    mockPost.mockResolvedValue({ status: 200, data: "ok" });

    const result = await postReviewToSlack(basePayload);

    expect(result.ok).toBe(true);
    expect(mockPost).toHaveBeenCalledOnce();

    const [url, body] = mockPost.mock.calls[0];
    expect(url).toBe("https://hooks.slack.com/services/TEST/HOOK/url");
    expect(body).toHaveProperty("blocks");
    expect(Array.isArray(body.blocks)).toBe(true);
  });

  it("includes MR title in the header block", async () => {
    mockPost.mockResolvedValue({ status: 200, data: "ok" });

    await postReviewToSlack(basePayload);

    const body = mockPost.mock.calls[0][1];
    const headerBlock = body.blocks.find((b: { type: string }) => b.type === "header");
    expect(headerBlock).toBeDefined();
    expect(JSON.stringify(headerBlock)).toContain("feat: add user authentication");
  });

  it("includes READY TO MERGE verdict for approved MRs", async () => {
    mockPost.mockResolvedValue({ status: 200, data: "ok" });

    await postReviewToSlack({ ...basePayload, ready_to_merge: true });

    const body = mockPost.mock.calls[0][1];
    const blocksStr = JSON.stringify(body.blocks);
    expect(blocksStr).toContain("READY TO MERGE");
  });

  it("includes NEEDS CHANGES verdict for rejected MRs", async () => {
    mockPost.mockResolvedValue({ status: 200, data: "ok" });

    await postReviewToSlack({ ...basePayload, ready_to_merge: false });

    const body = mockPost.mock.calls[0][1];
    const blocksStr = JSON.stringify(body.blocks);
    expect(blocksStr).toContain("NEEDS CHANGES");
  });

  it("includes Jira key when provided", async () => {
    mockPost.mockResolvedValue({ status: 200, data: "ok" });

    await postReviewToSlack({
      ...basePayload,
      jira_key: "DEMO-123",
      jira_url: "https://acme.atlassian.net/browse/DEMO-123",
    });

    const body = mockPost.mock.calls[0][1];
    const blocksStr = JSON.stringify(body.blocks);
    expect(blocksStr).toContain("DEMO-123");
  });

  it("truncates review_summary longer than 300 chars", async () => {
    mockPost.mockResolvedValue({ status: 200, data: "ok" });

    const longSummary = "A".repeat(400);
    await postReviewToSlack({ ...basePayload, review_summary: longSummary });

    const body = mockPost.mock.calls[0][1];
    const blocksStr = JSON.stringify(body.blocks);
    // Should have "..." to indicate truncation
    expect(blocksStr).toContain("...");
  });

  it("throws if SLACK_WEBHOOK_URL is not set", async () => {
    delete process.env.SLACK_WEBHOOK_URL;

    await expect(postReviewToSlack(basePayload)).rejects.toThrow(
      "SLACK_WEBHOOK_URL"
    );
  });
});
