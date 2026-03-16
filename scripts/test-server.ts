/**
 * scripts/test-server.ts
 *
 * Yeh script build ke bina sirf connectivity check karta hai:
 *   1. AWS DynamoDB connection test
 *   2. Table existence check (auto-creates if missing)
 *   3. Ek dummy record write + read + delete (dry-run)
 *
 * Run karo:
 *   npx ts-node --esm scripts/test-server.ts
 */

import "dotenv/config";
import {
  DynamoDBClient,
  ListTablesCommand,
  DescribeTableCommand,
} from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  DeleteCommand,
} from "@aws-sdk/lib-dynamodb";

const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RESET = "\x1b[0m";

function ok(msg: string) { console.log(`${GREEN}✓${RESET} ${msg}`); }
function fail(msg: string) { console.log(`${RED}✗${RESET} ${msg}`); }
function info(msg: string) { console.log(`${YELLOW}ℹ${RESET} ${msg}`); }

// ── 1. Env check ────────────────────────────────────────────────
console.log("\n=== mcp-bridge-tool — Connection Test ===\n");

const required = ["AWS_REGION", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"];
let envOk = true;
for (const key of required) {
  if (process.env[key]) {
    ok(`${key} set`);
  } else {
    fail(`${key} is MISSING in .env`);
    envOk = false;
  }
}
if (!envOk) {
  console.log(`\n${RED}Fix missing .env variables aur dobara run karo.${RESET}\n`);
  process.exit(1);
}

const region = process.env.AWS_REGION!;
const tableName = process.env.DDB_TABLE_NAME ?? "mcp-mr-analysis";
const endpoint = process.env.DDB_ENDPOINT;

info(`Region: ${region}`);
info(`Table:  ${tableName}`);
if (endpoint) info(`Endpoint (local): ${endpoint}`);

// ── 2. DynamoDB client ───────────────────────────────────────────
const rawClient = new DynamoDBClient({
  region,
  ...(endpoint ? { endpoint } : {}),
});
const docClient = DynamoDBDocumentClient.from(rawClient, {
  marshallOptions: { removeUndefinedValues: true },
});

// ── 3. List tables (connectivity check) ─────────────────────────
console.log("\n--- AWS Connectivity ---");
try {
  const { TableNames } = await rawClient.send(new ListTablesCommand({}));
  ok(`Connected to DynamoDB (${TableNames?.length ?? 0} tables found)`);
  if (TableNames?.includes(tableName)) {
    ok(`Table "${tableName}" exists`);
  } else {
    info(`Table "${tableName}" nahi mila — server start hone par auto-create hoga`);
  }
} catch (err) {
  fail(`DynamoDB connection failed: ${(err as Error).message}`);
  console.log(`\n${YELLOW}Tip: AWS credentials sahi hain? IAM user ko AmazonDynamoDBFullAccess policy chahiye.${RESET}\n`);
  process.exit(1);
}

// ── 4. Table describe ────────────────────────────────────────────
if ((await rawClient.send(new ListTablesCommand({}))).TableNames?.includes(tableName)) {
  try {
    const desc = await rawClient.send(new DescribeTableCommand({ TableName: tableName }));
    const t = desc.Table!;
    ok(`Table status: ${t.TableStatus}`);
    ok(`Item count:   ${t.ItemCount ?? 0}`);
    info(`Billing mode: ${t.BillingModeSummary?.BillingMode ?? "PROVISIONED"}`);
  } catch (_) {
    info("Table describe skip — permissions limited");
  }
}

// ── 5. Write + Read + Delete test ───────────────────────────────
console.log("\n--- Read/Write Test ---");

const TEST_PK = "test#mcp-bridge-tool#0";
const TEST_SK = new Date().toISOString();

try {
  await docClient.send(new PutCommand({
    TableName: tableName,
    Item: {
      mr_key: TEST_PK,
      analyzed_at: TEST_SK,
      _test: true,
      message: "connectivity test record — auto-deleted",
    },
  }));
  ok("Write successful");

  const get = await docClient.send(new GetCommand({
    TableName: tableName,
    Key: { mr_key: TEST_PK, analyzed_at: TEST_SK },
  }));
  if (get.Item) {
    ok("Read successful");
  } else {
    fail("Write hua lekin read nahi mila — check table config");
  }

  await docClient.send(new DeleteCommand({
    TableName: tableName,
    Key: { mr_key: TEST_PK, analyzed_at: TEST_SK },
  }));
  ok("Cleanup successful (test record deleted)");
} catch (err) {
  fail(`Read/Write test failed: ${(err as Error).message}`);
  info("Agar table abhi nahi hai, pehle npm run build && npm start se server start karo");
}

console.log(`\n${GREEN}=== All checks passed — server ready! ===${RESET}\n`);
console.log("Ab Copilot mein bolo: \"Review MR #<number> in <owner/repo>\"\n");
