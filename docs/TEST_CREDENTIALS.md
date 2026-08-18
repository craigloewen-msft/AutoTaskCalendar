# Test Credentials for Development

This file contains test credentials for GitHub Copilot and developers to use when testing the application.

## Database Seeding

To populate the database with test data, run:

```bash
npm run seed
```

See `docs/SEEDING.md` for what the dataset contains and how to extend it.

## Test User Credentials

After running the seed script, you can login with:

- **Username:** `testuser`
- **Password:** `testpassword`
- **Email:** `testuser@example.com`

Seeding also creates:

- `otheruser` / `testpassword`, whose data proves tenant isolation;
- `recurruser` / `testpassword`, with a minimal weekly recurrence;
- `slipuser` / `testpassword`, with a full mixed-capacity week and a spacious following week
  for checking blocked-slot reschedule forecasts; and
- `boundaryuser` / `testpassword`, with a two-day schedule that distinguishes unplaced work
  from tasks whose completions actually cross their due dates.

## What's Included

The dataset creates:

1. **Test User** with default working hours (9 AM - 5 PM, Monday-Friday)
2. **Sample Tasks:**
   - Complete project proposal (due tomorrow, 2 hours)
   - Review team code (due in 3 days, 1 hour)
   - Update documentation (due next week, 3 hours, chunked into 1-hour blocks)
   - Research new technologies (backlog task, 2 hours)
   - 70 completed tasks spanning 90 days, kept as completion history

3. **Sample Events:**
   - Team Meeting (tomorrow, 10 AM - 11 AM)
   - Lunch Break (tomorrow, 12 PM - 1 PM)
   - Client Call (in 2 days, 2 PM - 3 PM)

4. **A Compass hierarchy** — roles, goals, and projects, with about half the tasks linked
   to a project. See `docs/COMPASS.md`.

5. **Task-slip calendar on `slipuser`:**
   - Ten 3½-hour tasks, all eligible Monday and due Friday
   - One fixed 09:00–10:00 event on each workday
   - Exactly 40 hours of combined work and event time in that week
   - One isolated Friday task in the otherwise-empty following week

6. **Late-definition boundary on `boundaryuser`:**
   - One six-hour selected task and five two-hour follow-ups, all due Friday
   - The tasks exactly fill Monday and Tuesday
   - One event blocks Wednesday through the 60-day scheduling horizon
   - Blocking the selected Monday slot moves four downstream tasks, leaves three unplaced, and makes zero tasks late

## Using the Test Credentials

1. Start the development server:
   ```bash
   npm run dev
   ```

2. Navigate to the login page at `http://localhost:8080/#/login`

3. Enter the test credentials:
   - Username: `testuser`
   - Password: `testpassword`

4. You will be redirected to the user profile page at `http://localhost:8080/#/user/testuser`

5. From there you can:
   - View the Calendar page to see scheduled tasks and events
   - View the Compass page to manage roles, goals, and projects
   - View the User profile page to modify settings
   - Add, edit, or complete tasks
   - Schedule tasks automatically
   - Sync with Google Calendar (requires OAuth setup)

## Re-seeding the Database

Seeding wipes all users, tasks, events, roles, goals, and projects in your instance's
database before rebuilding the dataset, so you always start from a clean, known state.

## Important Notes

- These credentials are for **development and testing only**
- Do not use these credentials in production
- The automated test suite seeds its own isolated database and never touches yours;
  see `docs/TESTING.md`
