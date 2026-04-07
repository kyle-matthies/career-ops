# Mode: analytics — Pipeline Analytics & Insights

When the user runs `/career-ops analytics` or asks for insights, stats, or pipeline health:

## Data Sources

1. `data/applications.md` — main tracker table (columns: #, Date, Company, Role, Score, Status, PDF, Report, Notes)
2. `reports/` — detailed evaluation reports with sections A-F
3. `data/scan-history.tsv` — portal scan history

**Pre-check:** Run `node analytics.mjs --json` to get structured data. If the script fails or returns empty data, parse the tracker manually. If there is no tracker yet, respond with "No data yet — evaluate your first offer to get started."

---

## Quick Stats Mode

If the user just asks "how's my pipeline?", "stats", or "quick summary", show a compact block:

```
Pipeline Summary — {date}
━━━━━━━━━━━━━━━━━━━━━━━━
Total: N | Avg Score: X.X/5
Evaluated: N | Applied: N | Interview: N | Offer: N
Conversion: Applied→Interview X% | Interview→Offer X%
Top archetype: {type} (avg X.X/5)
Stale (>7d): N applications need attention
```

Use `node analytics.mjs --summary` for this data.

---

## Full Analytics Report

When the user asks for full analytics or a detailed report, generate all six sections below and save to `reports/analytics-{YYYY-MM-DD}.md`.

### A) Pipeline Funnel

- Count applications by status: Evaluated → Applied → Responded → Interview → Offer
- Also count terminal states: Rejected, Discarded, SKIP
- Calculate conversion rates between each stage:
  - Evaluated → Applied rate
  - Applied → Responded rate
  - Applied → Interview rate
  - Interview → Offer rate
- Compare to industry benchmarks:
  - Application → Interview: typically 10-15%
  - Interview → Offer: typically 20-30%
- **Flag** if any conversion rate is unusually low (below half of benchmark)

### B) Score Distribution

- Group scores into buckets: 1-2, 2-3, 3-4, 4-5 (and 4.5-5 for top tier)
- Calculate average score overall and by archetype
  - Read archetype from report Block A for each application (parse `reports/` directory)
- Identify which archetypes score highest → recommend focusing there
- List top 5 highest-scored applications with company, role, and score

### C) Application Velocity

- Applications per week trend (group by ISO week from Date column)
- Applications per month trend
- Average time between evaluation and application:
  - Compare Date column (evaluation date) to when status changed to Applied
  - If status change dates are not tracked, note this limitation
- **Stale applications:** Evaluated but not Applied for >7 days
  - List each stale application with days since evaluation
  - Recommend: review and apply, or discard

### D) Gap Analysis (requires reading reports)

- Parse Block B (CV Match → Gaps section) from each report in `reports/`
- Aggregate the most common gaps across all evaluations
- Rank gaps by frequency (how many reports mention each gap)
- For each top gap, suggest specific actions:
  - Update CV language to reframe existing experience
  - Build a portfolio project demonstrating the skill
  - Take a specific course or certification
  - Add to cover letter talking points
- If reports don't exist or can't be parsed, say: "No reports found to analyze gaps. Evaluate some offers first."

### E) Company & Role Insights

- Which companies responded (status = Responded, Interview, or Offer) vs ghosted (status stayed at Applied)
- Response rate by company
- Which role types (by archetype) have the best response rates
- Average score by archetype
- If there's enough data, identify patterns (e.g., "Remote roles have higher scores", "LLMOps roles get more responses")

### F) Recommendations

Based on all the above analysis, generate 3-5 specific, actionable recommendations. Examples:

- "Your LLMOps applications score 4.1 avg vs 3.2 for PM roles — focus on LLMOps"
- "You have 12 applications stuck in Evaluated — review and apply or discard"
- "Top gap is 'Kubernetes experience' (appears in 8 reports) — consider a portfolio project"
- "Your Applied→Interview rate is 5% (below 10% benchmark) — review your CV and cover letters"
- "Company X has responded to 3/3 applications — prioritize similar companies"

**Recommendations must be grounded in data.** Never invent statistics or make claims not supported by the tracker or reports.

---

## Output Format

### Full Report

Save as `reports/analytics-{YYYY-MM-DD}.md` with this structure:

```markdown
# Pipeline Analytics — {YYYY-MM-DD}

## Summary
(compact stats block from Quick Stats mode)

## A) Pipeline Funnel
(funnel analysis)

## B) Score Distribution
(score histogram and archetype breakdown)

## C) Application Velocity
(trends and stale applications)

## D) Gap Analysis
(aggregated gaps from reports)

## E) Company & Role Insights
(response rates and patterns)

## F) Recommendations
(3-5 actionable items)
```

### Using the Script

The `analytics.mjs` script provides reliable parsed data:

```bash
node analytics.mjs --json      # Full structured JSON
node analytics.mjs --summary   # Compact one-line summary
node analytics.mjs             # Human-readable text output
```

Use the script output as the foundation, then enrich with report parsing for sections D and E.

---

## Design Principles

- **Works with empty data:** If tracker is empty or missing, show "No data yet" — never error
- **Never invent data:** If reports don't exist or can't be parsed, say so explicitly
- **Actionable over vanity:** Focus on what the user should DO next, not just numbers
- **Respect existing conventions:** Use canonical statuses from `templates/states.yml`
