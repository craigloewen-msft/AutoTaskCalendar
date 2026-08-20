# Completed Task Export

Use the completed task export to turn a period of finished work into a Markdown report suitable for a performance review, journal, archive, or LLM conversation.

## Download a report

1. Sign in and open your username/profile page.
2. Find **Completed task export**.
3. Choose inclusive **From** and **To** dates. The form defaults to January 1 through today in your saved timezone.
4. Select **Download Markdown**.
5. Attach the downloaded `.md` file to your LLM conversation or open it in any text editor.

The filename records the selected range, for example:

```text
completed-tasks-2026-01-01-to-2026-12-31.md
```

The report includes a count summary, Compass context, task titles and notes, actual local completion times, authored start/due dates, and recurring-occurrence context. It groups aligned work by Role → Goal → Project and puts unaligned work or work whose hierarchy is no longer available in a clearly named fallback section.

## Interpret the dates

`completedFrom` and `completedTo` are inclusive civil dates in the IANA timezone saved on your profile. A completion is selected by its actual `completedDate` instant, not its task start date, due date, or recurrence occurrence date.

For example, with `America/New_York`, an export through March 10 includes work completed before local midnight ending March 10, even though that boundary changes from EST to EDT during the daylight-saving transition.

Each completed recurring occurrence is one history record. Completing the same repeating activity on different occurrence dates therefore produces separate report entries.

## Call the API

Use:

```http
GET /api/exportCompletedTasks?completedFrom=2026-01-01&completedTo=2026-12-31
Authorization: YOUR_JWT
```

This application uses the raw JWT as the `Authorization` header value; do not prefix it with `Bearer`. Both query parameters are required and must use strict `YYYY-MM-DD` format. The successful response is UTF-8 Markdown with an attachment filename.

Example:

```bash
curl \
  -H "Authorization: $AUTOTASKCALENDAR_TOKEN" \
  "http://localhost:3000/api/exportCompletedTasks?completedFrom=2026-01-01&completedTo=2026-12-31" \
  --output completed-tasks-2026.md
```

Use the API port printed by `npm run dev`; it may not be 3000 when another instance is running.

Validation errors follow the normal API convention: HTTP 200 with `{ "success": false, "log": "..." }`. Missing or invalid authentication returns HTTP 401.

## Privacy and field limits

The endpoint returns completed tasks owned by the authenticated user only. It includes standalone, unaligned, archived-project-linked, and recurring occurrence records in the requested completion window. It does not paginate or silently truncate the report.

The export deliberately omits:

- database and user IDs;
- authentication data;
- dependencies and priority;
- scheduler internals;
- task duration.

Duration is not reliable historical effort because completing chunks reduces the task's stored duration. The report preserves task notes and Compass descriptions because they provide useful review context; read the file before sharing it with an external service. User-authored Unicode is preserved, and Markdown/HTML-like text is escaped so it cannot change the report structure.

## Use with an LLM

Attach the report and state the review format you need. A useful prompt is:

```text
Using only the attached completed task report, identify major themes, outcomes, and recurring responsibilities. Draft a concise yearly self-review, distinguish evidence from inference, and ask me questions wherever impact is unclear.
```

Task titles record activity, not necessarily business impact. Verify inferred outcomes and add metrics, feedback, and results that were not captured in task notes before submitting a review.

## Implementation map

- `controllers/completedTaskExport.js` queries owned completion history and formats Markdown.
- `routes/tasks.js` validates the range and serves the authenticated attachment.
- `webinterface/src/views/User.vue` owns the date form and browser download.
- `tests/api/tasks.spec.js` pins ownership, boundaries, shape, and content.
- The export form itself has no automated coverage; verify the download by hand.

The Weekly Plan's `GET /api/getProjectCompletions` endpoint remains a separate minimal, project-linked previous-week read.
