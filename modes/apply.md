# Mode: apply — Live Application Assistant

Interactive mode for when the candidate is filling out an application form in Chrome. Reads what's on screen, loads prior context for the offer, and generates personalized answers for each form question.

## Requirements

- **Best with visible Playwright**: In visible mode, the candidate sees the browser and Claude can interact with the page.
- **Without Playwright**: the candidate shares a screenshot or pastes the questions manually.

## Workflow

```
1. DETECT     → Read active Chrome tab (screenshot/URL/title)
2. IDENTIFY   → Extract company + role from the page
3. SEARCH     → Match against existing reports in reports/
4. LOAD       → Read full report + Section G (if exists)
5. COMPARE    → Does the role on screen match the evaluated one? If changed → alert
6. ANALYZE    → Identify ALL visible form questions
7. GENERATE   → For each question, generate a personalized answer
8. PRESENT    → Display formatted answers for copy-paste
```

## Step 1 — Detect the Offer

**With Playwright:** Take a snapshot of the active page. Read title, URL, and visible content.

**Without Playwright:** Ask the candidate to:
- Share a screenshot of the form (Read tool reads images)
- Or paste the form questions as text
- Or provide company + role so we can look it up

## Step 2 — Identify and Search for Context

1. Extract company name and role title from the page
2. Search in `reports/` by company name (case-insensitive Grep)
3. If there's a match -> load the full report
4. If there's a Section G -> load the previous draft answers as a base
5. If there's NO match -> alert and offer to run a quick auto-pipeline

## Step 3 — Detect Role Changes

If the role on screen differs from the evaluated one:
- **Alert the candidate**: "The role has changed from [X] to [Y]. Do you want me to re-evaluate or adapt the answers to the new title?"
- **If adapting**: Adjust the answers to the new role without re-evaluating
- **If re-evaluating**: Run full A-F evaluation, update the report, regenerate Section G
- **Update tracker**: Change the role title in applications.md if appropriate

## Step 4 — Analyze Form Questions

Identify ALL visible questions:
- Free text fields (cover letter, why this role, etc.)
- Dropdowns (how did you hear, work authorization, etc.)
- Yes/No (relocation, visa, etc.)
- Salary fields (range, expectation)
- Upload fields (resume, cover letter PDF)

Classify each question:
- **Already answered in Section G** -> adapt the existing answer
- **New question** -> generate answer from the report + cv.md

## Step 5 — Generate Answers

For each question, generate the answer following:

1. **Report context**: Use proof points from Block B, STAR stories from Block F
2. **Previous Section G**: If a draft answer exists, use it as a base and refine
3. **"I'm choosing you" tone**: Same framework as auto-pipeline
4. **Specificity**: Reference something concrete from the JD visible on screen
5. **career-ops proof point**: Include in "Additional info" if there's a field for it

**Output format:**

```
## Answers for [Company] — [Role]

Based on: Report #NNN | Score: X.X/5 | Archetype: [type]

---

### 1. [Exact question from the form]
> [Answer ready for copy-paste]

### 2. [Next question]
> [Answer]

...

---

Notes:
- [Any observations about the role, changes, etc.]
- [Customization suggestions the candidate should review]
```

## Step 6 — Post-apply (optional)

If the candidate confirms they submitted the application:
1. Update status in `applications.md` from "Evaluated" to "Applied"
2. Update the report's Section G with the final answers
3. Suggest next step: `/career-ops contacto` for LinkedIn outreach

## Scroll Handling

If the form has more questions than are visible:
- Ask the candidate to scroll and share another screenshot
- Or paste the remaining questions
- Process in iterations until the entire form is covered
