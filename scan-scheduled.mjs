#!/usr/bin/env node
/**
 * scan-scheduled.mjs — Lightweight scheduled scanner for GitHub Actions
 * Usage: node scan-scheduled.mjs [--dry-run] [--output=json|markdown]
 *
 * Scans configured Greenhouse API endpoints from portals.yml (or portals.example.yml)
 * and checks for new job listings not already in scan-history.tsv
 *
 * This is a subset of the full scan mode — it only uses Level 2 (API) scanning
 * since GitHub Actions can't run Playwright with browser rendering.
 */

import { readFileSync, writeFileSync, existsSync, appendFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// --- CLI args ---
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const outputFlag = args.find(a => a.startsWith('--output='));
const outputMode = outputFlag ? outputFlag.split('=')[1] : 'text';

// --- Paths ---
const PORTALS_PATH = join(__dirname, 'portals.yml');
const PORTALS_EXAMPLE_PATH = join(__dirname, 'templates/portals.example.yml');
const SCAN_HISTORY_PATH = join(__dirname, 'data/scan-history.tsv');
const PIPELINE_PATH = join(__dirname, 'data/pipeline.md');
const DATA_DIR = join(__dirname, 'data');

// --- Simple YAML parser (enough for portals.yml structure) ---
function parsePortalsYaml(text) {
  const result = { title_filter: { positive: [], negative: [], seniority_boost: [] }, tracked_companies: [] };

  let currentSection = null;
  let currentSubSection = null;
  let currentCompany = null;

  for (const rawLine of text.split('\n')) {
    const line = rawLine.replace(/\r$/, '');

    // Skip comments and empty lines
    if (/^\s*#/.test(line) || /^\s*$/.test(line)) continue;

    // Top-level sections
    if (/^title_filter:\s*$/.test(line)) { currentSection = 'title_filter'; currentSubSection = null; continue; }
    if (/^tracked_companies:\s*$/.test(line)) { currentSection = 'tracked_companies'; currentSubSection = null; continue; }
    if (/^search_queries:\s*$/.test(line)) { currentSection = 'search_queries'; currentSubSection = null; continue; }

    if (currentSection === 'title_filter') {
      if (/^\s+positive:\s*$/.test(line)) { currentSubSection = 'positive'; continue; }
      if (/^\s+negative:\s*$/.test(line)) { currentSubSection = 'negative'; continue; }
      if (/^\s+seniority_boost:\s*$/.test(line)) { currentSubSection = 'seniority_boost'; continue; }

      if (currentSubSection && /^\s+-\s+"(.+)"/.test(line)) {
        const match = line.match(/^\s+-\s+"(.+)"/);
        if (match) result.title_filter[currentSubSection].push(match[1]);
        continue;
      }
      if (currentSubSection && /^\s+-\s+'(.+)'/.test(line)) {
        const match = line.match(/^\s+-\s+'(.+)'/);
        if (match) result.title_filter[currentSubSection].push(match[1]);
        continue;
      }
    }

    if (currentSection === 'tracked_companies') {
      // New company entry
      if (/^\s+-\s+name:\s*(.+)/.test(line)) {
        const match = line.match(/^\s+-\s+name:\s*(.+)/);
        if (currentCompany) result.tracked_companies.push(currentCompany);
        currentCompany = { name: match[1].trim(), enabled: true };
        continue;
      }

      if (currentCompany) {
        if (/^\s+careers_url:\s*(.+)/.test(line)) {
          currentCompany.careers_url = line.match(/^\s+careers_url:\s*(.+)/)[1].trim();
        } else if (/^\s+api:\s*(.+)/.test(line)) {
          currentCompany.api = line.match(/^\s+api:\s*(.+)/)[1].trim();
        } else if (/^\s+enabled:\s*(.+)/.test(line)) {
          currentCompany.enabled = line.match(/^\s+enabled:\s*(.+)/)[1].trim() === 'true';
        } else if (/^\s+notes:\s*(.+)/.test(line)) {
          currentCompany.notes = line.match(/^\s+notes:\s*(.+)/)[1].trim().replace(/^["']|["']$/g, '');
        } else if (/^\s+scan_method:\s*(.+)/.test(line)) {
          currentCompany.scan_method = line.match(/^\s+scan_method:\s*(.+)/)[1].trim();
        } else if (/^\s+scan_query:\s*(.+)/.test(line)) {
          currentCompany.scan_query = line.match(/^\s+scan_query:\s*(.+)/)[1].trim().replace(/^'|'$/g, '');
        }
      }
    }
  }

  // Push last company
  if (currentCompany) result.tracked_companies.push(currentCompany);

  return result;
}

// --- Title filter ---
function matchesFilter(title, filter) {
  const lower = title.toLowerCase();

  // At least one positive keyword must match
  const hasPositive = filter.positive.some(kw => lower.includes(kw.toLowerCase()));
  if (!hasPositive) return false;

  // No negative keyword must match
  const hasNegative = filter.negative.some(kw => lower.includes(kw.toLowerCase()));
  if (hasNegative) return false;

  return true;
}

// --- Load scan history URLs ---
function loadSeenUrls() {
  const seen = new Set();
  if (existsSync(SCAN_HISTORY_PATH)) {
    const content = readFileSync(SCAN_HISTORY_PATH, 'utf-8');
    for (const line of content.split('\n')) {
      if (!line.trim() || line.startsWith('url\t')) continue;
      const url = line.split('\t')[0];
      if (url) seen.add(url);
    }
  }
  return seen;
}

// --- Load pipeline URLs ---
function loadPipelineUrls() {
  const seen = new Set();
  if (existsSync(PIPELINE_PATH)) {
    const content = readFileSync(PIPELINE_PATH, 'utf-8');
    const urlRegex = /https?:\/\/[^\s|)]+/g;
    let match;
    while ((match = urlRegex.exec(content)) !== null) {
      seen.add(match[0]);
    }
  }
  return seen;
}

// --- Fetch jobs from Greenhouse API ---
async function fetchGreenhouseJobs(apiUrl, companyName) {
  try {
    const response = await fetch(apiUrl);
    if (!response.ok) {
      return { error: `HTTP ${response.status}`, jobs: [] };
    }
    const data = await response.json();
    const jobs = (data.jobs || []).map(job => ({
      title: job.title,
      url: job.absolute_url,
      company: companyName,
      location: job.location ? job.location.name : 'Unknown',
    }));
    return { error: null, jobs };
  } catch (err) {
    return { error: err.message, jobs: [] };
  }
}

// --- Main ---
async function main() {
  const today = new Date().toISOString().split('T')[0];

  // Load portals config
  let portalsPath;
  if (existsSync(PORTALS_PATH)) {
    portalsPath = PORTALS_PATH;
  } else if (existsSync(PORTALS_EXAMPLE_PATH)) {
    portalsPath = PORTALS_EXAMPLE_PATH;
  } else {
    const errorResult = {
      date: today,
      dryRun,
      error: 'No portals configuration found (portals.yml or templates/portals.example.yml)',
      newOffers: [],
      filteredOffers: 0,
      duplicateOffers: 0,
      totalJobsFetched: 0,
      errors: [],
      companiesScanned: 0,
    };
    if (outputMode === 'json') {
      console.log(JSON.stringify(errorResult, null, 2));
    } else {
      console.error('Error: No portals configuration found');
    }
    process.exit(1);
  }

  const portalsText = readFileSync(portalsPath, 'utf-8');
  const config = parsePortalsYaml(portalsText);

  // Find companies with Greenhouse API endpoints
  const apiCompanies = config.tracked_companies.filter(c =>
    c.enabled && c.api && c.api.includes('boards-api.greenhouse.io')
  );

  if (apiCompanies.length === 0) {
    const emptyResult = {
      date: today,
      dryRun,
      newOffers: [],
      filteredOffers: 0,
      duplicateOffers: 0,
      totalJobsFetched: 0,
      errors: [],
      companiesScanned: 0,
      message: 'No Greenhouse API endpoints found in configuration',
    };
    if (outputMode === 'json') {
      console.log(JSON.stringify(emptyResult, null, 2));
    } else {
      console.log('No Greenhouse API endpoints found in configuration.');
    }
    process.exit(0);
  }

  // Load dedup sources
  const seenUrls = loadSeenUrls();
  const pipelineUrls = loadPipelineUrls();

  const newOffers = [];
  const filteredOffers = [];
  const duplicateOffers = [];
  const errors = [];

  if (outputMode === 'text') {
    console.log(`\nScheduled Portal Scan — ${today}`);
    console.log('='.repeat(40));
    console.log(`Scanning ${apiCompanies.length} Greenhouse API endpoints...\n`);
  }

  // Scan each API endpoint
  for (const company of apiCompanies) {
    if (outputMode === 'text') {
      process.stdout.write(`  ${company.name}...`);
    }

    const result = await fetchGreenhouseJobs(company.api, company.name);

    if (result.error) {
      errors.push({ company: company.name, error: result.error });
      if (outputMode === 'text') {
        console.log(` ERROR: ${result.error}`);
      }
      continue;
    }

    let newCount = 0;
    let filteredCount = 0;
    let dupCount = 0;

    for (const job of result.jobs) {
      // Check title filter
      if (!matchesFilter(job.title, config.title_filter)) {
        filteredOffers.push(job);
        filteredCount++;
        continue;
      }

      // Check dedup
      if (seenUrls.has(job.url) || pipelineUrls.has(job.url)) {
        duplicateOffers.push(job);
        dupCount++;
        continue;
      }

      newOffers.push(job);
      newCount++;
    }

    if (outputMode === 'text') {
      console.log(` ${result.jobs.length} jobs, ${newCount} new, ${filteredCount} filtered, ${dupCount} dups`);
    }
  }

  // Write results if not dry run
  if (!dryRun && newOffers.length > 0) {
    // Ensure data directory exists
    if (!existsSync(DATA_DIR)) {
      mkdirSync(DATA_DIR, { recursive: true });
    }

    // Append to scan-history.tsv
    const historyExists = existsSync(SCAN_HISTORY_PATH);
    if (!historyExists) {
      writeFileSync(SCAN_HISTORY_PATH, 'url\tfirst_seen\tportal\ttitle\tcompany\tstatus\n');
    }
    for (const offer of newOffers) {
      appendFileSync(SCAN_HISTORY_PATH,
        `${offer.url}\t${today}\tGreenhouse API\t${offer.title}\t${offer.company}\tadded\n`
      );
    }


    // Append to pipeline.md
    let pipelineContent = '';
    if (existsSync(PIPELINE_PATH)) {
      pipelineContent = readFileSync(PIPELINE_PATH, 'utf-8');
    }

    const pendingHeader = /^##\s*(Pendientes|Pending)/m;
    const newEntries = newOffers.map(o =>
      `- [ ] ${o.url} | ${o.company} | ${o.title}`
    ).join('\n');

    if (pendingHeader.test(pipelineContent)) {
      // Insert after the Pendientes/Pending header
      pipelineContent = pipelineContent.replace(pendingHeader, (match) =>
        `${match}\n${newEntries}`
      );
    } else {
      // Create the section
      pipelineContent += `\n## Pending\n\n${newEntries}\n`;
    }

    writeFileSync(PIPELINE_PATH, pipelineContent);
  }

  // Output results
  const resultObj = {
    date: today,
    dryRun,
    companiesScanned: apiCompanies.length,
    totalJobsFetched: newOffers.length + filteredOffers.length + duplicateOffers.length,
    newOffers: newOffers.map(o => ({ title: o.title, company: o.company, url: o.url, location: o.location })),
    filteredOffers: filteredOffers.length,
    duplicateOffers: duplicateOffers.length,
    errors,
  };

  if (outputMode === 'json') {
    console.log(JSON.stringify(resultObj, null, 2));
  } else if (outputMode === 'markdown') {
    console.log(formatMarkdown(resultObj));
  } else {
    // Text summary
    console.log(`\n${'='.repeat(40)}`);
    console.log(`Companies scanned: ${apiCompanies.length}`);
    console.log(`Total jobs fetched: ${resultObj.totalJobsFetched}`);
    console.log(`New offers: ${newOffers.length}`);
    console.log(`Filtered by title: ${filteredOffers.length}`);
    console.log(`Duplicates: ${duplicateOffers.length}`);
    console.log(`Errors: ${errors.length}`);

    if (newOffers.length > 0) {
      console.log(`\nNew offers:`);
      for (const o of newOffers) {
        console.log(`  + ${o.company} | ${o.title}`);
        console.log(`    ${o.url}`);
      }
    }

    if (dryRun) {
      console.log('\n(dry run — no files modified)');
    } else if (newOffers.length > 0) {
      console.log('\nResults written to data/scan-history.tsv and data/pipeline.md');
    }
  }
}

// --- Markdown formatter ---
function formatMarkdown(result) {
  const lines = [];
  lines.push(`# Portal Scan Results — ${result.date}`);
  lines.push('');

  if (result.newOffers.length === 0) {
    lines.push('No new offers found matching your filters.');
    lines.push('');
    lines.push(`- Companies scanned: ${result.companiesScanned}`);
    lines.push(`- Total jobs checked: ${result.totalJobsFetched}`);
    lines.push(`- Filtered by title: ${result.filteredOffers}`);
    lines.push(`- Already seen: ${result.duplicateOffers}`);
    return lines.join('\n');
  }

  lines.push(`**${result.newOffers.length} new offer${result.newOffers.length === 1 ? '' : 's'} found!**`);
  lines.push('');
  lines.push('| Company | Role | Link |');
  lines.push('|---------|------|------|');
  for (const offer of result.newOffers) {
    lines.push(`| ${offer.company} | ${offer.title} | [Apply](${offer.url}) |`);
  }

  lines.push('');
  lines.push('### Summary');
  lines.push('');
  lines.push(`- Companies scanned: ${result.companiesScanned}`);
  lines.push(`- Total jobs checked: ${result.totalJobsFetched}`);
  lines.push(`- Filtered by title: ${result.filteredOffers}`);
  lines.push(`- Already seen: ${result.duplicateOffers}`);

  if (result.errors.length > 0) {
    lines.push('');
    lines.push('### Errors');
    lines.push('');
    for (const err of result.errors) {
      lines.push(`- **${err.company}**: ${err.error}`);
    }
  }

  lines.push('');
  lines.push('---');
  lines.push('*Automated scan via GitHub Actions — only Greenhouse API endpoints (Level 2)*');

  return lines.join('\n');
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
