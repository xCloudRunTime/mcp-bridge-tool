# MCP Bridge Tool — Copilot Instructions

You have access to the `mcp-bridge-tool` MCP server with 7 tools for reviewing GitHub/GitLab Merge Requests against Jira tickets and saving results to DynamoDB for team visibility.

## When to Use These Tools

Automatically invoke these tools when the user:
- Mentions an MR, PR, merge request, or pull request number
- Asks to "review", "analyze", or "check" a merge request
- Pastes a GitHub/GitLab MR URL
- Asks to see team review history or who reviewed what

---

## Standard MR Review Workflow

Follow these steps **in order** for every MR review request:

### Step 1 — Fetch MR Details
Call `analyze_merge_request` with the MR number and repo.
- Extract: title, description, changed files, code diff, author, source/target branch.

### Step 2 — Fetch Jira Ticket
Call `fetch_jira_ticket` with the Jira ID.
- If the user didn't provide a Jira ID, scan the MR description for a pattern like `PROJ-123` (uppercase letters, hyphen, digits).
- Extract: summary, acceptance criteria, story points, status.

### Step 3 — Review & Compare
Compare the MR code changes against the Jira acceptance criteria:
- For EACH acceptance criterion: state ✅ covered / ❌ not covered / ⚠️ partial.
- Check for missing tests, unhandled edge cases, or code quality issues.
- Give a final verdict: **Ready to Merge: YES / NO / CONDITIONAL**.

### Step 4 — Save to DynamoDB
Always call `save_mr_analysis` after completing the review.
- `review_summary`: Your complete review text.
- `ready_to_merge`: true/false based on your verdict.
- This allows the entire team to see the review.

---

## Other Tool Usage

| User asks... | Tool to call |
|---|---|
| "Show latest review for MR #42" | `get_mr_analysis` |
| "Show all reviews for MR #42" | `get_mr_analysis` with `history: true` |
| "What did the team review this week?" | `list_team_analyses` |
| "Show reviews by ravi" | `list_team_analyses` with `analyst: "ravi.sharma"` |
| "What MRs are ready to merge?" | `list_team_analyses`, filter `ready_to_merge: true` |
| "Show MRs reviewed this month" | `search_analyses` with `from: "2026-03-01"` |
| "Find all rejected MRs this week" | `search_analyses` with `ready_to_merge: false`, `from/to` |
| "Search reviews by date range" | `search_analyses` |

---

## Tool Parameters Quick Reference

### `analyze_merge_request`
```
mr_id    : "42"                  (required)
repo     : "owner/repo-name"     (required)
platform : "github" | "gitlab"   (default: github)
```

### `fetch_jira_ticket`
```
ticket_id : "PROJ-123"   (required)
```

### `review_mr_against_jira`
```
mr_id    : "42"
repo     : "owner/repo"
jira_id  : "PROJ-123"    (optional — auto-detected from MR description)
platform : "github" | "gitlab"
```

### `save_mr_analysis`
```
mr_id          : "42"
repo           : "owner/repo"
review_summary : "<your full review text>"
ready_to_merge : true | false
jira_id        : "PROJ-123"     (optional)
analyst        : "ravi.sharma"  (optional — uses ANALYST_NAME env if omitted)
```

### `get_mr_analysis`
```
mr_id   : "42"
repo    : "owner/repo"
history : false   (true = all past reviews for this MR)
```

### `list_team_analyses`
```
limit   : 20          (max 100)
analyst : "name"      (optional filter)
repo    : "owner/repo" (optional filter)
```

### `search_analyses`
```
from           : "2026-01-01"   (optional — start date, ISO-8601)
to             : "2026-03-31"   (optional — end date, ISO-8601)
ready_to_merge : true | false   (optional — filter by verdict)
analyst        : "name"         (optional)
repo           : "owner/repo"   (optional)
limit          : 50             (max 200)
```

---

## Output Format for Reviews

Structure every review response like this:

```
## MR Review: #<id> — <title>

**Jira Ticket:** <KEY> — <summary>
**Author:** <name>  |  **Branch:** <source> → <target>

### Changed Files
<list of files with +/- counts>

### Acceptance Criteria Check
- [ / ✅ / ❌ / ⚠️] <criterion 1>
- [ / ✅ / ❌ / ⚠️] <criterion 2>

### Code Quality Notes
<observations>

### Verdict
**Ready to Merge: YES / NO / CONDITIONAL**
<reason>

---
*Saved to team DynamoDB by: <analyst>*
```
