# Personal API tokens

Personal API tokens let a desktop tool or script act as a user without a browser session.
The Omarchy "Reminder (AutoTaskCalendar)" quick-add plugin is the first client.

---

## Creating and revoking

Users manage tokens on the **User** page (`/user`, "API tokens" card). A new token is shown
**once**; only its SHA-256 digest is stored. Revoking deletes the record, and the token stops
working on the next request. Each user may hold at most 20 tokens.

| Route | Auth | Purpose |
|---|---|---|
| `GET /api/apiTokens` | session only | List tokens (`name`, `prefix`, `createdAt`, `lastUsedAt`) — never the secret |
| `POST /api/apiTokens {name}` | session only | Create; returns `{ success, token, apiToken }` |
| `DELETE /api/apiTokens/:id` | session only | Revoke a token the caller owns |

## Format and storage

`atc_` + 32 random bytes as base64url (47 characters). The `apiToken` collection holds
`{ userRef, name, tokenDigest (unique), prefix, createdAt, lastUsedAt }`. The first ten
characters (`prefix`) are kept so users can tell tokens apart. `lastUsedAt` is updated at
most once a minute. Helpers live in `utils/apiTokens.js`.

## Using a token

Send `Authorization: Bearer atc_…` to any route guarded by `authenticateSession`:

```bash
curl -H "Authorization: Bearer $ATC_TOKEN" https://autotaskcalendar.azurewebsites.net/api/projects
```

- A bearer request skips the same-origin check: a token is not an ambient credential, so it
  cannot be ridden by a cross-site request the way a cookie can.
- A malformed, unknown, or revoked token gets **401** and never falls back to the session
  cookie, even if one is also sent.
- `req.authMethod === 'apiToken'` on bearer requests. `requireSessionAuth` rejects those with
  **403**; it guards token management, logout, Google Calendar connection, and (through
  `requireAdmin`) the admin dashboard, so a leaked token cannot mint more tokens or escalate.

## Endpoints a quick-add client needs

- `GET /api/projects` → `{ success, projects: [{ _id, title, goalTitle, roleTitle, label, context }] }`.
  Live projects only (ended projects and those under ended goals are omitted). `label` is
  `Role → Goal`, matching the web project picker; `context` is `work` or `personal`.
- `POST /api/recommendTaskProject` — see `docs/PROJECT_RECOMMENDATIONS.md`.
- `POST /api/createTask {title, duration, startDate, dueDate, projectRef}` — dates are
  `YYYY-MM-DD`. Tasks under a `personal` project become intentions (see `docs/INTENTIONS.md`),
  whose due date the server sets to the end of the start week.

## Desktop setup (Omarchy plugin)

Create a token on the User page, then store it with the plugin helper (mode 600):

```bash
~/.config/omarchy/plugins/craig.autotask-reminder/bin/atc set-token   # paste, then Ctrl+D
~/.config/omarchy/plugins/craig.autotask-reminder/bin/atc status
```

## Tests

`tests/api/apiTokens.spec.js` covers the token lifecycle over a cross-origin bearer request
and the session-only and no-fallback boundaries.
