import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: 'tests/e2e',
  webServer: {
    command: 'pnpm vite --host 127.0.0.1',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: true,
  },
  projects: [
    { name: 'mobile', use: { ...devices['Pixel 5'] } },
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
  ],
});
