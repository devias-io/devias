import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'data-engine',
    include: ['test/**/*.test.ts'],
    environment: 'node',
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
