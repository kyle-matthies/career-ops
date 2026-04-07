#!/usr/bin/env node

/**
 * generate-docx.mjs — Generate ATS-optimized DOCX from CV content
 *
 * Usage:
 *   node generate-docx.mjs <input.html> <output.docx>
 *
 * Reads the same HTML input as generate-pdf.mjs and converts it to
 * a clean, ATS-parseable DOCX file.
 *
 * Uses the 'docx' npm package (https://docx.js.org/) to generate
 * Word documents programmatically.
 */

import { readFile, writeFile } from 'fs/promises';
import { resolve } from 'path';
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  convertInchesToTwip,
} from 'docx';

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);

if (args.length < 2) {
  console.error('Usage: node generate-docx.mjs <input.html> <output.docx>');
  process.exit(1);
}

const inputPath = resolve(args[0]);
const outputPath = resolve(args[1]);

// ---------------------------------------------------------------------------
// Lightweight HTML helpers (no external parser needed)
// ---------------------------------------------------------------------------

/** Strip HTML tags and decode common entities */
function stripTags(html) {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&mdash;/g, '\u2014')
    .replace(/&ndash;/g, '\u2013')
    .replace(/&rsquo;/g, '\u2019')
    .replace(/&lsquo;/g, '\u2018')
    .replace(/&rdquo;/g, '\u201D')
    .replace(/&ldquo;/g, '\u201C')
    .trim();
}

/** Extract text content between a given class wrapper */
function extractByClass(html, className) {
  const regex = new RegExp(
    `<[^>]+class="[^"]*${className}[^"]*"[^>]*>([\\s\\S]*?)</(?:div|span|p)>`,
    'gi'
  );
  const matches = [];
  let m;
  while ((m = regex.exec(html)) !== null) {
    matches.push(m[1]);
  }
  return matches;
}

/** Extract all <li> contents from an HTML fragment */
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

/** Extract href from the first <a> inside html */
function extractHref(html) {
  const m = html.match(/href="([^"]+)"/i);
  return m ? m[1] : null;
}

// ---------------------------------------------------------------------------
// Section extractors — mirror the cv-template.html structure
// ---------------------------------------------------------------------------

