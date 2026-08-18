# Make Google Calendar sync truthful and bounded

## Outcome

Complete the first active data-correctness item in `docs/REFACTOR_OVERVIEW.md`: Google Calendar listing and sync must stop after at most one access-token refresh and one retry, and `/api/synccalendar` must never return `{ success: true }` after a required provider, transformation, credential, or persistence step failed.

This is one independently releasable correction to the Google provider boundary. It does not make the local Google-event projection transactional or take on the scheduler, recurrence, general transaction, or legacy `repeat` roadmap items.

## Confirmed defects

- `controllers/eventController.js` recursively calls `syncCalendarsToDatabase()` after every 401, so repeated authorization failures have no retry bound.
- The same controller catches provider, transformation, and database failures and returns `false`.
- `routes/events.js` discards that result and always returns `{ success: true }` from `/api/synccalendar` unless an exception escapes.
- Calendar listing has its own one-off refresh implementation, so listing and sync do not share one explicit, testable provider policy.
- A refresh response without a usable access token can be treated as successful and leave the stale access token in place.

## Behavioral invariants

- One calendar-list or sync operation makes its initial Google request once.
- Only an authorization failure from that initial request may trigger a refresh, and it triggers at most one refresh followed by at most one retry of the original provider operation.
- A second authorization failure, failed refresh, missing credential, malformed refresh result, or non-authorization provider failure stops immediately. There is no recursive retry path, backoff loop, or route-level retry.
- A refresh response that omits a replacement refresh token preserves the encrypted refresh token already stored for the user.
- Sync succeeds only after every selected calendar's required event fetch, every event transformation, and all existing local persistence steps complete.
- A failed sync returns the repository's existing safe `{ success: false, log }` envelope and never exposes provider bodies, credentials, or provider error descriptions.
- Calendar-list success payloads and successful sync payloads remain unchanged.
- The existing user-timezone fallback remains available when optional calendar-timezone metadata cannot be loaded for a non-authorization reason. Authorization failures still use the single shared refresh budget rather than being silently retried elsewhere.

## Implementation plan

### 1. Create one bounded Google provider execution path

- Extract the affected Google call/refresh workflow from `routes/events.js` and `controllers/eventController.js` only as far as needed to make the policy explicit and directly testable.
- Add a narrow dependency seam that defaults to `googleapis` in production and accepts a deterministic fake in tests; do not monkey-patch global module state or add a second test runner.
- Build an OAuth client from credentials read through `readGoogleCredentials()`, execute the requested provider operation, recognize Google authorization failures consistently, refresh once, rebuild credentials/client state, and retry once.
- Use an iterative attempt limit or equivalent explicit state. Do not call the list/sync workflow recursively.
- Keep refresh persistence in the existing encrypted credential utility. Validate that refresh produced a non-empty access token before saving, and preserve the old refresh token when Google omits a new one.
- Let required-operation failures propagate to the owning controller/route. Log only fixed, non-sensitive operational messages at the existing boundary.

### 2. Apply the policy to calendar listing and sync

- Route `getCalendars` through the shared bounded provider path instead of maintaining a second refresh implementation. Preserve `{ success: true, calendars }` and the current safe failure message.
- Give one top-level sync request one shared refresh budget across calendar metadata lookup and all selected-calendar event fetches. Parallel selected calendars must not each start an independent refresh.
- Keep event transformation and actor-scoped upsert/prune behavior unchanged. Provider retries cover provider reads only; they must not replay local writes.
- Make missing access credentials and unusable refreshed credentials explicit failed outcomes.
- Keep optional timezone metadata best-effort for non-authorization failures because event transformation already has the saved user timezone fallback.

### 3. Make the sync HTTP result truthful

- Change `/api/synccalendar` so it sends `{ success: true }` only after the controller reports successful completion.
- If the controller returns a failed result or throws, return `returnFailure('Could not sync Google calendars')` through the existing HTTP-200 failure convention.
- Do not expose raw errors or add a new application-wide error/status-code taxonomy in this task.
- Keep the endpoint path/method and successful payload stable; the frontend does not currently announce success, so no UI redesign or duplicate UI spec is needed.

### 4. Update the roadmap

- Add task `00059` to the concise shipped list in `docs/REFACTOR_OVERVIEW.md`.
- Remove the completed Google sync bullet from active work so scheduler validation/publication becomes the next listed data-correctness slice.
- Do not expand the roadmap into an implementation manual.

## Focused verification

Extend `tests/api/events.spec.js` (or add one equally focused API spec) without contacting Google:

- Through the real authenticated API, prove a user with no usable Google credential receives `success: false` from `/api/synccalendar`; this catches the route's current discarded-result defect.
- Through the injected provider seam, prove ordinary success performs no refresh.
- Prove an initial 401 followed by a successful retry performs exactly two provider attempts and one refresh, persists the new encrypted access token, and preserves the existing refresh token when the refresh response omits one.
- Prove a repeated 401 stops after exactly two provider attempts and one refresh and produces a failed outcome.
- Prove refresh failure, malformed refresh success, and a representative non-401 provider failure produce failed outcomes without extra attempts.
- Keep the existing Google timed/all-day/source-timezone transformation assertions unchanged.

Use each test's seeded tenant and the existing credential helpers; fake only the narrow Google adapter. Do not use browser request interception for backend SDK calls. Run `npm test -- tests/api/events.spec.js` while iterating, then `npm test` once during finalization.

## Acceptance criteria

- `/api/synccalendar` cannot return `success: true` when sync reports or throws a failure.
- Calendar listing and sync each enforce at most one token refresh and one retry per top-level operation, including with multiple selected calendars.
- No Google list/sync retry is recursive, unbounded, or duplicated at the route.
- Missing credentials, failed/malformed refresh, repeated 401, and non-401 provider failures settle as safe failures.
- A valid refresh writes the new encrypted access token and does not erase an existing refresh token merely because Google omitted a replacement.
- Successful calendar-list and sync response shapes and existing event temporal/persistence semantics remain compatible.
- Provider payloads, error descriptions, authorization data, and credentials do not enter responses or logs.
- The focused event specs and full Playwright suite pass.
- The roadmap records this item as shipped and identifies scheduler validation/complete projection publication as the next active refactor slice.

## Explicit non-goals

- No transactional or all-or-nothing replacement of the local Google event cache, source-calendar identity migration, sync token/delta protocol, background job, queue, circuit breaker, or general retry framework.
- No special `invalid_grant` credential-deletion workflow or new reconnect/error-code taxonomy; refresh failure is reported truthfully and stops within the same bound.
- No OAuth state, session, account-scope, credential-encryption, or migration redesign completed by task `00055`.
- No Google write scope, new calendar feature, sync-window change, event schema change, or temporal transformation change.
- No scheduler, recurrence, transaction-support investigation, atomic multi-document cascade, or legacy `repeat` work.
- No broad route/controller reorganization, frontend page decomposition, visual redesign, or general API error-contract rewrite.
