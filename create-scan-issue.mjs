#!/usr/bin/env node
/**
 * create-scan-issue.mjs — Create a GitHub Issue with scan results
 * Usage: node create-scan-issue.mjs <scan-results.json>
 *
 * Reads the JSON output from scan-scheduled.mjs and creates a formatted
 * GitHub Issue using the GitHub API (via GITHUB_TOKEN env var).
 *
 * Environment variables:
 *   GITHUB_TOKEN — GitHub token with issues:write permission (provided by Actions)
 *   GITHUB_REPOSITORY — owner/repo (provided by Actions)
 */

import { readFileSync } from 'fs';

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPOSITORY = process.env.GITHUB_REPOSITORY;

function die(msg) {
  console.error(`Error: ${msg}`);
  process.exit(1);
}

// --- Parse args ---
const resultsFile = process.argv[2];
if (!resultsFile) die('Usage: node create-scan-issue.mjs <scan-results.json>');

// --- Read scan results ---
let results;
try {
  const raw = readFileSync(resultsFile, 'utf-8');
  results = JSON.parse(raw);
} catch (err) {
  die(`Failed to read scan results: ${err.message}`);
}

// --- Skip if no new offers ---
if (!results.newOffers || results.newOffers.length === 0) {
  console.log('No new offers found — skipping issue creation.');
  process.exit(0);
}

// --- Validate environment ---
if (!GITHUB_TOKEN) die('GITHUB_TOKEN environment variable is required');
if (!GITHUB_REPOSITORY) die('GITHUB_REPOSITORY environment variable is required');

// --- Build issue body ---
function buildIssueBody(results) {
  const lines = [];

  lines.push(`## Portal Scan Results — ${results.date}`);
  lines.push('');
  lines.push(`**${results.newOffers.length} new offer${results.newOffers.length === 1 ? '' : 's'}** found matching your filters.`);
  lines.push('');
  lines.push('### New Offers');
  lines.push('');
  lines.push('| Company | Role | Location | Link |');
  lines.push('|---------|------|----------|------|');
  for (const offer of results.newOffers) {
    const location = offer.location || 'N/A';
    lines.push(`| ${offer.company} | ${offer.title} | ${location} | [View](${offer.url}) |`);
  }

  lines.push('');
  lines.push('### Scan Summary');
  lines.push('');
  lines.push(`- Companies scanned: ${results.companiesScanned}`);
  lines.push(`- Total jobs checked: ${results.totalJobsFetched}`);
  lines.push(`- Filtered by title: ${results.filteredOffers}`);
  lines.push(`- Already seen: ${results.duplicateOffers}`);

  if (results.errors && results.errors.length > 0) {
    lines.push('');
    lines.push('### Errors');
    lines.push('');
    for (const err of results.errors) {
      lines.push(`- **${err.company}**: ${err.error}`);
    }
  }

  // Calculate next scan date (next Mon, Wed, or Fri)
  const nextScan = getNextScanDate();
  lines.push('');
  lines.push(`### Next Steps`);
  lines.push('');
  lines.push(`- Review the offers above and evaluate any that look promising`);
  lines.push(`- Run \`/career-ops pipeline\` to process new entries in pipeline.md`);
  lines.push(`- Next scheduled scan: **${nextScan}**`);

  lines.push('');
  lines.push('---');
  lines.push('*Automated scan via [GitHub Actions](../../actions) — Greenhouse API endpoints only (Level 2)*');

  return lines.join('\n');
}

function getNextScanDate() {
  const now = new Date();
  const scanDays = [1, 3, 5]; // Mon, Wed, Fri
  const currentDay = now.getUTCDay();

  for (const day of scanDays) {
    if (day > currentDay) {
      const diff = day - currentDay;
      const next = new Date(now);
      next.setUTCDate(next.getUTCDate() + diff);
      return next.toISOString().split('T')[0];
    }
  }

  // Wrap to next Monday
  const daysUntilMonday = (1 + 7 - currentDay) % 7 || 7;
  const next = new Date(now);
  next.setUTCDate(next.getUTCDate() + daysUntilMonday);
  return next.toISOString().split('T')[0];
}

// --- Create GitHub Issue ---
async function createIssue(title, body, labels) {
  const url = `https://api.github.com/repos/${GITHUB_REPOSITORY}/issues`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${GITHUB_TOKEN}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ title, body, labels }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    die(`GitHub API error ${response.status}: ${errorBody}`);
  }

  const issue = await response.json();
  return issue;
}

// --- Main ---
async function main() {
  const title = `\u{1F50D} Portal Scan \u{2014} ${results.date}: ${results.newOffers.length} new offer${results.newOffers.length === 1 ? '' : 's'} found`;
  const body = buildIssueBody(results);
  const labels = ['scan-results', 'automated'];

  console.log(`Creating issue: ${title}`);
  const issue = await createIssue(title, body, labels);
  console.log(`Issue created: ${issue.html_url}`);
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
