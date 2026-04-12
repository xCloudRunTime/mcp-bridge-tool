import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  type Tool,
  type Prompt,
} from "@modelcontextprotocol/sdk/types.js";
import "dotenv/config";

import { fetchMergeRequestDetails, postInlineReviewComments, type InlineComment } from "./git-tool.js";
import { fetchJiraTicket, postReviewToJira, type JiraTicketDetails } from "./jira-tool.js";
import { generateRegressionSheet } from "./regression-tool.js";
import { postReviewToSlack } from "./slack-tool.js";
import { exportRegressionToSheets, exportDashboardToSheets } from "./sheets-tool.js";
import { saveReportToDrive } from "./drive-tool.js";
import {
  ensureTableExists,
  saveAnalysis,
  getLatestAnalysis,
  getMrHistory,
  listRecentAnalyses,
  searchAnalyses,
  buildMrKey,
  type AnalysisRecord,
} from "./db.js";

// ---------------------------------------------------------------
// Server Initialization
// ---------------------------------------------------------------

// DynamoDB table auto-create (agar table na ho toh pehli baar bana do)
// Sirf tab run hoga jab AWS_REGION env set ho
if (process.env.AWS_REGION) {
  ensureTableExists().catch((e) =>
    console.error("DDB table ensure failed:", e)
  );
}

const server = new Server(
  { name: "mcp-bridge-tool", version: "1.0.0" },
  { capabilities: { tools: {}, prompts: {} } }
);

