#!/usr/bin/env node

/**
 * generate-text.mjs — Generate plain-text CV for web form paste
 *
 * Usage:
 *   node generate-text.mjs <input.html> <output.txt>
 *
 * Strips HTML and produces a clean plain-text version of the CV
 * optimized for pasting into application form text areas.
 */

import { readFile, writeFile } from 'fs/promises';
import { resolve } from 'path';

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);

if (args.length < 2) {
  console.error('Usage: node generate-text.mjs <input.html> <output.txt>');
  process.exit(1);
}

const inputPath = resolve(args[0]);
const outputPath = resolve(args[1]);

// ---------------------------------------------------------------------------
// HTML helpers
// ---------------------------------------------------------------------------

/** Decode common HTML entities */
function decodeEntities(text) {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&mdash;/g, '\u2014')
    .replace(/&ndash;/g, '\u2013')
    .replace(/&rsquo;/g, "'")
    .replace(/&lsquo;/g, "'")
    .replace(/&rdquo;/g, '"')
    .replace(/&ldquo;/g, '"');
}

/** Strip tags but preserve structure */
function stripTags(html) {
  return html.replace(/<[^>]+>/g, '').trim();
}

/** Extract href from an <a> tag */
function extractHref(html) {
  const m = html.match(/href="([^"]+)"/i);
  return m ? m[1] : null;
}

/** Extract text content of elements matching a class */
function getByClass(html, className) {
  const regex = new RegExp(
    `<[^>]+class="[^"]*${className}[^"]*"[^>]*>([\\s\\S]*?)</(?:div|span|p)>`,
    'gi'
  );
  const results = [];
  let m;
  while ((m = regex.exec(html)) !== null) {
    results.push(m[1]);
  }
  return results;
}

/** Extract <li> contents */
function extractListItems(html) {
  const items = [];
  const regex = /<li[^>]*>([\s\S]*?)<\/li>/gi;
  let m;
  while ((m = regex.exec(html)) !== null) {
    const text = stripTags(m[1]).trim();
    if (text) items.push(text);
  }
  return items;
}

// ---------------------------------------------------------------------------
// Section parsers (same structure as generate-docx.mjs)
// ---------------------------------------------------------------------------

function extractHeader(html) {
  const nameMatch = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const name = nameMatch ? stripTags(nameMatch[1]) : '';

  const contactRowMatch = html.match(
    /<div[^>]*class="[^"]*contact-row[^"]*"[^>]*>([\s\S]*?)<\/div>/i
  );
  const contactParts = [];
  if (contactRowMatch) {
    const raw = contactRowMatch[1];
    const parts = raw.split(/<span[^>]*class="[^"]*separator[^"]*"[^>]*>[^<]*<\/span>/i);
    for (const part of parts) {
      // For links, show both text and URL
      const href = extractHref(part);
      const text = stripTags(part).trim();
      if (text) {
        contactParts.push(href && href !== text ? `${text} (${href})` : text);
      }
    }
  }
  return { name, contactParts };
}

function extractSections(html) {
  const sections = [];
  const sectionStartRegex = /<div[^>]*class="[^"]*\bsection\b[^"]*"[^>]*>/gi;
  let match;
  while ((match = sectionStartRegex.exec(html)) !== null) {
    const startIdx = match.index + match[0].length;
    // Track nested divs to find the matching closing tag
    let depth = 1;
    let i = startIdx;
    while (i < html.length && depth > 0) {
      const openTag = html.indexOf('<div', i);
      const closeTag = html.indexOf('</div>', i);
      if (closeTag === -1) break;
      if (openTag !== -1 && openTag < closeTag) {
        depth++;
        i = openTag + 4;
      } else {
        depth--;
        if (depth === 0) {
          const content = html.substring(startIdx, closeTag);
          const titleMatch = content.match(
            /<div[^>]*class="[^"]*section-title[^"]*"[^>]*>([\s\S]*?)<\/div>/i
          );
          const title = titleMatch ? stripTags(titleMatch[1]).trim() : '';
          if (title) sections.push({ title, content });
        }
        i = closeTag + 6;
      }
    }
  }
  return sections;
}

// ---------------------------------------------------------------------------
// Text rendering
// ---------------------------------------------------------------------------

