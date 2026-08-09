// Playwright configuration. Always run through `npm test` (scripts/test.js), which sets
// the per-instance environment this file reads.

const { defineConfig, devices } = require('@playwright/test');

const apiPort = parseInt(process.env.AUTOTASKCALENDAR_API_PORT, 10) || 3000;
const baseURL = process.env.AUTOTASKCALENDAR_BASE_URL || `http://127.0.0.1:${apiPort}`;
const isCI = !!process.env.CI;

module.exports = defineConfig({
    testDir: './tests',
    // Tests share one database, so they run one at a time and reseed what they need.
    fullyParallel: false,
    workers: 1,
    forbidOnly: isCI,
    retries: isCI ? 1 : 0,
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
        reuseExistingServer: !isCI,
        timeout: 60_000,
        stdout: 'pipe',
        stderr: 'pipe',
    },
});
