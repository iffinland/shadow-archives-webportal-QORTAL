import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import { defineConfig, globalIgnores } from 'eslint/config';

export default defineConfig([
  globalIgnores(['dist', 'coverage']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat['recommended-latest'],
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
  },
  {
    /*
     * Fast-refresh granularity is a developer-experience nicety, not part of the
     * Phase 1B acceptance criteria. These modules intentionally mix a component
     * with non-component exports (context hooks, the route table, test helpers)
     * or use `lazy()` route boundaries, where the rule produces false positives.
     */
    files: [
      '**/index.ts',
      '**/index.tsx',
      'src/app/providers/**',
      'src/app/router/**',
      'src/test/**',
    ],
    rules: { 'react-refresh/only-export-components': 'off' },
  },
]);
