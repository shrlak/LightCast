import { defineConfig } from 'vitest/config';

// End-to-end pass (npm run e2e): real Chromium against the built app. Kept out of `npx vitest run`.
export default defineConfig({
  test: {
    include: ['tests/e2e/**/*.e2e.ts'],
    setupFiles: ['tests/setupEngine.ts'],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    fileParallelism: false,
    sequence: { concurrent: false },
  },
});
