# Multi-agent dev environment on wslc, plus repo cleanup and AGENTS.md

Make AutoTaskCalendar runnable as N simultaneous isolated instances (own ports, own
database), replace `docker compose` with `wslc`, clean up accumulated repo cruft, and
add a concise `AGENTS.md`.

## Current state (from exploration)

- Ports are hardcoded in three places: `app.js` (`hostPort = 3000` dev / `8080` prod),
  `webinterface/vue.config.js` (devServer `8080`, proxy target `http://0.0.0.0:3000/`),
  `.vscode/launch.json` (`http://localhost:8080`).
- DB name is hardcoded in `defaultconfig.js`:
  `mongodb://db/GithubIssueManagement` — the `db` host only resolves under compose, and
  `seedDatabase.js` papers over this with a `.replace('mongodb://db/', 'mongodb://localhost/')`.
- `.devcontainer/docker-compose.yml` defines `app` + `db` (mongo) with fixed host ports
  `27017/8080/9229` and a named volume `mongodb-data`. Two agents = port collision +
  shared database.
- `wslc` 2.9.3.0 is installed at `~/.local/bin/wslc`. It has `run/create/start/stop/
  remove/list/logs/exec/volume/network/build` but **no compose**. `wslc run` supports
  `--name`, `-p`, `-v`, `-d`, `--rm`, `--network`, `--network-alias`, `-e`, `--label`.

## 1. Per-instance isolation

Introduce a single input, the environment variable `AUTOTASKCALENDAR_INSTANCE` (default
`default`), and derive everything else from it. All new env vars use the full,
unabbreviated `AUTOTASKCALENDAR_` prefix — no initialisms.

- Add `instance.js` at the repo root exporting a resolved instance descriptor:
  - `name` — `process.env.AUTOTASKCALENDAR_INSTANCE || 'default'`, slugified.
  - `offset` — `0` for `default`; otherwise a stable hash of `name` mapped into `1..49`.
    Allow explicit override via `AUTOTASKCALENDAR_PORT_OFFSET`.
  - `apiPort` = `3000 + offset*10`, `webPort` = `8080 + offset*10`,
    `mongoPort` = `27017 + offset*10`, `inspectPort` = `9229 + offset*10`.
    Each is individually overridable (`AUTOTASKCALENDAR_API_PORT`,
    `AUTOTASKCALENDAR_WEB_PORT`, `AUTOTASKCALENDAR_MONGO_PORT`,
    `AUTOTASKCALENDAR_INSPECT_PORT`) so a human can pin ports.
  - `dbName` = `autotaskcalendar_<name>`, `mongoUrl` =
    `mongodb://127.0.0.1:<mongoPort>/<dbName>` (overridable via
    `AUTOTASKCALENDAR_MONGO_URL`).
  - `containerName` = `autotaskcalendar-mongo-<name>`,
    `volumeName` = `autotaskcalendar-mongo-data-<name>`.
- `app.js`: replace the `hostPort` / `mongooseConnectionString` block with `instance.js`
  values in dev; production keeps reading `prodMongoDBConnectionString` and `PORT || 8080`
  (use `process.env.PORT` so Azure App Service is respected). `config.appUrl` in dev
  becomes `http://localhost:<webPort>`.
- `seedDatabase.js`: import `instance.js` and delete the `.replace(...)` hack.
- `webinterface/vue.config.js`: read `AUTOTASKCALENDAR_WEB_PORT` /
  `AUTOTASKCALENDAR_API_PORT` (via `process.env`, with the same defaults) for
  `devServer.port` and the `/api` proxy target.
- `defaultconfig.js`: drop `devMongoDBConnectionString` (now derived), keep secrets, and
  add the keys the code actually reads in production but that are missing from the
  template today: `googleOAuthClientID`, `googleOAuthClientSecret`, `appUrl`.
- Because two agents share one host, session/cookie collisions are avoided by namespacing
  the session cookie name per instance.

Acceptance: `AUTOTASKCALENDAR_INSTANCE=alpha npm run dev` and
`AUTOTASKCALENDAR_INSTANCE=beta npm run dev` run concurrently, on different ports, against
different Mongo databases, with no shared state.

## 2. Replace `docker compose` with `wslc`

`wslc` has no compose, so replace the compose file with a small orchestration script.

- Add `scripts/dev-db.sh` (bash, `set -euo pipefail`) with subcommands:
  - `up` — idempotent: create volume if absent (`wslc volume create <volumeName>`),
    `wslc list` to detect an existing container, `wslc start` it if stopped, else
    `wslc run -d --name <containerName> -p <mongoPort>:27017 -v <volumeName>:/data/db
     --label autotaskcalendar.instance=<name> mongo:latest`; then poll for readiness
    before returning.
  - `down` — `wslc stop` + `wslc remove` (keeps the volume).
  - `reset` — `down`, `wslc volume remove <volumeName>`, then `up`.
  - `status` — print instance name, all four ports, DB name, container state.
  - `logs` — `wslc logs -f`.
  - `nuke-all` — remove every container/volume carrying the `autotaskcalendar.instance`
    label.
  Port/name resolution is delegated to `node -e` against `instance.js` so the script and
  the app can never disagree.
