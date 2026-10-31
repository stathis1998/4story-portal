import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  // SWC emits the decorator metadata Nest needs for constructor injection; Vitest's default
  // transformer does not. tsconfigPaths resolves the path aliases declared in tsconfig.json.
  plugins: [swc.vite({ module: { type: 'es6' } }), tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['test/**/*.test.ts'],
    exclude: ['test/db/**', 'node_modules/**'],
  },
});
