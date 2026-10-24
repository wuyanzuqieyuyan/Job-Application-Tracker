import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/browser',
  timeout: 60_000,
  // 双引擎共享同一 dev server 与临时库，串行执行避免 POST 争用导致的表单关闭抖动
  workers: 1,
  retries: 0,
  outputDir: './tests/browser/artifacts',
  use: {
    baseURL: process.env.E2E_BASE ?? 'http://localhost:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  reporter: [['list'], ['html', { outputFolder: './tests/browser/report', open: 'never' }]],
  projects: [
    { name: 'chrome', use: { channel: 'chrome' } },
    { name: 'msedge', use: { channel: 'msedge' } },
  ],
})
