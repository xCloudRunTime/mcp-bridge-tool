#!/usr/bin/env bash
# =============================================================
# mcp-bridge-tool — First-Time Setup Script
# Usage:  bash scripts/setup.sh
# =============================================================
set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

ok()   { echo -e "${GREEN}✓${NC} $1"; }
fail() { echo -e "${RED}✗${NC} $1"; exit 1; }
info() { echo -e "${YELLOW}ℹ${NC} $1"; }
step() { echo -e "\n${BLUE}── $1 ──${NC}"; }

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR"

echo ""
echo "================================================="
echo "  mcp-bridge-tool — Setup"
echo "================================================="

# ── Step 1: Node.js version check ───────────────────────────
step "1. Prerequisites Check"

NODE_VERSION=$(node -v 2>/dev/null | sed 's/v//' | cut -d. -f1)
if [[ -z "$NODE_VERSION" ]]; then
  fail "Node.js nahi mila. https://nodejs.org se install karo (v18+)."
fi
if [[ "$NODE_VERSION" -lt 18 ]]; then
  fail "Node.js v18+ chahiye. Current: v$NODE_VERSION"
fi
ok "Node.js v$(node -v | sed 's/v//')"

if ! command -v npm &>/dev/null; then
  fail "npm nahi mila."
fi
ok "npm v$(npm -v)"

# Docker optional (only for local DDB)
if command -v docker &>/dev/null; then
  ok "Docker available (local DynamoDB ke liye)"
else
  info "Docker nahi mila — real AWS DynamoDB use karna hoga"
fi

# ── Step 2: npm install ──────────────────────────────────────
step "2. Installing Dependencies"
npm install --silent
ok "Dependencies installed"

# ── Step 3: .env setup ──────────────────────────────────────
step "3. Environment Setup"

if [[ -f ".env" ]]; then
  info ".env already exists — skipping copy"
else
  cp .env.example .env
  ok ".env created from template"
fi

# Check which required vars are missing
MISSING=()
while IFS= read -r line; do
  # Skip comments and empty lines
  [[ "$line" =~ ^#.*$ || -z "$line" ]] && continue
  # Skip optional/commented vars
  [[ "$line" =~ ^#.* ]] && continue
  
  KEY=$(echo "$line" | cut -d= -f1)
  VAL=$(echo "$line" | cut -d= -f2-)
  
  # Check if it's still the placeholder value
  if [[ "$VAL" == *"xxxx"* || "$VAL" == *"EXAMPLE"* || "$VAL" == *"your-company"* || "$VAL" == *"you@"* ]]; then
    MISSING+=("$KEY")
  fi
done < .env

if [[ ${#MISSING[@]} -gt 0 ]]; then
  echo ""
  info "Yeh .env variables abhi bhi placeholder hain — update karo:"
  for key in "${MISSING[@]}"; do
    echo -e "   ${YELLOW}$key${NC}"
  done
  echo ""
  echo -e "   ${BLUE}.env file open karo:${NC} code .env"
else
  ok "All .env variables set"
fi

# ── Step 4: Build ────────────────────────────────────────────
step "4. Building TypeScript"
npm run build
ok "Build successful → dist/"

# ── Step 5: Local DynamoDB (optional) ───────────────────────
step "5. Local DynamoDB (Optional)"

if command -v docker &>/dev/null; then
  read -r -p "   Local DynamoDB Docker container start karna chahte ho? (y/N) " yn
  case "$yn" in
    [yY]*)
      docker compose up -d 2>/dev/null || docker-compose up -d
      ok "Local DynamoDB started at localhost:8000"
      ok "DynamoDB Admin UI: http://localhost:8001"
      echo ""
      info "Apni .env mein yeh set karo:"
      echo "   DDB_ENDPOINT=http://localhost:8000"
      echo "   AWS_REGION=local"
      echo "   AWS_ACCESS_KEY_ID=local"
      echo "   AWS_SECRET_ACCESS_KEY=local"
      ;;
    *)
      info "Skipped — real AWS DynamoDB use hoga"
      ;;
  esac
else
  info "Docker nahi hai — real AWS credentials use karo"
fi

# ── Step 6: Summary ──────────────────────────────────────────
echo ""
echo "================================================="
echo -e "  ${GREEN}Setup Complete!${NC}"
echo "================================================="
echo ""
echo "  Agle steps:"
echo ""
echo "  1. .env mein real API keys bharo:"
echo "     code .env"
echo ""
echo "  2. DynamoDB connection test karo:"
echo "     npm run test:ddb"
echo ""
echo "  3. VS Code mein Copilot chat kholein aur type karo:"
echo "     /mr-review  →  MR #42 in owner/repo"
echo ""
echo "  4. Team dashboard:"
echo "     /team-dashboard"
echo ""
