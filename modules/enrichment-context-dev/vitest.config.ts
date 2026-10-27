import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'enrichment-context-dev',
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
});
