import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'mod-expenses',
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
});
