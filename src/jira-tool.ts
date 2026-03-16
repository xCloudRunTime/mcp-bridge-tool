/**
 * jira-tool.ts
 * Jira Cloud REST API v3 use karta hai.
 *
 * Docs: https://developer.atlassian.com/cloud/jira/platform/rest/v3/
 *
 * Required .env variables:
 *   JIRA_BASE_URL  = https://your-company.atlassian.net
 *   JIRA_EMAIL     = you@company.com
 *   JIRA_API_TOKEN = your-api-token (Atlassian account settings mein banao)
 */

import axios from "axios";

// ---------------------------------------------------------------
// Types
// ---------------------------------------------------------------
export interface JiraTicketDetails {
  id: string;
  key: string;
  summary: string;
  description: string;
  status: string;
  priority: string;
  issue_type: string;
  assignee: string;
  reporter: string;
  created_at: string;
  updated_at: string;
  labels: string[];
  acceptance_criteria: string;   // Custom field se ya description se extract hota hai
  story_points: number | null;
  linked_issues: LinkedIssue[];
  comments: JiraComment[];
  raw_url: string;
}

export interface LinkedIssue {
  key: string;
  summary: string;
  relationship: string;
}

export interface JiraComment {
  author: string;
  body: string;
  created_at: string;
}

// ---------------------------------------------------------------
// Main Exports
// ---------------------------------------------------------------

/**
 * MR review summary ko Jira ticket par comment ke roop mein post karta hai.
 * Jira Cloud ADF (Atlassian Document Format) format mein comment banta hai.
 */
export async function postReviewToJira(
  ticketId: string,
  reviewSummary: string,
  mrUrl: string,
  readyToMerge: boolean,
  analyst: string
): Promise<{ commentId: string; commentUrl: string }> {
  const baseUrl = process.env.JIRA_BASE_URL;
  const email   = process.env.JIRA_EMAIL;
  const apiToken = process.env.JIRA_API_TOKEN;

  if (!baseUrl)   throw new Error("JIRA_BASE_URL .env mein set nahi hai.");
  if (!email)     throw new Error("JIRA_EMAIL .env mein set nahi hai.");
  if (!apiToken)  throw new Error("JIRA_API_TOKEN .env mein set nahi hai.");

  const auth    = { username: email, password: apiToken };
  const headers = { Accept: "application/json", "Content-Type": "application/json" };
  const url     = `${baseUrl}/rest/api/3/issue/${ticketId}/comment`;

  const verdict = readyToMerge ? "✅ READY TO MERGE" : "❌ NOT READY TO MERGE";

  // Convert plain review summary text into ADF nodes (headings + bullet lists)
  function adfFromReviewText(text: string): object[] {
    const nodes: object[] = [];
    const lines = text.split("\n");
    let bulletBuffer: string[] = [];

    function flushBullets() {
      if (bulletBuffer.length === 0) return;
      nodes.push({
        type: "bulletList",
        content: bulletBuffer.map(item => ({
          type: "listItem",
          content: [{ type: "paragraph", content: [{ type: "text", text: item }] }],
        })),
      });
      bulletBuffer = [];
    }

    for (const raw of lines) {
      const line = raw.trim();
      if (!line || line === "---") {
        flushBullets();
        if (line === "---") nodes.push({ type: "rule" });
        continue;
      }
      const h3 = line.match(/^###\s+(.*)/);
      const h2 = line.match(/^##\s+(.*)/);
      const bullet = line.match(/^[-*\d+\.]\s+(.*)/);
      if (h2) {
        flushBullets();
        nodes.push({ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: h2[1] }] });
      } else if (h3) {
        flushBullets();
        nodes.push({ type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: h3[1] }] });
      } else if (bullet) {
        bulletBuffer.push(bullet[1].replace(/\*\*/g, ""));
      } else {
        flushBullets();
        nodes.push({ type: "paragraph", content: [{ type: "text", text: line.replace(/\*\*/g, "") }] });
      }
    }
    flushBullets();
    return nodes;
  }

  // Jira Cloud requires ADF (Atlassian Document Format) for comments
  const body = {
    body: {
      type: "doc",
      version: 1,
      content: [
        {
          type: "heading",
          attrs: { level: 2 },
          content: [{ type: "text", text: `🤖 AI Code Review — ${verdict}` }],
        },
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Reviewed by: ", marks: [{ type: "strong" }] },
            { type: "text", text: analyst },
            { type: "text", text: "   |   PR: " },
            { type: "text", text: mrUrl, marks: [{ type: "link", attrs: { href: mrUrl } }] },
          ],
        },
        { type: "rule" },
        ...adfFromReviewText(reviewSummary),
      ],
    },
  };

  const response = await axios.post(url, body, { auth, headers });
  const commentId: string = response.data.id;

  return {
    commentId,
    commentUrl: `${baseUrl}/browse/${ticketId}?focusedCommentId=${commentId}`,
  };
}