function renderSection(section) {
  const lines = [];
  const title = section.title;
  const titleUpper = title.toUpperCase();
  const content = section.content;

  // Section separator
  lines.push('');
  lines.push('='.repeat(title.length > 0 ? Math.max(title.length, 40) : 40));
  lines.push(title.toUpperCase());
  lines.push('='.repeat(title.length > 0 ? Math.max(title.length, 40) : 40));
  lines.push('');

  const isExperience = /experience|experiencia/i.test(titleUpper);
  const isSummary = /summary|resumen/i.test(titleUpper);
  const isCompetencies = /competenc/i.test(titleUpper);
  const isProjects = /project|proyecto/i.test(titleUpper);
  const isEducation = /education|formaci/i.test(titleUpper);
  const isCertifications = /certific/i.test(titleUpper);
  const isSkills = /skill|competencia/i.test(titleUpper) && !isCompetencies;

  if (isSummary) {
    const texts = getByClass(content, 'summary-text');
    const text = texts.map((t) => decodeEntities(stripTags(t))).join('\n').trim();
    if (text) lines.push(text);
  } else if (isCompetencies) {
    const tags = getByClass(content, 'competency-tag')
      .map((t) => decodeEntities(stripTags(t)).trim())
      .filter(Boolean);
    if (tags.length > 0) {
      lines.push(tags.join('  |  '));
    }
  } else if (isExperience) {
    const jobRegex =
      /<div[^>]*class="job"[^>]*>([\s\S]*?)(?=<div[^>]*class="job"[^>]*>|$)/gi;
    let m;
    while ((m = jobRegex.exec(content)) !== null) {
      const block = m[1];
      const company = decodeEntities(
        stripTags(
          (block.match(/<[^>]*class="[^"]*job-company[^"]*"[^>]*>([\s\S]*?)<\//) || [])[1] || ''
        )
      );
      const period = decodeEntities(
        stripTags(
          (block.match(/<[^>]*class="[^"]*job-period[^"]*"[^>]*>([\s\S]*?)<\//) || [])[1] || ''
        )
      );
      const role = decodeEntities(
        stripTags(
          (block.match(/<[^>]*class="[^"]*job-role[^"]*"[^>]*>([\s\S]*?)<\//) || [])[1] || ''
        )
      );
      const location = decodeEntities(
        stripTags(
          (block.match(/<[^>]*class="[^"]*job-location[^"]*"[^>]*>([\s\S]*?)<\//) || [])[1] || ''
        )
      );

      const header = [company, period].filter(Boolean).join(' | ');
      if (header) lines.push(header);
      const sub = [role, location].filter(Boolean).join(' | ');
      if (sub) lines.push(sub);

      const bullets = extractListItems(block);
      for (const bullet of bullets) {
        lines.push(`- ${decodeEntities(bullet)}`);
      }
      lines.push('');
    }
  } else if (isProjects) {
    const projRegex =
      /<div[^>]*class="project"[^>]*>([\s\S]*?)(?=<div[^>]*class="project"[^>]*>|$)/gi;
    let m;
    while ((m = projRegex.exec(content)) !== null) {
      const block = m[1];
      const title = decodeEntities(
        stripTags(
          (block.match(/<[^>]*class="[^"]*project-title[^"]*"[^>]*>([\s\S]*?)<\//) || [])[1] || ''
        )
      );
      const badge = decodeEntities(
        stripTags(
          (block.match(/<[^>]*class="[^"]*project-badge[^"]*"[^>]*>([\s\S]*?)<\//) || [])[1] || ''
        )
      );
      const desc = decodeEntities(
        stripTags(
          (block.match(/<[^>]*class="[^"]*project-desc[^"]*"[^>]*>([\s\S]*?)<\//) || [])[1] || ''
        )
      );
      const tech = decodeEntities(
        stripTags(
          (block.match(/<[^>]*class="[^"]*project-tech[^"]*"[^>]*>([\s\S]*?)<\//) || [])[1] || ''
        )
      );
      const href = extractHref(block);

      const titleLine = badge ? `${title} [${badge}]` : title;
      if (titleLine) lines.push(titleLine);
      if (desc) lines.push(`  ${desc}`);
      if (tech) lines.push(`  Tech: ${tech}`);
      if (href) lines.push(`  ${href}`);
      lines.push('');
    }
  } else if (isEducation) {
    const eduRegex =
      /<div[^>]*class="edu-item"[^>]*>([\s\S]*?)(?=<div[^>]*class="edu-item"[^>]*>|$)/gi;
    let m;
    while ((m = eduRegex.exec(content)) !== null) {
      const block = m[1];
      const eduTitle = decodeEntities(
        stripTags(
          (block.match(/<[^>]*class="[^"]*edu-title[^"]*"[^>]*>([\s\S]*?)<\//) || [])[1] || ''
        )
      );
      const org = decodeEntities(
        stripTags(
          (block.match(/<[^>]*class="[^"]*edu-org[^"]*"[^>]*>([\s\S]*?)<\//) || [])[1] || ''
        )
      );
      const year = decodeEntities(
        stripTags(
          (block.match(/<[^>]*class="[^"]*edu-year[^"]*"[^>]*>([\s\S]*?)<\//) || [])[1] || ''
        )
      );
      const desc = decodeEntities(
        stripTags(
          (block.match(/<[^>]*class="[^"]*edu-desc[^"]*"[^>]*>([\s\S]*?)<\//) || [])[1] || ''
        )
      );

      const line = [eduTitle, org, year].filter(Boolean).join(' | ');
      if (line) lines.push(line);
      if (desc) lines.push(`  ${desc}`);
    }
  } else if (isCertifications) {
    const certRegex =
      /<div[^>]*class="cert-item"[^>]*>([\s\S]*?)(?=<div[^>]*class="cert-item"[^>]*>|$)/gi;
    let m;
    while ((m = certRegex.exec(content)) !== null) {
      const block = m[1];
      const certTitle = decodeEntities(
        stripTags(
          (block.match(/<[^>]*class="[^"]*cert-title[^"]*"[^>]*>([\s\S]*?)<\//) || [])[1] || ''
        )
      );
      const year = decodeEntities(
        stripTags(
          (block.match(/<[^>]*class="[^"]*cert-year[^"]*"[^>]*>([\s\S]*?)<\//) || [])[1] || ''
        )
      );
      const line = year ? `${certTitle} (${year})` : certTitle;
      if (line) lines.push(line);
    }
  } else if (isSkills) {
    // skill-item spans contain nested skill-category spans — need to strip inner tags
    const skillSpanRegex =
      /<span[^>]*class="skill-item"[^>]*>([\s\S]*?)<\/span>\s*(?=<span[^>]*class="skill-item"|<\/div>|$)/gi;
    let skillMatch;
    const skillItems = [];
    while ((skillMatch = skillSpanRegex.exec(content)) !== null) {
      const text = decodeEntities(stripTags(skillMatch[1])).trim();
      if (text) skillItems.push(text);
    }
    if (skillItems.length > 0) {
      for (const item of skillItems) {
        lines.push(`- ${item}`);
      }
    } else {
      // Fallback: extract from skills-grid
      const gridMatch = content.match(/<div[^>]*class="[^"]*skills-grid[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
      if (gridMatch) {
        const text = decodeEntities(stripTags(gridMatch[1])).trim();
        if (text) {
          text.split('\n').map(l => l.trim()).filter(Boolean).forEach(l => lines.push(`- ${l}`));
        }
      } else {
        const text = decodeEntities(stripTags(content)).trim();
        if (text) lines.push(text);
      }
    }
  } else {
    // Fallback
    const text = decodeEntities(stripTags(content)).trim();
    if (text) lines.push(text);
  }

  return lines;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  let html;
  try {
    html = await readFile(inputPath, 'utf-8');
  } catch (err) {
    console.error(`Error reading input file: ${err.message}`);
    process.exit(1);
  }

  if (!html.includes('<') || !html.includes('>')) {
    console.error('Error: Input file does not appear to be valid HTML.');
    process.exit(1);
  }

  console.log(`Input:  ${inputPath}`);
  console.log(`Output: ${outputPath}`);

  const header = extractHeader(html);
  const sections = extractSections(html);

  const lines = [];

  // Header
  if (header.name) {
    lines.push(header.name);
  }
  if (header.contactParts.length > 0) {
    lines.push(header.contactParts.join('  |  '));
  }

  // Sections
  for (const section of sections) {
    lines.push(...renderSection(section));
  }

  // Clean up trailing whitespace and excessive blank lines
  const output = lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim() + '\n';

  await writeFile(outputPath, output, 'utf-8');

  console.log(`Text generated: ${outputPath}`);
  console.log(`Size: ${(Buffer.byteLength(output, 'utf-8') / 1024).toFixed(1)} KB`);
}

main().catch((err) => {
  console.error('Text generation failed:', err.message);
  process.exit(1);
});
