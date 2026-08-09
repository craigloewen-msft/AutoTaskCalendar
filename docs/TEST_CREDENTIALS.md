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

Seeding also creates a second user, `otheruser` / `testpassword`, whose data exists
only to prove it never leaks into the first user's views.

## What's Included

The dataset creates:

1. **Test User** with default working hours (9 AM - 5 PM, Monday-Friday)
2. **Sample Tasks:**
   - Complete project proposal (due tomorrow, 2 hours)
   - Review team code (due in 3 days, 1 hour)
   - Update documentation (due next week, 3 hours, chunked into 1-hour blocks)
   - Research new technologies (backlog task, 2 hours)
   - 35 completed tasks, enough to page through the Completed Tasks screen

3. **Sample Events:**
   - Team Meeting (tomorrow, 10 AM - 11 AM)
   - Lunch Break (tomorrow, 12 PM - 1 PM)
   - Client Call (in 2 days, 2 PM - 3 PM)

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
   - View the User profile page to modify settings
   - Add, edit, or complete tasks
   - Schedule tasks automatically
   - Sync with Google Calendar (requires OAuth setup)

## Re-seeding the Database

Seeding wipes all users, tasks, and events in your instance's database before rebuilding
the dataset, so you always start from a clean, known state.

## Important Notes

- These credentials are for **development and testing only**
- Do not use these credentials in production
- The automated test suite seeds its own isolated database and never touches yours;
  see `docs/TESTING.md`
