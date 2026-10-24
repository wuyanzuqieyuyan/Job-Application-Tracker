import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:4000',
    },
  },
  test: {
    // 仅服务端单元测试归 vitest；tests/browser/*.spec.ts 属于 Playwright（避免套件误加载报错）
    include: ['server/tests/**/*.test.ts'],
  },
})
