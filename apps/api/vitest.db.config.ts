import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// Real-database tests. They run only against the _TEST copies (enforced by guard.setup.ts) and roll
// back every write.
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    globals: true,
    root: './',
    include: ['test/db/**/*.db.test.ts'],
    setupFiles: ['test/db/guard.setup.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
  },
});
