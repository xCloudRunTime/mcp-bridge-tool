/**
 * git-tool.ts
 * GitHub aur GitLab dono ke saath kaam karta hai.
 *
 * GitHub API docs:  https://docs.github.com/en/rest/pulls/pulls
 * GitLab API docs:  https://docs.gitlab.com/ee/api/merge_requests.html
 */

import axios from "axios";

// ---------------------------------------------------------------
// Types
// ---------------------------------------------------------------
export interface MergeRequestDetails {
  platform: "github" | "gitlab";
  id: string;
  repo: string;
  title: string;
  description: string;
  state: string;
  author: string;
  source_branch: string;
  target_branch: string;
  created_at: string;
  updated_at: string;
  changed_files: ChangedFile[];
  diff_summary: string;
  raw_url: string;
}

export interface ChangedFile {
  filename: string;
  status: string;        // added | modified | removed
  additions: number;
  deletions: number;
  patch?: string;        // actual code diff (truncated for large files)
}

const MAX_PATCH_CHARS = 3000; // AI context mein overflow na ho isliye limit

// ---------------------------------------------------------------
// Main Export
// ---------------------------------------------------------------
export async function fetchMergeRequestDetails(
  mrId: string,
  repo: string,           // "owner/repo"
  platform: "github" | "gitlab" = "github"
): Promise<MergeRequestDetails> {
  if (platform === "gitlab") {
    return fetchFromGitLab(mrId, repo);
  }
  return fetchFromGitHub(mrId, repo);
}

// ---------------------------------------------------------------
// GitHub Implementation
// ---------------------------------------------------------------
async function fetchFromGitHub(
  prNumber: string,
  repo: string
): Promise<MergeRequestDetails> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("GITHUB_TOKEN .env mein set nahi hai.");

  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };

  const baseUrl = `https://api.github.com/repos/${repo}/pulls/${prNumber}`;

  // Parallel calls: PR info + files list
  const [prRes, filesRes] = await Promise.all([
    axios.get(baseUrl, { headers }),
    axios.get(`${baseUrl}/files`, { headers }),
  ]);

  const pr = prRes.data;
  const files: ChangedFile[] = (filesRes.data as GithubFile[]).map((f) => ({
    filename: f.filename,
    status: f.status,
    additions: f.additions,
    deletions: f.deletions,
    patch: f.patch ? f.patch.slice(0, MAX_PATCH_CHARS) : undefined,
  }));

  const diffSummary = buildDiffSummary(files);

  return {
    platform: "github",
    id: prNumber,
    repo,
    title: pr.title,
    description: pr.body ?? "",
    state: pr.state,
    author: pr.user?.login ?? "unknown",
    source_branch: pr.head?.ref ?? "",
    target_branch: pr.base?.ref ?? "",
    created_at: pr.created_at,
    updated_at: pr.updated_at,
    changed_files: files,
    diff_summary: diffSummary,
    raw_url: pr.html_url,
  };
}

// ---------------------------------------------------------------
// GitLab Implementation
// ---------------------------------------------------------------
async function fetchFromGitLab(
  mrIid: string,
  repo: string              // "group/project" (URL-encoded internally)
): Promise<MergeRequestDetails> {
  const token = process.env.GITLAB_TOKEN;
  const baseUrl = process.env.GITLAB_BASE_URL ?? "https://gitlab.com";
  if (!token) throw new Error("GITLAB_TOKEN .env mein set nahi hai.");

  const encodedRepo = encodeURIComponent(repo);
  const headers = { "PRIVATE-TOKEN": token };
  const apiBase = `${baseUrl}/api/v4/projects/${encodedRepo}/merge_requests/${mrIid}`;

  // Parallel calls: MR info + changes (diff)
  const [mrRes, changesRes] = await Promise.all([
    axios.get(apiBase, { headers }),
    axios.get(`${apiBase}/changes`, { headers }),
  ]);

  const mr = mrRes.data;
  const files: ChangedFile[] = (changesRes.data.changes as GitLabChange[]).map(
    (c) => ({
      filename: c.new_path,
      status: c.new_file
        ? "added"
        : c.deleted_file
        ? "removed"
        : "modified",
      additions: 0,   // GitLab changes API mein additions count nahi hota directly
      deletions: 0,
      patch: c.diff ? c.diff.slice(0, MAX_PATCH_CHARS) : undefined,
    })
  );

  const diffSummary = buildDiffSummary(files);

  return {
    platform: "gitlab",
    id: mrIid,
    repo,
    title: mr.title,
    description: mr.description ?? "",
    state: mr.state,
    author: mr.author?.username ?? "unknown",
    source_branch: mr.source_branch,
    target_branch: mr.target_branch,
    created_at: mr.created_at,
    updated_at: mr.updated_at,
    changed_files: files,
    diff_summary: diffSummary,
    raw_url: mr.web_url,
  };
}

