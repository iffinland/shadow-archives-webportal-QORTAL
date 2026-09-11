#!/usr/bin/env node
/**
 * Shadow Archives — QDN APP publication artifact builder.
 *
 * Packs the production `dist/` output into a ZIP whose ROOT contains
 * `index.html`, which is what Core's APP renderer requires
 * (`ArbitraryDataRenderer.getFilename` locates an index file in the resource
 * root, and `Service.APP` auto-routes unhandled paths back to it).
 *
 * The archive is deterministic given identical `dist/` bytes:
 *   - entries are written in sorted order;
 *   - all mtimes are normalized (SOURCE_DATE_EPOCH, else 1980-01-01 UTC);
 *   - `zip -X -D` suppresses platform extra fields and directory entries.
 *     Core's `ZipUtils.unzip` recreates parent directories, so directory
 *     entries are not required.
 *
 * It performs NO network or QDN write. It validates the artifact structure and
 * writes a per-file hash manifest for intended-revision verification.
 *
 * Usage: node scripts/package-app.mjs   (after `npm run build`)
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, posix, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const distDir = join(projectRoot, 'dist');
const releaseDir = join(projectRoot, 'release');

const SOURCE_DATE_EPOCH = process.env.SOURCE_DATE_EPOCH;
const FIXED_EPOCH_SECONDS =
  SOURCE_DATE_EPOCH && /^\d+$/.test(SOURCE_DATE_EPOCH) ? Number(SOURCE_DATE_EPOCH) : 315532800; // 1980-01-01T00:00:00Z

const failures = [];
const fail = (message) => failures.push(message);
const sha256File = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');

function walk(root) {
  const files = [];
  const dirs = [];
  const walkDir = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        dirs.push(full);
        walkDir(full);
      } else if (entry.isFile()) {
        files.push(full);
      } else {
        fail(`unsupported non-file entry in dist: ${relative(root, full)}`);
      }
    }
  };
  walkDir(root);
  return { files, dirs };
}

function toPosix(root, absolute) {
  return relative(root, absolute).split(sep).join(posix.sep);
}

// --- 1. Structural validation of dist/ -------------------------------------

if (!existsSync(distDir)) {
  console.error('FAIL: dist/ does not exist. Run `npm run build` first.');
  process.exit(2);
}

const { files: distFiles, dirs: distDirs } = walk(distDir);

if (!existsSync(join(distDir, 'index.html'))) {
  fail('dist/index.html is missing (required at the resource root)');
}

const buildJsonPath = join(distDir, 'build.json');
let buildMetadata = null;
if (!existsSync(buildJsonPath)) {
  fail('dist/build.json is missing (build provenance)');
} else {
  try {
    buildMetadata = JSON.parse(readFileSync(buildJsonPath, 'utf8'));
    for (const key of ['app', 'version', 'commit', 'commitShort', 'builtAt']) {
      if (typeof buildMetadata[key] !== 'string' || buildMetadata[key].length === 0) {
        fail(`dist/build.json is missing a non-empty "${key}"`);
      }
    }
    if (typeof buildMetadata.dirty !== 'boolean') {
      fail('dist/build.json is missing a boolean "dirty" flag');
    }
  } catch (error) {
    fail(`dist/build.json is not valid JSON: ${error.message}`);
  }
}

const relativeFiles = distFiles.map((file) => toPosix(distDir, file)).sort();

const requiredChunkPrefixes = [
  'assets/AboutPage-',
  'assets/BlogPage-',
  'assets/BlogPostPage-',
  'assets/CategoryPage-',
  'assets/ContactPage-',
  'assets/GalleryAlbumPage-',
  'assets/GalleryDetailPage-',
  'assets/GalleryItemPage-',
  'assets/GalleryPage-',
  'assets/ListingGrid-',
  'assets/NotFoundPage-',
  'assets/Pagination-',
  'assets/SearchPage-',
  'assets/StudioPage-',
  'assets/TagPage-',
  'assets/VideoDetailPage-',
  'assets/VideosPage-',
];
for (const prefix of requiredChunkPrefixes) {
  if (!relativeFiles.some((file) => file.startsWith(prefix) && file.endsWith('.js'))) {
    fail(`expected lazy route chunk missing from dist: ${prefix}*.js`);
  }
}

if (!relativeFiles.some((file) => /^assets\/banner-shadow-archives-.*\.webp$/.test(file))) {
  fail('banner asset missing from dist/assets');
}

if (!relativeFiles.some((file) => /^assets\/index-.*\.css$/.test(file))) {
  fail('entry stylesheet missing from dist/assets');
}

const forbidden = [
  [/\.map$/, 'source map'],
  [/(^|\/)node_modules(\/|$)/, 'node_modules directory'],
  [/(^|\/)\.env(\.|$)/, '.env file'],
  [/\.(ts|tsx)$/, 'TypeScript source file'],
];
for (const file of relativeFiles) {
  for (const [pattern, label] of forbidden) {
    if (pattern.test(file)) fail(`forbidden ${label} in dist: ${file}`);
  }
}

// QDN-safe relative asset references: no absolute/protocol-relative/external URLs.
const indexHtml = existsSync(join(distDir, 'index.html'))
  ? readFileSync(join(distDir, 'index.html'), 'utf8')
  : '';
for (const match of indexHtml.matchAll(/\b(?:src|href)="([^"]+)"/g)) {
  const url = match[1];
  if (url.startsWith('data:')) continue;
  if (url.startsWith('/') || url.startsWith('//')) {
    fail(`index.html contains a non-relative asset URL: ${url}`);
  }
  if (/^[a-z]+:\/\//i.test(url)) {
    fail(`index.html contains an external URL: ${url}`);
  }
}
for (const match of indexHtml.matchAll(/https?:\/\//g)) {
  fail(`index.html references an external origin: ${match[0]}`);
}

// --- 2. Build the deterministic ZIP ----------------------------------------

const artifactVersion = buildMetadata?.version ?? '0.0.0';
const artifactDate = (buildMetadata?.builtAt ?? new Date().toISOString())
  .slice(0, 10)
  .replace(/-/g, '');
const artifactName = `shadow-archives-app-${artifactVersion}-${artifactDate}.zip`;
const artifactPath = join(releaseDir, artifactName);

if (failures.length === 0) {
  if (process.platform === 'win32') {
    fail('packaging script requires a POSIX `zip` binary');
  } else {
    mkdirSync(releaseDir, { recursive: true });
    const stagingDir = join(tmpdir(), `shadow-archives-package-${process.pid}`);
    rmSync(stagingDir, { recursive: true, force: true });
    cpSync(distDir, stagingDir, { recursive: true });

    try {
      // Normalize mtimes (directories first, then files) for byte-stable entries.
      const staged = walk(stagingDir);
      const fixedTime = new Date(FIXED_EPOCH_SECONDS * 1000);
      for (const dir of [...staged.dirs, ...staged.files]) {
        utimesSync(dir, fixedTime, fixedTime);
      }

      const entryNames = staged.files.map((file) => toPosix(stagingDir, file)).sort();
      rmSync(artifactPath, { force: true });
      execFileSync('zip', ['-X', '-q', '-9', '-D', artifactPath, ...entryNames], {
        cwd: stagingDir,
        env: { ...process.env, TZ: 'UTC' },
        stdio: ['ignore', 'ignore', 'inherit'],
      });
    } finally {
      rmSync(stagingDir, { recursive: true, force: true });
    }

    // Confirm index.html is at the archive root.
    try {
      const listing = execFileSync('unzip', ['-Z1', artifactPath], { encoding: 'utf8' });
      const entries = listing.split('\n').filter(Boolean);
      if (!entries.includes('index.html')) {
        fail('index.html is not at the ZIP root');
      }
      if (entries.some((entry) => entry.startsWith('/') || entry.includes('..'))) {
        fail('ZIP contains an absolute or parent-relative entry');
      }
    } catch (error) {
      fail(`could not list the produced ZIP: ${error.message}`);
    }
  }
}

// --- 3. Report + manifest ---------------------------------------------------

if (failures.length > 0) {
  console.error('FAIL: APP publication artifact validation failed:');
  for (const message of failures) console.error(`  - ${message}`);
  process.exit(1);
}

const artifactBytes = statSync(artifactPath).size;
const uncompressedBytes = distFiles.reduce((total, file) => total + statSync(file).size, 0);
const artifactSha256 = sha256File(artifactPath);
const perFileHashes = relativeFiles.map((file) => ({
  path: file,
  bytes: statSync(join(distDir, file)).size,
  sha256: sha256File(join(distDir, file)),
}));

const manifest = {
  artifact: artifactName,
  sha256: artifactSha256,
  fileCount: relativeFiles.length,
  uncompressedBytes,
  compressedBytes: artifactBytes,
  build: buildMetadata,
  files: perFileHashes,
};
const manifestPath = `${artifactPath}.manifest.json`;
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

// Cross-check that every dist file made it into the archive.
try {
  const listing = new Set(
    execFileSync('unzip', ['-Z1', artifactPath], { encoding: 'utf8' })
      .split('\n')
      .filter(Boolean)
      .map((entry) => entry.replace(/\/$/, '')),
  );
  for (const file of relativeFiles) {
    if (!listing.has(file)) fail(`artifact is missing ${file}`);
  }
  const extras = [...listing].filter((entry) => !relativeFiles.includes(entry));
  if (extras.length > 0) fail(`artifact has unexpected entries: ${extras.join(', ')}`);
} catch (error) {
  fail(`could not cross-check ZIP contents: ${error.message}`);
}

if (failures.length > 0) {
  console.error('FAIL: artifact cross-check failed:');
  for (const message of failures) console.error(`  - ${message}`);
  process.exit(1);
}

console.log('APP publication artifact ready');
console.log(`  artifact:    ${artifactPath}`);
console.log(`  manifest:    ${manifestPath}`);
console.log(
  `  build:       v${buildMetadata.version}+${buildMetadata.commitShort} (${buildMetadata.commit})`,
);
console.log(`  builtAt:     ${buildMetadata.builtAt}`);
console.log(
  `  worktree:    ${buildMetadata.dirty ? 'DIRTY (uncommitted source changes)' : 'clean'}`,
);
console.log(`  files:       ${relativeFiles.length}`);
console.log(`  uncompressed:${uncompressedBytes} bytes`);
console.log(`  compressed:  ${artifactBytes} bytes`);
console.log(`  sha256:      ${artifactSha256}`);
console.log(`  index.html:  ZIP root (verified)`);
