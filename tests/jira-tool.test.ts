import { describe, it, expect, vi, beforeEach } from "vitest";
import axios from "axios";

vi.mock("axios");
const mockedAxios = vi.mocked(axios);

import { fetchJiraTicket } from "../src/jira-tool";

// ── Fixtures ──────────────────────────────────────────────────
function makeJiraResponse(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      id: "10042",
      key: "PROJ-123",
      fields: {
        summary: "Add JWT authentication to user service",
        description: {
          type: "doc",
          version: 1,
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Implement JWT-based auth." }],
            },
            {
              type: "heading",
              attrs: { level: 2 },
              content: [{ type: "text", text: "Acceptance Criteria" }],
            },
            {
              type: "bulletList",
              content: [
                {
                  type: "listItem",
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "Token expiry is 1 hour" }],
                    },
                  ],
                },
                {
                  type: "listItem",
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "Invalid tokens return 401" }],
                    },
                  ],
                },
              ],
            },
          ],
        },
        status: { name: "In Progress" },
        priority: { name: "High" },
        issuetype: { name: "Story" },
        assignee: { displayName: "Ravi Sharma" },
        reporter: { displayName: "Priya Mehta" },
        created: "2026-02-15T09:00:00Z",
        updated: "2026-03-10T15:30:00Z",
        labels: ["auth", "backend"],
        customfield_10016: 5,
        customfield_10106: null,  // No dedicated AC field — should fall back to description
        issuelinks: [
          {
            type: { outward: "blocks" },
            outwardIssue: { key: "PROJ-120", fields: { summary: "User login endpoint" } },
          },
        ],
        comment: {
          comments: [
            {
              author: { displayName: "Lead Dev" },
              body: {
                type: "doc",
                version: 1,
                content: [
                  {
                    type: "paragraph",
                    content: [{ type: "text", text: "Please add refresh token support too." }],
                  },
                ],
              },
              created: "2026-03-09T11:00:00Z",
            },
          ],
        },
        ...overrides,
      },
    },
  };
}

// ── Tests ─────────────────────────────────────────────────────
describe("fetchJiraTicket", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.JIRA_BASE_URL = "https://acme.atlassian.net";
    process.env.JIRA_EMAIL = "dev@acme.com";
    process.env.JIRA_API_TOKEN = "ATATT_test_token";
  });

  it("returns structured ticket details", async () => {
    mockedAxios.get.mockResolvedValueOnce(makeJiraResponse());

    const result = await fetchJiraTicket("PROJ-123");

    expect(result.key).toBe("PROJ-123");
    expect(result.id).toBe("10042");
    expect(result.summary).toBe("Add JWT authentication to user service");
    expect(result.status).toBe("In Progress");
    expect(result.priority).toBe("High");
    expect(result.issue_type).toBe("Story");
    expect(result.assignee).toBe("Ravi Sharma");
    expect(result.reporter).toBe("Priya Mehta");
    expect(result.story_points).toBe(5);
    expect(result.labels).toEqual(["auth", "backend"]);
  });

  it("extracts acceptance criteria from description when custom field is empty", async () => {
    mockedAxios.get.mockResolvedValueOnce(makeJiraResponse());

    const result = await fetchJiraTicket("PROJ-123");

    // Should have extracted from the "Acceptance Criteria" heading in description
    expect(result.acceptance_criteria).toBeTruthy();
    expect(result.acceptance_criteria).not.toBe("Not specified");
  });

  it("uses dedicated AC custom field when available", async () => {
    mockedAxios.get.mockResolvedValueOnce(
      makeJiraResponse({
        customfield_10106: {
          type: "doc",
          version: 1,
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "AC from dedicated field" }],
            },
          ],
        },
      })
    );

    const result = await fetchJiraTicket("PROJ-123");

    expect(result.acceptance_criteria).toContain("AC from dedicated field");
  });

  it("includes linked issues", async () => {
    mockedAxios.get.mockResolvedValueOnce(makeJiraResponse());

    const result = await fetchJiraTicket("PROJ-123");

    expect(result.linked_issues).toHaveLength(1);
    expect(result.linked_issues[0].key).toBe("PROJ-120");
    expect(result.linked_issues[0].relationship).toBe("blocks");
  });

  it("includes last comments (max 5)", async () => {
    mockedAxios.get.mockResolvedValueOnce(makeJiraResponse());

    const result = await fetchJiraTicket("PROJ-123");

    expect(result.comments).toHaveLength(1);
    expect(result.comments[0].author).toBe("Lead Dev");
    expect(result.comments[0].body).toContain("refresh token");
  });

  it("builds correct raw_url", async () => {
    mockedAxios.get.mockResolvedValueOnce(makeJiraResponse());

    const result = await fetchJiraTicket("PROJ-123");

    expect(result.raw_url).toBe("https://acme.atlassian.net/browse/PROJ-123");
  });

  it("uses Basic Auth with email + token", async () => {
    mockedAxios.get.mockResolvedValueOnce(makeJiraResponse());

    await fetchJiraTicket("PROJ-123");

    const callConfig = mockedAxios.get.mock.calls[0][1] as {
      auth?: { username: string; password: string };
    };
    expect(callConfig?.auth?.username).toBe("dev@acme.com");
    expect(callConfig?.auth?.password).toBe("ATATT_test_token");
  });

  it("throws when JIRA_BASE_URL is missing", async () => {
    delete process.env.JIRA_BASE_URL;

    await expect(fetchJiraTicket("PROJ-123")).rejects.toThrow("JIRA_BASE_URL");
  });

  it("throws when JIRA_EMAIL is missing", async () => {
    delete process.env.JIRA_EMAIL;

    await expect(fetchJiraTicket("PROJ-123")).rejects.toThrow("JIRA_EMAIL");
  });

  it("throws when JIRA_API_TOKEN is missing", async () => {
    delete process.env.JIRA_API_TOKEN;

    await expect(fetchJiraTicket("PROJ-123")).rejects.toThrow("JIRA_API_TOKEN");
  });

  it("handles unassigned tickets gracefully", async () => {
    mockedAxios.get.mockResolvedValueOnce(
      makeJiraResponse({ assignee: null })
    );

    const result = await fetchJiraTicket("PROJ-123");

    expect(result.assignee).toBe("Unassigned");
  });

  it("handles empty comments list", async () => {
    mockedAxios.get.mockResolvedValueOnce(
      makeJiraResponse({ comment: { comments: [] } })
    );

    const result = await fetchJiraTicket("PROJ-123");

    expect(result.comments).toEqual([]);
  });
});
