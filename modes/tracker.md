# Mode: tracker — Application Tracker

Reads and displays `data/applications.md`.

**Tracker format:**
```markdown
| # | Date | Company | Role | Score | Status | PDF | Report |
```

Possible statuses: `Evaluated` → `Applied` → `Responded` → `Interview` → `Offer` / `Rejected` / `Discarded` / `SKIP`

- `Applied` = the candidate submitted their application
- `Responded` = A recruiter/company reached out and the candidate responded (inbound)

> **Note:** Proactive outbound contact (e.g., LinkedIn power move via `/career-ops contacto`) should be tracked using the Notes column, not as a separate status. Use `Applied` or `Responded` as appropriate and add context in Notes.

If the user asks to update a status, edit the corresponding row.

Also display statistics:
- Total applications
- By status
- Average score
- % with generated PDF
- % with generated report
