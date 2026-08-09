// Playwright E2E test config for Jehydro Meet
// Auto-discovered by Playwright (named playwright.config.cjs)
// Uses plain object (no import from @playwright/test) for compatibility

const config = {
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,

  // Metadata shown in the HTML report sidebar
  // Populated from GitHub Actions env vars when run in CI
  metadata: (() => {
    const ci = process.env.CI === 'true';
    const workflow  = process.env.GITHUB_WORKFLOW || '';
    const runNumber = process.env.GITHUB_RUN_NUMBER || '';
    const sha = (process.env.GITHUB_SHA || '').slice(0, 7);
    // For PR events, GITHUB_HEAD_REF has the branch name.
    // For push events, fall through to GITHUB_REF (refs/heads/main -> main).
    const branch = process.env.GITHUB_HEAD_REF || (process.env.GITHUB_REF || '').replace('refs/heads/', '');

    const title = ci
      ? 'Jehydro Meet \u2014 E2E Test Report (' + workflow + ' #' + runNumber + ')'
      : 'Jehydro Meet \u2014 E2E Test Report (local)';

    const description = ci
      ? workflow + ' #' + runNumber + ' \u00b7 commit ' + sha + ' \u00b7 ' + branch
      : 'Cross-browser test results for the waiting room feature across Chromium, Firefox, and WebKit';

    return { title, description };
  })(),

  reporter: [
    ['html', { outputFolder: 'playwright-report', open: 'on-failure' }],
    ['json', { outputFile: 'test-results.json' }],
    ['list'],
  ],
  timeout: 30000,
  expect: {
    timeout: 10000,
  },
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      command: 'pnpm --filter @jehydro/backend dev',
      port: 4000,
      cwd: '../../',
      reuseExistingServer: !process.env.CI,
      timeout: 30000,
    },
    {
      command: 'pnpm --filter @jehydro/frontend dev',
      port: 3000,
      cwd: '../../',
      reuseExistingServer: !process.env.CI,
      timeout: 30000,
    },
  ],
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
    {
      name: 'firefox',
      use: { browserName: 'firefox' },
    },
    {
      name: 'webkit',
      use: { browserName: 'webkit' },
    },
  ],
};

module.exports = config;
