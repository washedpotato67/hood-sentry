import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['**/*.test.ts'],
    exclude: ['node_modules', 'dist', 'coverage'],
    passWithNoTests: true,
    // Integration tests drive the live-mode loop against a real database, which
    // needs more headroom than the default 5s.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
