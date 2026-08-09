# GitHub Copilot Instructions for AutoTaskCalendar

## Project Overview

AutoTaskCalendar is a web-based task management system that automatically schedules tasks on a calendar. It integrates with Google Calendar and uses intelligent scheduling to organize tasks based on user availability and working hours.

### Technology Stack

- **Backend**: Node.js with Express.js
- **Frontend**: Vue.js 
- **Database**: MongoDB with Mongoose ODM
- **Authentication**: Passport.js with JWT tokens
- **External APIs**: Google Calendar API (OAuth2)
- **Session Management**: express-session with connect-mongo

## Architecture

### Backend Structure (`app.js`)

The main application file contains:
- **User Management**: Registration, login, authentication with JWT
- **Task Management**: CRUD operations for tasks with features like:
  - Task chunking (breaking up large tasks)
  - Repeating tasks (daily, weekly, monthly, yearly)
  - Backlog tasks (tasks without specific deadlines)
  - Task completion tracking
- **Event Management**: Managing calendar events and syncing with Google Calendar
- **Scheduling Algorithm**: `generateTaskEvents()` function that automatically schedules tasks based on:
  - User's working hours and days
  - Existing calendar events
  - Task deadlines and priorities
  - Task duration and chunking preferences

### Frontend Structure (`webinterface/`)

- **Vue.js SPA** with Vue Router
- Components in `src/components/`
- Views in `src/views/`
- Vuex store for state management (`store.js`)

### Database Schemas

#### UserDetail
- Authentication credentials
- Working hours configuration (`workingStartTime`, `workingDuration`, `workingDays`)
- Google OAuth tokens
- Selected calendars for syncing

#### TaskDetail
- Task metadata (title, notes, due date, start date)
- Duration and scheduling info
- Break-up task settings (`breakUpTask`, `breakUpTaskChunkDuration`)
- Repeat settings (daily, weekly, monthly, yearly)
- Backlog flag for tasks without deadlines
- Completion status

#### EventDetail
- Event metadata (title, start/end dates, notes)
- Event type: `'task'`, `'task-chunk'`, `'calendar'`, or `'google'`
- References to external events (Google Calendar)
- Task references for scheduled task events

## Development Setup

See [AGENTS.md](../AGENTS.md) for the authoritative quick reference; this section must
stay consistent with it.

### Prerequisites
- Node.js (latest LTS version recommended)
- `wslc` to run the MongoDB container (there is no docker/compose setup)

### Quick Start
```bash
# Required if anyone else might be running this repo on the same machine.
export AUTOTASKCALENDAR_INSTANCE=<unique-name>

npm install
cd webinterface && npm install && cd ..

npm run seed   # optional test data: testuser / testpassword
npm run dev    # starts MongoDB, backend, and frontend together
```

Ports and the database name are derived per instance from `AUTOTASKCALENDAR_INSTANCE`
(see `instance.js`); the `default` instance uses 8080/3000/27017. Run `npm run db:status`
to print the values for the current instance. Never hardcode these ports in new code --
read them from `instance.js` or the `AUTOTASKCALENDAR_*_PORT` environment variables.

### Database Commands
`npm run db:up | db:down | db:reset | db:status | db:logs` wrap `scripts/dev-db.sh`,
which manages a per-instance MongoDB container through `wslc`.

### Build Commands
- **Full build**: `npm run build` - Builds Vue frontend and moves dist to root
- **Development**: `npm run dev` - Runs both backend and frontend with hot reload

## Coding Standards

### Authentication & Security
- All API routes use JWT authentication via `authenticateToken` middleware
- Sensitive config should be in `config.js` (not committed)
- Use `returnFailure(message)` helper for error responses
- Production uses environment variables for secrets

### API Patterns

#### Request Authentication
```javascript
app.post('/api/endpoint', authenticateToken, async (req, res) => {
    let user = await UserDetails.findOne({ username: req.user.id });
    if (!req.user || !user) {
        return res.send(returnFailure('Not logged in'));
    }
    // ... endpoint logic
});
```

#### Response Format
```javascript
// Success
return res.json({ success: true, data: value });

// Failure
return res.json(returnFailure('Error message'));
```

### Task Management Patterns

#### Completing Tasks
- Use `completeTask(task, user)` helper function
- Handles repeating tasks automatically by creating new instances
- Updates task status and creates follow-up tasks if needed

#### Task Scheduling
- The `generateTaskEvents()` function is the core scheduling algorithm
- It considers:
  1. User working hours and days
  2. Existing calendar events
  3. Task priorities (regular tasks before backlog tasks)
  4. Task chunking preferences
- Clears old task events before regenerating

### Google Calendar Integration

#### OAuth Flow
1. User initiates: `GET /api/connectGoogle`
2. Callback handler: `GET /api/connectGoogleCallback`
3. Tokens stored in user document

#### Token Refresh
- Use `refreshGoogleCalendarAccessToken(user)` when receiving 401 errors
- Automatically retries failed requests after refresh

#### Syncing
- `syncCalendarsToDatabase()` fetches events from selected Google calendars
- Syncs events within a time window
- Creates/updates local event records
- Removes events no longer in Google Calendar

## Important Considerations

### Date/Time Handling
- Use `moment.js` for date manipulation
- User timezone offsets are handled in `updateuserinfo` endpoint
- Be careful with UTC vs local time conversions

### Database Queries
- Use Mongoose populate for related data
- Use virtual properties for task/event lists
- Index username field for performance

### Error Handling
- Always use try-catch blocks for async operations
- Log errors with `console.error()`
- Return user-friendly error messages
- Don't expose internal errors to clients

### Testing
- Run `npm run build` to ensure the website still builds correctly
- There is no automated test suite; verify behaviour by running the app

## File Organization

```
/
├── app.js                    # Main backend application
├── instance.js               # Per-instance ports / database names (single source of truth)
├── defaultconfig.js          # Default configuration (template)
├── config.js                 # Local config (create from defaultconfig.js, not committed)
├── package.json              # Backend dependencies
├── scripts/
│   ├── dev.js                # Starts backend + frontend for the current instance
│   └── dev-db.sh             # Per-instance MongoDB container, managed with wslc
├── webinterface/             # Vue.js frontend
│   ├── src/
│   │   ├── components/      # Reusable Vue components
│   │   ├── views/           # Page views
│   │   ├── router/          # Vue Router config
│   │   ├── store.js         # Vuex store
│   │   └── App.vue          # Root component
│   └── package.json         # Frontend dependencies
└── .github/                 # GitHub configurations
```

## Environment Variables (Production)

- `NODE_ENV`: Set to 'production'
- `prodMongoDBConnectionString`: MongoDB connection string
- `secret`: JWT secret
- `sessionSecret`: Session secret
- `googleOAuthClientID`: Google OAuth client ID
- `googleOAuthClientSecret`: Google OAuth client secret
- `appUrl`: Application URL

## Tips for Copilot

- When suggesting task-related code, consider the scheduling algorithm implications
- Remember that tasks can be chunked, repeated, and have flexible deadlines (backlog)
- Always maintain the existing authentication patterns
- Keep timezone handling in mind for date/time operations
- Follow the established error handling patterns with `returnFailure()`
- When working with Google Calendar API, include token refresh logic
- Test changes locally before committing, especially scheduling algorithm modifications
