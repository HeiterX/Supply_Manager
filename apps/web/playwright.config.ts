import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './test/browser',
  fullyParallel: true,
  workers: process.env.CI ? 2 : undefined,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  expect: { timeout: 10000 },
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:3119',
    channel: process.env.PLAYWRIGHT_CHANNEL,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 } } },
  ],
  webServer: {
    command: 'node node_modules/next/dist/bin/next start -p 3119',
    url: 'http://localhost:3119',
    timeout: 60000,
    reuseExistingServer: !process.env.CI,
    env: { NEXT_TELEMETRY_DISABLED: '1' },
  },
});
