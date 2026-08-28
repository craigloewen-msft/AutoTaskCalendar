# AutoTaskCalendar

This repository's goal is to make a web interface to manage your daily tasks and automatically schedule them on your calendar.

> Working on this repo with an AI agent? See [AGENTS.md](AGENTS.md).

## Set up

You need [`node`](https://github.com/nodesource/distributions/blob/master/README.md) and
[`docker`](https://docs.docker.com/engine/install/). Nothing else — MongoDB runs in a
container that the scripts start for you.

```bash
npm install      # installs this project and webinterface/
npm run seed     # optional: sample data, log in as testuser / testpassword
npm run dev      # database + backend + frontend
```

That's the whole set-up. `npm run dev` prints the URLs it picked, normally
<http://localhost:8080>. The frontend hot reloads and the backend restarts via nodemon.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Runs the full stack. |
| `npm test` | Runs the Playwright suite, building the frontend first if needed. |
| `npm run seed` | Resets your seed namespace to the sample dataset. |
| `npm run build` | Production build into `dist/`. |

See [docs/TEST_CREDENTIALS.md](docs/TEST_CREDENTIALS.md) for the seeded login details.

## Running more than one copy

Every stack uses the same fixed ports (API 3000, web 8080) and the same shared database,
`mongodb://127.0.0.1:27017/autotaskcalendar`. Under the Kingdom IDE each agent has its own
loopback, so many can run at once on those numbers; the database is declared in
`.kingdom/services.toml` and raised once for everyone.

Without that isolation, pin the ports for the second stack and give it its own seed
namespace:

```bash
AUTOTASKCALENDAR_INSTANCE=agent2 AUTOTASKCALENDAR_API_PORT=3001 \
  AUTOTASKCALENDAR_WEB_PORT=8081 npm run dev
```

Seeded data is isolated by namespace rather than by database. See
[docs/SHARED_DATABASE.md](docs/SHARED_DATABASE.md).

## Configuration

Copy `defaultconfig.js` to `config.js` to override settings locally; `config.js` is
gitignored and takes precedence. In production, values are read from environment
variables instead (`prodMongoDBConnectionString`, `secret`, `sessionSecret`,
`googleOAuthClientID`, `googleOAuthClientSecret`, `appUrl`).

## If the database misbehaves

Under Kingdom the IDE owns the container and you should not stop it — other agents are
using it. On your own machine it is a normal Docker container if you need to poke it:

```bash
docker logs autotaskcalendar-mongo             # what happened
docker rm -f autotaskcalendar-mongo            # rebuilt next command, data survives
docker volume rm autotaskcalendar-mongo-data   # also throws the data away
```