// ---------------------------------------------------------------
// Tool Definitions  (AI yahan se tools discover karta hai)
// ---------------------------------------------------------------
const TOOLS: Tool[] = [
  {
    name: "analyze_merge_request",
    description:
      "GitLab/GitHub Merge Request ki complete details fetch karta hai — " +
      "code diff, description, changed files, aur author info sab milta hai.",
    inputSchema: {
      type: "object",
      properties: {
        mr_id: {
          type: "string",
          description: "Merge Request / Pull Request number (e.g. '42')",
        },
        repo: {
          type: "string",
          description:
            "owner/repo format mein repository (e.g. 'acme-org/backend-api')",
        },
        platform: {
          type: "string",
          enum: ["github", "gitlab"],
          description: "github ya gitlab — default: github",
        },
      },
      required: ["mr_id", "repo"],
    },
  },
  {
    name: "fetch_jira_ticket",
    description:
      "Jira se ticket ki puri details laata hai — " +
      "title, description, acceptance criteria, assignee, status, aur comments.",
    inputSchema: {
      type: "object",
      properties: {
        ticket_id: {
          type: "string",
          description:
            "Jira ticket ID (e.g. 'PROJ-123'). MR description se bhi automatically parse hota hai.",
        },
      },
      required: ["ticket_id"],
    },
  },
  {
    name: "review_mr_against_jira",
    description:
      "MR code changes ko Jira ticket ki requirements ke saath compare karta hai. " +
      "Pehle MR fetch karta hai, phir description se Jira ID nikaal kar ticket laata hai, " +
      "aur final 'Ready to Merge' report generate karta hai.",
    inputSchema: {
      type: "object",
      properties: {
        mr_id: {
          type: "string",
          description: "Merge Request number",
        },
        repo: {
          type: "string",
          description: "owner/repo format",
        },
        jira_id: {
          type: "string",
          description:
            "Optional: Agar MR description mein Jira ID na ho toh manually do",
        },
        platform: {
          type: "string",
          enum: ["github", "gitlab"],
        },
      },
      required: ["mr_id", "repo"],
    },
  },
  // ── 4. Save Analysis → DDB ─────────────────────────────────
  {
    name: "save_mr_analysis",
    description:
      "MR review ka result DynamoDB mein save karta hai taaki poori team dekh sake. " +
      "review_mr_against_jira ke output ke baad is tool ko call karo.",
    inputSchema: {
      type: "object",
      properties: {
        mr_id: { type: "string", description: "MR number" },
        repo: { type: "string", description: "owner/repo" },
        platform: { type: "string", enum: ["github", "gitlab"] },
        review_summary: { type: "string", description: "AI ka likha hua review text" },
        ready_to_merge: { type: "boolean", description: "true agar MR merge ke liye ready hai" },
        jira_id: { type: "string", description: "Optional: linked Jira ticket ID" },
        analyst: { type: "string", description: "Reviewer ka naam (default: ANALYST_NAME env se)" },
      },
      required: ["mr_id", "repo", "review_summary", "ready_to_merge"],
    },
  },
  // ── 5. Get Analysis ← DDB ─────────────────────────────────
  {
    name: "get_mr_analysis",
    description:
      "DynamoDB se kisi MR ka sabse latest saved analysis laata hai. " +
      "history: true karne par ek MR ke saare past reviews milenge.",
    inputSchema: {
      type: "object",
      properties: {
        mr_id: { type: "string" },
        repo: { type: "string", description: "owner/repo" },
        platform: { type: "string", enum: ["github", "gitlab"] },
        history: { type: "boolean", description: "true = saare past reviews laao" },
      },
      required: ["mr_id", "repo"],
    },
  },
  // ── 6. List Team Analyses ← DDB ───────────────────────────
  {
    name: "list_team_analyses",
    description:
      "Team ke saare recent MR analyses DynamoDB se laata hai. " +
      "Koi bhi team member dekh sakta hai kaunsa MR review hua aur kaun ready to merge hai.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Kitne records chahiye (default 20, max 100)" },
        analyst: { type: "string", description: "Optional: specific reviewer ke hi reviews" },
        repo: { type: "string", description: "Optional: specific repo ke hi reviews" },
      },
    },
  },
  // ── 7. Post Review to Jira ────────────────────────────────
  {
    name: "post_review_to_jira",
    description:
      "MR review summary ko Jira ticket par comment ke roop mein post karta hai. " +
      "save_mr_analysis ke baad is tool ko call karo taaki reviewer aur reporter ko Jira mein hi update mil sake.",
    inputSchema: {
      type: "object",
      properties: {
        ticket_id: { type: "string", description: "Jira ticket ID (e.g. 'DEMO-1')" },
        mr_id:     { type: "string", description: "MR / PR number" },
        repo:      { type: "string", description: "owner/repo" },
        platform:  { type: "string", enum: ["github", "gitlab"] },
        review_summary: { type: "string", description: "AI ka review text (save_mr_analysis se wahi text daal do)" },
        ready_to_merge: { type: "boolean", description: "true = READY TO MERGE, false = NOT READY" },
        analyst:   { type: "string", description: "Reviewer ka naam" },
      },
      required: ["ticket_id", "mr_id", "repo", "review_summary", "ready_to_merge"],
    },
  },
  // ── 8. Search Analyses ← DDB ──────────────────────────────
  {
    name: "search_analyses",
    description:
      "DynamoDB mein stored MR analyses ko date range aur filters ke saath search karta hai. " +
      "Kisi bhi specific time period ya verdict (ready/not ready) ke reviews nikalo.",
    inputSchema: {
      type: "object",
      properties: {
        from: {
          type: "string",
          description: "Start date (ISO-8601 format, e.g. '2026-01-01'). Is date se pehle ke records nahi aayenge.",
        },
        to: {
          type: "string",
          description: "End date (ISO-8601, e.g. '2026-03-31'). Is date ke baad ke records nahi aayenge.",
        },
        ready_to_merge: {
          type: "boolean",
          description: "true = sirf approved MRs, false = sirf rejected/conditional MRs",
        },
        analyst: {
          type: "string",
          description: "Optional: specific reviewer ke reviews hi laao",
        },
        repo: {
          type: "string",
          description: "Optional: specific repo ke reviews (owner/repo format)",
        },
        limit: {
          type: "number",
          description: "Max records (default 50)",
        },
      },
    },
  },
  // ── 9. Generate Regression Sheet ─────────────────────────
  {
    name: "generate_regression_sheet",
    description:
      "MR review findings se regression test cases generate karta hai. " +
      "Output: CSV (Google Sheets / Excel mein import karo) + JSON test cases. " +
      "save_mr_analysis ke baad call karo — blocking issues se Critical/High tests bante hain, " +
      "non-blocking se Medium/Low, aur changed files se Smoke tests.",
    inputSchema: {
      type: "object",
      properties: {
        mr_id: { type: "string", description: "MR / PR number" },
        repo: { type: "string", description: "owner/repo" },
        platform: { type: "string", enum: ["github", "gitlab"] },
      },
      required: ["mr_id", "repo"],
    },
  },
  // ── 10. Post Review to Slack ──────────────────────────────
  {
    name: "post_review_to_slack",
    description:
      "MR review result ko Slack channel mein post karta hai via Incoming Webhook. " +
      "Team ko instantly notify karta hai — ready-to-merge verdict, MR link, aur review summary ke saath. " +
      "save_mr_analysis ke baad call karo.",
    inputSchema: {
      type: "object",
      properties: {
        mr_id:          { type: "string", description: "MR / PR number" },
        repo:           { type: "string", description: "owner/repo" },
        platform:       { type: "string", enum: ["github", "gitlab"] },
        mr_title:       { type: "string", description: "MR title (optional, auto-fetch hoga)" },
        jira_key:       { type: "string", description: "Linked Jira ticket ID (optional)" },
        analyst:        { type: "string", description: "Reviewer ka naam (default: ANALYST_NAME env)" },
        review_summary: { type: "string", description: "Review text jo Slack mein dikhega" },
        ready_to_merge: { type: "boolean", description: "Merge verdict" },
      },
      required: ["mr_id", "repo", "review_summary", "ready_to_merge"],
    },
  },
  // ── 11. Post Inline Review Comments ──────────────────────
  {
    name: "post_inline_review_comments",
    description:
      "GitHub PR ya GitLab MR par line-by-line inline review comments post karta hai. " +
      "Har comment ek specific file aur line number se attach hota hai — " +
      "code ke andar directly annotations milti hain.",
    inputSchema: {
      type: "object",
      properties: {
        mr_id:    { type: "string", description: "MR / PR number" },
        repo:     { type: "string", description: "owner/repo" },
        platform: { type: "string", enum: ["github", "gitlab"] },
        comments: {
          type: "array",
          description: "Inline comments list",
          items: {
            type: "object",
            properties: {
              path: { type: "string", description: "File path (e.g. 'src/auth.ts')" },
              line: { type: "number", description: "Line number in the file" },
              body: { type: "string", description: "Comment text" },
            },
            required: ["path", "line", "body"],
          },
        },
        review_body: {
          type: "string",
          description: "Overall review summary (shown as PR review header)",
        },
      },
      required: ["mr_id", "repo", "comments"],
    },
  },
  // ── 12. Export to Google Sheets ───────────────────────────
  {
    name: "export_to_google_sheets",
    description:
      "MR analysis data ya regression tests ko Google Sheets mein export karta hai. " +
      "mode='regression_tests': test cases ek dedicated tab mein. " +
      "mode='team_dashboard': team ka poora dashboard ek tab mein overwrite karta hai.",
    inputSchema: {
      type: "object",
      properties: {
        mode: {
          type: "string",
          enum: ["regression_tests", "team_dashboard"],
          description: "Export mode: regression_tests ya team_dashboard",
        },
        mr_id:    { type: "string", description: "MR number (regression_tests mode ke liye)" },
        repo:     { type: "string", description: "owner/repo (regression_tests mode ke liye)" },
        platform: { type: "string", enum: ["github", "gitlab"] },
        spreadsheet_id: {
          type: "string",
          description: "Google Sheets spreadsheet ID (optional, GOOGLE_SHEET_ID env se override)",
        },
        limit: {
          type: "number",
          description: "team_dashboard mode: kitne records (default 50)",
        },
      },
      required: ["mode"],
    },
  },
  // ── 13. Save Report to Google Drive ──────────────────────
  {
    name: "save_report_to_drive",
    description:
      "MR review report ko Google Drive folder mein Markdown file ke roop mein save karta hai. " +
      "Permanent record ban jaata hai jo Drive se share kiya ja sakta hai.",
    inputSchema: {
      type: "object",
      properties: {
        mr_id:     { type: "string", description: "MR / PR number" },
        repo:      { type: "string", description: "owner/repo" },
        platform:  { type: "string", enum: ["github", "gitlab"] },
        folder_id: {
          type: "string",
          description: "Google Drive folder ID (optional, GOOGLE_DRIVE_FOLDER_ID env se override)",
        },
      },
      required: ["mr_id", "repo"],
    },
  },
];

