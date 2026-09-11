/**
 * Compile-time build identity.
 *
 * `__BUILD_INFO__` is injected by the Vite config (`define`) from the package
 * version and the source commit. The value is deliberately timestamp-free so
 * the compiled bytes are identical for a given commit + version, which keeps
 * the emitted content hashes meaningful for intended-revision verification.
 *
 * The full release record (including `builtAt`) is emitted once per build to
 * `dist/build.json`; see `vite.config.ts`.
 */

export interface BuildInfo {
  readonly app: string;
  readonly version: string;
  readonly commit: string;
  readonly commitShort: string;
}

declare const __BUILD_INFO__: BuildInfo;

export const buildInfo: BuildInfo = Object.freeze(__BUILD_INFO__);

/** Compact, human-readable build id: `<version>+<commitShort>`. */
export const buildLabel = `${buildInfo.version}+${buildInfo.commitShort}`;
