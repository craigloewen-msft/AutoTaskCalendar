# Admin dashboard

Add a site-wide management dashboard at `/#/admin`, visible only to administrators. It
answers "how is the whole site doing?" — how many people signed up, how many are still
using it, how much work they are filing, and whether the scheduler is keeping up.

Every existing page is single-tenant: each handler resolves `req.user` and filters by
`userRef`. This is the first deliberately **cross-tenant** surface in the app, so the
authorisation boundary matters more than the charts do.

## How a user becomes an admin

One mechanism: **`isAdmin: true` on the user document.** No config, no username allowlist,
no hardcoded name. Nothing is ever written at login, so there is no sync step that could
silently promote or demote an account, and "who is an admin" is answerable with one query.

Grant it in production with a single command:

```js
db.userInfo.updateOne({ username: 'craig' }, { $set: { isAdmin: true } })
```

The app never grants admin to itself — there is no self-service path, no bootstrap-on-empty
rule, and no way to register into it. That also keeps the flag testable: the Playwright
fixture namespaces every seeded username (`pw-<pid>-<worker>-<hash>-testuser`), so a
hardcoded name could never have matched a test user anyway.

### `models/index.js`

Add to `UserDetail`, nothing else:

```js
isAdmin: { type: Boolean, default: false },
```

### `middleware/auth.js`

`requireAdmin` needs no config, so it sits beside `authenticateSession` and matches its
shape — bare `res.sendStatus`, no `returnFailure` envelope:

```js
function requireAdmin(req, res, next) {
    if (req.user?.isAdmin !== true) return res.sendStatus(403);
    next();
}
```

## API — `routes/admin.js` + `controllers/adminController.js`

Mount in `app.js` the way the other routers are. Both endpoints run
`authenticateSession(config)` **then** `requireAdmin`, so an anonymous caller gets 401 and a
logged-in non-admin gets 403. Data payloads use the house `{ success: true, ... }` /
`returnFailure()` convention.

The controller holds the aggregation; the route stays thin, matching `compass.js`.

### `GET /api/admin/overview`

One response, four sections:

- **`totals`** — `users`, `tasks`, `completedTasks`, `activeTasks`, `backlogTasks`,
  `recurringSeries` (tasks with `recurrence.freq`), `events`, `roles`, `goals`, `projects`,
  `weeklyPlans`.
- **`engagement`** — `newUsers7`/`newUsers30` (by account creation), `activeUsers7`/
  `activeUsers30` (`lastLoginDate`), `usersWithTasks`, `usersWithCompass`,
  `usersWithGoogle` (`googleAccessTokenEncrypted` present), `usersWithCommittedWeek`,
  `dormantUsers` (no login in 30 days), plus `medianTasksPerUser` and `meanTasksPerUser`.
- **`health`** — `scheduledTasks`, `unscheduledTasks` (active, `scheduledDate: null`),
  `overdueTasks` (active, `dueDate` before today), `tasksWithProject` vs `tasksWithout`,
  and `completionRate`.
- **`trends`** — 30 entries of `{ date, signups, tasksCreated, tasksCompleted }`, oldest
  first, with zero-filled gaps.

Use `countDocuments` for the flat totals and one `$facet` aggregation for the per-user and
trend rollups; the whole thing is a handful of round trips. **No cache** — it would race
with concurrent test seeding and buys nothing at this size.

### `GET /api/admin/users`

Params: `search` (username/email substring, case-insensitive, escaped before it reaches a
regex), `page` (1-based), `limit` (default 25, hard cap 100), `sort` (one of
`lastLogin`, `created`, `username`, `tasks`; default `lastLogin` descending). Reject
anything outside those enums with `returnFailure` rather than silently coercing.

Returns `{ users: [...], totalCount, page, limit }`, each row:

```json
{ "_id": "...", "username": "craig", "email": "...", "createdAt": "...",
  "lastLoginDate": "...", "timeZone": "UTC", "isAdmin": true,
  "googleConnected": true, "taskCount": 42, "completedCount": 30,
  "activeCount": 12, "eventCount": 8, "projectCount": 3 }
```

`createdAt` comes from the ObjectId timestamp (`$toDate: '$_id'`) — there is no `createdAt`
field and this task does not add one.

**Never serialise `hash`, `salt`, `googleAccessTokenEncrypted`, or
`googleRefreshTokenEncrypted`.** Project them away in the aggregation, not in the view.
This endpoint reads across every tenant; it must expose counts and booleans only, never
task titles, notes, or event contents.

### Time handling

Site-wide metrics have no single user timezone, so **declare UTC** and derive every bucket
with the `utils/temporal` helpers (`todayInZone`, `parseDateOnly`, `addDateOnlyDays`,
`startOfDateInZone`). Bucket in the aggregation with `$dateTrunc`/`$dateToString` on an
explicit `timezone: 'UTC'`. Never subtract milliseconds to walk back 30 days, and never
compare a civil-date marker against `new Date()` — task `dueDate` is a civil-date marker,
so "overdue" compares against today's marker. Label the UI "All times UTC".

