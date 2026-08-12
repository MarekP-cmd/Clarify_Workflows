import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    environmentOptions: { jsdom: { url: 'http://localhost/' } },
    setupFiles: ['./src/test/setup.ts'],
    exclude: ['node_modules/**', 'dist/**', 'release/**', 'plugin/dist/**', '.stryker-tmp/**', 'coverage/**', 'reports/**'],
    clearMocks: true,
    restoreMocks: true,
    testTimeout: 10_000,
  },
})
