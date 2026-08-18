# Secure account and Google integration boundaries

## Outcome

Complete the current **“Do first: secure account and integration boundaries”** stage of `docs/REFACTOR_OVERVIEW.md` as one independently releasable security change. Afterward, update the roadmap so incorrect or partially published data is the next active stage.

This task closes four confirmed defects together because OAuth state binding, browser authentication, logout, and protected credential access share the same account boundary. It does not take on Google sync truthfulness/retry, scheduler publication, recurrence concurrency, transaction design, or legacy `repeat` removal.

## Security invariants

- A Google OAuth callback can affect only the authenticated browser session and user that initiated it.
- OAuth state is cryptographically unpredictable, expires, and can be consumed successfully at most once, including under concurrent callbacks.
- Google access and refresh tokens are authenticated ciphertext at rest; legacy plaintext fields are migrated and removed before the app accepts traffic.
- The browser has one authentication lifecycle: a server-side Passport session in an `HttpOnly` cookie. Browser-readable JWTs are neither issued nor accepted.
- Logout destroys the server session, so its old cookie cannot authorize another request.
- An authenticated actor can read only their own account record; account selection never comes from a URL parameter.
- OAuth URLs, authorization codes, tokens, and provider response bodies never enter application logs.

## Implementation plan

### 1. Make Passport sessions the only browser authentication mechanism

- Replace `middleware/auth.js` JWT verification with session authentication based on Passport’s deserialized user. Reject missing sessions with 401 and reject browser requests identified as cross-site, while allowing non-browser API clients that possess a valid session cookie.
- In `app.js`, retain `express-session`, `connect-mongo`, `passport.initialize()`, and `passport.session()`, but harden the cookie (`HttpOnly`, `SameSite=Lax`, production `Secure`), use `saveUninitialized: false`, use the intended two-week TTL, and trust the production proxy where required for secure cookies.
- Regenerate the session before establishing login or registration authentication to prevent session fixation. Return the basic user record without a JWT.
- Replace `GET /api/logout` with authenticated `POST /api/logout`; log out through Passport, destroy the session in MongoDB, and clear the session cookie.
- Remove `jsonwebtoken` and its lockfile entries. Keep the existing server secret as key material for Google credential encryption so production does not need an unsafe key cutover.
- Use the authenticated Passport user consistently in all protected routes; do not retain a compatibility path that accepts an old Authorization JWT.
- Add same-origin protection to unauthenticated login and registration requests, and ensure authenticated browser requests cannot use a cross-site session. The OAuth callback is the deliberate cross-site redirect exception and must pass its own state/session checks.

### 2. Make the frontend derive authentication from the server session

- Remove token and login-expiry state from `webinterface/src/store.js` and clear any legacy auth values from `localStorage` during upgrade.
- Add one deduplicated session bootstrap action that calls the self endpoint and sets the current user. Login and registration store only the returned user in memory.
- Make logout call the server first and always clear local auth state afterward. A server-rejected session also clears local state.
- Update router guards to await the initial session check rather than trusting `localStorage` or a mismatched 14-day client timer.
- Fix the Axios 401 interceptor so it clears auth, redirects appropriately, and rejects rather than leaving requests pending. Explicitly allow same-origin cookie credentials.
- Remove frontend logging of the generated Google OAuth URL.

### 3. Scope account reads to the authenticated actor

- Replace `GET /api/user/:username` with authenticated `GET /api/user` and return only `req.user` through `returnBasicUserInfo`.
- Remove the path-selected account API. The Vue profile route may keep its display URL, but it must not be an authorization input.
- Audit every protected route during the session conversion and keep task, event, Compass, scheduling, and settings queries scoped to the authenticated user.

### 4. Add atomic, session-bound Google OAuth state

- Add a small transient OAuth-state model containing only a SHA-256 state digest, initiating user reference, initiating session digest, and expiry. Use a unique state index and TTL expiry index.
- On `GET /api/connectGoogle`, generate at least 256 random bits, persist only its digest with a short expiry, and send the raw value to Google. Remove superseded state records for that session.
- On the callback, require the initiating Passport session, hash the supplied state, and atomically `findOneAndDelete` the matching unexpired record for that user and session before handling provider errors or exchanging a code. A mismatch must not consume another session’s state.
- Redirect missing, expired, fabricated, cross-session, and replayed state to a generic invalid-state result without exposing account existence.
- Keep the callback compatible with Google’s top-level redirect and consume valid state even when the provider denies access or omits a code.

