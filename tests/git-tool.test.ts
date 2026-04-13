import { describe, it, expect, vi, beforeEach } from "vitest";
import axios from "axios";

vi.mock("axios");
const mockedAxios = vi.mocked(axios);

// Import after mocking
import { fetchMergeRequestDetails } from "../src/git-tool";

// ── Fixtures ──────────────────────────────────────────────────
const GITHUB_PR_RESPONSE = {
  data: {
    number: 42,
    title: "feat: add user authentication",
    body: "Fixes PROJ-123\n\nAdds JWT-based auth flow.",
    state: "open",
    user: { login: "ravi.sharma" },
    head: { ref: "feature/auth" },
    base: { ref: "main" },
    created_at: "2026-03-01T10:00:00Z",
    updated_at: "2026-03-10T12:00:00Z",
    html_url: "https://github.com/acme/backend-api/pull/42",
  },
};

const GITHUB_FILES_RESPONSE = {
  data: [
    {
      filename: "src/auth/jwt.ts",
      status: "added",
      additions: 80,
      deletions: 0,
      patch: "@@ -0,0 +1,80 @@\n+import jwt from 'jsonwebtoken';\n+// ...",
    },
    {
      filename: "src/auth/middleware.ts",
      status: "modified",
      additions: 20,
      deletions: 5,
      patch: "@@ -10,5 +10,20 @@\n-old code\n+new code",
    },
  ],
};

const GITLAB_MR_RESPONSE = {
  data: {
    iid: 7,
    title: "fix: resolve null pointer in payment service",
    description: "Closes PAY-456",
    state: "opened",
    author: { username: "priya.mehta" },
    source_branch: "fix/null-payment",
    target_branch: "develop",
    created_at: "2026-03-05T08:00:00Z",
    updated_at: "2026-03-11T09:00:00Z",
    web_url: "https://gitlab.com/acme/payments-api/-/merge_requests/7",
  },
};

const GITLAB_CHANGES_RESPONSE = {
  data: {
    changes: [
      {
        new_path: "src/payment/processor.ts",
        old_path: "src/payment/processor.ts",
        new_file: false,
        deleted_file: false,
        diff: "@@ -55,7 +55,7 @@\n-if (amount == null)\n+if (amount === null)",
      },
    ],
  },
};

// ── Tests ─────────────────────────────────────────────────────
describe("fetchMergeRequestDetails — GitHub", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GITHUB_TOKEN = "ghp_test_token";
  });

  it("returns structured MR details for a GitHub PR", async () => {
    mockedAxios.get
      .mockResolvedValueOnce(GITHUB_PR_RESPONSE)   // PR info
      .mockResolvedValueOnce(GITHUB_FILES_RESPONSE); // changed files

    const result = await fetchMergeRequestDetails("42", "acme/backend-api", "github");

    expect(result.platform).toBe("github");
    expect(result.id).toBe("42");
    expect(result.repo).toBe("acme/backend-api");
    expect(result.title).toBe("feat: add user authentication");
    expect(result.author).toBe("ravi.sharma");
    expect(result.source_branch).toBe("feature/auth");
    expect(result.target_branch).toBe("main");
    expect(result.changed_files).toHaveLength(2);
    expect(result.changed_files[0].filename).toBe("src/auth/jwt.ts");
    expect(result.changed_files[0].status).toBe("added");
    expect(result.changed_files[0].additions).toBe(80);
  });

  it("includes raw_url pointing to the PR", async () => {
    mockedAxios.get
      .mockResolvedValueOnce(GITHUB_PR_RESPONSE)
      .mockResolvedValueOnce(GITHUB_FILES_RESPONSE);

    const result = await fetchMergeRequestDetails("42", "acme/backend-api", "github");

    expect(result.raw_url).toContain("pull/42");
  });

  it("builds diff_summary from changed files", async () => {
    mockedAxios.get
      .mockResolvedValueOnce(GITHUB_PR_RESPONSE)
      .mockResolvedValueOnce(GITHUB_FILES_RESPONSE);

    const result = await fetchMergeRequestDetails("42", "acme/backend-api", "github");

    expect(result.diff_summary).toContain("src/auth/jwt.ts");
    expect(result.diff_summary).toContain("src/auth/middleware.ts");
  });

  it("uses GITHUB_TOKEN header in API calls", async () => {
    mockedAxios.get
      .mockResolvedValueOnce(GITHUB_PR_RESPONSE)
      .mockResolvedValueOnce(GITHUB_FILES_RESPONSE);

    await fetchMergeRequestDetails("42", "acme/backend-api", "github");

    const firstCall = mockedAxios.get.mock.calls[0];
    const config = firstCall[1] as { headers?: Record<string, string> };
    expect(config?.headers?.Authorization).toBe("Bearer ghp_test_token");
  });

  it("throws when GitHub API returns 404", async () => {
    mockedAxios.get.mockRejectedValueOnce(
      Object.assign(new Error("Not Found"), { response: { status: 404 } })
    );

    await expect(
      fetchMergeRequestDetails("9999", "acme/backend-api", "github")
    ).rejects.toThrow();
  });

  it("paginates when Link header contains rel=next", async () => {
    const page1Files = Array.from({ length: 100 }, (_, i) => ({
      filename: `src/file-${i}.ts`,
      status: "modified",
      additions: 1,
      deletions: 1,
      patch: "+line",
    }));
    const page2Files = [
      { filename: "src/extra.ts", status: "added", additions: 5, deletions: 0, patch: "+extra" },
    ];

    mockedAxios.get
      .mockResolvedValueOnce(GITHUB_PR_RESPONSE)             // PR info
      .mockResolvedValueOnce({                                // page 1 with next link
        data: page1Files,
        headers: { link: '<https://api.github.com/...?page=2>; rel="next"' },
      })
      .mockResolvedValueOnce({ data: page2Files });           // page 2 (no next link)

    const result = await fetchMergeRequestDetails("42", "acme/backend-api", "github");

    expect(result.changed_files).toHaveLength(101);
    expect(result.changed_files[100].filename).toBe("src/extra.ts");
  });

  it("truncates patch longer than MAX_PATCH_CHARS and adds notice", async () => {
    const longPatch = "+".repeat(4000);
    mockedAxios.get
      .mockResolvedValueOnce(GITHUB_PR_RESPONSE)
      .mockResolvedValueOnce({
        data: [{ filename: "big.ts", status: "modified", additions: 200, deletions: 0, patch: longPatch }],
      });

    const result = await fetchMergeRequestDetails("42", "acme/backend-api", "github");

    expect(result.changed_files[0].patch).toContain("... [diff truncated]");
    expect(result.changed_files[0].patch!.length).toBeLessThan(longPatch.length);
  });
});

