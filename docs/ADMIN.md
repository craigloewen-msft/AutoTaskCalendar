# Admin dashboard

A site-wide management dashboard at `/#/admin`, visible only to administrators. It answers
"how is the whole site doing?" — how many people signed up, how many are still using it,
how much work they are filing, and whether the scheduler is keeping up.

This is the only **cross-tenant** surface in the app. Every other page resolves `req.user`
and filters by `userRef`; these two endpoints deliberately read across all tenants, so the
authorisation boundary matters more than the numbers do.

---

## Granting admin

One mechanism, and only one: **`isAdmin: true` on the user document.**

```js
// mongosh, against the production database
db.userInfo.updateOne({ username: 'craig' }, { $set: { isAdmin: true } })
```

Revoking is the same command with `false`. The change takes effect on the admin's next
request — no restart, no re-login, no deploy.

Locally, `docker exec -it autotaskcalendar-mongo mongosh <dbname>` gets you a shell; the
database name is printed by `npm run dev`.

There is no config key, no username allowlist, and no hardcoded name. **Nothing in the
application ever writes `isAdmin`**, which is what makes this safe:

- registration cannot reach it, so nobody can sign up into admin;
- login does not sync it, so no code path can silently promote or demote an account;
- "who is an admin?" is one query: `db.userInfo.find({ isAdmin: true })`.

The seeded `adminuser` (see `docs/SEEDING.md`) is the only account that gets the flag
automatically, and only in seeded development and test databases.

---

## The authorisation boundary

Both endpoints run two middlewares from `middleware/auth.js`, in this order:

| Caller | Result |
| --- | --- |
| Not logged in | `401` from `authenticateSession` |
| Logged in, `isAdmin` not `true` | `403` from `requireAdmin` |
| Logged in, `isAdmin: true` | `200` |

`requireAdmin` takes no config and reads only `req.user.isAdmin`. Both replies are bare
status codes, matching `authenticateSession`; the `{ success: false }` envelope is used only
for *data* errors like a bad sort key.

The Vue router guard on `meta.requiresAdmin` redirects non-admins to Home and the nav link
is hidden, but **both are conveniences**. The server is the boundary and answers 403 to a
direct call regardless of what the client believes.

### What is never sent

`GET /api/admin/users` projects `hash`, `salt`, `googleAccessTokenEncrypted`, and
`googleRefreshTokenEncrypted` away *inside the aggregation*, before any document reaches
JavaScript. The dashboard shows counts and booleans only — never task titles, notes, or
event contents. Preserve that when adding fields: an admin can see *that* a user has 40
tasks, never *what* they are.

---

## API

### `GET /api/admin/overview`

Four sections in one response.

| Section | Contents |
| --- | --- |
| `totals` | `users`, `tasks`, `completedTasks`, `activeTasks`, `backlogTasks`, `recurringSeries`, `events`, `roles`, `goals`, `projects`, `weeklyPlans` |
| `engagement` | `newUsers7/30`, `activeUsers7/30`, `dormantUsers`, `usersWithTasks`, `usersWithCompass`, `usersWithCommittedWeek`, `usersWithGoogle`, `meanTasksPerUser`, `medianTasksPerUser` |
| `health` | `scheduledTasks`, `unscheduledTasks`, `overdueTasks`, `tasksWithProject`, `tasksWithoutProject`, `completionRate` |
| `trends` | 30 `{ date, signups, tasksCreated, tasksCompleted }` entries, oldest first, zero-filled |

"Active" tasks are neither completed nor series templates, matching how the Calendar counts
work in hand. There is **no cache**: the whole thing is a handful of counts, and a cache
would only introduce staleness.

### `GET /api/admin/users`

| Param | Default | Notes |
| --- | --- | --- |
| `search` | — | Username or email substring, case-insensitive. Regex metacharacters are escaped. |
| `page` | `1` | 1-based. |
| `limit` | `25` | Hard cap `100`; larger values are clamped, not rejected. |
| `sort` | `lastLogin` | One of `lastLogin`, `created`, `username`, `tasks`. Anything else fails. |
| `direction` | `desc` (`asc` for `username`) | — |

Returns `{ users, totalCount, page, limit, sort }`. Each row:

```json
{ "_id": "...", "username": "craig", "email": "craig@example.com",
  "createdAt": "2024-01-05T09:12:44.000Z", "lastLoginDate": "2024-06-01T08:00:00.000Z",
  "timeZone": "Europe/London", "isAdmin": true, "googleConnected": true,
  "taskCount": 42, "completedCount": 30, "activeCount": 12,
  "eventCount": 8, "projectCount": 3 }
```

`createdAt` is derived from the ObjectId timestamp (`$toDate: '$_id'`). There is no
`createdAt` field on the user schema and this feature did not add one.

---

## Time handling

Site-wide metrics have no single user timezone, so **the dashboard declares UTC** and says
so in the header. Every boundary is derived with the `utils/temporal` helpers
(`todayInZone`, `addDateOnlyDays`, `startOfDateInZone`) and every aggregation bucket passes
`timezone: 'UTC'` explicitly.

Two rules, both load-bearing:

- **Never walk days by arithmetic on milliseconds.** `windowStart()` counts civil days back
  through `addDateOnlyDays`, so a DST transition cannot shift a bucket.
- **Never compare a civil-date marker to a wall clock.** Task `dueDate` is a civil-date
  marker, so `overdueTasks` compares it against today's *marker*, not `new Date()`.

A user in Auckland will therefore see their signup attributed to the UTC day, which is the
intended trade: one consistent site-wide clock beats per-row ambiguity.

---

## Adding a metric

1. **`controllers/adminController.js`** — add the count to the appropriate `Promise.all`
   batch and expose it under `totals`, `engagement`, or `health`. Reuse `ACTIVE_TASK` if the
   metric is about work in hand.
2. **`webinterface/src/views/Admin.vue`** — add a row to `engagementRows` or `healthRows`,
   or a card to `metricCards` if it deserves top billing.
3. **`tests/api/admin.spec.js`** — assert it, with `>=` if it is a global count (see below).

Adding a *chart* does not mean adding a chart library. The trend strip is plain CSS-height
`div`s; `chart.js` was deliberately removed in task `00042` and should not come back.

---

## Testing

`tests/api/admin.spec.js` and `tests/ui/admin.spec.js`; run with `npm test -- -g "admin"`.

> **The concurrency trap.** Twelve Playwright workers share one test database and these
> endpoints count *every* tenant, so `totals.users` changes while a test is running. Assert
> global counts with `toBeGreaterThanOrEqual`, and use `?search=<namespaced username>` when
> you need an exact number — that pins the query to the test's own tenant.

The `adminPage` fixture in `tests/fixtures/index.js` gives a browser session logged in as
the seeded admin, alongside `loggedInPage` for the ordinary-user case.
