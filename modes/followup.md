# Mode: followup — Follow-up & Reminder System

Scan the application tracker for stale entries and generate follow-up recommendations.

**Trigger:** `/career-ops followup` or any question about follow-ups, reminders, or stale applications.

## Steps

1. **Read data sources:**
   - `data/applications.md` — current application statuses and dates
   - `data/followup-log.tsv` — history of follow-up actions (may not exist yet)

2. **Determine last activity date for each application:**
   - Start with the application date from `data/applications.md`
   - If `data/followup-log.tsv` has entries for that `app_num`, use the most recent date instead
   - Last activity = max(application date, latest followup-log entry)

3. **Apply staleness thresholds (days since last activity):**
   | Status | Threshold | Urgency |
   |--------|-----------|---------|
   | Applied | >7 days | Overdue — needs follow-up |
   | Interview | >5 days | Overdue — send check-in |
   | Responded | >3 days | Overdue — reply needed |
   | Evaluated | >14 days | Stale — decide: apply or discard |

   Applications within the threshold window are "on track." Terminal statuses (Offer, Rejected, Discarded, SKIP) are excluded.

4. **For each stale application, recommend an action:**
   - **Applied, 7+ days:** Draft a follow-up email or LinkedIn message (use `contacto` mode framework for LinkedIn outreach)
   - **Interview, 5+ days:** Draft a thank-you or check-in message
   - **Responded, 3+ days:** Remind the user to reply
   - **Evaluated, 14+ days:** Flag for decision — apply or discard

5. **Output the follow-up report:**

   ```
   Follow-up Report — {YYYY-MM-DD}
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

   🔴 Urgent (overdue):
     - #{num} {Company} — {Role} | Applied {N} days ago | No response
       → Suggested: LinkedIn message to hiring manager

   🟡 Due soon:
     - #{num} {Company} — {Role} | Interview {N} days ago
       → Suggested: Thank-you follow-up email

   🟢 On track:
     - #{num} {Company} — {Role} | Applied 3 days ago | Within normal window

   📊 Summary: {N} need follow-up, {N} on track, {N} stale (consider discarding)
   ```

6. **Log follow-ups:** When the user confirms they sent a follow-up, append a row to `data/followup-log.tsv`:

   ```
   app_num	date	action	channel	notes
   ```

   - `app_num` — matches the `#` column in applications.md
   - `date` — YYYY-MM-DD (today)
   - `action` — one of: `follow-up`, `response`, `reminder`, `thank-you`, `check-in`
   - `channel` — one of: `email`, `linkedin`, `phone`, `other`
   - `notes` — free-text description of what was sent/received

   **The follow-up log is append-only.** Never edit or delete existing entries.

## Rules

- **Never auto-send messages.** Only suggest and draft. The user decides when and whether to send.
- Handle missing `data/followup-log.tsv` gracefully — treat it as empty (no prior follow-ups).
- Handle missing or empty `data/applications.md` gracefully — report "no applications to check."
- Exclude terminal statuses: Offer, Rejected, Discarded, SKIP.
- Sort output by urgency: urgent first, then due soon, then on track.
- If no applications need follow-up, say so clearly.

## Automation

For scripted/CI usage, the companion script `followup-check.mjs` can be run directly:

```bash
node followup-check.mjs           # Human-readable report
node followup-check.mjs --json    # Machine-readable JSON output
node followup-check.mjs --days=5  # Override default threshold for all statuses
```
