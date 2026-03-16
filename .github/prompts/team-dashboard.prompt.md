---
mode: agent
tools:
  - list_team_analyses
  - get_mr_analysis
description: Team ke saare recent MR reviews DynamoDB se laata hai — dashboard view.
---

Fetch and display the team's recent MR analysis activity from DynamoDB.

## Steps

1. Call `list_team_analyses` with:
   - `limit`: 20 (or as user specified)
   - `analyst`: only if user asked for a specific person's reviews
   - `repo`: only if user asked for a specific repo

2. For each result, show a compact table row.

3. If user asks to dig into a specific MR, call `get_mr_analysis` for full details.

## Output Format

```
## Team MR Review Dashboard

| MR | Title | Jira | Status | Analyst | Date |
|---|---|---|---|---|---|
{{rows}}

**Total reviewed:** {{count}}
**Ready to merge:** {{ready_count}}
**Blocked:** {{blocked_count}}
```

If no results: "Abhi tak koi MR review save nahi hua. `mr-review` prompt se pehla review karo."