### 5. Encrypt and migrate Google credentials

- Add a focused Google credential utility using AES-256-GCM with a random nonce and authenticated versioned envelope. Derive a dedicated subkey from the existing server secret using HKDF domain separation; fail startup if required key material is absent.
- Replace the plaintext user fields with explicitly named ciphertext fields. All OAuth callback, calendar listing, refresh, and sync paths must use the credential utility and must fail closed on malformed or undecryptable data.
- Before listening, run an idempotent migration that encrypts any legacy `googleAccessToken` / `googleRefreshToken` values and unsets the plaintext fields. Test partial credentials and already-migrated records. This startup ordering is limited to making the credential migration safe; broader readiness work remains outside this task.
- Preserve existing refresh and sync behavior otherwise. In particular, do not address truthful sync failures or bounded retries here; that is the next roadmap stage.
- Remove logs containing OAuth URLs or dynamic provider details. Keep only concise, non-sensitive operational messages where useful.

### 6. Update the roadmap

- Remove the completed security bullets from the active queue and record this task in a single concise shipped entry.
- Promote **prevent incorrect or partially published data** to the current “Do first” section without adding implementation-manual detail.
- Leave the roadmap’s non-goals and one-item-at-a-time execution rule intact.

## Focused verification

Add behavior specs alongside the fixes:

- **OAuth account binding:** user B cannot use user A’s state; B’s attempt does not consume A’s valid state; a raw user ObjectId or fabricated state cannot select an account.
- **OAuth replay and expiry:** one of concurrent/repeated callbacks can consume state at most once, and an expired state is rejected without reaching token exchange.
- **Credential protection:** legacy plaintext credentials migrate to decryptable authenticated ciphertext, raw MongoDB records contain neither plaintext token nor legacy fields, and tampered ciphertext is rejected.
- **Cross-account read:** `GET /api/user` returns the caller; the removed username-selected endpoint cannot return the other seeded account.
- **Logout:** the same session works before logout and receives 401 afterward; an Authorization header containing an old-style JWT cannot authenticate.
- **Browser lifecycle:** login, reload/session bootstrap, logout, cleared legacy local storage, anonymous redirect, and rejected-session handling work through the real UI.

Update shared Playwright fixtures to retain the cookie-bearing request context created by login rather than discarding it and constructing a JWT context. Give OAuth API tests harmless test-only client configuration so URL generation is exercised without contacting Google; use missing-code/provider-denial paths after state consumption to avoid external network calls.

Run narrow auth/event/UI specs while iterating, then `npm test` once at finalization.

## Acceptance criteria

- The four bullets in the roadmap’s current security stage are implemented and no longer active work.
- OAuth state is random, short-lived, atomically one-use, and bound to both the initiating session and authenticated user.
- No callback can bind credentials by supplying a user ID, borrowing another session’s state, replaying state, or using expired state.
- No Google token remains in the legacy plaintext fields after startup migration, and every runtime token read/write passes through authenticated encryption.
- The application issues and accepts only hardened Passport session cookies for browser authentication; no JWT or browser auth token remains.
- Login and registration rotate the session; logout destroys it server-side; protected endpoints reject the destroyed session.
- Account data is available only from the self endpoint and cannot be selected by another username.
- Sensitive OAuth/provider values are absent from backend and frontend logging.
- Existing task, event, Compass, recurrence, scheduling, timezone, and calendar behavior remains unchanged outside the account boundary.
- `docs/REFACTOR_OVERVIEW.md` identifies data correctness as the next active roadmap stage and remains concise.
- The focused specs and full Playwright suite pass.

## Explicit non-goals

- No Google sync success-contract or retry redesign.
- No scheduler, recurrence, transaction, index, or legacy `repeat` work except the transient OAuth-state indexes.
- No broad API error-contract rewrite, rate limiting, readiness endpoint, deployment redesign, or unrelated dependency cleanup.
- No frontend visual redesign or general API-client/page decomposition.
