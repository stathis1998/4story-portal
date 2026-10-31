import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  // The router plugin must run before React so it can generate src/routeTree.gen.ts.
  // Test files next to routes must not become routes.
  plugins: [
    tanstackRouter({ target: 'react', autoCodeSplitting: true, routeFileIgnorePattern: '\\.test\\.tsx?$' }),
    react(),
    tailwindcss(),
  ],
  server: {
    port: 5173,
    // Same origin for the browser, so the httpOnly session cookie needs no CORS setup. xfwd passes
    // the browser's address on, so the API rate-limits each player separately.
    proxy: { '/api': { target: 'http://localhost:3000', xfwd: true } },
  },
})