function extractHeader(html) {
  const nameMatch = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const name = nameMatch ? stripTags(nameMatch[1]) : '';

  // Contact row items
  const contactRowMatch = html.match(
    /<div[^>]*class="[^"]*contact-row[^"]*"[^>]*>([\s\S]*?)<\/div>/i
  );
  const contactParts = [];
  if (contactRowMatch) {
    const raw = contactRowMatch[1];
    // Split by separator spans
    const parts = raw.split(/<span[^>]*class="[^"]*separator[^"]*"[^>]*>[^<]*<\/span>/i);
    for (const part of parts) {
      const text = stripTags(part).trim();
      if (text) contactParts.push(text);
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

function parseSummary(content) {
  const summaryTexts = extractByClass(content, 'summary-text');
  return summaryTexts.map((t) => stripTags(t).trim()).join('\n');
}

function parseCompetencies(content) {
  const tags = extractByClass(content, 'competency-tag');
  return tags.map((t) => stripTags(t).trim()).filter(Boolean);
}

function parseJobs(content) {
  const jobs = [];
  const jobRegex = /<div[^>]*class="job"[^>]*>([\s\S]*?)(?=<div[^>]*class="job"[^>]*>|$)/gi;
  let m;
  while ((m = jobRegex.exec(content)) !== null) {
    const block = m[1];
    const company = stripTags(
      (block.match(/<[^>]*class="[^"]*job-company[^"]*"[^>]*>([\s\S]*?)<\//) || [])[1] || ''
    );
    const period = stripTags(
      (block.match(/<[^>]*class="[^"]*job-period[^"]*"[^>]*>([\s\S]*?)<\//) || [])[1] || ''
    );
    const role = stripTags(
      (block.match(/<[^>]*class="[^"]*job-role[^"]*"[^>]*>([\s\S]*?)<\//) || [])[1] || ''
    );
    const location = stripTags(
      (block.match(/<[^>]*class="[^"]*job-location[^"]*"[^>]*>([\s\S]*?)<\//) || [])[1] || ''
    );
    const bullets = extractListItems(block);
    jobs.push({ company, period, role, location, bullets });
  }
  return jobs;
}

function parseProjects(content) {
  const projects = [];
  const projRegex =
    /<div[^>]*class="project"[^>]*>([\s\S]*?)(?=<div[^>]*class="project"[^>]*>|$)/gi;
  let m;
  while ((m = projRegex.exec(content)) !== null) {
    const block = m[1];
    const title = stripTags(
      (block.match(/<[^>]*class="[^"]*project-title[^"]*"[^>]*>([\s\S]*?)<\//) || [])[1] || ''
    );
    const badge = stripTags(
      (block.match(/<[^>]*class="[^"]*project-badge[^"]*"[^>]*>([\s\S]*?)<\//) || [])[1] || ''
    );
    const desc = stripTags(
      (block.match(/<[^>]*class="[^"]*project-desc[^"]*"[^>]*>([\s\S]*?)<\//) || [])[1] || ''
    );
    const tech = stripTags(
      (block.match(/<[^>]*class="[^"]*project-tech[^"]*"[^>]*>([\s\S]*?)<\//) || [])[1] || ''
    );
    const href = extractHref(block);
    projects.push({ title, badge, desc, tech, href });
  }
  return projects;
}

function parseEducation(content) {
  const items = [];
  const eduRegex =
    /<div[^>]*class="edu-item"[^>]*>([\s\S]*?)(?=<div[^>]*class="edu-item"[^>]*>|$)/gi;
  let m;
  while ((m = eduRegex.exec(content)) !== null) {
    const block = m[1];
    const title = stripTags(
      (block.match(/<[^>]*class="[^"]*edu-title[^"]*"[^>]*>([\s\S]*?)<\//) || [])[1] || ''
    );
    const org = stripTags(
      (block.match(/<[^>]*class="[^"]*edu-org[^"]*"[^>]*>([\s\S]*?)<\//) || [])[1] || ''
    );
    const year = stripTags(
      (block.match(/<[^>]*class="[^"]*edu-year[^"]*"[^>]*>([\s\S]*?)<\//) || [])[1] || ''
    );
    const desc = stripTags(
      (block.match(/<[^>]*class="[^"]*edu-desc[^"]*"[^>]*>([\s\S]*?)<\//) || [])[1] || ''
    );
    items.push({ title, org, year, desc });
  }
  return items;
}

function parseCertifications(content) {
  const items = [];
  const certRegex =
    /<div[^>]*class="cert-item"[^>]*>([\s\S]*?)(?=<div[^>]*class="cert-item"[^>]*>|$)/gi;
  let m;
  while ((m = certRegex.exec(content)) !== null) {
    const block = m[1];
    const title = stripTags(
      (block.match(/<[^>]*class="[^"]*cert-title[^"]*"[^>]*>([\s\S]*?)<\//) || [])[1] || ''
    );
    const year = stripTags(
      (block.match(/<[^>]*class="[^"]*cert-year[^"]*"[^>]*>([\s\S]*?)<\//) || [])[1] || ''
    );
    items.push({ title, year });
  }
  return items;
}

function parseSkills(content) {
  const items = [];
  // skill-item spans may contain nested skill-category spans
  // Use a nesting-aware approach: find outer skill-item, then strip all inner tags
  const skillRegex =
    /<span[^>]*class="skill-item"[^>]*>([\s\S]*?)<\/span>\s*(?=<span[^>]*class="skill-item"|<\/div>|$)/gi;
  let m;
  while ((m = skillRegex.exec(content)) !== null) {
    const text = stripTags(m[1]).trim();
    if (text) items.push(text);
  }
  // Fallback: try matching skill-item divs
  if (items.length === 0) {
    const divRegex =
      /<div[^>]*class="skill-item"[^>]*>([\s\S]*?)<\/div>/gi;
    while ((m = divRegex.exec(content)) !== null) {
      const text = stripTags(m[1]).trim();
      if (text) items.push(text);
    }
  }
  // Final fallback: extract lines from skills-grid
  if (items.length === 0) {
    const gridMatch = content.match(/<div[^>]*class="[^"]*skills-grid[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    if (gridMatch) {
      const text = stripTags(gridMatch[1]).trim();
      if (text) {
        text.split('\n').map(l => l.trim()).filter(Boolean).forEach(l => items.push(l));
      }
    }
  }
  return items;
}

// ---------------------------------------------------------------------------
// DOCX generation
// ---------------------------------------------------------------------------

const FONT = 'Calibri';
const FONT_SIZE_BODY = 22; // 11pt in half-points
const FONT_SIZE_SMALL = 20; // 10pt
const MARGIN = convertInchesToTwip(0.75);

/** Standard body text run */
function bodyRun(text, opts = {}) {
  return new TextRun({ text, font: FONT, size: FONT_SIZE_BODY, ...opts });
}

/** Small text run */
function smallRun(text, opts = {}) {
  return new TextRun({ text, font: FONT, size: FONT_SIZE_SMALL, color: '555555', ...opts });
}

function buildDocx(header, sections) {
  const children = [];

  // --- Name ---
  children.push(
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      children: [
        new TextRun({
          text: header.name,
          font: FONT,
          size: 48, // 24pt
          bold: true,
        }),
      ],
    })
  );

  // --- Contact info ---
  if (header.contactParts.length > 0) {
    children.push(
      new Paragraph({
        spacing: { after: 200 },
        children: header.contactParts.flatMap((part, i) => {
          const runs = [smallRun(part)];
          if (i < header.contactParts.length - 1) {
            runs.push(smallRun('  |  '));
          }
          return runs;
        }),
      })
    );
  }

  // --- Process each section ---
  for (const section of sections) {
    const titleUpper = section.title.toUpperCase();

    // Section heading
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 240, after: 120 },
        children: [
          new TextRun({
            text: section.title,
            font: FONT,
            size: 26, // 13pt
            bold: true,
          }),
        ],
      })
    );

    // Determine section type by title keywords
    const isExperience = /experience|experiencia/i.test(titleUpper);
    const isSummary = /summary|resumen/i.test(titleUpper);
    const isCompetencies = /core competenc|competencias? core/i.test(titleUpper);
    const isProjects = /project|proyecto/i.test(titleUpper);
    const isEducation = /education|formaci/i.test(titleUpper);
    const isCertifications = /certific/i.test(titleUpper);
    const isSkills = /skill|competencia/i.test(titleUpper) && !isCompetencies;

    if (isSummary) {
      const text = parseSummary(section.content);
      if (text) {
        children.push(
          new Paragraph({
            spacing: { after: 120 },
            children: [bodyRun(text)],
          })
        );
      }
    } else if (isCompetencies) {
      const tags = parseCompetencies(section.content);
      if (tags.length > 0) {
        children.push(
          new Paragraph({
            spacing: { after: 120 },
            children: [bodyRun(tags.join('  \u2022  '))],
          })
        );
      }
    } else if (isExperience) {
      const jobs = parseJobs(section.content);
      for (const job of jobs) {
        // Company + period
        const headerRuns = [
          bodyRun(job.company, { bold: true }),
        ];
        if (job.period) {
          headerRuns.push(bodyRun('  \u2014  '));
          headerRuns.push(smallRun(job.period));
        }
        children.push(new Paragraph({ children: headerRuns }));

        // Role + location
        const roleRuns = [];
        if (job.role) roleRuns.push(bodyRun(job.role, { italics: true }));
        if (job.location) {
          if (roleRuns.length > 0) roleRuns.push(bodyRun('  |  '));
          roleRuns.push(smallRun(job.location));
        }
        if (roleRuns.length > 0) {
          children.push(new Paragraph({ children: roleRuns }));
        }

        // Bullets
        for (const bullet of job.bullets) {
          children.push(
            new Paragraph({
              bullet: { level: 0 },
              spacing: { after: 40 },
              children: [bodyRun(bullet)],
            })
          );
        }

        // Spacing after job
        children.push(new Paragraph({ spacing: { after: 80 }, children: [] }));
      }
    } else if (isProjects) {
      const projects = parseProjects(section.content);
      for (const proj of projects) {
        const titleRuns = [bodyRun(proj.title, { bold: true })];
        if (proj.badge) {
          titleRuns.push(bodyRun(`  [${proj.badge}]`));
        }
        children.push(new Paragraph({ children: titleRuns }));

        if (proj.desc) {
          children.push(
            new Paragraph({
              spacing: { after: 40 },
              children: [bodyRun(proj.desc)],
            })
          );
        }
        if (proj.tech) {
          children.push(
            new Paragraph({
              spacing: { after: 40 },
              children: [smallRun(proj.tech)],
            })
          );
        }
        if (proj.href) {
          children.push(
            new Paragraph({
              spacing: { after: 80 },
              children: [smallRun(proj.href)],
            })
          );
        }
      }
    } else if (isEducation) {
      const items = parseEducation(section.content);
      for (const item of items) {
        const runs = [];
        if (item.title) runs.push(bodyRun(item.title, { bold: true }));
        if (item.org) {
          if (runs.length > 0) runs.push(bodyRun('  \u2014  '));
          runs.push(bodyRun(item.org));
        }
        if (item.year) {
          runs.push(bodyRun('  '));
          runs.push(smallRun(item.year));
        }
        children.push(new Paragraph({ children: runs }));

        if (item.desc) {
          children.push(
            new Paragraph({
              spacing: { after: 60 },
              children: [smallRun(item.desc)],
            })
          );
        }
      }
    } else if (isCertifications) {
      const items = parseCertifications(section.content);
      for (const item of items) {
        const runs = [bodyRun(item.title)];
        if (item.year) {
          runs.push(bodyRun('  '));
          runs.push(smallRun(item.year));
        }
        children.push(
          new Paragraph({
            spacing: { after: 40 },
            children: runs,
          })
        );
      }
    } else if (isSkills) {
      const items = parseSkills(section.content);
      for (const item of items) {
        children.push(
          new Paragraph({
            bullet: { level: 0 },
            spacing: { after: 40 },
            children: [bodyRun(item)],
          })
        );
      }
    } else {
      // Fallback: render as plain text
      const text = stripTags(section.content).trim();
      if (text) {
        children.push(
          new Paragraph({
            spacing: { after: 120 },
            children: [bodyRun(text)],
          })
        );
      }
    }
  }

  return new Document({
    styles: {
      default: {
        document: {
          run: {
            font: FONT,
            size: FONT_SIZE_BODY,
          },
        },
      },
    },
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: MARGIN,
              right: MARGIN,
              bottom: MARGIN,
              left: MARGIN,
            },
          },
        },
        children,
      },
    ],
  });
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

  const doc = buildDocx(header, sections);
  const buffer = await Packer.toBuffer(doc);
  await writeFile(outputPath, buffer);

  console.log(`DOCX generated: ${outputPath}`);
  console.log(`Size: ${(buffer.length / 1024).toFixed(1)} KB`);
}

main().catch((err) => {
  console.error('DOCX generation failed:', err.message);
  process.exit(1);
});
