# End-to-End Tests

This directory contains Playwright automated tests for the AutoTaskCalendar application.

## Test Coverage

The tests verify the following functionality:

1. **User Login**: Tests user authentication with test credentials
2. **Task Creation**: Verifies the ability to create new tasks through the UI
3. **Task Scheduling**: Tests the automatic task scheduling feature
4. **Calendar Display**: Verifies tasks appear on the calendar after scheduling
5. **Sample Data**: Confirms that pre-populated sample data is displayed correctly

## Prerequisites

- Node.js (v24.x recommended)
- MongoDB running on localhost:27017
- Backend and frontend dependencies installed

## Running Tests Locally

1. **Install dependencies:**
   ```bash
   npm install
   cd webinterface && npm install
   cd ..
   ```

2. **Install Playwright browsers:**
   ```bash
   npx playwright install chromium
   ```

3. **Create config.js:**
   ```bash
   cat > config.js << 'EOF'
   module.exports = {
       'devMongoDBConnectionString': 'mongodb://localhost/GithubIssueManagement',
       'secret': 'mysecret',
       'sessionSecret': 'somesessionsecret'
   };
   EOF
   ```

4. **Start MongoDB:**
   ```bash
   sudo docker run -d -p 27017:27017 --name mongo mongo:latest
   ```

5. **Seed the database:**
   ```bash
   npm run seed
   ```

6. **Run tests (with automatic server management):**
   ```bash
   npm run test:ci
   ```

   Or manually start servers and run tests:
   ```bash
   # Terminal 1: Start backend
   node app.js

   # Terminal 2: Start frontend
   cd webinterface && npm run serve

   # Terminal 3: Run tests
   npm test
   ```

## Test Scripts

- `npm test` - Run Playwright tests (requires servers to be running)
- `npm run test:headed` - Run tests with visible browser
- `npm run test:ui` - Run tests with Playwright UI mode
- `npm run test:report` - View the latest test report
- `npm run test:ci` - Start servers, run tests, then stop servers (for CI/CD)
- `npm run test:start-servers` - Manually start backend and frontend servers
- `npm run test:stop-servers` - Manually stop test servers

## Test Files

- `calendar.spec.js` - Main test suite for login, task creation, scheduling, and calendar display
- `setup.js` - Test setup utilities (database seeding, MongoDB readiness checks)

## CI/CD

Tests run automatically on:
- Push to `main` or `develop` branches
- Pull requests to `main` or `develop` branches
- Manual workflow dispatch

See `.github/workflows/playwright.yml` for the CI configuration.

## Screenshots and Videos

Failed tests automatically capture:
- Screenshots at the point of failure
- Video recordings of the test execution
- Traces for debugging (view with `npx playwright show-trace <trace-file>`)

Successful tests save screenshots to `tests/e2e/screenshots/`.

## Test User Credentials

The tests use the following test user (created by `seedDatabase.js`):
- **Username**: testuser
- **Password**: testpassword
- **Email**: testuser@example.com

See `TEST_CREDENTIALS.md` for more information about test data.
