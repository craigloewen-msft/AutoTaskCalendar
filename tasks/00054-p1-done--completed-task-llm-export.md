# Export completed tasks as LLM-ready Markdown

Add an authenticated date-range export for completed work, with a simple download control in the user's profile. The export shall be a curated Markdown report rather than a raw database dump so it can be attached to an LLM conversation and used for annual or periodic reviews.

## User experience

Add a **Completed task export** card to `webinterface/src/views/User.vue` beneath the account/calendar settings.

- Provide **From** and **To** civil-date inputs.
- Default the range to January 1 of the current year through today, calculated in the user's saved IANA timezone.
- Provide a **Download Markdown** button and short copy explaining that the file contains completed task titles, notes, completion dates, and Compass context for use in reviews or LLM prompts.
- Validate that both dates exist and that From is not after To before requesting the export.
- Keep the form usable during failures, show an inline error, and disable the button only while the download is being prepared.
- Download a deterministic filename such as `completed-tasks-2026-01-01-to-2026-12-31.md` without navigating away from the page.

## API and date contract

Add `GET /api/exportCompletedTasks?completedFrom=YYYY-MM-DD&completedTo=YYYY-MM-DD` in the task API.

- Require the existing JWT authentication and resolve the calling user normally.
- Require strict `YYYY-MM-DD` bounds and reject an inverted range using the project's existing `{ success: false }` error convention.
- Treat both dates as inclusive civil dates in the user's persisted timezone. Query from local midnight on `completedFrom` (inclusive) to local midnight after `completedTo` (exclusive) with `utils/temporal.js`; never use fixed offsets or millisecond day arithmetic.
- Select every task owned by the caller with `completed: true` and a `completedDate` in that window. Include standalone, unaligned, archived-project-linked, and recurring occurrence records. Do not require `projectRef` and do not expose another user's data.
- Return a UTF-8 Markdown attachment with a Markdown content type and `Content-Disposition` filename. Do not paginate or silently truncate a requested export.
- Keep the existing minimal `/api/getProjectCompletions` endpoint unchanged for Weekly Plan.

## LLM-ready report

Generate a stable, human-readable report with enough semantics to be useful without exposing implementation details:

1. Title and export metadata: inclusive requested range, saved timezone, generation instant, and total completed-task count.
2. A short interpretation note explaining that selection uses the actual completion timestamp, not due/start dates, and that each recurring occurrence is a separate completion.
3. A compact month-by-month count summary.
4. Completed work grouped by available **Role → Goal → Project** context, followed by an **Unaligned or unavailable project context** group. Include the hierarchy titles and descriptions so an LLM can infer goals and impact.
5. Within each group, list work chronologically with local completion date/time, task title, notes when present, due/start dates when present, and recurring-occurrence context when present.

Exclude database IDs, user/authentication fields, dependencies, priority, scheduler internals, and mutable duration. Chunk completion changes the stored duration, so it is not reliable historical effort data. Preserve Unicode and safely format arbitrary Markdown/HTML-looking user text so content cannot corrupt headings or list structure.

Implement report querying/formatting in a focused controller/helper rather than embedding it all in the route or Vue component.

## Tests

Extend `tests/api/tasks.spec.js` to cover:

- anonymous access returning 401;
- missing, malformed, and inverted ranges;
- inclusive saved-timezone boundaries across local midnight/DST;
- selection by `completedDate`, regardless of due date;
- inclusion of unaligned and recurring occurrences;
- exclusion of incomplete and other-user tasks;
- Compass hierarchy enrichment, including safe fallback when a project or ancestor is unavailable;
- response content type, attachment filename, deterministic ordering, Unicode/Markdown-safe content, and absence of private/internal fields.

Extend `tests/ui/user.spec.js` to cover the year-to-date defaults, date validation, successful `.md` download and filename/content, loading/error recovery, and narrow-screen usability of the card.

Update or add a dedicated instruction manual in `docs/` describing how to download the report, call the API directly with the app's existing raw JWT `Authorization` header, interpret the report, and understand timezone/privacy/field limitations. Link it from relevant existing documentation if useful.

## Verification

Iterate with focused specs, then run the full suite only during finalization:

```bash
npm test -- tests/api/tasks.spec.js
npm test -- tests/ui/user.spec.js
npm test
```
