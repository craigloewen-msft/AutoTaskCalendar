# AutoTaskCalendar

This repository's goal is to make a web interface to manage your daily tasks and automatically schedule them on your calendar.

> Working on this repo with an AI agent? See [AGENTS.md](AGENTS.md).

## Set up

### Prerequisites

- An up to date `node`. See [NodeSource Node.js Binary Distributions](https://github.com/nodesource/distributions/blob/master/README.md).
- [`wslc`](https://learn.microsoft.com/windows/wsl/) to run the MongoDB container.

### Run it

```bash
npm install
cd webinterface && npm install && cd ..

npm run seed     # optional: creates a test user with sample data
npm run dev      # starts MongoDB, the backend, and the frontend
```

`npm run dev` prints the URLs it is using. On `main` that is <http://localhost:8080>; log
in with `testuser` / `testpassword` if you seeded the database. See
[docs/TEST_CREDENTIALS.md](docs/TEST_CREDENTIALS.md) for details on the sample data.

Each git branch automatically gets its own ports and its own MongoDB database, so several
checkouts can run at the same time without interfering. Run `npm run db:status` to print
the values for the current branch.

The frontend hot reloads. The backend restarts automatically via nodemon.

## Configuration

Copy `defaultconfig.js` to `config.js` to override settings locally; `config.js` is
gitignored and takes precedence. In production, values are read from environment
variables instead (`prodMongoDBConnectionString`, `secret`, `sessionSecret`,
`googleOAuthClientID`, `googleOAuthClientSecret`, `appUrl`).
