/**
 * sheets-tool.ts
 * Exports MR analysis data and regression test cases to Google Sheets.
 *
 * Setup:
 *   1. Create a Google Cloud project and enable the Sheets API.
 *   2. Create a Service Account, download the JSON key.
 *   3. Share your target Google Sheet with the service account email.
 *   4. Set GOOGLE_SERVICE_ACCOUNT_JSON and GOOGLE_SHEET_ID in .env.
 *
 * Google Sheets API v4 docs: https://developers.google.com/sheets/api
 */

import { google } from "googleapis";
import type { AnalysisRecord } from "./db.js";
import type { RegressionSheet } from "./regression-tool.js";

// ---------------------------------------------------------------
// Types
// ---------------------------------------------------------------
export type ExportMode = "regression_tests" | "team_dashboard";

export interface SheetsExportResult {
  spreadsheetId: string;
  sheetTitle: string;
  updatedRange: string;
  rowsWritten: number;
}

// ---------------------------------------------------------------
// Auth Helper
// ---------------------------------------------------------------
function getAuth() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    throw new Error(
      "GOOGLE_SERVICE_ACCOUNT_JSON .env mein set nahi hai. " +
      "Service account JSON ka path ya JSON string dalo."
    );
  }

  let credentials: object;
  try {
    credentials = JSON.parse(raw);
  } catch {
    throw new Error(
      "GOOGLE_SERVICE_ACCOUNT_JSON valid JSON nahi hai. " +
      "Service account key file ka content paste karo."
    );
  }

  return new google.auth.GoogleAuth({
    credentials,
    scopes: [
      "https://www.googleapis.com/auth/spreadsheets",
    ],
  });
}

// ---------------------------------------------------------------
// Main Export: Regression Tests → Google Sheets
// ---------------------------------------------------------------
export async function exportRegressionToSheets(
  sheet: RegressionSheet,
  spreadsheetId?: string
): Promise<SheetsExportResult> {
  const sheetId = spreadsheetId ?? process.env.GOOGLE_SHEET_ID;
  if (!sheetId) {
    throw new Error("GOOGLE_SHEET_ID .env mein set nahi hai.");
  }

  const auth = getAuth();
  const sheets = google.sheets({ version: "v4", auth });

  const sheetTitle = `Regression-${sheet.mr_key.replace(/[^a-zA-Z0-9-]/g, "_").slice(0, 50)}`;

  // Ensure the tab exists (create if not)
  await ensureSheetTab(sheets, sheetId, sheetTitle);

  // Build header + data rows
  const header = [
    "Test ID", "Category", "Priority", "Area",
    "Test Description", "Steps", "Expected Result", "Status", "Source",
    "MR Key", "Jira Key",
  ];

  const rows = sheet.test_cases.map((tc) => [
    tc.test_id,
    tc.category,
    tc.priority,
    tc.area,
    tc.test_description,
    tc.steps,
    tc.expected_result,
    tc.status,
    tc.source,
    sheet.mr_key,
    sheet.jira_key ?? "",
  ]);

  const values = [header, ...rows];

  const updateRes = await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId,
    range: `${sheetTitle}!A1`,
    valueInputOption: "RAW",
    requestBody: { values },
  });

  return {
    spreadsheetId: sheetId,
    sheetTitle,
    updatedRange: updateRes.data.updatedRange ?? `${sheetTitle}!A1`,
    rowsWritten: rows.length,
  };
}

// ---------------------------------------------------------------
// Main Export: Team Dashboard → Google Sheets
// ---------------------------------------------------------------
export async function exportDashboardToSheets(
  records: AnalysisRecord[],
  spreadsheetId?: string
): Promise<SheetsExportResult> {
  const sheetId = spreadsheetId ?? process.env.GOOGLE_SHEET_ID;
  if (!sheetId) {
    throw new Error("GOOGLE_SHEET_ID .env mein set nahi hai.");
  }

  const auth = getAuth();
  const sheets = google.sheets({ version: "v4", auth });

  const sheetTitle = "Team Dashboard";
  await ensureSheetTab(sheets, sheetId, sheetTitle);

  const header = [
    "MR Key", "MR Title", "Jira Key", "Jira Summary",
    "Analyst", "Ready to Merge", "Analyzed At", "Review Snippet",
  ];

  const rows = records.map((r) => [
    r.mr_key,
    r.mr_title ?? "",
    r.jira_key ?? "",
    r.jira_summary ?? "",
    r.analyst,
    r.ready_to_merge ? "YES" : "NO",
    r.analyzed_at,
    r.review_summary.slice(0, 300),
  ]);

  const values = [header, ...rows];

  const updateRes = await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId,
    range: `${sheetTitle}!A1`,
    valueInputOption: "RAW",
    requestBody: { values },
  });

  return {
    spreadsheetId: sheetId,
    sheetTitle,
    updatedRange: updateRes.data.updatedRange ?? `${sheetTitle}!A1`,
    rowsWritten: rows.length,
  };
}

// ---------------------------------------------------------------
// Helper: Ensure a sheet tab exists
// ---------------------------------------------------------------
async function ensureSheetTab(
  sheets: ReturnType<typeof google.sheets>,
  spreadsheetId: string,
  title: string
): Promise<void> {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const exists = meta.data.sheets?.some(
    (s) => s.properties?.title === title
  );

  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            addSheet: {
              properties: { title },
            },
          },
        ],
      },
    });
  }
}
