# tests/

Playwright suite covering the API and the Vue UI.

```bash
npm test                    # everything (~3 min)
npm test -- tests/api       # API only (~1 min)
npm test -- -g "a name"     # one test, seconds
npm test -- --ui            # interactive UI mode
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

- `fixtures/` — `seed`, `api`, `apiAnon`, `loginAs`, `loggedInPage`, `withDb`.
- `api/` — HTTP-level tests. Fast; put logic coverage here.
- `ui/` — browser tests. Slower; keep them to user-visible smoke paths.

Reading the database directly? Go through `withDb`, which connects to the right
per-instance database for you:

```js
const { test, expect, withDb } = require('../fixtures');

const user = await withDb(() => UserDetails.findOne({ username: 'testuser' }));
```