- `package.json` scripts: add `db:up`, `db:down`, `db:reset`, `db:status`, and make
  `dev` and `seed` depend on `db:up` so a fresh agent gets a working stack from one command.
- **Delete the `.devcontainer/` directory entirely** (`docker-compose.yml`,
  `devcontainer.json`, `Dockerfile`). The dev container is dropped for now; `wslc` plus
  the `db:*` scripts is the single supported path. Remove the codespaces section from
  `README.md` accordingly.
- Purge `docker`/`docker-compose` instructions from `README.md`,
  `.github/copilot-instructions.md`, and the `seedDatabase.js` comment; replace with the
  `wslc` flow.

## 3. Repo review — issues found, to be fixed

1. **Wrong project identity throughout.** The repo still carries its ancestor project's
   name in several places. Rename everything to **AutoTaskCalendar**:
   - `webinterface/package.json` `name`: `GitGudIssues` → `autotaskcalendar-webinterface`.
   - The Mongo database `GithubIssueManagement` → the per-instance
     `autotaskcalendar_<name>` from section 1.
   - Sweep the codebase (`grep -ri 'gitgud\|githubissue'`) for any remaining references in
     comments, docs, the Vue app, and `docs/mongodb-playground-examples/` and fix them.
   - Add a README note that pre-existing local data lives under the old DB name and is not
     migrated.
2. **`app.js` starts listening mid-configuration.** `app.listen()` is called *before*
   `passport.initialize()`, `passport.session()`, and all route registration. Move
   `app.listen()` to the end of the file so no request can arrive against a half-built app.
3. **Deprecated mongoose options.** `useNewUrlParser` / `useUnifiedTopology` are no-ops
   in mongoose 8 and log warnings. Remove them.
4. **`seedDatabase.js` duplicates the schemas** from `models/index.js` (its own `Schema`
   definitions + a second `passport-local-mongoose` require). Import from `models/` so the
   seed can't silently drift from the real models.
5. **`.gitignore` ignores `.vscode/` but `.vscode/launch.json` is committed.** Un-ignore
   the specific file (`!.vscode/launch.json`) and update its hardcoded `localhost:8080`
   to reference the instance port.
6. **Delete `increaseVersion.sh`.** Its `sed "s/$current_version/$new_version/"` replaces
   the first bare number anywhere in the HTML, and float-incrementing via `bc` is not a
   versioning scheme. Remove the script; version bumps are a manual edit to
   `webinterface/public/index.html`.
7. **README is stale/wrong** — recommends `sudo apt install docker` (not a real package),
   documents the compose-era connection-string edit, and numbers its steps `1,1,1,2,1,1`.
   Rewrite around the `wslc` + `AUTOTASKCALENDAR_INSTANCE` flow.
8. **Structure.** The layout (`controllers/`, `routes/`, `models/`, `middleware/`,
   `utils/`) is coherent and worth keeping — no restructure. The only move:
   `TEST_CREDENTIALS.md` folds into `docs/` (README keeps the link).

No tests are added as part of this task. The CI step `npm run test --if-present` stays a
no-op.

## 4. `AGENTS.md`

Add a root `AGENTS.md`, deliberately short (target ≤ 40 lines):

- One-line project summary and stack (Express + Mongoose + Vue 3 CLI).
- **Start here:** `export AUTOTASKCALENDAR_INSTANCE=<your-agent-name>` then `npm run dev` —
  states plainly that every agent MUST set a unique instance name and why.
- The derived port/DB table and how to see it (`npm run db:status`).
- `wslc`, not docker — one line, plus the `db:*` scripts.
- Verify with `npm run build` (there is no test suite).
- Map of directories, one line each.
- Gotchas: `config.js` overrides `defaultconfig.js` and is gitignored; timezone handling
  via moment; scheduling algorithm lives in `controllers/scheduling.js`.

Cross-link it from `README.md` and reconcile `.github/copilot-instructions.md` so the two
agent-facing docs don't contradict each other.

## Verification

- `AUTOTASKCALENDAR_INSTANCE=alpha npm run db:up` and
  `AUTOTASKCALENDAR_INSTANCE=beta npm run db:up` produce two containers on different host
  ports; `wslc list` shows both.
- Both instances seed and serve concurrently; data written in `alpha` is absent in `beta`.
- `npm run build` succeeds.
- `grep -ri "docker" .` returns no instructional hits.
- `grep -ri "gitgud\|githubissue" .` returns nothing.
