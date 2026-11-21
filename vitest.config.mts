import { defineConfig } from 'vitest/config';

const unitFiles = ['src/ai.test.ts', 'src/paths.test.ts', 'src/window-close.test.ts', 'src/shared/**/*.test.ts'];

export default defineConfig({
  test: {
    // Local npm test and Actions use the same disk concurrency and limits.
    maxWorkers: 2,
    reporters: ['default', 'json'],
    outputFile: { json: 'out/review-unit/report.json' },
    slowTestThreshold: 1000,
    projects: [
      { test: { name: 'unit', include: unitFiles, environment: 'node', testTimeout: 5000 } },
      { test: {
        name: 'storage', include: ['src/**/*.test.ts'], exclude: unitFiles,
        environment: 'node', testTimeout: 30000, hookTimeout: 30000
      } }
    ]
  }
});
