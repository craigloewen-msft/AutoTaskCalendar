# Make date and timezone handling correct and explicit

## Audit outcome

The repository currently uses `Date` for three different concepts:

1. **Instants** — an exact point in time, such as a timed event or completion timestamp.
2. **Civil dates** — a calendar day with no clock or offset, such as a task due date or recurrence cutoff.
3. **Wall-clock preferences** — values such as “work from 09:30 to 17:30 in Europe/Berlin”.

Mixing those concepts is causing real timezone and DST defects. The recurrence generator’s day-by-day loop is already DST-safe; most recurrence failures originate at its API/UI boundaries.

### Confirmed defects

- User working hours are stored as a dated instant plus duration, using the browser’s current numeric offset. This assumes a UTC server, loses 30/45-minute offsets, drifts when DST changes, and gives new accounts a server-local 14:00 default (`models/index.js`, `routes/auth.js`, `User.vue`).
- The scheduler creates the end of a workday by adding fixed elapsed hours. A wall-clock shift crossing DST can end one hour early or late (`controllers/scheduling.js`).
- Task date inputs are converted to browser-local midnight instants. The server later treats them as server-local days, so recurrence anchors and task dates can move a day when browser and server zones differ (`Calendar.vue`, `routes/tasks.js`, `controllers/recurrence.js`).
- Task creation approximates end-of-day with `+ 86,399,000ms`; on the US 2024 spring transition, a March 10 deadline becomes March 11 at 00:59:59. Editing and follow-up creation instead save midnight, so create/edit/follow-up have inconsistent deadline semantics.
- The sidebar divides elapsed milliseconds by 24 hours to count calendar days, returning zero for adjacent dates across a 23-hour DST day (`Calendar.vue`).
- Recurrence `endsOn` summaries parse bare `YYYY-MM-DD` with `new Date()`, displaying the previous day west of UTC (`webinterface/src/utils/recurrence.js`).
- Compass date inputs are date-only, but both server and client parse them as instants. This can move a displayed date or month, and `completedTo` currently excludes most of the selected day. The permissive shared parser also accepts rollover dates such as `2024-02-31` (`utils/helpers.js`, `compassController.js`, Compass UI).
- Event week lookup uses an almost eight-day UTC window, checks only event start times, and therefore both includes the following Sunday and omits events that begin before but overlap the week (`routes/events.js`).
- Event create/update do not strictly validate timestamps or reject inverted ranges.
- Google all-day `date` values are cast as UTC instants and have no all-day marker, so they can move to the previous day or render as timed events (`eventController.js`).
- Tests inherit the host timezone, use UTC date helpers for local date inputs, mirror some production bugs, and almost never exercise a browser/server timezone mismatch.

### Audited behavior that is not itself a bug

DayPilot represents displayed values as timezone-neutral wall times. The calendar’s current timed-event conversion is obscure, but its intent is valid: convert an API instant into the browser’s local wall time before handing it to DayPilot. Replace it with a named/tested adapter rather than passing raw ISO instants through and causing DayPilot to display UTC clock fields.

## Target temporal contract

Use one explicit contract throughout the app:

| Concept | Examples | Representation |
| --- | --- | --- |
| Instant | timed event start/end, `scheduledDate`, `completedDate`, `lastLoginDate` | Mongo `Date`, ISO 8601 with `Z` or an explicit offset at API boundaries |
| Civil date | task start/due day, `occurrenceDate`, recurrence `endsOn`, Compass start/end | strict `YYYY-MM-DD` over the API; existing Mongo `Date` fields become canonical UTC calendar markers and are never interpreted with local getters |
| Wall time | working start/end | minutes after midnight (or equivalently validated `HH:mm`) plus a persisted IANA timezone |
| All-day event | Google `start.date` / `end.date` | explicit `allDay` plus date-only start/end; derived instants are used only where timeline overlap is required |

A civil date stored in an existing Mongo `Date` field is a compatibility marker, not an instant. Normalize start-like values to UTC midnight and due-like values consistently; convert to a real instant only where a civil date meets the user’s timeline.

## Requirements

1. Persist and validate an IANA timezone on every user. Registration and first login send the browser zone; subsequent timezone changes are explicit in User settings rather than silently following travel.
2. Store working start/end as wall-clock values with minute precision. Reject malformed values, unsupported zones, empty working-day sets where appropriate, and end times that are not after start times; overnight shifts remain unsupported and must fail clearly.
3. Build each scheduling day’s start and end in the user’s IANA zone. Use calendar/zoned operations rather than fixed milliseconds, including across DST transitions.
4. Centralize strict backend helpers for date-only values, instants, wall times, timezone validation, zoned day boundaries, and date-only serialization. Do not use permissive `new Date(value)` for civil-date validation.
5. Send raw `YYYY-MM-DD` values from date inputs. Normalize task create, edit, follow-up, recurrence, and Compass paths on the server so all callers get the same semantics.
6. Make recurrence operate on timezone-neutral civil-date markers. Determine “today” in the user’s timezone, keep occurrence identity stable across server timezone and DST changes, and update the recurrence documentation accordingly.
7. Compare calendar days as calendar dates, not elapsed 24-hour blocks. Keep task due/start days unchanged through create/edit/reload.
8. Compute event requests as `[local week start, next local week start)` in the user’s timezone and query by interval overlap: `startDate < nextWeekStart && endDate > weekStart`.
9. Strictly validate event instants and ensure `endDate > startDate` on create/update.
10. Preserve Google all-day semantics with explicit schema fields, source/fallback timezone handling, all-day DayPilot rendering, and full-day scheduler blocking. Refresh existing Google records during sync instead of leaving stale temporal fields untouched.
11. Replace opaque frontend date conversions with small named utilities. The DayPilot adapter must convert timed instants to browser-local wall strings deliberately and must pass all-day dates without instant conversion.
12. Keep API errors in the repository’s existing HTTP-200 `{ success: false }` shape.