// ---------------------------------------------------------------
// Skill Prompts (MCP Prompts = reusable named workflows)
// ---------------------------------------------------------------
const SKILLS: Prompt[] = [
  {
    name: "full-mr-review",
    description:
      "Complete MR review workflow: MR fetch → Jira ticket → AI comparison → save to DynamoDB. " +
      "Ek hi command mein poora review cycle complete karta hai.",
    arguments: [
      { name: "mr_id", description: "MR / PR number (e.g. '42')", required: true },
      { name: "repo", description: "owner/repo (e.g. 'acme/backend')", required: true },
      { name: "platform", description: "github ya gitlab (default: github)", required: false },
      { name: "jira_id", description: "Optional Jira ticket ID (auto-detect se bhi chalega)", required: false },
    ],
  },
  {
    name: "team-dashboard",
    description:
      "Team ke saare recent MR analyses ka dashboard banaao. " +
      "Ready-to-merge MRs highlight karo aur pending reviews list karo.",
    arguments: [
      { name: "analyst", description: "Specific reviewer filter karo (optional)", required: false },
      { name: "repo", description: "Specific repo filter karo (optional)", required: false },
    ],
  },
  {
    name: "search-ready-mrs",
    description:
      "Ek specific date range mein ready-to-merge MRs dhundo. " +
      "Sprint review ya weekly report ke liye useful.",
    arguments: [
      { name: "from", description: "Start date ISO-8601 (e.g. '2026-03-01')", required: false },
      { name: "to", description: "End date ISO-8601 (e.g. '2026-03-31')", required: false },
      { name: "repo", description: "optional: owner/repo filter", required: false },
    ],
  },
  {
    name: "review-and-report",
    description:
      "MR review karo aur ek readable Markdown report generate karo jise PR comment mein daal sako.",
    arguments: [
      { name: "mr_id", description: "MR number", required: true },
      { name: "repo", description: "owner/repo", required: true },
      { name: "platform", description: "github ya gitlab", required: false },
    ],
  },
  // ── Tech-Stack Skills ────────────────────────────────────
  {
    name: "react-pr-review",
    description:
      "React / Next.js PR ka specialized review: hooks rules, re-render performance, " +
      "accessibility (a11y), SSR/SSG correctness, aur component structure.",
    arguments: [
      { name: "mr_id", description: "PR number", required: true },
      { name: "repo", description: "owner/repo", required: true },
      { name: "platform", description: "github ya gitlab (default: github)", required: false },
    ],
  },
  {
    name: "node-api-review",
    description:
      "Node.js / Express / Fastify API PR ka review: authentication, input validation, " +
      "error handling, async/await correctness, aur security (injection, rate limiting).",
    arguments: [
      { name: "mr_id", description: "PR number", required: true },
      { name: "repo", description: "owner/repo", required: true },
      { name: "platform", description: "github ya gitlab (default: github)", required: false },
    ],
  },
  {
    name: "python-review",
    description:
      "Python PR ka review: type hints, PEP-8 compliance, test coverage, " +
      "dependency safety, aur common anti-patterns (mutable defaults, bare excepts).",
    arguments: [
      { name: "mr_id", description: "PR number", required: true },
      { name: "repo", description: "owner/repo", required: true },
      { name: "platform", description: "github ya gitlab (default: github)", required: false },
    ],
  },
  {
    name: "security-review",
    description:
      "Security-focused PR review: OWASP Top 10 check, secrets/credentials exposure, " +
      "injection vulnerabilities (SQL, command, XSS), auth/authz issues, aur dependency CVEs.",
    arguments: [
      { name: "mr_id", description: "PR number", required: true },
      { name: "repo", description: "owner/repo", required: true },
      { name: "platform", description: "github ya gitlab (default: github)", required: false },
    ],
  },
  {
    name: "db-migration-review",
    description:
      "Database migration PR ka review: rollback safety, data loss risk, index impact, " +
      "locking behavior on large tables, aur backward compatibility.",
    arguments: [
      { name: "mr_id", description: "PR number", required: true },
      { name: "repo", description: "owner/repo", required: true },
      { name: "platform", description: "github ya gitlab (default: github)", required: false },
    ],
  },
];

