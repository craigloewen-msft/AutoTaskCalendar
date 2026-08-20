# Remove flaky browser tests

The `login` UI spec is chronically flaky. Per the user's decision, delete it and every
other timing-sensitive spec rather than diagnosing the underlying race.

## Scope

Delete the whole browser-driven suite — every `tests/ui/*.spec.js` depends on real
navigation, Vue mount timing, and redirect races, so all of it is "could be flaky":

- `tests/ui/login.spec.js`
- `tests/ui/calendar.spec.js`
- `tests/ui/weeklyPlan.spec.js`
- `tests/ui/compass.spec.js`
- `tests/ui/user.spec.js`
- `tests/ui/admin.spec.js`

Also remove the now-unused browser-only fixtures from `tests/fixtures/index.js`
(`loggedInPage`, `adminPage`, `nonUtcPage`) and their doc-comment entries, plus any
Playwright config that only exists to serve UI tests (browser install step in
`scripts/test.js`, `webServer`/frontend-build wiring in `playwright.config.js` if it is
not needed by the API specs).

Keep `tests/api/**` intact — those are request-level and deterministic.

## Consequences (accepted)

- No end-to-end coverage of login, logout, session-cookie handling, the `?next=`
  redirect, calendar rendering, weekly plan UI, compass UI, or the admin dashboard.
- Real regressions in those flows will now reach users undetected.
- The underlying race (likely the `$router.push` after the store `login` dispatch in
  `webinterface/src/views/Login.vue`) remains unfixed.

## Steps

1. `git rm` the six UI spec files; remove `tests/ui/` if empty.
2. Prune the browser fixtures and their docs from `tests/fixtures/index.js`.
3. Simplify `playwright.config.js` / `scripts/test.js` where they exist only for UI runs.
4. Update `docs/TESTING.md` and `tests/README.md` to state the suite is API-only now.
5. Run `npm test` and confirm a clean, green API-only run.
