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
