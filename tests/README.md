# tests/

Playwright suite covering the API and the Vue UI.

```bash
npm test                    # everything
npm test -- --project=api   # API only
npm run test:ui             # interactive UI mode
```

**Read `docs/TESTING.md` before adding a test.** It has the templates, the fixture
reference, and the debugging guide. `docs/SEEDING.md` covers the data scenarios.

The short version:

```js
const { test, expect } = require('../fixtures');   // never from '@playwright/test'

test('does the thing', async ({ seed, api }) => {
    await seed('full');                            // pick your data first
    const res = await api.get('/api/getUserTasks');
    expect((await res.json()).success).toBe(true);
});
```

Layout:

- `fixtures/` — `seed`, `api`, `apiAnon`, `loginAs`, `loggedInPage`.
- `api/` — HTTP-level tests. Fast; put logic coverage here.
- `ui/` — browser tests. Slower; keep them to user-visible smoke paths.
