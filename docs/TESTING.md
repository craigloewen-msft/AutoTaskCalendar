# Testing

AutoTaskCalendar has one test suite: **Playwright**, covering both the HTTP API and the
Vue UI. This file is the whole manual — how to run it, how to add to it, and how to debug
a failure.

**The rule: any behaviour change ships with a spec.** If you fix a bug, add the test that
would have caught it. If you add a feature, add the test that proves it works.

## Running the tests

```bash
npm test                                     # the whole suite (~3 min)
npm test -- tests/api                        # API tests only (~1 min)
npm test -- tests/api/tasks.spec.js          # one file
npm test -- -g "completes a task"            # one test by name, seconds
npm test -- --ui                             # watch, step, time-travel
```

Everything after `--` goes straight to Playwright.

**Iterating on one thing? Do not run the whole suite.** `npm test -- -g "<name>"` takes
seconds; save the full run for just before you commit.

`npm test` handles the setup itself: it starts the database, downloads the Chromium
browser the first time, rebuilds the web bundle whenever `webinterface/src` is newer than
`dist/`, then starts the app and runs the suite. There is nothing to install or export
beforehand.

## How isolation works

Tests never touch the database you develop against. `scripts/test.js` runs everything
under the instance name `<your-branch>-test`, and `instance.js` turns that name into its
own ports, database, and session cookie. All instances share one MongoDB container and are
isolated by database name.

```mermaid
flowchart LR
  A["npm run dev (instance: my-branch)"] --> B[("db: ..._my_branch")]
  C["npm test (instance: my-branch-test)"] --> D[("db: ..._my_branch_test")]
```

So you can leave `npm run dev` running while the suite executes, and several agents can
test at once without colliding. `npm test` prints the ports and database it chose.

The suite runs the **built** bundle served by Express (one server on the API port), which
is closer to production and faster than the webpack dev server.

Tests share one database and therefore run serially (`workers: 1`). Each test reseeds
whatever it needs, so order never matters.

## Writing a test

Everything lives in `tests/`:

```
tests/
  fixtures/index.js     shared fixtures (seed, api, loggedInPage, withDb, ...)
  fixtures/db.js        database connection handling
  api/*.spec.js         HTTP-level tests
  ui/*.spec.js          browser tests
```

Always import `test` and `expect` from the fixtures, never from `@playwright/test`
directly — that is what gives you seeding and authentication.

### Fixtures

| Fixture | What it gives you |
| --- | --- |
| `seed()` | Wipes the database and builds the dataset. Returns everything it created. |
| `seed.clearTasks()` | Removes the primary user's tasks and events, for empty-state tests. |
| `api` | Request context authenticated as `testuser`. |
| `apiAnon` | Request context with no credentials, for auth-failure tests. |
| `loginAs(user, pass)` | Authenticated request context for any seeded user. |
| `loggedInPage` | A browser page already logged in as `testuser`. |
| `withDb(fn)` | Run a query against the test database, connecting if needed. |

### API test template

```js
const { test, expect } = require('../fixtures');

test('rejects a task with no duration', async ({ seed, api }) => {
    await seed();

    const res = await api.post('/api/createTask', { data: { title: 'No duration' } });
    const body = await res.json();

    // Remember: API errors are HTTP 200 with success: false.
    expect(body.success).toBe(false);
});
```

### UI test template

```js
const { test, expect } = require('../fixtures');

test('shows the seeded tasks', async ({ seed, loggedInPage: page }) => {
    const data = await seed();

    await page.goto('/#/calendar');

    await expect(page.locator('.task-list')).toContainText(data.named.proposal.title);
});
```

Routes are hash-based, so URLs look like `/#/calendar` and `/#/about`.

### Using the data

The dataset contains everything worth testing — see `docs/SEEDING.md`. Reach for
`data.named.*` and `data.counts.*` rather than hard-coding titles and numbers, so your
assertions survive the dataset growing:

```js
const data = await seed();
expect(events).toHaveLength(data.counts.repeating);   // not: toBe(3)
```

If your test needs an empty account, set that up explicitly:

```js
await seed.clearTasks();
```

## Testing the scheduler

`controllers/scheduling.js` is the highest-risk code in the repo. Its tests
(`tests/api/scheduling.spec.js`) assert **invariants**, not exact timestamps, because the
result depends on the current time:

- nothing is scheduled outside working hours or on a non-working day
- nothing overlaps a calendar event or another scheduled task
- nothing is scheduled before its dependency or before its own start date
- broken-up tasks never exceed their total duration
- completed tasks are never scheduled
- re-running the scheduler is idempotent
- the hostile edge-case tasks complete rather than hanging

When you change the scheduler, add an invariant rather than pinning a timestamp. Pinned
timestamps break every time the clock moves, and everyone learns to ignore them.

## Debugging a failure

Artifacts are captured **on failure only**, so a green run leaves `test-results/` empty.
A failed test leaves four things behind:

```
test-results/calendar-calendar-page-renders-tasks-ui/
  test-failed-1.png     screenshot at the moment of failure
  video.webm            video of the whole test
  trace.zip             full time-travel recording (the useful one)
  error-context.md      the page's accessibility tree as text
```

The trace is a step-by-step recording where you can scrub through the test and inspect the
DOM at each step:

```bash
npx playwright show-trace test-results/<the-failing-test>/trace.zip
npx playwright show-report        # the HTML report for the whole run
```

`error-context.md` is worth knowing about if you are an agent rather than a human — it is
plain text, so you can `cat` it without a browser. It contains the expected vs. received
values and a text rendering of the page, which is usually enough to diagnose a failure
without opening anything.

Useful flags:

```bash
npm test -- --headed             # watch the browser as it runs
npm test -- --debug              # step through with the inspector
npm test -- --repeat-each=5      # hunt for flakiness
```

## Troubleshooting

**A test passes alone but fails in the suite.** It is depending on data another test left
behind. Call `seed(...)` at the top of the test so it owns its state.

**The suite cannot reach MongoDB.** `npm test` starts the container itself; check it with
`docker logs autotaskcalendar-mongo`, or recreate it with
`docker rm -f autotaskcalendar-mongo`.

**Browser tests fail right after a front-end change.** `npm test` rebuilds when
`webinterface/src` is newer than `dist/`, but a file restored from git can carry an old
timestamp. Force it with `npm run build`.
