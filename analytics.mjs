#!/usr/bin/env node
/**
 * analytics.mjs — Parse tracker data and output analytics JSON
 *
 * Reads data/applications.md and outputs:
 * - Pipeline funnel counts
 * - Score distribution
 * - Status breakdown
 * - Stale application detection
 * - Top scored applications
 * - Application velocity
 *
 * Usage: node analytics.mjs [--json] [--summary]
 *
 * Flags:
 *   --json      Machine-readable JSON output
 *   --summary   Compact one-line summary
 *   (default)   Human-readable text output
 */

import { readFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';

const ROOT = new URL('.', import.meta.url).pathname;
const APPS_FILE = existsSync(join(ROOT, 'data/applications.md'))
  ? join(ROOT, 'data/applications.md')
  : join(ROOT, 'applications.md');
const REPORTS_DIR = join(ROOT, 'reports');

const JSON_FLAG = process.argv.includes('--json');
const SUMMARY_FLAG = process.argv.includes('--summary');

// --- Canonical status mapping (English) ---
const STATUS_NORMALIZE = {
  'evaluated': 'Evaluated',
  'evaluada': 'Evaluated',
  'applied': 'Applied',
  'aplicado': 'Applied',
  'aplicada': 'Applied',
  'enviada': 'Applied',
  'sent': 'Applied',
  'responded': 'Responded',
  'respondido': 'Responded',
  'interview': 'Interview',
  'entrevista': 'Interview',
  'offer': 'Offer',
  'oferta': 'Offer',
  'rejected': 'Rejected',
  'rechazado': 'Rejected',
  'rechazada': 'Rejected',
  'discarded': 'Discarded',
  'descartado': 'Discarded',
  'descartada': 'Discarded',
  'cerrada': 'Discarded',
  'cancelada': 'Discarded',
  'skip': 'SKIP',
  'no aplicar': 'SKIP',
  'no_aplicar': 'SKIP',
  'monitor': 'SKIP',
};

function normalizeStatus(raw) {
  const clean = raw.replace(/\*\*/g, '').replace(/\s+\d{4}-\d{2}-\d{2}.*$/, '').trim();
  const lower = clean.toLowerCase();
  return STATUS_NORMALIZE[lower] || clean;
}

function parseScore(raw) {
  const clean = raw.replace(/\*\*/g, '').trim();
  const m = clean.match(/([\d.]+)\/5/);
  return m ? parseFloat(m[1]) : null;
}

function parseDate(raw) {
  const trimmed = raw.trim();
  const m = trimmed.match(/(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

function daysBetween(dateStr1, dateStr2) {
  const d1 = new Date(dateStr1);
  const d2 = new Date(dateStr2);
  return Math.floor((d2 - d1) / (1000 * 60 * 60 * 24));
}

function getISOWeek(dateStr) {
  const d = new Date(dateStr);
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}

function getMonth(dateStr) {
  return dateStr.substring(0, 7); // YYYY-MM
}

// --- Parse applications.md ---
function parseTracker() {
  if (!existsSync(APPS_FILE)) {
    return [];
  }

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
      date: parseDate(parts[2]),
      company: parts[3],
      role: parts[4],
      score: parseScore(parts[5]),
      scoreRaw: parts[5],
      status: normalizeStatus(parts[6]),
      statusRaw: parts[6],
      pdf: parts[7],
      report: parts[8],
      notes: parts[9] || '',
    });
  }

  return entries;
}

// --- Parse report archetypes ---
function parseReportArchetypes() {
  const archetypes = {};

  if (!existsSync(REPORTS_DIR)) return archetypes;

  const files = readdirSync(REPORTS_DIR).filter(f => f.endsWith('.md') && f !== '.gitkeep');

  for (const file of files) {
    try {
      const content = readFileSync(join(REPORTS_DIR, file), 'utf-8');
      // Extract archetype from report header: **Archetype:** or **Arquetipo:**
      const archetypeMatch = content.match(/\*\*(?:Archetype|Arquetipo):\*\*\s*(.+)/i);
      // Extract report number from filename
      const numMatch = file.match(/^(\d+)/);
      if (archetypeMatch && numMatch) {
        archetypes[parseInt(numMatch[1])] = archetypeMatch[1].trim();
      }
    } catch {
      // Skip unreadable reports
    }
  }

  return archetypes;
}

// --- Build analytics ---
function buildAnalytics(entries) {
  const today = new Date().toISOString().split('T')[0];
  const total = entries.length;

  if (total === 0) {
    return {
      generated: today,
      total: 0,
      byStatus: {},
      scoreDistribution: { '1-2': 0, '2-3': 0, '3-4': 0, '4-5': 0 },
      avgScore: null,
      avgScoreByArchetype: {},
      topScored: [],
      staleApps: [],
      velocity: { byWeek: {}, byMonth: {} },
      funnel: {
        evaluatedToApplied: null,
        appliedToInterview: null,
        interviewToOffer: null,
      },
      message: 'No data yet — evaluate your first offer to get started.',
    };
  }

  // --- Status breakdown ---
  const byStatus = {};
  for (const e of entries) {
    byStatus[e.status] = (byStatus[e.status] || 0) + 1;
  }

  // --- Score distribution ---
  const scoreDistribution = { '1-2': 0, '2-3': 0, '3-4': 0, '4-5': 0 };
  const validScores = entries.filter(e => e.score !== null);
  for (const e of validScores) {
    if (e.score < 2) scoreDistribution['1-2']++;
    else if (e.score < 3) scoreDistribution['2-3']++;
    else if (e.score < 4) scoreDistribution['3-4']++;
    else scoreDistribution['4-5']++;
  }

  const avgScore = validScores.length > 0
    ? parseFloat((validScores.reduce((sum, e) => sum + e.score, 0) / validScores.length).toFixed(2))
    : null;

  // --- Archetype-based score averages ---
  const reportArchetypes = parseReportArchetypes();
  const scoresByArchetype = {};
  for (const e of validScores) {
    const archetype = reportArchetypes[e.num] || 'Unknown';
    if (!scoresByArchetype[archetype]) scoresByArchetype[archetype] = [];
    scoresByArchetype[archetype].push(e.score);
  }
  const avgScoreByArchetype = {};
  for (const [arch, scores] of Object.entries(scoresByArchetype)) {
    avgScoreByArchetype[arch] = {
      avg: parseFloat((scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(2)),
      count: scores.length,
    };
  }

  // --- Top scored ---
  const topScored = [...validScores]
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map(e => ({
      num: e.num,
      company: e.company,
      role: e.role,
      score: e.score,
      status: e.status,
    }));

  // --- Stale applications (Evaluated >7 days ago) ---
  const staleApps = entries
    .filter(e => {
      if (e.status !== 'Evaluated') return false;
      if (!e.date) return false;
      return daysBetween(e.date, today) > 7;
    })
    .map(e => ({
      num: e.num,
      company: e.company,
      role: e.role,
      score: e.score,
      date: e.date,
      daysSinceEval: daysBetween(e.date, today),
    }))
    .sort((a, b) => b.daysSinceEval - a.daysSinceEval);

  // --- Velocity ---
  const byWeek = {};
  const byMonth = {};
  for (const e of entries) {
    if (!e.date) continue;
    const week = getISOWeek(e.date);
    const month = getMonth(e.date);
    byWeek[week] = (byWeek[week] || 0) + 1;
    byMonth[month] = (byMonth[month] || 0) + 1;
  }

  // --- Funnel conversion rates ---
  const evaluated = (byStatus['Evaluated'] || 0);
  const applied = (byStatus['Applied'] || 0);
  const responded = (byStatus['Responded'] || 0);
  const interview = (byStatus['Interview'] || 0);
  const offer = (byStatus['Offer'] || 0);

  // For funnel calculations, count "downstream" statuses too
  // Someone in Interview was also Applied at some point
  const totalAppliedOrBeyond = applied + responded + interview + offer;
  const totalInterviewOrBeyond = interview + offer;

  const funnel = {
    evaluatedToApplied: total > 0
      ? parseFloat(((totalAppliedOrBeyond / total) * 100).toFixed(1))
      : null,
    appliedToInterview: totalAppliedOrBeyond > 0
      ? parseFloat(((totalInterviewOrBeyond / totalAppliedOrBeyond) * 100).toFixed(1))
      : null,
    interviewToOffer: totalInterviewOrBeyond > 0
      ? parseFloat(((offer / totalInterviewOrBeyond) * 100).toFixed(1))
      : null,
  };

  // --- Top archetype ---
  let topArchetype = null;
  let topArchetypeAvg = 0;
  for (const [arch, data] of Object.entries(avgScoreByArchetype)) {
    if (arch !== 'Unknown' && data.avg > topArchetypeAvg) {
      topArchetype = arch;
      topArchetypeAvg = data.avg;
    }
  }

  return {
    generated: today,
    total,
    byStatus,
    scoreDistribution,
    avgScore,
    avgScoreByArchetype,
    topArchetype: topArchetype ? { name: topArchetype, avgScore: topArchetypeAvg } : null,
    topScored,
    staleApps,
    velocity: { byWeek, byMonth },
    funnel,
  };
}

// --- Output formatters ---
function formatSummary(analytics) {
  if (analytics.total === 0) {
    console.log(analytics.message);
    return;
  }

  const s = analytics.byStatus;
  const topArch = analytics.topArchetype
    ? `${analytics.topArchetype.name} (avg ${analytics.topArchetype.avgScore}/5)`
    : 'N/A';

  const lines = [
    `Pipeline Summary — ${analytics.generated}`,
    '━━━━━━━━━━━━━━━━━━━━━━━━',
    `Total: ${analytics.total} | Avg Score: ${analytics.avgScore ?? 'N/A'}/5`,
    `Evaluated: ${s['Evaluated'] || 0} | Applied: ${s['Applied'] || 0} | Interview: ${s['Interview'] || 0} | Offer: ${s['Offer'] || 0}`,
    `Conversion: Applied→Interview ${analytics.funnel.appliedToInterview ?? 'N/A'}% | Interview→Offer ${analytics.funnel.interviewToOffer ?? 'N/A'}%`,
    `Top archetype: ${topArch}`,
    `Stale (>7d): ${analytics.staleApps.length} applications need attention`,
  ];

  console.log(lines.join('\n'));
}

function formatText(analytics) {
  if (analytics.total === 0) {
    console.log(analytics.message);
    return;
  }

  console.log(`\n📊 Pipeline Analytics — ${analytics.generated}\n`);
  console.log(`${'='.repeat(50)}\n`);

  // Summary
  console.log(`Total applications: ${analytics.total}`);
  console.log(`Average score: ${analytics.avgScore ?? 'N/A'}/5\n`);

  // Status breakdown
  console.log('Status Breakdown:');
  for (const [status, count] of Object.entries(analytics.byStatus).sort((a, b) => b[1] - a[1])) {
    const pct = ((count / analytics.total) * 100).toFixed(1);
    console.log(`  ${status}: ${count} (${pct}%)`);
  }

  // Funnel
  console.log('\nFunnel Conversion Rates:');
  if (analytics.funnel.evaluatedToApplied !== null)
    console.log(`  Evaluated → Applied: ${analytics.funnel.evaluatedToApplied}%`);
  if (analytics.funnel.appliedToInterview !== null)
    console.log(`  Applied → Interview: ${analytics.funnel.appliedToInterview}% (benchmark: 10-15%)`);
  if (analytics.funnel.interviewToOffer !== null)
    console.log(`  Interview → Offer: ${analytics.funnel.interviewToOffer}% (benchmark: 20-30%)`);

  // Score distribution
  console.log('\nScore Distribution:');
  for (const [bucket, count] of Object.entries(analytics.scoreDistribution)) {
    const bar = '█'.repeat(count);
    console.log(`  ${bucket}: ${bar} ${count}`);
  }

  // Top archetype
  if (analytics.topArchetype) {
    console.log(`\nTop archetype: ${analytics.topArchetype.name} (avg ${analytics.topArchetype.avgScore}/5)`);
  }

  // Archetype breakdown
  if (Object.keys(analytics.avgScoreByArchetype).length > 0) {
    console.log('\nScore by Archetype:');
    const sorted = Object.entries(analytics.avgScoreByArchetype)
      .sort((a, b) => b[1].avg - a[1].avg);
    for (const [arch, data] of sorted) {
      console.log(`  ${arch}: ${data.avg}/5 (${data.count} apps)`);
    }
  }

  // Top scored
  if (analytics.topScored.length > 0) {
    console.log('\nTop 5 Highest Scored:');
    for (const app of analytics.topScored) {
      console.log(`  #${app.num} ${app.company} — ${app.role} (${app.score}/5) [${app.status}]`);
    }
  }

  // Stale applications
  if (analytics.staleApps.length > 0) {
    console.log(`\n⚠️  Stale Applications (Evaluated >7 days, not applied):`);
    for (const app of analytics.staleApps) {
      console.log(`  #${app.num} ${app.company} — ${app.role} (${app.daysSinceEval}d ago, score ${app.score}/5)`);
    }
  }

  // Velocity
  const months = Object.entries(analytics.velocity.byMonth).sort();
  if (months.length > 0) {
    console.log('\nMonthly Velocity:');
    for (const [month, count] of months) {
      console.log(`  ${month}: ${count} applications`);
    }
  }

  console.log('');
}

// --- Main ---
const entries = parseTracker();
const analytics = buildAnalytics(entries);

if (JSON_FLAG) {
  console.log(JSON.stringify(analytics, null, 2));
} else if (SUMMARY_FLAG) {
  formatSummary(analytics);
} else {
  formatText(analytics);
}