## Session payload

The client needs to know whether to show the page, so `returnBasicUserInfo` in
`utils/helpers.js` gains one field: `isAdmin: inputUser.isAdmin === true`. It reads straight
off the document, so no signature change and no call-site edits. In
`webinterface/src/store.js` add `isAdmin: state => state.user.isAdmin === true`.

## Frontend — `webinterface/src/views/Admin.vue`

Route `/admin` with `meta: { requiresAuth: true, requiresAdmin: true }`. Extend the
`router.beforeEach` guard: after the existing auth check, redirect a non-admin to `Home`.
The guard is convenience only — the server is the boundary.

Nav link in `App.vue`, `v-if="isAdmin"`, placed after Compass.

Layout, built from existing Bootstrap classes and the dark theme already in `App.vue`:

```text
Admin · site overview                                  All times UTC
┌─────────┬─────────┬─────────┬─────────┐
│  Users  │  Tasks  │  Done   │ Active  │   metric cards, big number + delta
│   128   │  4,207  │  61.4%  │  34/7d  │
└─────────┴─────────┴─────────┴─────────┘

Last 30 days        signups / created / completed, one bar per day
Engagement          new · active · dormant · with Google · with Compass
Scheduling health   scheduled · unscheduled · overdue · unaligned

Users  [search…]                                    sort ▾   « 1/6 »
username   email   joined   last seen   tasks   done   projects   admin
```

- **No chart library.** Task `00042` deliberately removed `chart.js`/`vue-chartjs`; trends
  are CSS-height `div` bars in a flex row with a `title` tooltip per day. Do not add a
  dependency.
- Loading spinner, error state with a Retry button, and an empty search result message —
  mirroring `Compass.vue`.
- Search is debounced (`v-debounce` is already registered globally in `main.js`).
- `data-test` hooks: `admin-overview`, `admin-metric-<key>`, `admin-trends`,
  `admin-user-table`, `admin-user-row`, `admin-user-search`, `admin-pagination`.

## Seeding — `seed/dataset.js`

Add a sixth user after `boundaryuser`, so the dashboard has an admin to log in as and tests
have a subject:

```js
const admin = await b.createUser({
    username: 'adminuser',
    email: 'adminuser@example.com',
    isAdmin: true,
});
```

Give it two or three tasks (one completed) so its row is not all zeros, and return it as
`admin` alongside `primary`/`other`/`recurring`/`slip`/`slipBoundary`. `makeUser` passes
overrides straight through, so no factory change is needed. `npm run seed` already prints
every seeded login, so `adminuser` shows up there for free.

## Verification

**`tests/api/admin.spec.js`** — the boundary is the point:

- anonymous → 401; seeded non-admin → 403 on both endpoints;
- the seeded `adminuser` → 200 with the documented shape;
- flipping `isAdmin` to `false` via `withDb` turns the same account into a 403, proving the
  flag alone decides;
- `/api/admin/users` never returns `hash`, `salt`, or either Google token field;
- searching the primary user's namespaced username returns exactly that row, with
  `taskCount`/`completedCount` matching a direct `TaskDetails.countDocuments` via `withDb`;
- `limit` is capped at 100 and an unknown `sort` is rejected.

> **Concurrency.** Twelve Playwright workers share one test database, so site-wide totals
> move under the test. Assert `>=` on global counts and reserve exact assertions for the
> searched single row. Never assert an exact `totals.users`.

**`tests/ui/admin.spec.js`** — one journey plus the guard:

- logged in as the seeded admin, `/#/admin` renders the metric cards, the trend strip, and
  the user table; searching narrows it to one row;
- the primary (non-admin) user is redirected away from `/#/admin` and sees no nav link.

Add an admin-logged-in page fixture to `tests/fixtures/index.js` next to `loggedInPage`,
reusing the existing login flow.

Iterate with `npm test -- tests/api/admin.spec.js`, then `npm test -- -g "admin"`; run the
full suite before finishing.

## Docs

- **`docs/ADMIN.md`** (new) — the standalone manual: what the dashboard shows, how to grant
  admin (the `updateOne` above) and revoke it, the API contract, the UTC convention, and how
  to add a metric.
- **`AGENTS.md`** — one line in the `docs/` index pointing at it.
- **`docs/TEST_CREDENTIALS.md`** and **`docs/SEEDING.md`** — add `adminuser` / `testpassword`
  to the seeded-user lists, noting it is the only seeded admin.

## Acceptance criteria

- `isAdmin: true` on the user document is the only thing that grants admin; nothing in the
  app writes that field.
- A non-admin gets 403 from both admin endpoints and cannot reach `/#/admin`; an anonymous
  caller gets 401.
- The dashboard shows totals, engagement, scheduling health, a 30-day trend, and a
  searchable, sortable, paged user table.
- No password hashes, salts, Google tokens, or task/event content ever cross the wire.
- All date bucketing goes through the temporal helpers in explicit UTC.
- No new frontend dependency.
- `docs/ADMIN.md` exists and the full test suite passes.
