# AGENTS.md

AutoTaskCalendar: task manager that auto-schedules tasks onto a calendar.
Express + Mongoose (MongoDB) backend, Vue 3 (vue-cli) frontend in `webinterface/`.

## Start here

```bash
export AUTOTASKCALENDAR_INSTANCE=<your-agent-name>   # REQUIRED, must be unique
npm install && (cd webinterface && npm install)
npm run seed        # optional: testuser / testpassword
npm run dev         # starts mongo, API, and web UI
```

**Every agent must set a unique `AUTOTASKCALENDAR_INSTANCE`.** All ports, the MongoDB
database, the container/volume names, and the session cookie are derived from it, so
instances with different names never collide. Two agents sharing a name will fight over
ports and corrupt each other's data.

## Ports and database

Derived from the instance name (see `instance.js`); `default` gets offset 0. Run
`npm run db:status` to print yours.

| | `default` | derived |
|---|---|---|
| web UI | 8080 | `8080 + offset*10` |
| API | 3000 | `3000 + offset*10` |
| MongoDB | 27017 | `27017 + offset*10` |
| debugger | 9229 | `9229 + offset*10` |
| database | `autotaskcalendar_default` | `autotaskcalendar_<name>` |

Override individually with `AUTOTASKCALENDAR_{API,WEB,MONGO,INSPECT}_PORT` or
`AUTOTASKCALENDAR_PORT_OFFSET`.

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

## Gotchas

- `config.js` (gitignored) overrides `defaultconfig.js`; production reads env vars instead.
- API errors return HTTP 200 with `{success: false}` via `returnFailure()`.
- Dates use `moment`; watch UTC vs. local conversions and per-user timezone offsets.