export async function fetchJiraTicket(ticketId: string): Promise<JiraTicketDetails> {
  const baseUrl = process.env.JIRA_BASE_URL;
  const email = process.env.JIRA_EMAIL;
  const apiToken = process.env.JIRA_API_TOKEN;

  if (!baseUrl) throw new Error("JIRA_BASE_URL .env mein set nahi hai.");
  if (!email) throw new Error("JIRA_EMAIL .env mein set nahi hai.");
  if (!apiToken) throw new Error("JIRA_API_TOKEN .env mein set nahi hai.");

  // Basic Auth: Jira Cloud har request mein email:token maangta hai
  const auth = {
    username: email,
    password: apiToken,
  };

  const headers = {
    Accept: "application/json",
    "Content-Type": "application/json",
  };

  const url = `${baseUrl}/rest/api/3/issue/${ticketId}`;

  // Fields list: sirf woh fields mangwao jo chahiye (performance ke liye)
  const fields = [
    "summary",
    "description",
    "status",
    "priority",
    "issuetype",
    "assignee",
    "reporter",
    "created",
    "updated",
    "labels",
    "story_points",
    "customfield_10016",   // Story Points (Jira ka default custom field)
    "customfield_10014",   // Epic Link
    "customfield_10106",   // Acceptance Criteria (most common field ID)
    "issuelinks",
    "comment",
  ].join(",");

  const response = await axios.get(`${url}?fields=${fields}`, {
    auth,
    headers,
  });

  return parseJiraResponse(response.data, baseUrl);
}

// ---------------------------------------------------------------
// Response Parser
// ---------------------------------------------------------------
function parseJiraResponse(data: JiraApiResponse, baseUrl: string): JiraTicketDetails {
  const f = data.fields;

  // Description: Jira Cloud Atlassian Document Format (ADF) use karta hai
  const descriptionText = extractTextFromADF(f.description);

  // Acceptance Criteria: custom field hai (ID company-to-company alag hoti hai)
  // Pehle dedicated field check karo, warna description mein "Acceptance Criteria" section dhundo
  let acceptanceCriteria =
    extractTextFromADF(f.customfield_10106) ||
    extractSectionFromText(descriptionText, "acceptance criteria") ||
    extractSectionFromText(descriptionText, "ac:") ||
    "Not specified";

  const comments: JiraComment[] = (f.comment?.comments ?? [])
    .slice(0, 5)   // Last 5 comments
    .map((c: JiraCommentRaw) => ({
      author: c.author?.displayName ?? "Unknown",
      body: extractTextFromADF(c.body),
      created_at: c.created,
    }));

  const linkedIssues: LinkedIssue[] = (f.issuelinks ?? []).map(
    (link: JiraIssueLink) => ({
      key:
        link.outwardIssue?.key ?? link.inwardIssue?.key ?? "N/A",
      summary:
        link.outwardIssue?.fields?.summary ??
        link.inwardIssue?.fields?.summary ??
        "",
      relationship:
        link.type?.outward ?? link.type?.inward ?? "related",
    })
  );

  return {
    id: data.id,
    key: data.key,
    summary: f.summary ?? "",
    description: descriptionText,
    status: f.status?.name ?? "Unknown",
    priority: f.priority?.name ?? "None",
    issue_type: f.issuetype?.name ?? "Unknown",
    assignee: f.assignee?.displayName ?? "Unassigned",
    reporter: f.reporter?.displayName ?? "Unknown",
    created_at: f.created ?? "",
    updated_at: f.updated ?? "",
    labels: f.labels ?? [],
    acceptance_criteria: acceptanceCriteria,
    story_points: f.customfield_10016 ?? f.story_points ?? null,
    linked_issues: linkedIssues,
    comments,
    raw_url: `${baseUrl}/browse/${data.key}`,
  };
}

