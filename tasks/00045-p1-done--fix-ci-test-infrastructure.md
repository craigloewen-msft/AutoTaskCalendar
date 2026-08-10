# Fix CI test infrastructure and deployment packaging

## Problem

The GitHub Actions deployment pipeline builds the Vue app successfully, then `npm test`
fails before Playwright starts:

```text
error: 'wslc' not found on PATH. It is required to run the dev database.
```

`scripts/test.js` unconditionally starts MongoDB through `scripts/dev-db.sh`, while `wslc`
is a local WSL runtime and is not available on the Ubuntu GitHub Actions runner. Once this
is fixed, the same job also needs a Playwright Chromium installation to run the UI project.
The deployment package additionally omits `instance.js`, even though `app.js` requires it at
startup.

## Requirements

- When `AUTOTASKCALENDAR_TEST_MONGO_URL` is set, `npm test` shall use that URL and shall not
  invoke the local `wslc` database manager.
- When `AUTOTASKCALENDAR_TEST_MONGO_URL` is absent, `npm test` shall retain the current
  per-instance `wslc` startup and isolation behavior.
- The explicit test URL shall be propagated to the app, global setup, fixtures, and seeding
  through the existing `AUTOTASKCALENDAR_MONGO_URL` interface.
- The CI build job shall provide a disposable MongoDB service and configure the test runner
  to use a database dedicated to that run.
- The CI build job shall install the locked Playwright version's Chromium browser and Linux
  dependencies before running the full suite.
- The Azure deployment artifact shall include `instance.js` so the deployed app can start.
- Documentation shall warn that an externally managed test database is wiped/reseeded and
  must be disposable.

## Implementation plan

1. Update `scripts/test.js` to recognize `AUTOTASKCALENDAR_TEST_MONGO_URL`, pass it to all
   child processes as `AUTOTASKCALENDAR_MONGO_URL`, and skip only the `dev-db.sh up` step in
   that mode. Keep database readiness checking in Playwright global setup.
2. Add a focused Playwright regression spec for the launcher. Run it as a child process with
   a mock `npx`, an external test URL, and a PATH without `wslc`; assert that the launcher
   reaches Playwright successfully rather than trying to start a local container.
3. Update `.github/workflows/main_autotaskcalendar.yml` to:
   - start a pinned MongoDB service on localhost;
   - install Chromium with Playwright;
   - set `AUTOTASKCALENDAR_TEST_MONGO_URL` for the test command;
   - copy `instance.js` into `deploy-package`.
4. Document local versus externally managed test databases in `docs/TESTING.md`, including
   the disposable-database warning and a CI/local example.

## Verification

- Run the focused launcher regression spec.
- Run `npm run test:api` while retaining the normal local `wslc` path.
- Run the suite against an externally managed MongoDB URL and confirm no `wslc` command is
  attempted.
- Run `npm run verify`.
- Validate the workflow YAML and inspect the generated deployment package for `instance.js`.
