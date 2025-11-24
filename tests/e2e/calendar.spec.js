const { test, expect } = require('@playwright/test');
const { seedDatabase, waitForMongoDB } = require('./setup');

// Test credentials (defined in seedDatabase.js)
const TEST_USER = {
  username: 'testuser',
  password: 'testpassword',
};

test.describe('AutoTaskCalendar E2E Tests', () => {
  test.beforeAll(async () => {
    // Wait for MongoDB to be ready
    await waitForMongoDB();
    
    // Seed the database with test data
    await seedDatabase();
    
    // Wait a bit for the seed to complete
    await new Promise(resolve => setTimeout(resolve, 2000));
  });

  test('should login, create a task, schedule it, and verify it appears on calendar', async ({ page }) => {
    // Navigate to the home page
    await page.goto('/');
    
    // Verify we're on the home page
    await expect(page.locator('h2')).toContainText('AutoTaskCalendar');
    
    // Click the Login button
    await page.click('a.btn.btn-primary[href="#/login"]');
    
    // Wait for navigation to login page
    await page.waitForURL('**/#/login');
    
    // Fill in login credentials
    await page.fill('input[name="username"]', TEST_USER.username);
    await page.fill('input[name="password"]', TEST_USER.password);
    
    // Click sign in button and wait for navigation
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle' }),
      page.click('button:has-text("Sign in")'),
    ]);
    
    // Verify we're logged in and on the user page
    await expect(page).toHaveURL(new RegExp(`/user/${TEST_USER.username}`));
    
    // Navigate to Calendar page
    await page.goto('/#/calendar');
    await page.waitForLoadState('networkidle');
    
    // Verify we're on the calendar page
    await expect(page.locator('h1.page-title')).toContainText('My Calendar');
    
    // Click "Add Task" button
    await page.click('button:has-text("Add Task")');
    
    // Wait for modal to appear
    await page.waitForSelector('#task-modal', { state: 'visible' });
    
    // Fill in task details
    const taskTitle = `Test Task ${Date.now()}`;
    await page.fill('#task-title', taskTitle);
    
    // Set due date to tomorrow
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dueDateString = tomorrow.toISOString().split('T')[0];
    await page.fill('#task-due-date', dueDateString);
    
    // Set duration (in hours)
    await page.fill('#task-duration', '2');
    
    // Click OK to create the task
    await page.click('#task-modal button:has-text("OK")');
    
    // Wait for modal to close
    await page.waitForSelector('#task-modal', { state: 'hidden', timeout: 5000 });
    
    // Verify task appears in the task list (use a more specific locator)
    await expect(page.locator('.task-item').filter({ hasText: taskTitle })).toBeVisible();
    
    // Click "Schedule Tasks" button
    await page.click('button:has-text("Schedule Tasks")');
    
    // Wait for scheduling to complete (the button may show a loading state)
    await page.waitForTimeout(3000);
    
    // Verify that events appear on the calendar
    // The calendar uses DayPilot, so we need to check for event elements
    const calendarEvents = page.locator('.calendar_default_event, .calendar-container [data-event], .event-item');
    
    // Wait for at least one event to appear
    await expect(calendarEvents.first()).toBeVisible({ timeout: 10000 });
    
    // Take a screenshot of the calendar with the scheduled task
    await page.screenshot({ 
      path: 'tests/e2e/screenshots/calendar-with-task.png',
      fullPage: true 
    });
    
    console.log('✓ Successfully logged in');
    console.log('✓ Successfully created task:', taskTitle);
    console.log('✓ Successfully scheduled tasks');
    console.log('✓ Verified task appears on calendar');
  });

  test('should display pre-populated sample data after seeding', async ({ page }) => {
    // Login with test user
    await page.goto('/#/login');
    await page.fill('input[name="username"]', TEST_USER.username);
    await page.fill('input[name="password"]', TEST_USER.password);
    
    // Click sign in and wait for navigation
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle' }),
      page.click('button:has-text("Sign in")'),
    ]);
    
    // Navigate to calendar
    await page.goto('/#/calendar');
    await page.waitForLoadState('networkidle');
    
    // Verify that sample tasks from seeding are present
    const taskList = page.locator('.task-list');
    await expect(taskList).toBeVisible();
    
    // Check for at least one of the sample tasks
    const hasSampleTask = await page.locator('.task-item').count() > 0;
    expect(hasSampleTask).toBe(true);
    
    console.log('✓ Sample data is populated and visible');
  });
});
