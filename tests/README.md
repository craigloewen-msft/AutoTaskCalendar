# tests/

Playwright suite covering the API. The browser (UI) specs were removed as flaky, so the
Vue front end has no automated coverage.

```bash
npm test                    # everything, twelve local workers; four in CI
npm test -- -g "a name"     # one test, seconds
npm test -- --workers=1     # force serial execution
npm test -- --ui            # interactive runner
```

**Read `docs/TESTING.md` before adding a test.** It has the templates, the fixture
reference, and the debugging guide. `docs/SEEDING.md` covers the seeded dataset.

The short version:

```js
const { test, expect } = require('../fixtures');   // never from '@playwright/test'

test('does the thing', async ({ seed, api }) => {
    const data = await seed();                     // the dataset, and everything in it
    const res = await api.get('/api/getUserTasks');
    expect((await res.json()).success).toBe(true);
});
```

Layout:

- `fixtures/` — `seed`, `api`, `apiAnon`, `loginAs`, `withDb`.
- `api/` — HTTP-level and tenant-isolation tests. Fast; put logic coverage here.

Reading the database directly? Go through `withDb`, which connects to the right
per-instance database for you:

```js
const { test, expect, withDb } = require('../fixtures');

const data = await seed();
const user = await withDb(() => UserDetails.findById(data.primary.user._id));
```
