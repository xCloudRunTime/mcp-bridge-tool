#!/usr/bin/env bash
# install-global.sh — Register mcp-bridge-tool in VS Code global MCP config
# Run this once from the mcp-bridge-tool directory to make tools available
# in ALL VS Code workspaces without needing per-project .vscode/settings.json

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DIST_JS="$PROJECT_DIR/dist/index.js"
MCP_JSON="$HOME/Library/Application Support/Code/User/mcp.json"

echo "=== mcp-bridge-tool Global Installer ==="
echo "Project: $PROJECT_DIR"

# ── 1. Build if dist/index.js is missing ────────────────────────
if [[ ! -f "$DIST_JS" ]]; then
  echo "→ Building TypeScript..."
  cd "$PROJECT_DIR" && npm run build
  echo "✓ Build complete"
else
  echo "✓ dist/index.js already exists (run 'npm run build' to rebuild)"
fi

# ── 2. Create mcp.json if it doesn't exist ──────────────────────
if [[ ! -f "$MCP_JSON" ]]; then
  echo "→ Creating $MCP_JSON"
  echo '{"servers":{},"inputs":[]}' > "$MCP_JSON"
fi

# ── 3. Add/update server entry using Python (safe JSON editing) ──
python3 << PYEOF
import json, sys

path = "$MCP_JSON"
dist_js = "$DIST_JS"

with open(path) as f:
    data = json.load(f)

if "servers" not in data:
    data["servers"] = {}

data["servers"]["mcp-bridge-tool"] = {
    "type": "stdio",
    "command": "node",
    "args": [dist_js],
    "env": {
        "GITHUB_TOKEN": "\${env:GITHUB_TOKEN}",
        "GITLAB_TOKEN": "\${env:GITLAB_TOKEN}",
        "GITLAB_BASE_URL": "\${env:GITLAB_BASE_URL}",
        "JIRA_BASE_URL": "\${env:JIRA_BASE_URL}",
        "JIRA_EMAIL": "\${env:JIRA_EMAIL}",
        "JIRA_API_TOKEN": "\${env:JIRA_API_TOKEN}",
        "AWS_REGION": "\${env:AWS_REGION}",
        "AWS_ACCESS_KEY_ID": "\${env:AWS_ACCESS_KEY_ID}",
        "AWS_SECRET_ACCESS_KEY": "\${env:AWS_SECRET_ACCESS_KEY}",
        "DDB_TABLE_NAME": "\${env:DDB_TABLE_NAME}",
        "ANALYST_NAME": "\${env:ANALYST_NAME}"
    }
}

with open(path, "w") as f:
    json.dump(data, f, indent=2)

print("✓ mcp-bridge-tool registered in", path)
PYEOF

# ── 4. Done ─────────────────────────────────────────────────────
echo ""
echo "✅ Installation complete!"
echo ""
echo "Next steps:"
echo "  1. Set environment variables in your shell profile (~/.zshrc or ~/.bashrc):"
echo "     export GITHUB_TOKEN=ghp_..."
echo "     export JIRA_BASE_URL=https://yourorg.atlassian.net"
echo "     export JIRA_EMAIL=you@yourorg.com"
echo "     export JIRA_API_TOKEN=..."
echo "     export AWS_REGION=ap-south-1"
echo "     export AWS_ACCESS_KEY_ID=..."
echo "     export AWS_SECRET_ACCESS_KEY=..."
echo "     export DDB_TABLE_NAME=mcp-mr-analysis"
echo "     export ANALYST_NAME=YourName"
echo ""
echo "  2. Restart VS Code"
echo "  3. In any VS Code workspace, open Copilot Chat (agent mode)"
echo "     — mcp-bridge-tool's 7 tools + 4 skills will be available globally"
echo ""
echo "  4. Use skills with: /full-mr-review, /team-dashboard, /search-ready-mrs, /review-and-report"
