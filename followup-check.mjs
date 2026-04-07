#!/usr/bin/env node
/**
 * followup-check.mjs — Scan tracker for applications needing follow-up
 *
 * Usage: node followup-check.mjs [--json] [--days=7]
 *
 * Reads data/applications.md and data/followup-log.tsv
 * Outputs applications that need follow-up based on age thresholds
 *
 * Thresholds (default):
 *   Applied   > 7 days
 *   Interview > 5 days
 *   Responded > 3 days
 *   Evaluated > 14 days
 *
 * Flags:
 *   --json     Output machine-readable JSON
 *   --days=N   Override ALL thresholds with a single value
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const CAREER_OPS = new URL('.', import.meta.url).pathname;
const APPS_FILE = existsSync(join(CAREER_OPS, 'data/applications.md'))
  ? join(CAREER_OPS, 'data/applications.md')
  : join(CAREER_OPS, 'applications.md');
const FOLLOWUP_LOG = join(CAREER_OPS, 'data/followup-log.tsv');

// --- Parse CLI flags ---
const args = process.argv.slice(2);
const JSON_OUTPUT = args.includes('--json');
const daysFlag = args.find(a => a.startsWith('--days='));
const daysOverride = daysFlag ? parseInt(daysFlag.split('=')[1], 10) : null;
if (daysOverride !== null && isNaN(daysOverride)) {
  console.error('Error: --days= requires a numeric value');
  process.exit(1);
}

// --- Thresholds (days since last activity) ---
const THRESHOLDS = {
  'Applied':   daysOverride ?? 7,
  'Interview': daysOverride ?? 5,
  'Responded': daysOverride ?? 3,
  'Evaluated': daysOverride ?? 14,
};

// Terminal statuses — excluded from follow-up checks
const TERMINAL = new Set([
  'offer', 'rejected', 'discarded', 'skip',
  // Spanish equivalents
  'oferta', 'rechazado', 'descartado', 'no aplicar',
]);

// Status normalization: map Spanish/alias → English canonical
const STATUS_MAP = {
  'aplicado': 'Applied',
  'applied': 'Applied',
  'enviada': 'Applied',
  'aplicada': 'Applied',
  'sent': 'Applied',
  'entrevista': 'Interview',
  'interview': 'Interview',
  'respondido': 'Responded',
  'responded': 'Responded',
  'evaluada': 'Evaluated',
  'evaluated': 'Evaluated',
  'condicional': 'Evaluated',
  'hold': 'Evaluated',
};

function normalizeStatus(raw) {
  const clean = raw.replace(/\*\*/g, '').trim().toLowerCase();
  return STATUS_MAP[clean] || null;
}

function daysBetween(dateStr, now) {
  const d = new Date(dateStr + 'T00:00:00Z');
  if (isNaN(d.getTime())) return -1;
  return Math.floor((now - d) / (1000 * 60 * 60 * 24));
}

// --- Parse applications.md ---
function parseApplications() {
  if (!existsSync(APPS_FILE)) return [];

  const content = readFileSync(APPS_FILE, 'utf-8');
  const lines = content.split('\n');
  const entries = [];

  for (const line of lines) {
    if (!line.startsWith('|')) continue;
    const parts = line.split('|').map(s => s.trim());
    if (parts.length < 9) continue;
    const num = parseInt(parts[1]);
    if (isNaN(num)) continue;

    entries.push({
      num,
      date: parts[2],
      company: parts[3],
      role: parts[4],
      score: parts[5],
      status: parts[6],
      notes: parts[9] || '',
    });
  }

  return entries;
}

// --- Parse followup-log.tsv ---
function parseFollowupLog() {
  if (!existsSync(FOLLOWUP_LOG)) return new Map();

  const content = readFileSync(FOLLOWUP_LOG, 'utf-8');
  const lines = content.split('\n').filter(l => l.trim());
  const logMap = new Map(); // app_num → most recent date

  for (const line of lines) {
    const parts = line.split('\t');
    if (parts.length < 2) continue;
    const appNum = parseInt(parts[0]);
    if (isNaN(appNum)) continue; // skip header

    const date = parts[1];
    if (!logMap.has(appNum) || date > logMap.get(appNum)) {
      logMap.set(appNum, date);
    }
  }

  return logMap;
}

