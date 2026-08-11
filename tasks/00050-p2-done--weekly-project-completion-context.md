# Show last week’s completed work within Weekly Plan projects

## Outcome

Give users a small retrospective cue while they plan: on each started project in Weekly Plan, show what they completed during the previous full Monday–Sunday week when that project has matching work.

This remains a stateless view over normal task completion records. Do not add weekly-plan records, snapshots, or a second completion lifecycle.

## Product and interaction design

Use the product’s existing task vocabulary: **Completed last week**, not “closed.” Compass uses end/archive language for hierarchy items, while tasks are completed.

For each started project with one or more matches, place a compact native disclosure after the project’s current/other active task lists and immediately before **Quick task**:

```text
Migration plan
  Draft rollout checklist · Thu
  ▸ ✓ 3 tasks completed last week · Mar 2–8
  ─────────────────────────────────────────
  Quick task …
```

When expanded:

```text
  ▾ ✓ 3 tasks completed last week · Mar 2–8
      ✓ Validate import mapping                 Completed Fri, Mar 6
      ✓ Rehearse rollback                       Completed Wed, Mar 4
      ✓ Document cutover                        Completed Mon, Mar 2
```

Requirements:

- Render the disclosure only when that specific project has matches; do not add zero-count rows or a global empty state.
- Keep it collapsed by default so this week’s plan remains primary.
- Include a restrained success/check accent, exact previous-week range, sufficient contrast, a visible keyboard focus treatment, and a comfortable tap target.
- Show task title and completion day/date, sorted by `completedDate` newest first.
- Preserve the recurrence marker when a completed item is a materialised occurrence.
- Render completed rows as static history, visually distinct from active task buttons. Do not open the active task editor or suggest that completed work is editable.
- Do not show a duration rollup. `duration` is mutable remaining work for chunked tasks and is not a reliable historical-effort value.
- Do not add this disclosure to parked Someday projects, unaligned tasks, or work outside the active Compass tree in this iteration.
- Keep the disclosure and expanded rows usable without horizontal overflow at the existing narrow viewport.

## Meaning of “last week”

“Last week” is the previous complete Monday–Sunday period relative to the current Weekly Plan week, not a rolling seven-day window.

Inclusion is based on the task’s `completedDate` instant—not `dueDate`, `startDate`, or `occurrenceDate`—using the caller’s persisted IANA timezone. Use an inclusive local Monday start and exclusive following-Monday start. Never slice a UTC timestamp to infer the user’s completion day, invent numeric offsets, or advance calendar days with fixed milliseconds.

The UI derives the previous civil range from the existing Monday week helper:

- `startDate`: current week’s Monday minus seven calendar days;
- `endDate`: current week’s Monday minus one calendar day;
- the API converts those civil boundaries to instants in the saved user timezone.

If the saved timezone later changes, history is interpreted in the user’s current saved timezone, consistent with the rest of the app.

## Narrow completion-history endpoint

Do not widen `GET /api/getUserTasks`, which intentionally returns incomplete work, and do not add completed task data to `GET /api/getCompass`. Add a separate bounded read:

```http
GET /api/getProjectCompletions?completedFrom=YYYY-MM-DD&completedTo=YYYY-MM-DD
```

Both bounds are required inclusive civil dates. Validate them strictly, reject an inverted range, and convert them with `startOfDateInZone()` plus the start of the day after `completedTo` as the exclusive upper instant.

Query `TaskDetails` once with:

- the authenticated user’s `userRef`;
- `completed: true`;
- non-null `projectRef`;
- `completedDate >= local start` and `< local next-day start`.

Return only what this review needs, newest completion first:

```json
{
  "success": true,
  "completedFrom": "2026-03-02",
  "completedTo": "2026-03-08",
  "items": [
    {
      "_id": "…",
      "title": "Validate import mapping",
      "projectRef": "…",
      "completedDate": "2026-03-06T18:42:00.000Z",
      "seriesRef": null
    }
  ]
}
```

The response must not include notes, due dates, mutable duration totals, hierarchy copies, search, or an all-time archive. A completed recurring occurrence is one completed item and is returned like any other completion.