// ---------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------
function buildDiffSummary(files: ChangedFile[]): string {
  const lines = files.map(
    (f) =>
      `[${f.status.toUpperCase()}] ${f.filename}` +
      (f.additions || f.deletions
        ? ` (+${f.additions}/-${f.deletions})`
        : "")
  );
  return lines.join("\n");
}

// ---------------------------------------------------------------
// Inline Review Comments
// ---------------------------------------------------------------

export interface InlineComment {
  path: string;       // File path (relative to repo root)
  line: number;       // Line number in the file (new version)
  body: string;       // Comment text
}

export interface InlineReviewResult {
  platform: "github" | "gitlab";
  review_id?: number;
  comment_count: number;
  html_url?: string;
}

/**
 * Post inline review comments on a GitHub PR or GitLab MR.
 * Each comment is anchored to a specific file + line number.
 */
export async function postInlineReviewComments(
  mrId: string,
  repo: string,
  comments: InlineComment[],
  platform: "github" | "gitlab" = "github",
  reviewBody = "AI Code Review — inline annotations"
): Promise<InlineReviewResult> {
  if (platform === "gitlab") {
    return postGitLabInlineComments(mrId, repo, comments);
  }
  return postGitHubInlineComments(mrId, repo, comments, reviewBody);
}

async function postGitHubInlineComments(
  prNumber: string,
  repo: string,
  comments: InlineComment[],
  reviewBody: string
): Promise<InlineReviewResult> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("GITHUB_TOKEN .env mein set nahi hai.");

  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };

  // GitHub Review API expects commit_id — fetch the latest commit SHA
  const prRes = await axios.get(
    `https://api.github.com/repos/${repo}/pulls/${prNumber}`,
    { headers }
  );
  const commitId: string = prRes.data.head?.sha ?? "";

  const reviewComments = comments.map((c) => ({
    path: c.path,
    line: c.line,
    side: "RIGHT",
    body: c.body,
  }));

  const reviewRes = await axios.post(
    `https://api.github.com/repos/${repo}/pulls/${prNumber}/reviews`,
    {
      commit_id: commitId,
      body: reviewBody,
      event: "COMMENT",
      comments: reviewComments,
    },
    { headers }
  );

  return {
    platform: "github",
    review_id: reviewRes.data.id,
    comment_count: reviewComments.length,
    html_url: reviewRes.data.html_url,
  };
}

async function postGitLabInlineComments(
  mrIid: string,
  repo: string,
  comments: InlineComment[]
): Promise<InlineReviewResult> {
  const token = process.env.GITLAB_TOKEN;
  const baseUrl = process.env.GITLAB_BASE_URL ?? "https://gitlab.com";
  if (!token) throw new Error("GITLAB_TOKEN .env mein set nahi hai.");

  const encodedRepo = encodeURIComponent(repo);
  const headers = { "PRIVATE-TOKEN": token };
  const apiBase = `${baseUrl}/api/v4/projects/${encodedRepo}/merge_requests/${mrIid}`;

  // Fetch MR version info to get base_commit_sha and start_commit_sha
  const versionsRes = await axios.get(`${apiBase}/versions`, { headers });
  const latestVersion = versionsRes.data[0];
  const baseSha: string = latestVersion?.base_commit_sha ?? "";
  const startSha: string = latestVersion?.start_commit_sha ?? "";
  const headSha: string = latestVersion?.head_commit_sha ?? "";

  // Post each comment as a separate discussion
  const results = await Promise.allSettled(
    comments.map((c) =>
      axios.post(
        `${apiBase}/discussions`,
        {
          body: c.body,
          position: {
            position_type: "text",
            base_sha: baseSha,
            start_sha: startSha,
            head_sha: headSha,
            new_path: c.path,
            new_line: c.line,
          },
        },
        { headers }
      )
    )
  );

  const successCount = results.filter((r) => r.status === "fulfilled").length;

  return {
    platform: "gitlab",
    comment_count: successCount,
  };
}

// Raw API response types (partial — sirf jo fields chahiye)
interface GithubFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  patch?: string;
}

interface GitLabChange {
  new_path: string;
  old_path: string;
  new_file: boolean;
  deleted_file: boolean;
  diff: string;
}
