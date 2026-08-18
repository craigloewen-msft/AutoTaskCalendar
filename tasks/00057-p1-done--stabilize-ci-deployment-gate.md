# Stabilize the CI deployment test gate

## Diagnosis

The deployment is blocked by the test gate, not by the Azure deploy action itself.

1. `Calendar.vue` intentionally uses a 21-day recurring-task sidebar window, but the failing UI fixture puts its recurring occurrence only 20 days ahead and expects it to be hidden. The window was increased from 14 to 21 days without updating this older fixture. The retry that finds one recurring row is therefore the correct application behavior.
2. The first attempt's missing one-off row and the later cluster of `/api/login` `ECONNRESET` failures indicate shared test-stack pressure rather than defects in the event endpoints. CI currently runs 12 fully parallel workers against one Express process while collecting browser artifacts and running scheduling/database integration tests.
3. The workflow also starts a MongoDB service and exports `AUTOTASKCALENDAR_TEST_MONGO_URL`, but `scripts/test.js` no longer reads that variable; it starts the repository-managed `autotaskcalendar-mongo` container instead. CI therefore runs two MongoDB containers, one unused.

The supplied excerpt does not include the server's termination line, so resource exhaustion cannot be proven from that excerpt alone. The clustered socket resets, worker count, and duplicate database service make it the strongest explanation, and the changes below remove those concrete hazards without masking failures through request retries.

## Implementation

1. Update the Calendar regression fixture so the recurring occurrence is unambiguously outside the documented 21-day window. Pin the browser clock for the assertion so a UTC-midnight rollover cannot move the fixture back onto the boundary. Keep the one-off and unscheduled assertions unchanged.
2. Keep 12 workers for local development, but cap CI at four workers in `playwright.config.js`. Four was the repository's original parallel setting and still exercises tenant isolation while fitting a hosted runner more safely.
3. Remove the unused MongoDB service and stale `AUTOTASKCALENDAR_TEST_MONGO_URL` setting from the GitHub Actions workflow. Continue using `npm test` as the single owner of database startup, per the repository's documented contract.
4. Update `docs/TESTING.md` to distinguish the 12-worker local default from the four-worker CI cap and to state that the test runner owns MongoDB in CI too.

No production event, login, scheduling, or sidebar behavior will be changed, and no network retry will be added to hide a dead server.

## Verification

- Repeat the focused Calendar sidebar test several times.
- Run `tests/api/events.spec.js` under the CI worker configuration.
- Confirm the loaded Playwright configuration resolves to four workers with `CI=1` and twelve workers locally.
- Run the full suite once with the CI environment so the exact deployment gate, including retries/reporters and the four-worker cap, passes without socket resets.

## Acceptance criteria

- A one-off task beyond the recurring sidebar window remains visible.
- A recurring occurrence beyond 21 days is hidden, while unscheduled work remains first and marked `NEEDS TIME`.
- CI uses four Playwright workers; local runs retain twelve unless explicitly overridden on the command line.
- GitHub Actions starts only the test runner's MongoDB container.
- The full CI-mode test suite passes without `ECONNRESET` login failures.
