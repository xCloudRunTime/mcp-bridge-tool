/**
 * slack-tool.ts
 * Posts formatted review notifications to Slack via Incoming Webhooks.
 *
 * Setup: Create an Incoming Webhook at https://api.slack.com/apps
 * and set SLACK_WEBHOOK_URL in your .env file.
 */

import axios from "axios";

// ---------------------------------------------------------------
// Types
// ---------------------------------------------------------------
export interface SlackReviewPayload {
  mr_title: string;
  mr_url: string;
  repo: string;
  mr_id: string;
  jira_key?: string | null;
  jira_url?: string | null;
  analyst: string;
  ready_to_merge: boolean;
  review_summary: string;
  platform: "github" | "gitlab";
}

export interface SlackPostResult {
  ok: boolean;
  channel?: string;
}

// ---------------------------------------------------------------
// Main Export
// ---------------------------------------------------------------
export async function postReviewToSlack(
  payload: SlackReviewPayload
): Promise<SlackPostResult> {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) {
    throw new Error("SLACK_WEBHOOK_URL .env mein set nahi hai.");
  }

  const blocks = buildSlackBlocks(payload);

  await axios.post(webhookUrl, { blocks }, {
    headers: { "Content-Type": "application/json" },
  });

  return { ok: true };
}

// ---------------------------------------------------------------
// Block Kit Message Builder
// ---------------------------------------------------------------
function buildSlackBlocks(payload: SlackReviewPayload): object[] {
  const verdict = payload.ready_to_merge
    ? ":white_check_mark: *READY TO MERGE*"
    : ":x: *NEEDS CHANGES*";

  const summarySnippet = payload.review_summary.length > 300
    ? payload.review_summary.slice(0, 300) + "..."
    : payload.review_summary;

  const platformLabel = payload.platform === "github" ? "GitHub PR" : "GitLab MR";

  const blocks: object[] = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: `AI Code Review: ${payload.mr_title.slice(0, 150)}`,
        emoji: true,
      },
    },
    {
      type: "section",
      fields: [
        {
          type: "mrkdwn",
          text: `*${platformLabel}:*\n<${payload.mr_url}|#${payload.mr_id} — ${payload.repo}>`,
        },
        {
          type: "mrkdwn",
          text: `*Analyst:*\n${payload.analyst}`,
        },
      ],
    },
  ];

  if (payload.jira_key) {
    const jiraText = payload.jira_url
      ? `<${payload.jira_url}|${payload.jira_key}>`
      : payload.jira_key;

    blocks.push({
      type: "section",
      fields: [
        {
          type: "mrkdwn",
          text: `*Jira Ticket:*\n${jiraText}`,
        },
        {
          type: "mrkdwn",
          text: `*Verdict:*\n${verdict}`,
        },
      ],
    });
  } else {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Verdict:* ${verdict}`,
      },
    });
  }

  blocks.push(
    { type: "divider" },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Review Summary:*\n${summarySnippet}`,
      },
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `Posted by mcp-bridge-tool • ${new Date().toUTCString()}`,
        },
      ],
    }
  );

  return blocks;
}
