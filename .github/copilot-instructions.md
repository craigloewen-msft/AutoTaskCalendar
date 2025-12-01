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

### Backend Structure

The backend follows a modular MVC-like architecture:

#### Entry Point (`app.js`)
- Express server setup and configuration
- MongoDB connection with Mongoose
- Session management with connect-mongo
- Passport.js initialization for authentication
- Route mounting for `/api` endpoints

#### Models (`models/index.js`)
Database schemas using Mongoose:
- **UserDetail**: Authentication credentials, working hours configuration, Google OAuth tokens
- **TaskDetail**: Task metadata, scheduling info, repeat settings, backlog flag
- **EventDetail**: Calendar events, task-generated events, Google Calendar synced events

#### Routes (`routes/`)
API endpoint definitions:
- **auth.js**: User registration, login, logout, profile management, Google OAuth
- **tasks.js**: Task CRUD operations, completion, scheduling
- **events.js**: Event management, Google Calendar sync

#### Controllers (`controllers/`)
Business logic:
- **taskController.js**: Task list retrieval, task completion with repeat handling, `generateTaskEvents()` scheduling algorithm
- **eventController.js**: Event operations, Google Calendar synchronization

#### Middleware (`middleware/auth.js`)
- JWT token authentication via `authenticateToken`

#### Utils (`utils/helpers.js`)
- `returnFailure()` helper for consistent error responses

### Key Features
- **Task Chunking**: Breaking up large tasks into smaller chunks
- **Repeating Tasks**: Daily, weekly, monthly, yearly recurrence
- **Backlog Tasks**: Tasks without specific deadlines
- **Task Scheduling**: `generateTaskEvents()` function that automatically schedules tasks based on:
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

### Prerequisites
- Node.js (latest LTS version recommended)
- MongoDB (can run via Docker)
- Optional: Use GitHub Codespaces or VS Code Dev Containers

### Quick Start

**Using Codespaces/Dev Containers:**
```bash
npm run dev
```

**Local Development:**
1. Start MongoDB:
   ```bash
   sudo docker run -d -p 27017:27017 --name mongo mongo:latest
   ```
2. Install dependencies:
   ```bash
   npm install
   cd webinterface && npm install
   ```
3. Configure `defaultconfig.js` or create `config.js` for custom settings
4. Run backend: `node app.js` (port 3000)
5. Run frontend: `cd webinterface && npm run serve` (port 8080)

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

#### Route Definition (in routes/*.js)
```javascript
const express = require('express');
const router = express.Router();
const { UserDetails, TaskDetails } = require('../models');
const { returnFailure } = require('../utils/helpers');

function createRoutes(config, authenticateToken) {
    router.post('/endpoint', authenticateToken, async (req, res) => {
        let user = await UserDetails.findOne({ username: req.user.id });
        if (!req.user || !user) {
            return res.send(returnFailure('Not logged in'));
        }
        // ... endpoint logic
    });
    return router;
}

module.exports = createRoutes;
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
- Use `completeTask(task, user)` from `controllers/taskController.js`
- Handles repeating tasks automatically by creating new instances
- Updates task status and creates follow-up tasks if needed

#### Task Scheduling
- The `generateTaskEvents()` function in `controllers/taskController.js` is the core scheduling algorithm
- It considers:
  1. User working hours and days
  2. Existing calendar events
  3. Task priorities (regular tasks before backlog tasks)
  4. Task chunking preferences
- Clears old task events before regenerating

### Google Calendar Integration

#### OAuth Flow
1. User initiates: `GET /api/connectGoogle` (in `routes/auth.js`)
2. Callback handler: `GET /api/connectGoogleCallback`
3. Tokens stored in user document

#### Token Refresh
- Use `refreshGoogleCalendarAccessToken(user)` in `controllers/eventController.js` when receiving 401 errors
- Automatically retries failed requests after refresh

#### Syncing
- `syncCalendarsToDatabase()` in `controllers/eventController.js` fetches events from selected Google calendars
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
- Run `npm run build` to test and ensure the website builds correctly

## File Organization

```
/
├── app.js                    # Express server entry point
├── defaultconfig.js          # Default configuration (template)
├── config.js                 # Local config (create from defaultconfig.js, not committed)
├── package.json              # Backend dependencies
├── seedDatabase.js           # Database seeding script for testing
├── models/
│   └── index.js              # Mongoose schemas (UserDetail, TaskDetail, EventDetail)
├── routes/
│   ├── auth.js               # Authentication routes
│   ├── tasks.js              # Task management routes
│   └── events.js             # Event management routes
├── controllers/
│   ├── taskController.js     # Task business logic and scheduling algorithm
│   └── eventController.js    # Event business logic and Google sync
├── middleware/
│   └── auth.js               # JWT authentication middleware
├── utils/
│   └── helpers.js            # Utility functions (returnFailure, etc.)
├── webinterface/             # Vue.js frontend
│   ├── src/
│   │   ├── components/       # Reusable Vue components
│   │   ├── views/            # Page views
│   │   ├── router/           # Vue Router config
│   │   ├── store.js          # Vuex store
│   │   └── App.vue           # Root component
│   └── package.json          # Frontend dependencies
├── .devcontainer/            # Dev container configuration
└── .github/                  # GitHub configurations
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

### Code Organization
- Place new API endpoints in the appropriate route file (`routes/auth.js`, `routes/tasks.js`, `routes/events.js`)
- Business logic should go in controllers (`controllers/taskController.js`, `controllers/eventController.js`)
- Database schema changes go in `models/index.js`
- Reusable utility functions go in `utils/helpers.js`

### Development Workflow
- When suggesting task-related code, consider the scheduling algorithm implications
- Remember that tasks can be chunked, repeated, and have flexible deadlines (backlog)
- Always maintain the existing authentication patterns
- Keep timezone handling in mind for date/time operations
- Follow the established error handling patterns with `returnFailure()`
- When working with Google Calendar API, include token refresh logic
- Test changes with `npm run build` to ensure the website builds correctly
- Use `npm run seed` to set up test data for local testing

### Common Tasks
- **Adding a new API endpoint**: Create route in `routes/*.js`, add logic in `controllers/*.js`
- **Adding a new database field**: Update schema in `models/index.js`
- **Adding frontend features**: Work in `webinterface/src/` (components, views, store)
- **Testing locally**: Run `npm run dev` for hot-reload development