describe("fetchMergeRequestDetails — GitLab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GITLAB_TOKEN = "glpat_test_token";
    process.env.GITLAB_BASE_URL = undefined as unknown as string;
  });

  it("returns structured MR details for a GitLab MR", async () => {
    mockedAxios.get
      .mockResolvedValueOnce(GITLAB_MR_RESPONSE)
      .mockResolvedValueOnce(GITLAB_CHANGES_RESPONSE);

    const result = await fetchMergeRequestDetails("7", "acme/payments-api", "gitlab");

    expect(result.platform).toBe("gitlab");
    expect(result.id).toBe("7");
    expect(result.title).toBe("fix: resolve null pointer in payment service");
    expect(result.author).toBe("priya.mehta");
    expect(result.source_branch).toBe("fix/null-payment");
    expect(result.changed_files).toHaveLength(1);
    expect(result.changed_files[0].filename).toBe("src/payment/processor.ts");
  });

  it("calculates additions and deletions from GitLab diff lines", async () => {
    const changesWithDiff = {
      data: {
        changes: [{
          new_path: "src/service.ts",
          old_path: "src/service.ts",
          new_file: false,
          deleted_file: false,
          diff: [
            "@@ -10,6 +10,8 @@",
            " unchanged line",
            "-removed line 1",
            "-removed line 2",
            "+added line 1",
            "+added line 2",
            "+added line 3",
          ].join("\n"),
        }],
      },
    };

    mockedAxios.get
      .mockResolvedValueOnce(GITLAB_MR_RESPONSE)
      .mockResolvedValueOnce(changesWithDiff);

    const result = await fetchMergeRequestDetails("7", "acme/payments-api", "gitlab");

    expect(result.changed_files[0].additions).toBe(3);
    expect(result.changed_files[0].deletions).toBe(2);
  });

  it("marks new files as status: added, deleted files as status: removed", async () => {
    const changesWithNewAndDeleted = {
      data: {
        changes: [
          { new_path: "new.ts", old_path: "new.ts", new_file: true, deleted_file: false, diff: "+line" },
          { new_path: "old.ts", old_path: "old.ts", new_file: false, deleted_file: true, diff: "-line" },
        ],
      },
    };

    mockedAxios.get
      .mockResolvedValueOnce(GITLAB_MR_RESPONSE)
      .mockResolvedValueOnce(changesWithNewAndDeleted);

    const result = await fetchMergeRequestDetails("7", "acme/payments-api", "gitlab");

    expect(result.changed_files[0].status).toBe("added");
    expect(result.changed_files[1].status).toBe("removed");
  });

  it("defaults to platform: github when not specified", async () => {
    mockedAxios.get
      .mockResolvedValueOnce(GITHUB_PR_RESPONSE)
      .mockResolvedValueOnce(GITHUB_FILES_RESPONSE);

    const result = await fetchMergeRequestDetails("42", "acme/backend-api");

    expect(result.platform).toBe("github");
  });
});
