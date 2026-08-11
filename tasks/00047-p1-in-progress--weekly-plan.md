# Weekly Plan: review Compass and create this week's tasks

## Outcome

Add a manual Weekly Plan page where a user reviews the active **Role → Goal → Project** hierarchy and quickly creates ordinary tasks for the current Monday–Sunday week.

Weekly Plan is a view and workflow over existing Compass and task data. It has no plan schema, plan records, selected-task state, weekly archive, or new lifecycle to maintain. A task is shown as part of this week when its existing due date falls within the current week.

## Product decisions

- **Entry:** manual navigation only. Add `Weekly Plan` to the authenticated navigation.
- **Week:** Monday through Sunday, calculated in the user's persisted IANA timezone.
- **Planning action:** create normal tasks linked to the reviewed project. Do not add a separate “commitment” or selection state.
- **Source of truth:** the existing task's `projectRef`, `startDate`, and `dueDate`. The page groups and filters those records; it does not copy them.
- **History:** no weekly-plan history or previous-week browser. Existing task dates remain the record of what was planned for when.
- **Scheduling:** no scheduler changes. New tasks participate in automatic scheduling exactly like tasks created on Calendar.
- **Alignment:** tasks still attach only to projects, following the existing Compass rule. Unaligned tasks remain valid.

## User experience

Add an authenticated `/weekly-plan` page and a `Weekly Plan` nav item between Calendar and Compass.

### Header and overview

Show:

- `Weekly plan` and an unambiguous current range such as `Mon, Apr 13 – Sun, Apr 19`;
- count and summed duration of incomplete tasks due this week;
- a `Go to calendar` action that only navigates—it must not schedule tasks automatically;
- a short explanation that tasks created here are ordinary auto-scheduled tasks.

The page should support a quick role-by-role review rather than present another task-management system:

```text
Weekly plan · Mon Apr 13 – Sun Apr 19             5 tasks · 3h 30m

▌ Engineer
  Ship v2 by June
    Migration plan                         2 tasks · 1h 30m this week
      Draft migration plan · Thu · 60m
      Review rollout · Sun · 30m
      [Task title] [Duration] [Due day] [Add task]

▌ Parent
  Be present
    Weekend adventures                     Nothing planned this week
      [Task title] [Duration] [Due day] [Add task]
```

Use a readable multi-column/card layout on desktop and a single stacked layout on narrow screens. Do not rely on hover, drag-and-drop, or a desktop-only interaction.

### Review hierarchy

- Render live roles, goals, and started projects from `getCompass`, preserving their existing order and role colours.
- Include stored role, goal, and project descriptions so this is an actual review of direction rather than only a task form.
- Show each level's existing dates without introducing a second status system.
- Show parked projects in a collapsed `Someday` section with a link to manage them in Compass; do not offer a current-week task form under a project that has not started.
- Show helpful empty states for roles/goals/projects with no children and link to Compass for structural editing.
- On each started project, list its incomplete tasks due Monday–Sunday with title, duration, due day, backlog/recurrence indicator where applicable, and a link/action to edit it on Calendar.
- Sort this-week tasks by due date, then priority, then title.
- Add a per-project collapsed `Other active tasks` section for incomplete tasks outside the week. This context helps avoid creating duplicates but does not let the user “select” or silently redraft them into the week.

### Quick task creation

Every started project gets a compact task form:

- required title;
- required positive duration in minutes;
- due date constrained to the displayed Monday–Sunday range and defaulted to Sunday;
- visible project context, preselected from the surrounding project;
- start date defaulted to today in the user's timezone;
- creates a normal, one-off, non-backlog task through `/api/createTask`;
- immediately refreshes that project's current-week list and the page totals;
- reports API validation failures inline without losing the entered title or duration;
- clears the form and visibly confirms success after creation.

Do not duplicate the full Calendar task editor. Recurrence, dependencies, chunking, priority, notes, backlog controls, and dates outside the current week remain available through Calendar.

Because creating a task is the plan action, there are no `Add to plan`, `Remove from plan`, `Clear plan`, or `Planning complete` controls. Existing tasks are never changed merely by opening or reviewing this page.

### Unaligned work

At the bottom, include a collapsed `Unaligned tasks` section:

- show incomplete unaligned tasks due this week separately so they are not invisible during review;
- allow assigning an unaligned task to a project through the existing `/api/setTaskProject` endpoint;
- refresh the page grouping after alignment;
- never require alignment or block task creation because unaligned work exists.

## Data and date semantics

Do **not** add a Weekly Plan model, collection, field, or persistence endpoint.

The page derives its state from:

- `GET /api/getCompass` for live roles/goals/projects;
- `GET /api/getUserTasks` for incomplete ordinary tasks and materialised recurrence occurrences;
- each task's existing `projectRef`, `startDate`, `dueDate`, `duration`, and `priority`;
- the user's persisted timezone for the current civil date and week range.

Add a Monday-based civil-week helper. This can live in both `utils/temporal.js` and `webinterface/src/utils/temporal.js` where server/client tests benefit, or be a parameterised form of the existing helper. Preserve the backend `localWeekBounds()` Sunday default used by event retrieval unless all callers are deliberately migrated.

The Monday helper must:

- derive “today” in the user's IANA timezone;
- return Monday and Sunday date-only strings, plus the following Monday as an exclusive bound where useful;
- advance dates with calendar arithmetic rather than fixed milliseconds;
- remain correct across month/year boundaries and DST transitions.

Date comparisons in the page operate on strict `YYYY-MM-DD` civil dates. Do not parse date-only values as timeline instants or depend on the browser timezone matching the user's saved timezone.

## API impact

No Weekly Plan API is needed. Reuse the existing endpoints:

| Method | Endpoint | Weekly Plan use |
| --- | --- | --- |
| GET | `/api/getCompass` | Load the review hierarchy. |
| GET | `/api/getUserTasks` | Derive current-week, other active, and unaligned task groups. |
| POST | `/api/createTask` | Create a normal task already linked to the surrounding project. |
| POST | `/api/setTaskProject` | Optionally align an existing unaligned task. |

Do not bypass existing ownership or validation paths. Quick creation sends the same required fields Calendar sends: title, duration, civil `startDate`, civil `dueDate`, `projectRef`, `isBacklog: false`, and normal defaults for optional fields.

If `createTask` fails with the app's HTTP-200 failure payload, keep the quick form open and show `log` (or a safe fallback). On success use its returned `taskList` directly, as Calendar already does; no extra read or created-task identifier is necessary.

A Compass load failure needs a visible retry/error state because hierarchy review is the purpose of this page. A task load failure should also be explicit instead of presenting every project as “nothing planned.”

## Frontend structure

- Add `webinterface/src/views/WeeklyPlan.vue` and its authenticated route/nav link.
- Add a focused quick-task component if it keeps validation and per-project state clear; do not move page data into Vuex, which currently owns authentication state only.
- Load Compass and incomplete tasks in parallel and derive all hierarchy/task groupings client-side, matching the existing Compass design rule.
- Reuse `buildRoleColorMap()`, `formatCivilDate()`, and civil-date helpers.
- Keep form state keyed by project ID so opening or submitting one project cannot erase another project's draft.
- Use stable `data-test` hooks for planning controls rather than tying Playwright to decorative CSS.
- Preserve accessible labels, keyboard operation, visible focus, inline status announcements, and mobile responsiveness.

When linking to Calendar to edit a task, use a small, explicit route/query contract only if Calendar can safely open the requested owned task after loading. Otherwise provide a straightforward `Go to calendar` link and do not expand scope into a task-modal refactor.

## Tests

Any behavior change ships with specs.

### Temporal/API coverage

Extend temporal tests to cover:

1. Monday–Sunday civil bounds in UTC and a non-UTC timezone.
2. A Monday range spanning a DST transition and a year boundary.
3. Existing Sunday-based event week retrieval remains unchanged.
4. `/api/createTask` through the quick-form payload preserves its project ownership validation and civil start/due dates.

A separate `weeklyPlan.spec.js` API suite is unnecessary unless implementation introduces backend behavior beyond shared temporal helpers.

### UI

Add `tests/ui/weeklyPlan.spec.js` covering:

1. The authenticated route/nav renders the correct Monday–Sunday range and seeded Role → Goal → Project hierarchy.
2. Existing incomplete tasks due this week appear under their project and contribute to count/duration totals; tasks outside the week appear only under `Other active tasks`.
3. Quick creation under a project defaults to Sunday, creates a task linked to that project, and immediately displays it in that project's current-week list.
4. The user can choose another due day within the week, while a date outside the range is rejected by the control and API-safe validation.
5. API failure remains inline and preserves the draft.
6. Parked projects do not offer quick creation, and empty hierarchy states link to Compass.
7. Unaligned current-week tasks are visible and can be aligned without making alignment mandatory.
8. The core review and quick-add controls remain usable at a narrow mobile viewport.
9. The displayed week stays stable when browser timezone differs from the user's saved timezone.

Use existing named Compass/task seed records where possible. Add deterministic current-week seed records only where the existing anchor-relative tasks do not provide clear coverage.

## Documentation

- Add `docs/WEEKLY_PLAN.md` as the end-to-end manual: purpose, stateless derivation, Monday/timezone semantics, quick creation, endpoints reused, and the distinction from future scheduler weighting.
- Link the workflow from `docs/COMPASS.md` and clarify that Weekly Plan is a task-creation lens over Compass, not a stored planning layer.
- Add the new manual to the `AGENTS.md` layout index.

## Non-goals

- No Weekly Plan schema, collection, API, selected-task field, or browser storage.
- No prompts, banners, automatic redirects, notifications, or completion nag.
- No prior/future week navigation, archived plans, retrospective analytics, weekly notes, or snapshots.
- No separate task completion checklist or duplicate task lifecycle.
- No role time budgets, capacity enforcement, goal weighting, role-colour Calendar phase, or scheduler changes.
- No changing existing task dates simply because they are viewed on Weekly Plan.
- No automatic scheduling when opening, creating from, or leaving Weekly Plan.

## Verification

Iterate with focused temporal and UI specs. At finalization run:

```bash
npm run verify
```

Manually verify with the seeded account that the page supports a full role-by-role review, creates a normal project-linked Sunday-due task, immediately includes it in this week's totals, does not alter existing tasks, exposes unaligned work without forcing it, and remains usable on desktop and mobile.
