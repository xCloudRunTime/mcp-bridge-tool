/**
 * regression-tool.ts
 *
 * MR review findings se regression test cases generate karta hai.
 * Output: CSV (Google Sheets / Excel) + JSON
 *
 * Test case columns:
 *   Test ID | Category | Priority | Area | Test Description | Steps | Expected Result | Status | Source
 */

import type { AnalysisRecord } from "./db.js";

// ---------------------------------------------------------------
// Types
// ---------------------------------------------------------------
export interface RegressionTestCase {
  test_id: string;
  category: "Security" | "Billing" | "Functional" | "Config" | "Auth" | "Code Quality" | "Smoke";
  priority: "Critical" | "High" | "Medium" | "Low";
  area: string;                 // Which file / module / feature
  test_description: string;
  steps: string;
  expected_result: string;
  status: "To Test" | "Pass" | "Fail" | "Blocked";
  source: string;               // "BLOCKING" | "Non-Blocking" | "Changed File" | "Positive"
}

export interface RegressionSheet {
  mr_key: string;
  mr_title: string;
  jira_key: string | null;
  generated_at: string;
  total_tests: number;
  critical_count: number;
  high_count: number;
  test_cases: RegressionTestCase[];
  csv: string;
}

// ---------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------
function csvEscape(val: string): string {
  const s = val.replace(/"/g, '""');
  return `"${s}"`;
}

function toCsv(cases: RegressionTestCase[]): string {
  const headers = [
    "Test ID", "Category", "Priority", "Area",
    "Test Description", "Steps", "Expected Result", "Status", "Source",
  ];
  const rows = cases.map(tc => [
    tc.test_id, tc.category, tc.priority, tc.area,
    tc.test_description, tc.steps, tc.expected_result, tc.status, tc.source,
  ].map(csvEscape).join(","));
  return [headers.join(","), ...rows].join("\n");
}

function areaFromFile(filename: string): string {
  const parts = filename.split("/");
  const base = parts[parts.length - 1];
  // Infer area from filename/path
  if (/billing|subscription|plan/i.test(filename)) return "Billing";
  if (/auth|session|login|admin/i.test(filename)) return "Authentication";
  if (/queue|bull|worker|job/i.test(filename)) return "Background Jobs";
  if (/prisma|migration|schema/i.test(filename)) return "Database";
  if (/webhook/i.test(filename)) return "Webhooks";
  if (/onboard/i.test(filename)) return "Onboarding";
  if (/generate|description|ai/i.test(filename)) return "AI Generation";
  if (/env|config|toml|npmrc/i.test(filename)) return "Config";
  if (/test|spec/i.test(filename)) return "Tests";
  if (/route|api\./i.test(filename)) return "API Routes";
  return base.replace(/\.[^.]+$/, ""); // strip extension
}

// ---------------------------------------------------------------
// Section parser — splits review_summary into named sections
// ---------------------------------------------------------------
function parseSections(text: string): Record<string, string[]> {
  const sections: Record<string, string[]> = {
    blocking: [],
    nonblocking: [],
    positive: [],
  };
  let current: keyof typeof sections | null = null;

  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;

    const lower = line.toLowerCase();
    if (/blocking issue|must fix|critical|🚨/.test(lower)) { current = "blocking"; continue; }
    if (/non.blocking|non blocking|warning|⚠/.test(lower)) { current = "nonblocking"; continue; }
    if (/positive|well done|good|✅/.test(lower)) { current = "positive"; continue; }
    if (/^#/.test(line) || /^---/.test(line)) { current = null; continue; }

    const stripped = line.replace(/^[-*\d+.]+\s+/, "").replace(/\*\*/g, "").trim();
    if (stripped && current) sections[current].push(stripped);
  }
  return sections;
}

// ---------------------------------------------------------------
// Category + Priority inference from issue text
// ---------------------------------------------------------------
function inferCategory(text: string): RegressionTestCase["category"] {
  const t = text.toLowerCase();
  if (/security|api key|token|secret|credential|auth.*comment|unauthenticated/i.test(t)) return "Security";
  if (/billing|plan|interval|charge|subscription|payment/i.test(t)) return "Billing";
  if (/auth|session|login|permission|role/i.test(t)) return "Auth";
  if (/config|toml|npmrc|env|placeholder/i.test(t)) return "Config";
  if (/dead code|unused|gitignore|lint/i.test(t)) return "Code Quality";
  return "Functional";
}

function inferPriority(text: string, source: string): RegressionTestCase["priority"] {
  if (source === "BLOCKING") {
    if (/security|api key|unauthenticated|leak/i.test(text)) return "Critical";
    return "High";
  }
  if (/billing|charge|payment/i.test(text)) return "High";
  if (/config|placeholder|npmrc/i.test(text)) return "Medium";
  return "Low";
}

// ---------------------------------------------------------------
// Test case builders
// ---------------------------------------------------------------
function blockingToTest(issue: string, idx: number): RegressionTestCase {
  const category = inferCategory(issue);
  const test_id = `REG-${String(idx + 1).padStart(3, "0")}`;

  // Security: API key leaked
  if (/api key|gemini key|credential|secret/i.test(issue)) {
    return {
      test_id, category: "Security", priority: "Critical",
      area: "Repository / .env-example",
      test_description: "Verify no real credentials are committed in example files",
      steps: "1. Open .env-example\n2. Verify all values are placeholders (e.g. YOUR_KEY_HERE)\n3. Run git log to check history for exposed keys",
      expected_result: "No real API keys, tokens, or credentials present in any committed file",
      status: "To Test", source: "BLOCKING",
    };
  }
  // Security: unauthenticated route
  if (/unauthenticated|auth.*comment|publicly accessible/i.test(issue)) {
    return {
      test_id, category: "Security", priority: "Critical",
      area: "API Route / Authentication",
      test_description: "Verify AI generation API route requires authenticated Shopify session",
      steps: "1. Make a direct HTTP request to /api/ai-generate-description without session token\n2. Verify request is rejected\n3. Make request with valid session token\n4. Verify request succeeds",
      expected_result: "Unauthenticated requests return 401/403. Authenticated requests return 200.",
      status: "To Test", source: "BLOCKING",
    };
  }
  // Billing
  if (/billing|interval|onetime|every30|monthly/i.test(issue)) {
    return {
      test_id, category: "Billing", priority: "High",
      area: "Billing / Subscription",
      test_description: "Verify MONTHLY_PLAN charges recur every 30 days, not one-time",
      steps: "1. Subscribe to the monthly plan\n2. Check Shopify billing API for interval type\n3. Verify BillingInterval is Every30Days\n4. Verify charge recurs on next billing cycle",
      expected_result: "Monthly plan uses BillingInterval.Every30Days and recurs cyclically",
      status: "To Test", source: "BLOCKING",
    };
  }
  // Wrong Jira ticket
  if (/jira|ticket|wrong ticket/i.test(issue)) {
    return {
      test_id, category: "Functional", priority: "High",
      area: "Process / Traceability",
      test_description: "Verify MR is linked to the correct Jira story",
      steps: "1. Open PR description\n2. Verify Jira ticket ID references the correct Shopify AI feature story\n3. Open ticket and confirm scope matches PR changes",
      expected_result: "MR links to the correct feature ticket (not MCP tooling ticket).",
      status: "To Test", source: "BLOCKING",
    };
  }
  // Generic blocking fallback
  return {
    test_id, category, priority: "High",
    area: "General",
    test_description: `Verify fix for: ${issue.slice(0, 100)}`,
    steps: `1. Reproduce the reported issue\n2. Apply fix\n3. Verify issue no longer occurs`,
    expected_result: "Issue resolved without regression in related features",
    status: "To Test", source: "BLOCKING",
  };
}

function nonBlockingToTest(issue: string, idx: number, offset: number): RegressionTestCase {
  const test_id = `REG-${String(idx + offset + 1).padStart(3, "0")}`;
  const category = inferCategory(issue);
  const priority = inferPriority(issue, "Non-Blocking");

  if (/dead code|after return/i.test(issue)) {
    return {
      test_id, category: "Code Quality", priority: "Low",
      area: "cancel-subscription.ts",
      test_description: "Verify cancel subscription flow completes correctly (no dead code path executed)",
      steps: "1. Subscribe to a plan\n2. Cancel the subscription\n3. Verify cancellation succeeds and no unexpected side effects",
      expected_result: "Subscription cancelled successfully. Dead code after return does not execute.",
      status: "To Test", source: "Non-Blocking",
    };
  }
  if (/gemini.txt|gitignore/i.test(issue)) {
    return {
      test_id, category: "Config", priority: "Low",
      area: "Repository / .gitignore",
      test_description: "Verify AI-generated docs are excluded from version control",
      steps: "1. Check .gitignore for gemini.txt entry\n2. Run git status to confirm file is not tracked",
      expected_result: "gemini.txt is in .gitignore and not committed",
      status: "To Test", source: "Non-Blocking",
    };
  }
  if (/npmrc|auto-install|shamefully/i.test(issue)) {
    return {
      test_id, category: "Config", priority: "Medium",
      area: ".npmrc / Dependencies",
      test_description: "Verify npm install works correctly after .npmrc flag removal",
      steps: "1. Delete node_modules\n2. Run npm install\n3. Verify all dependencies install without errors\n4. Run the app and confirm no missing peer dependency warnings",
      expected_result: "Clean npm install with no errors or missing peer dependencies",
      status: "To Test", source: "Non-Blocking",
    };
  }
  if (/application_url|example.com|placeholder/i.test(issue)) {
    return {
      test_id, category: "Config", priority: "Medium",
      area: "Shopify App Config / .toml",
      test_description: "Verify shopify app toml has real application URL, not placeholder",
      steps: "1. Open shopify.app.ai-product-description.toml\n2. Verify application_url is set to real deployment URL",
      expected_result: "application_url points to the real deployed app URL, not https://example.com",
      status: "To Test", source: "Non-Blocking",
    };
  }
  if (/billing.request|cancel.*loader|leftover/i.test(issue)) {
    return {
      test_id, category: "Billing", priority: "Medium",
      area: "API Route / Billing",
      test_description: "Verify api.billing.request.tsx is not auto-cancelling subscriptions",
      steps: "1. Trigger a billing request\n2. Verify subscription is NOT immediately cancelled\n3. Check loader logic does not call cancel on load",
      expected_result: "Billing request route only creates/confirms subscriptions, does not auto-cancel",
      status: "To Test", source: "Non-Blocking",
    };
  }
  return {
    test_id, category, priority,
    area: "General",
    test_description: `Verify: ${issue.slice(0, 100)}`,
    steps: "1. Review the change\n2. Test related functionality\n3. Confirm no regression",
    expected_result: "Feature works correctly with no side effects",
    status: "To Test", source: "Non-Blocking",
  };
}

function changedFileToSmokeTest(filename: string, idx: number, offset: number): RegressionTestCase {
  const test_id = `REG-${String(idx + offset + 1).padStart(3, "0")}`;
  const area = areaFromFile(filename);
  const base = filename.split("/").pop()?.replace(/\.[^.]+$/, "") ?? filename;

  return {
    test_id,
    category: "Smoke",
    priority: "Medium",
    area,
    test_description: `Smoke test: ${base} — verify core functionality still works after change`,
    steps: `1. Navigate to / trigger the ${area} feature\n2. Verify basic happy path works\n3. Check no console errors or crashes`,
    expected_result: `${area} feature works correctly end-to-end`,
    status: "To Test",
    source: "Changed File",
  };
}

// ---------------------------------------------------------------
// Main Export
// ---------------------------------------------------------------
export function generateRegressionSheet(record: AnalysisRecord): RegressionSheet {
  const sections = parseSections(record.review_summary);
  const testCases: RegressionTestCase[] = [];

  // 1. Blocking issues → Critical/High test cases
  sections.blocking.forEach((issue, i) => {
    testCases.push(blockingToTest(issue, i));
  });

  // 2. Non-blocking issues → Medium/Low test cases
  const blockingCount = sections.blocking.length;
  sections.nonblocking.forEach((issue, i) => {
    testCases.push(nonBlockingToTest(issue, i, blockingCount));
  });

  // 3. Changed files → Smoke tests (deduplicate by area)
  const changedFiles: string[] = record.mr_snapshot?.changed_files?.map(f => f.filename) ?? [];
  const seenAreas = new Set<string>();
  const smokeOffset = testCases.length;
  let smokeIdx = 0;

  for (const filename of changedFiles) {
    // Skip config/lock/generated files
    if (/package-lock|yarn.lock|\.snap$|migration.*\.sql$|\.prisma$/i.test(filename)) continue;
    const area = areaFromFile(filename);
    if (seenAreas.has(area)) continue;
    seenAreas.add(area);
    testCases.push(changedFileToSmokeTest(filename, smokeIdx++, smokeOffset));
  }

  const critical = testCases.filter(t => t.priority === "Critical").length;
  const high = testCases.filter(t => t.priority === "High").length;

  return {
    mr_key: record.mr_key,
    mr_title: record.mr_title,
    jira_key: record.jira_key,
    generated_at: new Date().toISOString(),
    total_tests: testCases.length,
    critical_count: critical,
    high_count: high,
    test_cases: testCases,
    csv: toCsv(testCases),
  };
}
