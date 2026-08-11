# Run the Playwright suite with parallel workers and isolated tenants

## Goal

Reduce the wall-clock time of the full `npm test` gate without introducing database races,
port collisions, missing artifacts, or confusing output.

## Final design

After validating an isolated-shard implementation, the suite moved to the simpler native
Playwright model requested during review:

- one Playwright process with `workers: 4`;
- one Express server and one run-specific database;
- unique users for every test;
- tenant-scoped seeding and teardown instead of whole-database wipes;
- normal Playwright argument and reporting behavior.

The original shard requirements and implementation notes below are retained as the
point-in-time approved plan; the Result section records the final design.


The current suite takes about three minutes because `playwright.config.js` fixes `workers: 1`. Simply raising that number is unsafe: every test's `seed()` call wipes the one database used by the app server. Parallelism must therefore happen above Playwright's workers, with a complete isolated app stack per shard.

## Required behavior

- A normal unfiltered `npm test` SHALL run several Playwright shards concurrently.
- The default shard count SHALL be based on available CPU and capped at four, so ordinary developer and CI machines gain parallelism without spawning an unbounded number of Express/Chromium processes.
- `AUTOTASKCALENDAR_TEST_SHARDS=<n>` SHALL override the default; `1` SHALL provide an explicit serial mode.
- Every shard SHALL have a unique instance name, Express port, MongoDB database, session cookie, Playwright output directory, and blob report.
- All shards SHALL continue sharing the one host MongoDB container. No extra MongoDB containers shall be created.
- Each shard SHALL keep `workers: 1`; tests inside one shard must remain serial because they share that shard's database.
- Enable Playwright's `fullyParallel` test distribution so individual tests, rather than only the repository's unevenly sized spec files, can be balanced across isolated shards.
- The parent runner SHALL wait for every shard, merge the blob reports into one terminal result and one HTML report, and return nonzero when any shard or merge fails.
- Failure screenshots, videos, traces, and logs SHALL remain available in run-specific paths, and the runner SHALL print those paths.
- Frontend staleness checks/builds, MongoDB startup, and browser installation SHALL run once in the parent before fan-out.
- The runner SHALL forward `SIGINT` and `SIGTERM` to all active children and avoid leaving Express servers behind.
- Focused and interactive invocations SHALL stay single-process by default so commands such as `npm test -- -g "name"`, `--ui`, `--debug`, `--list`, and file filters remain fast and predictable.
- Existing Playwright arguments SHALL continue to pass through unchanged in serial mode. Explicit `--shard`, `--workers`, `--reporter`, or `--output` controls SHALL not be silently combined with automatic fan-out.
- An explicitly set shard count MAY enable parallel execution for compatible filtered runs; incompatible interactive or caller-owned sharding/reporting modes must still use the safe serial path or fail with an actionable message.
- Concurrent top-level test runs on the same branch SHALL not share shard databases or report directories. Include a per-run identifier in shard instance names and output paths.

## Implementation plan

1. Refactor `scripts/test.js` into an asynchronous parent orchestrator while retaining its current database, stale-build, browser-install, timezone, and environment setup.
2. Extract small, testable helpers for:
   - validating/resolving the shard count;
   - deciding whether an argv set supports automatic sharding;
   - producing unique run/shard instance names;
   - resolving and pinning the complete per-shard environment;
   - aggregating child and merge exit statuses.
3. For each shard, resolve a separate instance and spawn `npx playwright test --shard=<index>/<total> --workers=1` with the caller's compatible arguments. Give each process its own `--output` path and force the blob reporter into a fresh run-specific directory.
4. Update `playwright.config.js` so sharded test distribution is balanced while the process-local worker count stays one. Make reporter and output behavior environment-aware where the parent runner needs it, and do not reuse an existing server for orchestrated test shards.
5. Merge shard blobs after all children exit. Produce the same local/CI terminal reporting semantics as today plus one HTML report. Attempt the merge even when tests fail so diagnostics are not lost; surface a shard's captured log if it crashes without a blob.
6. Handle child startup errors and process signals deterministically. Let sibling shards finish after ordinary test failures so the merged report describes the whole suite.
7. Namespace the fixed synthetic instance/database names in `tests/api/dev-database.spec.js` with the test run identifier where necessary, so two complete suite invocations cannot mutate the same marker databases.
8. Update `docs/TESTING.md` and script usage comments with:
   - default parallel behavior;
   - `AUTOTASKCALENDAR_TEST_SHARDS=1` serial mode;
   - overriding shard count;
   - focused/interactive fallback behavior;
   - run-specific artifact/report locations;
   - the distinction between unsafe shared-database workers and safe isolated shards.

## Specs

Add behavior-level coverage for the runner rather than relying only on a timing observation:

- default shard count is CPU-aware and capped at four;
- valid environment overrides are honored and invalid values fail clearly;
- focused and interactive argv select serial mode;
- caller-owned shard/worker/reporter/output arguments are never combined with automatic sharding;
- two planned shards receive distinct instance names, app ports, database names, base URLs, and output directories while sharing the MongoDB port;
- run identifiers keep two concurrent plans disjoint;
- aggregate status fails when any shard fails;
- a narrow integration smoke test runs two isolated shards that both seed successfully and produces a merged report.

Keep test-only orchestration helpers side-effect free so these specs do not recursively run the complete suite.

## Verification

1. Run the new runner-focused specs while iterating.
2. Compare serial and four-shard full-suite results from the same checkout:
   - `AUTOTASKCALENDAR_TEST_SHARDS=1 npm test`
   - `AUTOTASKCALENDAR_TEST_SHARDS=4 npm test`
3. Confirm both runs execute the same test count and pass, while the four-shard run has materially lower wall-clock time on a machine with enough CPU.
4. Confirm a deliberate failing test still yields one merged terminal summary, an HTML report, and its trace/screenshot/video.
5. Confirm `npm test -- -g "<one test>"`, `npm test -- --ui`, and an explicit Playwright `--shard` invocation use the documented safe path.
6. Run the complete `npm test` suite once as the final gate.

## Result

The first implementation used isolated Playwright shards. It passed all 206 tests in
133.793 seconds versus 329.928 seconds serial, but created unnecessary orchestration.

The final implementation uses Playwright's native `workers: 4` with one Express server and
one run-specific database. Every test seeds uniquely named users and removes only its own
tenant, so workers never wipe one another's state. The runner drops the complete database
on exit. This removed the shard planner, multiple app processes, blob report merging, and
custom argument rules.

Final verification: 199 tests passed in 138.071 seconds (2.3 minutes), including explicit
tenant-isolation, OAuth-origin, and instance-name coverage. That is 2.39× faster and 58.2%
less wall-clock time than the 329.928-second serial baseline. The native-worker version is
about 3% slower than isolated shards, in exchange for roughly 900 fewer lines and standard
Playwright behavior.

## Non-goals

- Do not route requests dynamically to a database per Playwright worker.
- Do not create one MongoDB container per shard.
- Do not make tests sharing a database concurrent.
- Do not split GitHub Actions into a deployment matrix in this change; the existing workflow gains speed through the runner automatically.
