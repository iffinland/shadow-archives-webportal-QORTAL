import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// `base: ''` is required for QDN: Core injects `<base href=".../">` and the app
// must emit relative asset URLs so it resolves under `/render/<service>/<name>`.
export default defineConfig({
  base: '',
  plugins: [react()],
  build: {
    target: 'es2022',
    cssCodeSplit: true,
    sourcemap: false,
    chunkSizeWarningLimit: 700,
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    restoreMocks: true,
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
});