// ---------------------------------------------------------------
// List Tools Handler
// ---------------------------------------------------------------
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

// ---------------------------------------------------------------
// List Skills (Prompts) Handler
// ---------------------------------------------------------------
server.setRequestHandler(ListPromptsRequestSchema, async () => ({ prompts: SKILLS }));

// ---------------------------------------------------------------
// Get Skill (Prompt) Handler  — returns filled prompt messages
// ---------------------------------------------------------------
server.setRequestHandler(GetPromptRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  switch (name) {
    case "full-mr-review": {
      const mrId = args?.mr_id ?? "<MR_ID>";
      const repo = args?.repo ?? "<owner/repo>";
      const platform = args?.platform ?? "github";
      const jiraId = args?.jira_id ?? "";
      return {
        description: "Full MR review workflow prompt",
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text:
                `Please do a complete review of MR #${mrId} in repo ${repo} (${platform}).\n\n` +
                `Steps:\n` +
                `1. Call analyze_merge_request with mr_id="${mrId}", repo="${repo}", platform="${platform}"\n` +
                `2. ${jiraId ? `Call fetch_jira_ticket with ticket_id="${jiraId}"` : "Auto-detect Jira ID from MR description and call fetch_jira_ticket"}\n` +
                `3. Call review_mr_against_jira with mr_id="${mrId}", repo="${repo}"${jiraId ? `, jira_id="${jiraId}"` : ""}\n` +
                `4. Analyze the results: check each Jira acceptance criterion against the code diff\n` +
                `5. Call save_mr_analysis with your review summary and ready_to_merge verdict\n` +
                `6. Return a structured report: Summary, Missing Items, Verdict`,
            },
          },
        ],
      };
    }

    case "team-dashboard": {
      const analyst = args?.analyst ?? "";
      const repo = args?.repo ?? "";
      return {
        description: "Team dashboard prompt",
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text:
                `Generate a team MR review dashboard.\n\n` +
                `1. Call list_team_analyses${analyst ? ` with analyst="${analyst}"` : ""}${repo ? ` with repo="${repo}"` : ""}\n` +
                `2. Separate results into: ✅ Ready to Merge vs ⏳ Needs Work\n` +
                `3. Show a summary table: MR key | Title | Jira | Analyst | Date | Status\n` +
                `4. Highlight any MR that has been pending for more than 3 days`,
            },
          },
        ],
      };
    }

    case "search-ready-mrs": {
      const from = args?.from ?? "";
      const to = args?.to ?? "";
      const repo = args?.repo ?? "";
      return {
        description: "Search ready-to-merge MRs prompt",
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text:
                `Find all ready-to-merge MRs${from ? ` from ${from}` : ""}${to ? ` to ${to}` : ""}${repo ? ` in repo ${repo}` : ""}.\n\n` +
                `1. Call search_analyses with ready_to_merge=true${from ? `, from="${from}"` : ""}${to ? `, to="${to}"` : ""}${repo ? `, repo="${repo}"` : ""}\n` +
                `2. List the results grouped by repository\n` +
                `3. Show total count and highlight any that were reviewed by multiple analysts`,
            },
          },
        ],
      };
    }

    case "review-and-report": {
      const mrId = args?.mr_id ?? "<MR_ID>";
      const repo = args?.repo ?? "<owner/repo>";
      const platform = args?.platform ?? "github";
      return {
        description: "MR review with Markdown report output",
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text:
                `Review MR #${mrId} in ${repo} (${platform}) and generate a Markdown PR comment.\n\n` +
                `1. Call review_mr_against_jira with mr_id="${mrId}", repo="${repo}", platform="${platform}"\n` +
                `2. Format the output as a Markdown comment suitable for a GitHub/GitLab PR:\n` +
                `   ## 🤖 AI Code Review\n` +
                `   ### Summary\n` +
                `   ### Jira Requirements Coverage\n` +
                `   | Criterion | Status |\n` +
                `   ### Issues Found\n` +
                `   ### Verdict: ✅ Ready to Merge / ❌ Needs Changes\n` +
                `3. Call save_mr_analysis with the review results`,
            },
          },
        ],
      };
    }

    case "react-pr-review": {
      const mrId = args?.mr_id ?? "<MR_ID>";
      const repo = args?.repo ?? "<owner/repo>";
      const platform = args?.platform ?? "github";
      return {
        description: "React/Next.js specialized PR review",
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text:
                `Do a React/Next.js specialized review of PR #${mrId} in ${repo} (${platform}).\n\n` +
                `1. Call analyze_merge_request with mr_id="${mrId}", repo="${repo}", platform="${platform}"\n` +
                `2. Review the diff with focus on:\n` +
                `   - **Hooks rules**: No conditional hooks, correct dependency arrays in useEffect/useMemo/useCallback\n` +
                `   - **Re-render performance**: Missing React.memo, unnecessary state, prop drilling\n` +
                `   - **Accessibility (a11y)**: Missing ARIA labels, keyboard navigation, color contrast\n` +
                `   - **SSR/SSG correctness**: Window/document usage without guards, hydration mismatches\n` +
                `   - **Component structure**: Oversized components, missing error boundaries\n` +
                `3. Report: list each issue with file path + line number, severity (Critical/High/Medium/Low)\n` +
                `4. Call save_mr_analysis with your verdict`,
            },
          },
        ],
      };
    }

    case "node-api-review": {
      const mrId = args?.mr_id ?? "<MR_ID>";
      const repo = args?.repo ?? "<owner/repo>";
      const platform = args?.platform ?? "github";
      return {
        description: "Node.js API specialized PR review",
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text:
                `Do a Node.js API specialized review of PR #${mrId} in ${repo} (${platform}).\n\n` +
                `1. Call analyze_merge_request with mr_id="${mrId}", repo="${repo}", platform="${platform}"\n` +
                `2. Review the diff with focus on:\n` +
                `   - **Authentication**: Missing auth middleware, JWT verification, session handling\n` +
                `   - **Input validation**: Unvalidated user input, missing sanitization, schema checks\n` +
                `   - **Error handling**: Unhandled promise rejections, missing try/catch, error leakage\n` +
                `   - **Async correctness**: Uncaught async errors, blocking operations in event loop\n` +
                `   - **Security**: SQL/command injection, path traversal, rate limiting missing\n` +
                `3. Report: list each issue with file path + line number, severity (Critical/High/Medium/Low)\n` +
                `4. Call save_mr_analysis with your verdict`,
            },
          },
        ],
      };
    }

    case "python-review": {
      const mrId = args?.mr_id ?? "<MR_ID>";
      const repo = args?.repo ?? "<owner/repo>";
      const platform = args?.platform ?? "github";
      return {
        description: "Python specialized PR review",
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text:
                `Do a Python specialized review of PR #${mrId} in ${repo} (${platform}).\n\n` +
                `1. Call analyze_merge_request with mr_id="${mrId}", repo="${repo}", platform="${platform}"\n` +
                `2. Review the diff with focus on:\n` +
                `   - **Type hints**: Missing annotations, incorrect types, untyped function signatures\n` +
                `   - **PEP-8**: Naming conventions, line length, import ordering\n` +
                `   - **Test coverage**: New code without tests, missing edge case tests\n` +
                `   - **Common anti-patterns**: Mutable default arguments, bare except, broad imports\n` +
                `   - **Dependency safety**: New packages added, version pinning, known vulnerabilities\n` +
                `3. Report: list each issue with file path + line number, severity (Critical/High/Medium/Low)\n` +
                `4. Call save_mr_analysis with your verdict`,
            },
          },
        ],
      };
    }

    case "security-review": {
      const mrId = args?.mr_id ?? "<MR_ID>";
      const repo = args?.repo ?? "<owner/repo>";
      const platform = args?.platform ?? "github";
      return {
        description: "Security-focused PR review (OWASP Top 10)",
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text:
                `Do a security-focused review of PR #${mrId} in ${repo} (${platform}).\n\n` +
                `1. Call analyze_merge_request with mr_id="${mrId}", repo="${repo}", platform="${platform}"\n` +
                `2. Review the diff with focus on OWASP Top 10:\n` +
                `   - **A01 Broken Access Control**: Missing authz checks, IDOR, privilege escalation\n` +
                `   - **A02 Crypto Failures**: Plaintext secrets, weak hashing (MD5/SHA1), hardcoded keys\n` +
                `   - **A03 Injection**: SQL, command, LDAP, XSS injection vectors\n` +
                `   - **A05 Security Misconfiguration**: Debug mode, CORS wildcard, open redirects\n` +
                `   - **A07 Auth Failures**: Weak passwords, missing MFA, insecure session management\n` +
                `   - **Secrets exposure**: API keys, tokens, passwords in code or env files committed\n` +
                `3. Rate every finding as Critical/High/Medium/Low — BLOCK merge on any Critical\n` +
                `4. Call save_mr_analysis with ready_to_merge=false if any Critical issues found`,
            },
          },
        ],
      };
    }

    case "db-migration-review": {
      const mrId = args?.mr_id ?? "<MR_ID>";
      const repo = args?.repo ?? "<owner/repo>";
      const platform = args?.platform ?? "github";
      return {
        description: "Database migration safety review",
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text:
                `Do a database migration safety review of PR #${mrId} in ${repo} (${platform}).\n\n` +
                `1. Call analyze_merge_request with mr_id="${mrId}", repo="${repo}", platform="${platform}"\n` +
                `2. Review migration files with focus on:\n` +
                `   - **Rollback safety**: Is there a corresponding down migration? Can it be reverted safely?\n` +
                `   - **Data loss risk**: DROP TABLE/COLUMN, TRUNCATE, irreversible transforms\n` +
                `   - **Locking**: ALTER TABLE on large tables causes lock — is this planned for off-hours?\n` +
                `   - **Index impact**: New indexes on large tables, missing indexes on foreign keys\n` +
                `   - **Backward compatibility**: New NOT NULL columns without defaults break old code\n` +
                `3. Mark as Critical if data loss or unrecoverable state is possible\n` +
                `4. Call save_mr_analysis with your verdict and rollback instructions`,
            },
          },
        ],
      };
    }

    default:
      throw new Error(`Unknown skill: ${name}`);
  }
});