// --- Main ---
const now = new Date();
const today = now.toISOString().slice(0, 10);
const applications = parseApplications();
const followupLog = parseFollowupLog();

if (applications.length === 0) {
  if (JSON_OUTPUT) {
    console.log(JSON.stringify({ date: today, urgent: [], dueSoon: [], onTrack: [], summary: { needFollowUp: 0, onTrack: 0, stale: 0 } }, null, 2));
  } else {
    console.log('\nNo applications found. Nothing to check.\n');
  }
  process.exit(0);
}

const urgent = [];
const dueSoon = [];
const onTrack = [];

for (const app of applications) {
  const rawStatus = app.status.replace(/\*\*/g, '').trim().toLowerCase();

  // Skip terminal statuses
  if (TERMINAL.has(rawStatus)) continue;

  const normalizedStatus = normalizeStatus(app.status);
  if (!normalizedStatus) continue; // Unknown status, skip

  const threshold = THRESHOLDS[normalizedStatus];
  if (threshold == null) continue; // No threshold for this status

  // Determine last activity date
  const logDate = followupLog.get(app.num);
  const lastActivityDate = logDate && logDate > app.date ? logDate : app.date;
  const days = daysBetween(lastActivityDate, now);

  if (days < 0) continue; // Invalid date

  const entry = {
    num: app.num,
    company: app.company,
    role: app.role,
    status: normalizedStatus,
    days,
    threshold,
    lastActivity: lastActivityDate,
    score: app.score,
  };

  if (days > threshold * 2) {
    // Way overdue
    entry.urgency = 'urgent';
    urgent.push(entry);
  } else if (days > threshold) {
    // Past threshold
    entry.urgency = 'due-soon';
    dueSoon.push(entry);
  } else {
    entry.urgency = 'on-track';
    onTrack.push(entry);
  }
}

// Sort by days descending (most overdue first)
urgent.sort((a, b) => b.days - a.days);
dueSoon.sort((a, b) => b.days - a.days);
onTrack.sort((a, b) => b.days - a.days);

// --- Output ---
if (JSON_OUTPUT) {
  const result = {
    date: today,
    thresholds: THRESHOLDS,
    urgent,
    dueSoon,
    onTrack,
    summary: {
      needFollowUp: urgent.length + dueSoon.length,
      onTrack: onTrack.length,
      stale: urgent.filter(e => e.status === 'Evaluated').length,
    },
  };
  console.log(JSON.stringify(result, null, 2));
} else {
  const SUGGESTIONS = {
    'Applied': 'LinkedIn message to hiring manager',
    'Interview': 'Thank-you / check-in email',
    'Responded': 'Reply to their message',
    'Evaluated': 'Decide: apply or discard',
  };

  console.log(`\nFollow-up Report — ${today}`);
  console.log('━'.repeat(40));

  if (urgent.length > 0) {
    console.log('\n🔴 Urgent (overdue):');
    for (const e of urgent) {
      console.log(`  - #${e.num} ${e.company} — ${e.role} | ${e.status} ${e.days} days ago | Last activity: ${e.lastActivity}`);
      console.log(`    → Suggested: ${SUGGESTIONS[e.status] || 'Follow up'}`);
    }
  }

  if (dueSoon.length > 0) {
    console.log('\n🟡 Due soon:');
    for (const e of dueSoon) {
      console.log(`  - #${e.num} ${e.company} — ${e.role} | ${e.status} ${e.days} days ago`);
      console.log(`    → Suggested: ${SUGGESTIONS[e.status] || 'Follow up'}`);
    }
  }

  if (onTrack.length > 0) {
    console.log('\n🟢 On track:');
    for (const e of onTrack) {
      console.log(`  - #${e.num} ${e.company} — ${e.role} | ${e.status} ${e.days} days ago | Within normal window`);
    }
  }

  if (urgent.length === 0 && dueSoon.length === 0 && onTrack.length === 0) {
    console.log('\nNo active applications to check.');
  }

  const needFollowUp = urgent.length + dueSoon.length;
  const stale = urgent.filter(e => e.status === 'Evaluated').length;
  console.log(`\n📊 Summary: ${needFollowUp} need follow-up, ${onTrack.length} on track, ${stale} stale (consider discarding)\n`);
}