// ---------------------------------------------------------------
// ADF (Atlassian Document Format) → Plain Text converter
// Jira Cloud ADF JSON ko human-readable text mein convert karta hai
// ---------------------------------------------------------------
function extractTextFromADF(node: AdfNode | null | undefined): string {
  if (!node) return "";

  // Agar sirf plain string ho (some older Jira versions)
  if (typeof node === "string") return node;

  const lines: string[] = [];

  function walk(n: AdfNode, depth = 0): void {
    if (!n) return;

    switch (n.type) {
      case "doc":
      case "blockquote":
        (n.content ?? []).forEach((child) => walk(child, depth));
        break;

      case "paragraph":
        const paraText = (n.content ?? [])
          .map((c) => (c.text ?? ""))
          .join("");
        if (paraText.trim()) lines.push(paraText);
        break;

      case "heading":
        const headingText = (n.content ?? [])
          .map((c) => c.text ?? "")
          .join("");
        const prefix = "#".repeat(Number(n.attrs?.level ?? 1));
        lines.push(`${prefix} ${headingText}`);
        break;

      case "bulletList":
      case "orderedList":
        (n.content ?? []).forEach((item, i) => {
          const bullet =
            n.type === "orderedList" ? `${i + 1}.` : "-";
          const itemText = (item.content ?? [])
            .flatMap((p) => p.content ?? [])
            .map((c) => c.text ?? "")
            .join("");
          lines.push(`${"  ".repeat(depth)}${bullet} ${itemText}`);
        });
        break;

      case "codeBlock":
        const code = (n.content ?? [])
          .map((c) => c.text ?? "")
          .join("");
        lines.push("```");
        lines.push(code);
        lines.push("```");
        break;

      case "text":
        if (n.text) lines.push(n.text);
        break;

      default:
        (n.content ?? []).forEach((child) => walk(child, depth));
    }
  }

  walk(node);
  return lines.join("\n").trim();
}

// Description mein se specific section dhundho (e.g. "Acceptance Criteria")
function extractSectionFromText(text: string, sectionKeyword: string): string {
  const lower = text.toLowerCase();
  const idx = lower.indexOf(sectionKeyword.toLowerCase());
  if (idx === -1) return "";

  // Us section ke baad ka content (next heading tak)
  const afterSection = text.slice(idx);
  const nextHeadingMatch = afterSection.slice(sectionKeyword.length).match(/\n#+\s/);
  const end = nextHeadingMatch
    ? sectionKeyword.length + (nextHeadingMatch.index ?? afterSection.length)
    : afterSection.length;

  return afterSection.slice(0, end).trim();
}

// ---------------------------------------------------------------
// Partial API Response Types
// ---------------------------------------------------------------
interface AdfNode {
  type: string;
  text?: string;
  content?: AdfNode[];
  attrs?: Record<string, unknown>;
}

interface JiraApiResponse {
  id: string;
  key: string;
  fields: JiraFields;
}

interface JiraFields {
  summary: string;
  description: AdfNode | null;
  status: { name: string };
  priority: { name: string };
  issuetype: { name: string };
  assignee: { displayName: string } | null;
  reporter: { displayName: string } | null;
  created: string;
  updated: string;
  labels: string[];
  story_points: number | null;
  customfield_10016: number | null;   // Story Points
  customfield_10014: string | null;   // Epic Link
  customfield_10106: AdfNode | null;  // Acceptance Criteria
  issuelinks: JiraIssueLink[];
  comment: { comments: JiraCommentRaw[] };
}

interface JiraCommentRaw {
  author: { displayName: string };
  body: AdfNode;
  created: string;
}

interface JiraIssueLink {
  type: { inward: string; outward: string };
  inwardIssue?: { key: string; fields: { summary: string } };
  outwardIssue?: { key: string; fields: { summary: string } };
}
