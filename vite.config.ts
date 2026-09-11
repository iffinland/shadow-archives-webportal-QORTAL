import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

const projectRoot = fileURLToPath(new URL('.', import.meta.url));

function readPackageVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
      version?: string;
    };
    return typeof pkg.version === 'string' && pkg.version.length > 0 ? pkg.version : '0.0.0';
  } catch {
    return '0.0.0';
  }
}

function readCommit(): string {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: projectRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return 'unknown';
  }
}

function isWorkTreeDirty(): boolean {
  try {
    const status = execFileSync('git', ['status', '--porcelain'], {
      cwd: projectRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return status.trim().length > 0;
  } catch {
    return false;
  }
}

function resolveBuiltAt(): string {
  const sourceDateEpoch = process.env.SOURCE_DATE_EPOCH;
  if (sourceDateEpoch && /^\d+$/.test(sourceDateEpoch)) {
    return new Date(Number(sourceDateEpoch) * 1000).toISOString();
  }
  return new Date().toISOString();
}

const commit = readCommit();

/**
 * Injected into the bundle via `define`. Timestamp-free so the executable bytes
 * stay identical for a given commit + version and the emitted content hashes
 * remain meaningful for intended-revision verification.
 */
const buildIdentity = {
  app: 'shadow-archives-webportal',
  version: readPackageVersion(),
  commit,
  commitShort: commit === 'unknown' ? 'unknown' : commit.slice(0, 7),
};

/**
 * Full release record, emitted once per build to `dist/build.json`. `commit` is
 * the source commit the working tree is based on; `dirty` records whether that
 * tree had uncommitted changes when the artifact was built.
 */
const releaseMetadata = { ...buildIdentity, builtAt: resolveBuiltAt(), dirty: isWorkTreeDirty() };

function buildProvenancePlugin(): Plugin {
  return {
    name: 'shadow-archives-build-provenance',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'build.json',
        source: `${JSON.stringify(releaseMetadata, null, 2)}\n`,
      });
    },
  };
}

// `base: ''` is required for QDN: Core injects `<base href=".../">` and the app
// must emit relative asset URLs so it resolves under `/render/<service>/<name>`.
export default defineConfig({
  base: '',
  define: {
    __BUILD_INFO__: JSON.stringify(buildIdentity),
  },
  plugins: [react(), buildProvenancePlugin()],
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