## Legacy-data transition

Add an idempotent temporal-data version and automatic first-login migration for users missing the new fields. The login request supplies the browser IANA zone only to initialize legacy accounts.

- Derive legacy working wall time in that zone and calculate the end as wall-clock minutes, not from a fresh offset calculation.
- Normalize task civil dates in the user zone. Recognize the old UI’s exact `+ 86,399,000ms` due-date signature where possible so spring/fall DST deadlines recover the originally selected day.
- Normalize Compass and recurrence cutoff values using their legacy date-only/UTC contract.
- Rebuild incomplete future recurrence occurrences after template normalization; preserve completed history.
- Leave true instants untouched.
- Mark the user migrated only after all idempotent steps succeed.
- Existing Google events that lack enough information to recover all-day semantics should be refreshed from Google on the next sync.

Retain deprecated user working-time fields temporarily for reading legacy users, but stop writing or exposing them once migration completes. Document rollback/backup expectations and the one-time compatibility behavior.

## Implementation areas

- `models/index.js`: user timezone/wall-time/version fields; explicit all-day event fields and indexes as needed.
- `utils/`: strict temporal parsing, formatting, and zoned-boundary utilities.
- `routes/auth.js`, Login/Register/User UI: initialize, return, display, validate, and update timezone-aware working preferences.
- `controllers/scheduling.js`: zoned work windows and civil-date eligibility.
- `routes/tasks.js`, `controllers/recurrence.js`, `taskController.js`, `Calendar.vue`, `RepeatEditor.vue`, recurrence UI utility: one date-only task/recurrence contract.
- `controllers/compassController.js`, Compass editor/view: strict stable date-only handling and inclusive date filters.
- `routes/events.js`, `controllers/eventController.js`, Calendar event adapter: exact local-week overlap, strict instants, Google all-day preservation.
- Seed factories and docs: seed the new user fields and describe the end-to-end contract in a standalone `docs/DATE_AND_TIME.md`; update recurrence, Compass, seeding, and testing references.

Use `moment-timezone` on the backend unless an equally well-tested existing facility covers IANA-zone conversion. Do not implement timezone conversion by manually adding offsets.

## Regression coverage

### Deterministic harness

- Pin the test server/process timezone to UTC.
- Allow the seed fixture to accept an explicit anchor.
- Add targeted browser contexts with `America/Los_Angeles` or `America/New_York` so browser and server zones differ.
- Replace test helpers based on `toISOString().slice(0, 10)` or fixed milliseconds with civil-date helpers.

### API/helper specs

- Strictly reject impossible civil dates and invalid/inverted event timestamps.
- Round-trip 09:30–17:30 working hours and an IANA zone through register/login/update.
- Verify zoned work boundaries across US spring-forward and fall-back and in a non-hour-offset zone such as `Asia/Kathmandu`.
- Create, edit, and follow up a task on DST dates; assert the selected civil day is unchanged and all paths share one due-day contract.
- Create a recurring task with browser/server zones different; assert its first occurrence and `endsOn` day match the selected dates.
- Keep recurrence generation correct across both DST transitions and independent of the host timezone.
- Assert Compass create/edit/display markers, live/archive status, and inclusive `completedFrom`/`completedTo` boundaries.
- Assert an exact seven-day event window, exclusion of the following week boundary, inclusion of spanning events, and correct near-midnight behavior.
- Unit-test Google timed/all-day transformation, including exclusive all-day end dates and source timezone fallback.
- Test legacy migration idempotence and preservation of true instants/completed recurrence history.

### UI specs

- Under a non-UTC browser zone, create and reopen a task and Compass item without date/month shifts.
- Show recurrence `until 31 Mar 2024` when `2024-03-31` is selected west of UTC.
- Assert a known timed event instant appears at the correct browser-local DayPilot clock position.
- Assert a Google all-day event appears in the all-day row on its source date.
- Save minute-precision working hours and verify the form and calendar business-hour configuration remain aligned.

## Verification

During implementation, run focused API/UI specs while iterating, then finish with:

```bash
npm run verify
```

The work is complete when the full suite passes, the targeted timezone/DST matrix is deterministic, existing users migrate without losing true timestamps or completed history, and no production date input relies on implicit JavaScript date parsing or fixed-millisecond day arithmetic.
