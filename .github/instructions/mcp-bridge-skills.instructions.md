---
applyTo: "**"
---

# MCP Bridge Tool — Skills & Tools Reference

This workspace has access to **mcp-bridge-tool** — a global MCP server with **13 tools** and **9 skills** for AI-assisted MR code reviews, Slack notifications, Google Sheets/Drive exports, and inline PR annotations.

## Available Skills (Prompt Workflows)

Invoke these in agent mode by describing the task — Copilot will use the right skill automatically.

### Core Review Skills

| Skill | Trigger phrase | What it does |
|-------|---------------|-------------|
| `full-mr-review` | "Review MR #42 in owner/repo" | Full cycle: fetch MR → Jira → compare → save to DynamoDB |
| `team-dashboard` | "Show team review dashboard" | List all recent analyses, highlight ready-to-merge |
| `search-ready-mrs` | "Find all approved MRs this week" | Date-range search of ready-to-merge MRs |
| `review-and-report` | "Review MR #42 and write a PR comment" | Review + formatted Markdown report for PR comment |

### Tech-Stack Specialized Skills

| Skill | Trigger phrase | What it checks |
|-------|---------------|----------------|
| `react-pr-review` | "React review of PR #42" | Hooks rules, re-render performance, a11y, SSR/SSG |
| `node-api-review` | "API review of PR #42" | Auth, validation, error handling, async, security |
| `python-review` | "Python review of PR #42" | Type hints, PEP-8, test coverage, anti-patterns |
| `security-review` | "Security review of PR #42" | OWASP Top 10, secrets, injection, auth failures |
| `db-migration-review` | "Migration review of PR #42" | Rollback safety, data loss, locking, index impact |

---

## Available Tools (Called Directly by Agent)

### MR Analysis Tools
| Tool | Purpose |
|------|---------|
| `analyze_merge_request` | Fetch MR/PR diff, description, changed files |
| `fetch_jira_ticket` | Get Jira ticket title, ACs, status, comments |
| `review_mr_against_jira` | Compare MR diff against Jira acceptance criteria |
| `save_mr_analysis` | Save review result to DynamoDB (team-shared) |
| `get_mr_analysis` | Retrieve saved analysis for a specific MR |
| `list_team_analyses` | List all team's recent MR analyses |
| `search_analyses` | Search analyses by date, reviewer, repo, or verdict |
| `generate_regression_sheet` | Generate CSV regression test cases from findings |

### Notification & Export Tools
| Tool | Purpose |
|------|---------|
| `post_review_to_slack` | Post review verdict + summary to Slack channel |
| `post_inline_review_comments` | Add line-by-line comments on GitHub PR / GitLab MR |
| `post_review_to_jira` | Post ADF-formatted review comment to Jira ticket |
| `export_to_google_sheets` | Export regression tests or team dashboard to Google Sheets |
| `save_report_to_drive` | Save full Markdown review report to Google Drive folder |

---

## Example Prompts

```
Review MR #105 in acme-org/payment-service and tell me if it's ready to merge.

Do a security review of PR #88 in myorg/backend.

Do a React review of PR #42 in myorg/frontend and post inline comments.

Show me the team dashboard for the backend-api repo this sprint.

Find all MRs that were approved this week and summarize them.

Review PR #88 and post the result to Slack and save to Google Drive.

Export regression tests from MR #42 to Google Sheets.
```

---

## Environment Variables Required

Set these in your `.env` file (copy from `.env.example`):

```bash
# Core
GITHUB_TOKEN=ghp_...
JIRA_BASE_URL=https://yourorg.atlassian.net
JIRA_EMAIL=you@yourorg.com
JIRA_API_TOKEN=...
AWS_REGION=ap-south-1
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
DDB_TABLE_NAME=mcp-mr-analysis
ANALYST_NAME=YourName

# Slack (optional)
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/<WORKSPACE>/<APP>/<TOKEN>

# Google (optional)
GOOGLE_SERVICE_ACCOUNT_JSON={"type":"service_account",...}
GOOGLE_SHEET_ID=your-spreadsheet-id
GOOGLE_DRIVE_FOLDER_ID=your-folder-id
```
