---
applyTo: "**"
---

# MCP Bridge Tool — Skills & Tools Reference

This workspace has access to **mcp-bridge-tool** — a global MCP server with 7 tools and 4 skills for AI-assisted MR code reviews.

## Available Skills (Prompt Workflows)

Invoke these in agent mode by describing the task — Copilot will use the right skill automatically.

| Skill | Trigger phrase | What it does |
|-------|---------------|-------------|
| `full-mr-review` | "Review MR #42 in owner/repo" | Full cycle: fetch MR → Jira → compare → save to DynamoDB |
| `team-dashboard` | "Show team review dashboard" | List all recent analyses, highlight ready-to-merge |
| `search-ready-mrs` | "Find all approved MRs this week" | Date-range search of ready-to-merge MRs |
| `review-and-report` | "Review MR #42 and write a PR comment" | Review + formatted Markdown report for PR comment |

## Available Tools (Called Directly by Agent)

| Tool | Purpose |
|------|---------|
| `analyze_merge_request` | Fetch MR/PR diff, description, changed files |
| `fetch_jira_ticket` | Get Jira ticket title, ACs, status, comments |
| `review_mr_against_jira` | Compare MR diff against Jira acceptance criteria |
| `save_mr_analysis` | Save review result to DynamoDB (team-shared) |
| `get_mr_analysis` | Retrieve saved analysis for a specific MR |
| `list_team_analyses` | List all team's recent MR analyses |
| `search_analyses` | Search analyses by date, reviewer, repo, or verdict |

## Example Prompts

```
Review MR #105 in acme-org/payment-service and tell me if it's ready to merge.

Show me the team dashboard for the backend-api repo this sprint.

Find all MRs that were approved this week and summarize them.

Review PR #88 in myorg/frontend and generate a GitHub PR comment.
```

## Environment Variables Required

Set these in your shell `~/.zshrc`:
```bash
export GITHUB_TOKEN=ghp_...
export JIRA_BASE_URL=https://yourorg.atlassian.net
export JIRA_EMAIL=you@yourorg.com
export JIRA_API_TOKEN=...
export AWS_REGION=ap-south-1
export AWS_ACCESS_KEY_ID=...
export AWS_SECRET_ACCESS_KEY=...
export DDB_TABLE_NAME=mcp-mr-analysis
export ANALYST_NAME=YourName
```