Scope every query to the caller. Follow the app’s HTTP-200 `{success:false}` error policy: missing/invalid bounds produce a useful validation message; unexpected failures are logged and safely reported.

Add a compound task index suitable for the user/completion-date/project query so retained completion history does not turn the weekly read into a collection scan.

## Weekly Plan data flow

In `webinterface/src/views/WeeklyPlan.vue`:

- Keep Compass and incomplete tasks as the two required page reads.
- Start the project-completion read alongside them, but do not hold the core page loading gate open for this optional context.
- Group returned items by `projectRef` client-side, matching the existing per-project grouping rule.
- Convert each `completedDate` instant to a civil date with `dateOnlyInTimeZone(savedTimeZone, completedDate)` before formatting it.
- If the completion read fails, keep the Weekly Plan hierarchy and quick-add forms usable. Show a small, non-blocking “Last week’s completions could not be loaded” status with a retry action; never imply that an error means zero completions.
- On a Monday/week rollover detected by the existing visibility-change refresh, recompute the previous range and refetch this bounded history so the disclosure does not retain the old week.
- A normal Weekly Plan task completion does not enter this section immediately because it belongs to the current week, not the previous one.

Use stable `data-test` hooks for the per-project disclosure, its rows, and the non-blocking error/retry state.

## Backend structure

Keep route parsing/response handling in `routes/tasks.js` and put the owned, bounded history query in `controllers/taskController.js`. Reuse temporal helpers from `utils/temporal.js`; do not duplicate timezone conversion logic in the route.

Add the completion-history index to the canonical `TaskDetail` schema in `models/index.js`.

## Tests

Any behavior change ships with specs.

### API coverage

Extend `tests/api/tasks.spec.js` (and temporal coverage only if a shared helper changes) to prove:

1. only the authenticated user’s completed, project-linked tasks inside the requested completion window are returned;
2. grouping facts are driven by `completedDate`, including a task due outside the week but completed inside it, while a task due inside but completed outside is excluded;
3. unaligned completions and another user’s completions do not leak;
4. local Monday boundaries are correct in a non-UTC timezone, including an instant near midnight and a DST-transition week;
5. the lower bound is inclusive and the exclusive next-Monday boundary is excluded;
6. recurring occurrences are returned as individual completion records;
7. empty windows return `items: []`;
8. missing, impossible, or inverted civil bounds return `{success:false}` with a useful message;
9. anonymous access is rejected.

### UI coverage

Extend `tests/ui/weeklyPlan.spec.js` with deterministic completion records to prove:

1. a project with prior-week completions gets one collapsed summary with the correct count and exact range;
2. its task titles are hidden initially, then appear newest first with completion dates when expanded;
3. a completion is matched by `projectRef` and `completedDate`, not by due date;
4. projects without matches have no completion disclosure;
5. completed rows are non-interactive history rather than task-editor buttons;
6. completion-history failure leaves the hierarchy and quick-add UI available and offers a working retry;
7. the disclosure remains usable without horizontal overflow at the existing mobile viewport.

Use direct test setup for boundary records rather than changing the broad seed dataset unless a reusable visual fixture is genuinely needed.

## Documentation

Update `docs/WEEKLY_PLAN.md` with:

- the project-local **Completed last week** disclosure and its placement;
- completion-time and previous-Monday–Sunday semantics;
- the optional, non-blocking history load;
- the new bounded endpoint and fields;
- the reason duration is intentionally omitted.

Update the relevant API guidance in `docs/COMPASS.md` to record that completed-per-project detail comes from this separate endpoint rather than `getCompass`.

## Non-goals

- No generic Completed Tasks page, search, pagination, or all-time task archive.
- No rolling-seven-day toggle or previous-week navigation.
- No editing, reopening, deleting, or reassigning completed tasks.
- No completion-duration or productivity analytics.
- No stored weekly review, notes, snapshots, notifications, or scheduler changes.
- No historical project attribution redesign when a project is deleted and its tasks are unlinked.

## Verification

Iterate with focused API and Weekly Plan UI specs. During finalization run the full suite:

```bash
npm test
```

Manually inspect the seeded Weekly Plan on desktop and mobile: completion context should be discoverable while scanning a project, quiet while collapsed, useful when expanded, absent where empty, and never compete with current-week work or Quick task.
