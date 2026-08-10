# Date and time handling

This is the end-to-end contract for all temporal data in AutoTaskCalendar.

## The three kinds of values

| Kind | Examples | API representation | Storage |
| --- | --- | --- | --- |
| Instant | event start/end, task placement, login/completion time | ISO 8601 with `Z` or explicit offset | Mongo `Date` |
| Civil date | task start/due day, recurrence cutoff/identity, Compass dates | strict `YYYY-MM-DD` | Mongo `Date` at UTC midnight as a compatibility marker |
| Wall time | working start/end | validated `HH:mm` | minutes after midnight |

Never parse a civil date with `new Date(value)` and never derive a calendar boundary by adding 24 hours. Use `utils/temporal.js` on the server and `webinterface/src/utils/temporal.js` in the browser.

## User timezone

`UserDetail.timeZone` is an IANA timezone such as `America/New_York`. It is initialized from the browser at registration or the first login of a legacy user. Travel does not silently change scheduling; users change the value explicitly on the profile page.

Working hours are `workingStartMinutes` and `workingEndMinutes`. The scheduler combines those wall-clock values with each civil date in the user's zone, so 09:30 stays 09:30 through DST and non-hour offsets.

Overnight working windows are intentionally unsupported. The API rejects an end at or before the start.

## Tasks and recurrence

Task `startDate`, `dueDate`, `occurrenceDate`, and recurrence `endsOn` are civil dates. The browser sends `YYYY-MM-DD`. API responses serialize those fields in the same form.

The scheduler converts a task's start day into midnight in the user's timezone before deciding whether it is eligible. A due date is a calendar deadline used for ordering; it is not a midnight instant.

Recurrence walks canonical UTC civil-date markers, not server-local dates. The user's timezone determines today's date and timeline eligibility. This keeps occurrence identity stable when server timezone or DST changes.

## Events

Timed event dates are instants. Create/update routes require ISO timestamps and reject invalid or inverted ranges.

Week lookup receives a civil date and computes `[Sunday start, next Sunday start)` in the user's timezone. Events are selected by interval overlap, so events spanning into the week are included.

Google all-day events keep their exclusive date-only start/end in `allDayStart` and `allDayEnd`, along with `allDay` and `sourceTimeZone`. Timeline boundaries are derived from those values to block scheduling. The UI displays them in its all-day row.

DayPilot uses timezone-neutral wall-time strings. `instantToDayPilotWall()` deliberately converts API instants to browser wall fields before rendering.

## Compass

Compass start/end fields are inclusive civil dates. An item remains live through its selected end day and archives the next day. `completedFrom` and `completedTo` are inclusive date-only filters.

## Legacy migration

`temporalDataVersion` gates an idempotent first-login migration. The browser sends an IANA timezone on login so an unmigrated user can be initialized.

The migration:

- derives wall-clock preferences from legacy fields;
- normalizes task, recurrence, and Compass civil dates;
- recognizes the old task UI's exact `+ 86,399,000ms` due-date signature;
- rebuilds incomplete projected recurrence occurrences;
- preserves completed history and true instants;
- marks the user migrated only after successful writes.

Google records without recoverable all-day metadata are corrected on the next sync. The sync is an upsert and refreshes temporal fields on existing records.

Before a production rollout, back up MongoDB. Rolling back application code after users have migrated is safe only if the old code is not allowed to rewrite the new civil-date markers or working-time fields.

## Tests

The test server runs with `TZ=UTC`. Targeted browser contexts use `America/Los_Angeles`; API helper tests cover `America/New_York` DST and `Asia/Kathmandu` minute offsets. Seed fixtures accept an explicit anchor for deterministic date scenarios.
