# AutoTaskCalendar

This repository's goal is to make a web interface to manage your daily tasks and automatically schedule them on your calendar.

> Working on this repo with an AI agent? See [AGENTS.md](AGENTS.md).

## Set up

### Prerequisites

- An up to date `node`. See [NodeSource Node.js Binary Distributions](https://github.com/nodesource/distributions/blob/master/README.md).
- [`wslc`](https://learn.microsoft.com/windows/wsl/) to run the MongoDB container.

### Run it

```bash
# Optional, but required if you want to run more than one copy at once.
export AUTOTASKCALENDAR_INSTANCE=my-instance

npm install
cd webinterface && npm install && cd ..

npm run seed     # optional: creates a test user with sample data
npm run dev      # starts MongoDB, the backend, and the frontend
```

`npm run dev` prints the URLs it is using. For the default instance that is
<http://localhost:8080>; log in with `testuser` / `testpassword` if you seeded the
database. See [docs/TEST_CREDENTIALS.md](docs/TEST_CREDENTIALS.md) for details on the
sample data.

The frontend hot reloads. The backend restarts automatically via nodemon.

## Running several copies at once

Everything that could collide between copies -- the ports, the MongoDB database, the
container and volume names, and the session cookie -- is derived from
`AUTOTASKCALENDAR_INSTANCE` (default: `default`). Set a different value in each shell and
two checkouts can run side by side without interfering:

```bash
AUTOTASKCALENDAR_INSTANCE=alpha npm run dev   # web on :8280, db autotaskcalendar_alpha
AUTOTASKCALENDAR_INSTANCE=beta  npm run dev   # web on :8270, db autotaskcalendar_beta
```

Run `npm run db:status` to print the ports and database name for your instance. The
derivation lives in `instance.js`; individual values can be pinned with
`AUTOTASKCALENDAR_PORT_OFFSET` or `AUTOTASKCALENDAR_{API,WEB,MONGO,INSPECT}_PORT`.

## Database

MongoDB runs in a container managed by `wslc` via `scripts/dev-db.sh`:

| Command | Effect |
| --- | --- |
| `npm run db:up` | Start this instance's MongoDB (called automatically by `dev`/`seed`) |
| `npm run db:down` | Stop and remove the container, keeping the data volume |
| `npm run db:reset` | Delete the data volume and start fresh |
| `npm run db:status` | Print ports, database name, and container state |
| `npm run db:logs` | Follow the MongoDB logs |

`scripts/dev-db.sh nuke-all` removes the containers and volumes for *every* instance.

> Databases are now named `autotaskcalendar_<instance>`. Data created before this change
> lives in the old `GithubIssueManagement` database and is not migrated automatically.

## Configuration

Copy `defaultconfig.js` to `config.js` to override settings locally; `config.js` is
gitignored and takes precedence. In production, values are read from environment
variables instead (`prodMongoDBConnectionString`, `secret`, `sessionSecret`,
`googleOAuthClientID`, `googleOAuthClientSecret`, `appUrl`).

## Build

`npm run build` builds the frontend and moves the output to `./dist`, which the Express
app serves in production.