// ---------------------------------------------------------------
// Call Tool Handler
// ---------------------------------------------------------------
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      // ── Tool 1: MR Details ───────────────────────────────────
      case "analyze_merge_request": {
        const mrId = String(args?.mr_id ?? "");
        const repo = String(args?.repo ?? "");
        const platform = (args?.platform as "github" | "gitlab") ?? "github";

        if (!mrId || !repo)
          return errorResponse("mr_id aur repo dono required hain.");

        const mrData = await fetchMergeRequestDetails(mrId, repo, platform);
        return {
          content: [{ type: "text", text: JSON.stringify(mrData, null, 2) }],
        };
      }

      // ── Tool 2: Jira Ticket ──────────────────────────────────
      case "fetch_jira_ticket": {
        const ticketId = String(args?.ticket_id ?? "");
        if (!ticketId) return errorResponse("ticket_id required hai.");

        const jiraData = await fetchJiraTicket(ticketId);
        return {
          content: [{ type: "text", text: JSON.stringify(jiraData, null, 2) }],
        };
      }

      // ── Tool 3: Full Review ──────────────────────────────────
      case "review_mr_against_jira": {
        const mrId = String(args?.mr_id ?? "");
        const repo = String(args?.repo ?? "");
        const platform = (args?.platform as "github" | "gitlab") ?? "github";
        let jiraId = String(args?.jira_id ?? "");

        if (!mrId || !repo)
          return errorResponse("mr_id aur repo dono required hain.");

        // Step 1: MR details fetch karo
        const mrData = await fetchMergeRequestDetails(mrId, repo, platform);

        // Step 2: Jira ID MR description se auto-detect karo (agar manually nahi diya)
        if (!jiraId) {
          const match = (mrData.description ?? "").match(
            /([A-Z][A-Z0-9]+-\d+)/
          );
          jiraId = match ? match[1] : "";
        }

        let jiraData: JiraTicketDetails | null = null;
        if (jiraId) {
          jiraData = await fetchJiraTicket(jiraId);
        }

        const combinedReport = {
          merge_request: mrData,
          jira_ticket: jiraData ?? "Jira ticket nahi mila (ID not found in MR description)",
          review_hint:
            "Upar diye gaye MR diff aur Jira acceptance criteria ko compare karo. " +
            "Har acceptance criterion covered hai ya nahi check karo. " +
            "Agar sab cover hain toh 'Ready to Merge: YES' likho, warna missing items batao.",
        };

        return {
          content: [
            { type: "text", text: JSON.stringify(combinedReport, null, 2) },
          ],
        };
      }

      // ── Tool 3: Save Analysis to DDB ────────────────────────
      case "save_mr_analysis": {
        const mrId = String(args?.mr_id ?? "");
        const repo = String(args?.repo ?? "");
        const platform = (args?.platform as "github" | "gitlab") ?? "github";
        const reviewSummary = String(args?.review_summary ?? "");
        const readyToMerge = Boolean(args?.ready_to_merge);
        const jiraId = args?.jira_id ? String(args.jira_id) : null;
        const analyst =
          args?.analyst
            ? String(args.analyst)
            : (process.env.ANALYST_NAME ?? "AI-Copilot");

        if (!mrId || !repo || !reviewSummary)
          return errorResponse("mr_id, repo aur review_summary required hain.");

        // MR snapshot bhi save karo taaki history mein context rahe
        const mrData = await fetchMergeRequestDetails(mrId, repo, platform);
        let jiraData: JiraTicketDetails | null = null;
        if (jiraId) jiraData = await fetchJiraTicket(jiraId);

        const record: AnalysisRecord = {
          mr_key: buildMrKey(platform, repo, mrId),
          analyzed_at: new Date().toISOString(),
          platform,
          repo,
          mr_id: mrId,
          mr_title: mrData.title,
          jira_key: jiraId,
          jira_summary: jiraData?.summary ?? null,
          review_summary: reviewSummary,
          ready_to_merge: readyToMerge,
          analyst,
          mr_snapshot: mrData,
          jira_snapshot: jiraData,
        };

        await saveAnalysis(record);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  saved: true,
                  mr_key: record.mr_key,
                  analyzed_at: record.analyzed_at,
                  analyst: record.analyst,
                  ready_to_merge: record.ready_to_merge,
                  message: `Analysis DynamoDB mein save ho gaya. Koi bhi team member get_mr_analysis se dekh sakta hai.`,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      // ── Tool 4: Get Analysis from DDB ───────────────────────
      case "get_mr_analysis": {
        const mrId = String(args?.mr_id ?? "");
        const repo = String(args?.repo ?? "");
        const platform = (args?.platform as "github" | "gitlab") ?? "github";
        const wantHistory = Boolean(args?.history);

        if (!mrId || !repo)
          return errorResponse("mr_id aur repo required hain.");

        if (wantHistory) {
          const records = await getMrHistory(platform, repo, mrId);
          if (records.length === 0)
            return {
              content: [
                { type: "text", text: `No analysis found for MR #${mrId} in ${repo}` },
              ],
            };
          return {
            content: [{ type: "text", text: JSON.stringify(records, null, 2) }],
          };
        }

        const record = await getLatestAnalysis(platform, repo, mrId);
        if (!record)
          return {
            content: [
              {
                type: "text",
                text: `MR #${mrId} (${repo}) ka koi analysis DynamoDB mein nahi mila. Pehle save_mr_analysis se save karo.`,
              },
            ],
          };

        return {
          content: [{ type: "text", text: JSON.stringify(record, null, 2) }],
        };
      }

      // ── Tool 5: List Team Analyses ──────────────────────────
      case "list_team_analyses": {
        const limit = Math.min(Number(args?.limit ?? 20), 100);
        const analyst = args?.analyst ? String(args.analyst) : undefined;
        const repo = args?.repo ? String(args.repo) : undefined;

        const records = await listRecentAnalyses({ limit, analyst, repo });

        if (records.length === 0)
          return {
            content: [
              {
                type: "text",
                text: "Abhi tak koi analysis save nahi hua. save_mr_analysis tool use karo.",
              },
            ],
          };

        // Lightweight summary (full snapshots chod do — context overflow na ho)
        const summary = records.map((r) => ({
          mr_key: r.mr_key,
          mr_title: r.mr_title,
          jira_key: r.jira_key,
          jira_summary: r.jira_summary,
          ready_to_merge: r.ready_to_merge,
          analyst: r.analyst,
          analyzed_at: r.analyzed_at,
          review_snippet: r.review_summary.slice(0, 200),
        }));

        return {
          content: [{ type: "text", text: JSON.stringify(summary, null, 2) }],
        };
      }

      // ── Tool 7: Search Analyses ─────────────────────────────
      case "search_analyses": {
        const from = args?.from ? String(args.from) : undefined;
        const to = args?.to ? String(args.to) : undefined;
        const ready_to_merge =
          typeof args?.ready_to_merge === "boolean"
            ? args.ready_to_merge
            : undefined;
        const analyst = args?.analyst ? String(args.analyst) : undefined;
        const repo = args?.repo ? String(args.repo) : undefined;
        const limit = Math.min(Number(args?.limit ?? 50), 200);

        const records = await searchAnalyses({
          from,
          to,
          ready_to_merge,
          analyst,
          repo,
          limit,
        });

        if (records.length === 0)
          return {
            content: [
              {
                type: "text",
                text: "Is filter ke saath koi analysis nahi mila.",
              },
            ],
          };

        const summary = records.map((r) => ({
          mr_key: r.mr_key,
          mr_title: r.mr_title,
          jira_key: r.jira_key,
          ready_to_merge: r.ready_to_merge,
          analyst: r.analyst,
          analyzed_at: r.analyzed_at,
          review_snippet: r.review_summary.slice(0, 200),
        }));

        return {
          content: [{ type: "text", text: JSON.stringify(summary, null, 2) }],
        };
      }

      // ── Tool 7: Post Review to Jira ─────────────────────────
      case "post_review_to_jira": {
        const ticketId     = String(args?.ticket_id ?? "");
        const mrId         = String(args?.mr_id ?? "");
        const repo         = String(args?.repo ?? "");
        const platform     = (args?.platform as "github" | "gitlab") ?? "github";
        const reviewSummary = String(args?.review_summary ?? "");
        const readyToMerge  = Boolean(args?.ready_to_merge);
        const analyst = args?.analyst
          ? String(args.analyst)
          : (process.env.ANALYST_NAME ?? "AI-Copilot");

        if (!ticketId || !mrId || !repo || !reviewSummary)
          return errorResponse("ticket_id, mr_id, repo aur review_summary required hain.");

        const prNumber = platform === "github"
          ? `https://github.com/${repo}/pull/${mrId}`
          : `${process.env.GITLAB_BASE_URL ?? "https://gitlab.com"}/${repo}/-/merge_requests/${mrId}`;

        const result = await postReviewToJira(
          ticketId, reviewSummary, prNumber, readyToMerge, analyst
        );

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              posted: true,
              ticket_id: ticketId,
              comment_id: result.commentId,
              comment_url: result.commentUrl,
              verdict: readyToMerge ? "READY TO MERGE" : "NOT READY TO MERGE",
              message: `Review comment Jira ticket ${ticketId} par post ho gaya. Link: ${result.commentUrl}`,
            }, null, 2),
          }],
        };
      }

      // ── Tool 9: Generate Regression Sheet ───────────────────
      case "generate_regression_sheet": {
        const mrId    = String(args?.mr_id ?? "");
        const repo    = String(args?.repo ?? "");
        const platform = (args?.platform as "github" | "gitlab") ?? "github";

        if (!mrId || !repo)
          return errorResponse("mr_id aur repo required hain.");

        const record = await getLatestAnalysis(platform, repo, mrId);
        if (!record)
          return errorResponse(`No saved analysis found for ${platform}#${repo}#${mrId}. Pehle save_mr_analysis call karo.`);

        const sheet = generateRegressionSheet(record);

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              mr_key: sheet.mr_key,
              mr_title: sheet.mr_title,
              jira_key: sheet.jira_key,
              generated_at: sheet.generated_at,
              summary: {
                total_tests: sheet.total_tests,
                critical: sheet.critical_count,
                high: sheet.high_count,
                medium: sheet.test_cases.filter(t => t.priority === "Medium").length,
                low: sheet.test_cases.filter(t => t.priority === "Low").length,
              },
              test_cases: sheet.test_cases,
              csv: sheet.csv,
              instructions: "CSV column ko copy karke Google Sheets → File → Import mein paste karo, ya .csv file mein save karke Excel mein kholo.",
            }, null, 2),
          }],
        };
      }

      // ── Tool 10: Post Review to Slack ───────────────────────
      case "post_review_to_slack": {
        const mrId         = String(args?.mr_id ?? "");
        const repo         = String(args?.repo ?? "");
        const platform     = (args?.platform as "github" | "gitlab") ?? "github";
        const reviewSummary = String(args?.review_summary ?? "");
        const readyToMerge  = Boolean(args?.ready_to_merge);
        const jiraKey      = args?.jira_key ? String(args.jira_key) : null;
        const analyst      = args?.analyst
          ? String(args.analyst)
          : (process.env.ANALYST_NAME ?? "AI-Copilot");

        if (!mrId || !repo || !reviewSummary)
          return errorResponse("mr_id, repo aur review_summary required hain.");

        // Fetch MR to get title + URL
        let mrTitle = args?.mr_title ? String(args.mr_title) : "";
        let mrUrl = "";
        if (!mrTitle) {
          const mrData = await fetchMergeRequestDetails(mrId, repo, platform);
          mrTitle = mrData.title;
          mrUrl = mrData.raw_url;
        } else {
          mrUrl = platform === "github"
            ? `https://github.com/${repo}/pull/${mrId}`
            : `${process.env.GITLAB_BASE_URL ?? "https://gitlab.com"}/${repo}/-/merge_requests/${mrId}`;
        }

        const jiraUrl = jiraKey && process.env.JIRA_BASE_URL
          ? `${process.env.JIRA_BASE_URL}/browse/${jiraKey}`
          : null;

        const result = await postReviewToSlack({
          mr_title: mrTitle,
          mr_url: mrUrl,
          repo,
          mr_id: mrId,
          jira_key: jiraKey,
          jira_url: jiraUrl,
          analyst,
          ready_to_merge: readyToMerge,
          review_summary: reviewSummary,
          platform,
        });

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              posted: result.ok,
              verdict: readyToMerge ? "READY TO MERGE" : "NEEDS CHANGES",
              message: "Review notification Slack mein post ho gaya.",
            }, null, 2),
          }],
        };
      }

      // ── Tool 11: Post Inline Review Comments ────────────────
      case "post_inline_review_comments": {
        const mrId      = String(args?.mr_id ?? "");
        const repo      = String(args?.repo ?? "");
        const platform  = (args?.platform as "github" | "gitlab") ?? "github";
        const comments  = (args?.comments ?? []) as InlineComment[];
        const reviewBody = args?.review_body
          ? String(args.review_body)
          : "AI Code Review — inline annotations";

        if (!mrId || !repo)
          return errorResponse("mr_id aur repo required hain.");
        if (!Array.isArray(comments) || comments.length === 0)
          return errorResponse("comments array empty nahi hona chahiye.");

        const result = await postInlineReviewComments(
          mrId, repo, comments, platform, reviewBody
        );

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              posted: true,
              platform: result.platform,
              review_id: result.review_id,
              comment_count: result.comment_count,
              html_url: result.html_url,
              message: `${result.comment_count} inline comments ${platform === "github" ? "PR" : "MR"} par post ho gaye.`,
            }, null, 2),
          }],
        };
      }

      // ── Tool 12: Export to Google Sheets ────────────────────
      case "export_to_google_sheets": {
        const mode = String(args?.mode ?? "regression_tests") as "regression_tests" | "team_dashboard";
        const spreadsheetId = args?.spreadsheet_id ? String(args.spreadsheet_id) : undefined;

        if (mode === "regression_tests") {
          const mrId    = String(args?.mr_id ?? "");
          const repo    = String(args?.repo ?? "");
          const platform = (args?.platform as "github" | "gitlab") ?? "github";

          if (!mrId || !repo)
            return errorResponse("regression_tests mode ke liye mr_id aur repo required hain.");

          const record = await getLatestAnalysis(platform, repo, mrId);
          if (!record)
            return errorResponse(`No saved analysis found for ${platform}#${repo}#${mrId}. Pehle save_mr_analysis call karo.`);

          const sheet = generateRegressionSheet(record);
          const result = await exportRegressionToSheets(sheet, spreadsheetId);

          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                exported: true,
                spreadsheet_id: result.spreadsheetId,
                sheet_title: result.sheetTitle,
                updated_range: result.updatedRange,
                rows_written: result.rowsWritten,
                message: `${result.rowsWritten} regression test rows Google Sheets tab '${result.sheetTitle}' mein export ho gaye.`,
              }, null, 2),
            }],
          };
        }

        // team_dashboard mode
        const limit = Math.min(Number(args?.limit ?? 50), 100);
        const records = await listRecentAnalyses({ limit });

        if (records.length === 0)
          return { content: [{ type: "text", text: "Koi analysis nahi mila. save_mr_analysis se pehle save karo." }] };

        const result = await exportDashboardToSheets(records, spreadsheetId);

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              exported: true,
              spreadsheet_id: result.spreadsheetId,
              sheet_title: result.sheetTitle,
              updated_range: result.updatedRange,
              rows_written: result.rowsWritten,
              message: `Team dashboard — ${result.rowsWritten} MR records Google Sheets tab '${result.sheetTitle}' mein export ho gaye.`,
            }, null, 2),
          }],
        };
      }

      // ── Tool 13: Save Report to Google Drive ────────────────
      case "save_report_to_drive": {
        const mrId     = String(args?.mr_id ?? "");
        const repo     = String(args?.repo ?? "");
        const platform = (args?.platform as "github" | "gitlab") ?? "github";
        const folderId = args?.folder_id ? String(args.folder_id) : undefined;

        if (!mrId || !repo)
          return errorResponse("mr_id aur repo required hain.");

        const record = await getLatestAnalysis(platform, repo, mrId);
        if (!record)
          return errorResponse(`No saved analysis found for ${platform}#${repo}#${mrId}. Pehle save_mr_analysis call karo.`);

        const result = await saveReportToDrive(record, folderId);

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              saved: true,
              file_id: result.fileId,
              file_name: result.fileName,
              web_view_link: result.webViewLink,
              folder_id: result.folderId,
              message: `Review report '${result.fileName}' Google Drive mein save ho gaya. Link: ${result.webViewLink}`,
            }, null, 2),
          }],
        };
      }

      default:
        return errorResponse(`Unknown tool: ${name}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return errorResponse(`Tool execution failed: ${message}`);
  }
});

// ---------------------------------------------------------------
// Helper
// ---------------------------------------------------------------
function errorResponse(message: string) {
  return {
    content: [{ type: "text", text: `ERROR: ${message}` }],
    isError: true,
  };
}

// ---------------------------------------------------------------
// Start Server via stdio transport (Copilot/Cursor se connect hota hai)
// ---------------------------------------------------------------
const transport = new StdioServerTransport();
await server.connect(transport);
console.error("mcp-bridge-tool server started ✓");
