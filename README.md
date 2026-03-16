# mcp-bridge-tool

> **AI-powered MR/PR Code Review MCP Server** — GitHub Copilot Agent calls this server to review Pull Requests against Jira acceptance criteria, save results to DynamoDB, post comments to Jira, and generate regression test sheets.

[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)](https://www.typescriptlang.org/)
[![MCP](https://img.shields.io/badge/MCP-2024--11--05-green)](https://modelcontextprotocol.io/)
[![DynamoDB](https://img.shields.io/badge/DynamoDB-local%20%2F%20AWS-orange)](https://aws.amazon.com/dynamodb/)

---

## What It Does

```
You (chat) ──→ GitHub Copilot Agent ──→ mcp-bridge-tool (this server)
                                              │
                              ┌───────────────┼───────────────┐
                              ▼               ▼               ▼
                         GitHub API      Jira API       DynamoDB
                         (PR diff)    (ticket fetch)  (save/query)
```

Type natural language in Copilot Agent mode — the tools fire automatically:

> *"Review PR #1 in xruntime/AI-Product-Description"*
> *"Generate regression sheet for PR #1"*
> *"Post the review to Jira ticket DEMO-1"*

---

## Tools (9 total)

| Tool | Description |
|---|---|
| `analyze_merge_request` | Fetch PR diff + changed files from GitHub/GitLab |
| `fetch_jira_ticket` | Get ticket details, acceptance criteria, status from Jira |
| `review_mr_against_jira` | AI comparison: code changes vs Jira acceptance criteria |
| `save_mr_analysis` | Save review result to DynamoDB |
| `get_mr_analysis` | Read latest saved review from DynamoDB |
| `list_team_analyses` | List all team MR reviews with verdict |
| `post_review_to_jira` | Post formatted review as comment on Jira ticket |
| `search_analyses` | Search reviews by date range, analyst, verdict |
| `generate_regression_sheet` | Generate regression test CSV from review findings |

---

## Live Example — PR #1 Review

### 1. Copilot runs the full pipeline

Copilot calls: `review_mr_against_jira` → `save_mr_analysis` → `post_review_to_jira` → `generate_regression_sheet`

### 2. Review saved to DynamoDB (63KB record)

```json
{
  "mr_key": "github#xruntime/AI-Product-Description#1",
  "analyzed_at": "2026-03-16T10:22:14.000Z",
  "mr_title": "Feature/phase-1",
  "jira_key": "DEMO-1",
  "ready_to_merge": false,
  "analyst": "ravi.sharma",
  "review_summary": "## BLOCKING Issues\n1. SECURITY — Real API key committed..."
}
```

### 3. Review posted to Jira as formatted comment

The `post_review_to_jira` tool posts a fully formatted Atlassian Document Format (ADF) comment — rendered as headings, bullet lists, and code spans (not raw markdown):

```
MR Review — PR #1 (xruntime/AI-Product-Description)
NOT READY TO MERGE

🚨 BLOCKING Issues
• SECURITY — Real API key in .env-example (Critical)
• Unauthenticated API route (Critical)
• BILLING BUG: BillingInterval.OneTime instead of Every30Days (High)
• Wrong Jira ticket linked (High)

⚠️ Non-Blocking Issues
• Dead code after return in cancel-subscription.ts
• gemini.txt committed — add to .gitignore
• .npmrc regression
• application_url placeholder in .toml
• api.billing.request.tsx auto-cancels subscription

✅ Positive Observations
• BullMQ exponential backoff retry — well done
• Prisma migrations clean and complete
• Billing gating correct on bulk-generate-start
• Onboarding flow with hasOnboarded flag well-structured
• Cursor-based GraphQL pagination implemented properly
```

### 4. Regression Sheet Generated (CSV)

21 test cases auto-generated from the review findings:

| Test ID | Priority | Category | Area | Test Description |
|---|---|---|---|---|
| REG-001 | 🔴 Critical | Security | `.env-example` | Verify no real credentials committed |
| REG-002 | 🔴 Critical | Security | `.env-example` | Verify no real credentials committed |
| REG-003 | 🟠 High | Billing | Billing/Subscription | Verify MONTHLY_PLAN charges every 30 days |
| REG-004 | 🟠 High | Functional | Process/Traceability | Verify MR links to correct Jira story |
| REG-005 | 🟠 High | Code Quality | cancel-subscription.ts | Dead code after return removed |
| REG-006 | 🟠 High | Config | .gitignore | gemini.txt excluded from repo |
| REG-007 | 🟠 High | Config | .npmrc | npm install clean after flag removal |
| REG-008 | 🟠 High | Config | shopify.app.toml | application_url is real URL |
| REG-009 | 🟠 High | Security | worker.ts | Access token retrieval reviewed |
| REG-010 | 🟠 High | Billing | Billing/Subscription | Monthly billing interval verified |
| REG-011–021 | 🟡 Medium | Smoke | AI Gen, Billing, Onboarding… | Smoke tests per changed module |

Full CSV: [`regression-PR1-xruntime-AI-Product-Description.csv`](./regression-PR1-xruntime-AI-Product-Description.csv)

Import to Google Sheets: **File → Import → Upload**

---

## Architecture

```
mcp-bridge-tool/
├── src/
│   ├── index.ts          # MCP server — tool definitions + request handlers
│   ├── git-tool.ts       # GitHub & GitLab API integration
│   ├── jira-tool.ts      # Jira Cloud REST API v3 + ADF comment builder
│   ├── db.ts             # DynamoDB — save/query/search analyses
│   └── regression-tool.ts # Regression test case generator from review findings
├── dist/                 # Compiled JS (gitignored)
├── docker-compose.yml    # Local DynamoDB (port 8002) + Admin UI (port 8003)
├── regression-PR1-xruntime-AI-Product-Description.csv
├── .env.example          # Required environment variables
└── .github/
    ├── copilot-instructions.md
    └── prompts/          # Reusable Copilot prompt workflows
```

---

## Setup

### 1. Clone & install

```bash
git clone https://github.com/xCloudRunTime/mcp-bridge-tool.git
cd mcp-bridge-tool
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env`:

```env
GITHUB_TOKEN=ghp_your_token_here
JIRA_BASE_URL=https://your-company.atlassian.net
JIRA_EMAIL=you@company.com
JIRA_API_TOKEN=your_jira_api_token

# For local DynamoDB (docker-compose)
AWS_REGION=local
AWS_ACCESS_KEY_ID=local
AWS_SECRET_ACCESS_KEY=local
DDB_ENDPOINT=http://localhost:8002

# For AWS DynamoDB
# AWS_REGION=ap-south-1
# AWS_ACCESS_KEY_ID=AKIA...
# AWS_SECRET_ACCESS_KEY=...
# DDB_ENDPOINT=   (leave blank for real AWS)
```

### 3. Start local DynamoDB

```bash
docker compose up -d
# DynamoDB: http://localhost:8002
# Admin UI:  http://localhost:8003
```

### 4. Build

```bash
npm run build
```

### 5. Register in VS Code MCP config

Edit `~/Library/Application Support/Code/User/mcp.json` (macOS) or `%APPDATA%\Code\User\mcp.json` (Windows):

```json
{
  "servers": {
    "mcp-bridge-tool": {
      "type": "stdio",
      "command": "node",
      "args": [
        "--env-file=/absolute/path/to/mcp-bridge-tool/.env",
        "/absolute/path/to/mcp-bridge-tool/dist/index.js"
      ],
      "env": {
        "AWS_REGION": "local",
        "AWS_ACCESS_KEY_ID": "local",
        "AWS_SECRET_ACCESS_KEY": "local",
        "DDB_ENDPOINT": "http://localhost:8002"
      }
    }
  }
}
```

> **Important:** Use absolute paths. `${workspaceFolder}` resolves to the VS Code workspace root, which may not be the mcp-bridge-tool directory.

### 6. Reload VS Code

**Cmd+Shift+P** → `Developer: Reload Window`

---

## Usage in Copilot Agent Mode

Make sure you're in **Agent** mode (not Ask or Edit), then just describe what you want:

```
Review PR #5 in acme-org/backend-api
```

Copilot automatically chains:
1. `analyze_merge_request` — fetches diff
2. `fetch_jira_ticket` — fetches linked ticket
3. `review_mr_against_jira` — AI review
4. `save_mr_analysis` — saves to DDB
5. `post_review_to_jira` — posts to Jira
6. `generate_regression_sheet` — creates CSV

---

## DynamoDB Table Schema

| Attribute | Type | Role |
|---|---|---|
| `mr_key` | String | PK — `"github#owner/repo#42"` |
| `analyzed_at` | String | SK — ISO-8601 timestamp |
| `review_summary` | String | Full AI review text |
| `ready_to_merge` | Boolean | Merge verdict |
| `mr_snapshot` | Map | Full PR data (diff, files, author) |
| `jira_snapshot` | Map | Full Jira ticket data |
| `analyst` | String | Reviewer name (GSI) |

GSI `analyst-index` allows querying all reviews by a specific team member.

---

## License

MIT


> **GitHub Copilot MCP Server** — GitHub/GitLab MRs aur Jira tickets ko bridge karta hai AI-assisted code review ke liye. Team analyses DynamoDB mein store hoti hain.

---

## Architecture

```
VS Code Copilot Chat
       │
       ▼ (stdio)
  mcp-bridge-tool  (Node.js MCP server)
   ├── git-tool    ──► GitHub REST API / GitLab REST API
   ├── jira-tool   ──► Jira Cloud REST API v3
   └── db          ──► AWS DynamoDB  (team-shared storage)
```

---

## Features

| Tool | Description |
|---|---|
| `analyze_merge_request` | GitHub/GitLab se MR diff + file changes fetch karo |
| `fetch_jira_ticket` | Jira ticket details + acceptance criteria fetch karo |
| `review_mr_against_jira` | MR ko Jira acceptance criteria se compare karo |
| `save_mr_analysis` | Review DynamoDB mein save karo (team ke saath share) |
| `get_mr_analysis` | Kisi bhi MR ki last/full review history nikalo |
| `list_team_analyses` | Team ke sare recent reviews ek dashboard mein dekho |

---

## Quick Start

### 1. Clone & Setup

```bash
git clone <repo-url>
cd mcp-bridge-tool
npm run setup        # installs deps, copies .env, builds
```

### 2. Fill Credentials

```bash
code .env
```

Yeh values fill karo:

| Variable | Kahan se milega |
|---|---|
| `GITHUB_TOKEN` | [GitHub → Settings → Developer settings → PAT](https://github.com/settings/tokens) — scope: `repo` |
| `GITLAB_TOKEN` | GitLab → User Settings → Access Tokens — scope: `read_api` |
| `JIRA_BASE_URL` | `https://your-company.atlassian.net` |
| `JIRA_EMAIL` | Jira account email |
| `JIRA_API_TOKEN` | [Atlassian Account → Security → API tokens](https://id.atlassian.com/manage-profile/security/api-tokens) |
| `AWS_REGION` | e.g. `ap-south-1` |
| `AWS_ACCESS_KEY_ID` | IAM user access key (see [IAM setup](#aws-iam-setup)) |
| `AWS_SECRET_ACCESS_KEY` | IAM user secret |
| `ANALYST_NAME` | Tumhara naam (reviews mein dikhega) |

### 3. Build

```bash
npm run build
```

### 4. Test DynamoDB Connection

```bash
npm run test:ddb
```

---

## Daily Usage (Copilot Chat)

VS Code mein Copilot Chat kholein:

### MR Review

```
/mr-review   MR #42 in owner/backend-api
```

Ya Jira ticket bhi specify karo:
```
/mr-review   MR #42 in owner/backend-api, Jira: PROJ-123
```

### Team Dashboard

```
/team-dashboard
```

---

## Local Development (No AWS Account Needed)

Docker se local DynamoDB chalaao:

```bash
docker compose up -d
```

- DynamoDB local: http://localhost:8000
- DynamoDB Admin UI: http://localhost:8001

Phir `.env` mein yeh set karo:

```env
DDB_ENDPOINT=http://localhost:8000
AWS_REGION=local
AWS_ACCESS_KEY_ID=local
AWS_SECRET_ACCESS_KEY=local
```

---

## AWS IAM Setup

Least-privilege policy `iam-policy.json` mein hai. Steps:

1. AWS Console → IAM → Policies → Create Policy  
2. JSON tab mein `iam-policy.json` ka content paste karo  
3. Policy ka naam do: `mcp-bridge-tool-policy`  
4. IAM user/role mein attach karo  

---

## Project Structure

```
mcp-bridge-tool/
├── src/
│   ├── index.ts        # MCP server entry point (6 tools)
│   ├── git-tool.ts     # GitHub + GitLab connector
│   ├── jira-tool.ts    # Jira Cloud REST API v3
│   └── db.ts           # DynamoDB CRUD layer
├── scripts/
│   ├── setup.sh        # First-time setup script
│   └── test-server.ts  # DynamoDB connectivity test
├── .github/
│   ├── copilot-instructions.md   # Copilot tool usage instructions
│   └── prompts/
│       ├── mr-review.prompt.md      # /mr-review chat command
│       └── team-dashboard.prompt.md # /team-dashboard chat command
├── .vscode/
│   └── settings.json   # MCP server registration + TS SDK
├── dist/               # Compiled JS (after npm run build)
├── docker-compose.yml  # Local DynamoDB for testing
├── iam-policy.json     # Minimum AWS IAM permissions
├── .env.example        # Credentials template
└── tsconfig.json
```

---

## DynamoDB Table Design

Table name: `mcp-mr-analysis` (configurable via `DDB_TABLE_NAME`)

| Attribute | Type | Role |
|---|---|---|
| `mr_key` | String | Partition Key — `"github#owner/repo#42"` |
| `analyzed_at` | String | Sort Key — ISO-8601 timestamp |
| `analyst` | String | GSI Partition Key |

**GSI**: `analyst-index` (query by reviewer name + date)

---

## Environment Variables Reference

```env
# GitHub
GITHUB_TOKEN=ghp_...

# GitLab
GITLAB_TOKEN=glpat-...
GITLAB_BASE_URL=https://gitlab.your-company.com   # only for self-hosted

# Jira
JIRA_BASE_URL=https://your-company.atlassian.net
JIRA_EMAIL=you@company.com
JIRA_API_TOKEN=ATATT...

# AWS DynamoDB
AWS_REGION=ap-south-1
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=...
DDB_TABLE_NAME=mcp-mr-analysis        # optional, this is default
DDB_ENDPOINT=http://localhost:8000    # only for local Docker testing

# MCP
ANALYST_NAME=ravi.sharma
```

---

## Scripts

```bash
npm run setup      # First-time setup (install + build)
npm run build      # TypeScript compile → dist/
npm run start      # Production server start
npm run dev        # Dev mode (ts-node, no build needed)
npm run watch      # TypeScript watch mode
npm run test:ddb   # DynamoDB connectivity test
```

---

## Tech Stack

- **Runtime**: Node.js 18+ (ESM)
- **Language**: TypeScript 5.9
- **MCP SDK**: `@modelcontextprotocol/sdk`
- **HTTP**: `axios`
- **AWS**: `@aws-sdk/client-dynamodb` + `@aws-sdk/lib-dynamodb`
