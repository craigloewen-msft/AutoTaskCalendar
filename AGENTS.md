# AGENTS.md

AutoTaskCalendar: task manager that auto-schedules tasks onto a calendar.
Express + Mongoose (MongoDB) backend, Vue 3 (vue-cli) frontend in `webinterface/`.

## Start here

```bash
npm install && (cd webinterface && npm install)
npm run seed        # optional: testuser / testpassword
npm run dev         # starts mongo, API, and web UI
```

Nothing needs to be exported. Each git branch automatically gets its own ports, MongoDB
database, container, and session cookie, so several agents can run at once without
colliding. `main` uses the standard 8080/3000/27017.

Run `npm run db:status` to print the ports and database name for your branch. Override the
name with `AUTOTASKCALENDAR_INSTANCE` if you need two stacks on one branch.

## Coding style

Keep all comments short and concise, usually just 1 or 2 sentences max.

## Containers: `wslc`, not docker

MongoDB runs in a `wslc` container (no compose support; `scripts/dev-db.sh` replaces it):
`npm run db:up | db:down | db:reset | db:status | db:logs`.
`scripts/dev-db.sh nuke-all` removes every instance's container and volume.

## Verify

`npm run build` must succeed. There is no test suite — verify changes by running the app.

## Layout

- `app.js` — Express setup, session/passport wiring, route mounting.
- `instance.js` — per-instance ports/DB names. Single source of truth.
- `routes/` — HTTP endpoints; `controllers/` — business logic.
- `controllers/scheduling.js` — the task-scheduling algorithm. Highest-risk code.
- `models/index.js` — all Mongoose schemas. Import these; never redefine.
- `middleware/auth.js` — JWT `authenticateToken`. `utils/helpers.js` — `returnFailure()`.
- `webinterface/src/` — Vue app (`views/`, `components/`, `store.js`).
- `scripts/` — `dev.js` (dev stack), `dev-db.sh` (database).
- `docs/` — one file per broad concept, each a standalone instruction manual.

## Documenting your work

Any broad concept (a subsystem, a workflow, an integration) gets its own file in `docs/`,
written as an instruction manual someone can follow end to end. Keep this file as the
short index and put the depth in `docs/`. See `docs/TEST_CREDENTIALS.md` for the format.

## Gotchas

- `config.js` (gitignored) overrides `defaultconfig.js`; production reads env vars instead.
- API errors return HTTP 200 with `{success: false}` via `returnFailure()`.
- Dates use `moment`; watch UTC vs. local conversions and per-user timezone offsets.
- Keep code comments to one or two sentences.
