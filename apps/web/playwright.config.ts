import { defineConfig, devices } from "@playwright/test";

/** Browser tests in all three engines. Runs inside the dev container (./dev.sh e2e). */
export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "vite --host 127.0.0.1 --port 4173 --strictPort",
    url: "http://127.0.0.1:4173/papers/index.json",
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
    { name: "ipad", use: { ...devices["iPad Pro 11"] } },
    { name: "phone", use: { ...devices["Pixel 7"] } },
  ],
});
