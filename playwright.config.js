// Playwright configuration. Always run through `npm test` (scripts/test.js), which sets
// the per-instance environment this file reads.

const { defineConfig, devices } = require('@playwright/test');

const apiPort = parseInt(process.env.AUTOTASKCALENDAR_API_PORT, 10) || 3000;
const baseURL = process.env.AUTOTASKCALENDAR_BASE_URL || `http://127.0.0.1:${apiPort}`;
const isCI = !!process.env.CI;
const isOrchestrated = process.env.AUTOTASKCALENDAR_TEST_ORCHESTRATED === '1';

module.exports = defineConfig({
    testDir: './tests',
    // Waits for the database to be genuinely ready, so the first test of a run does not
    // eat the container's cold start.
    globalSetup: require.resolve('./tests/global-setup.js'),
    // Tests isolate their users, so workers can share one app server and database.
    fullyParallel: true,
    workers: 12,
    outputDir: process.env.AUTOTASKCALENDAR_TEST_OUTPUT_DIR || 'test-results',
    forbidOnly: isCI,
    retries: isCI ? 2 : 0,
    timeout: 30_000,
    expect: { timeout: 10_000 },
    reporter: isCI ? [['github'], ['html', { open: 'never' }]] : [['list'], ['html', { open: 'never' }]],

    use: {
        baseURL,
        // Artifacts only on failure: enough to debug a regression, cheap when green.
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
        video: 'retain-on-failure',
    },

    projects: [
        { name: 'api', testDir: './tests/api' },
        { name: 'ui', testDir: './tests/ui', use: { ...devices['Desktop Chrome'] } },
    ],

    // Express serves both /api and the built SPA from dist/, so one server covers both.
    webServer: {
        command: 'node app.js',
        url: baseURL,
        reuseExistingServer: !isCI && !isOrchestrated,
        timeout: 60_000,
        // Only errors, so a run's output is the test results and nothing else.
        stdout: 'ignore',
        stderr: 'pipe',
    },
});
