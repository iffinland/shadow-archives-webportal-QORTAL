# Shadow Archives Webportal (Qortal APP)

Shadow Archives is a Qortal Q-App (`APP` service) for publishing and reading an
archive of blog posts, videos and gallery media stored on QDN.

**Current status: Phase 1B — application foundation and responsive AppShell.**
There is no content discovery, publishing, engagement, search or Q-Mail in this
build, and nothing is loaded from QDN yet. See "Phase boundaries" below.

## Requirements

- Node.js 20.19+ (verified on 20.19.2)
- npm 10+

## Commands

| Command                           | Purpose                                           |
| --------------------------------- | ------------------------------------------------- |
| `npm install`                     | Install dependencies                              |
| `npm run dev`                     | Vite dev server (plain browser; no Qortal bridge) |
| `npm run build`                   | Type-check (`tsc -b`) and build to `dist/`        |
| `npm run preview`                 | Serve the production build locally                |
| `npm run lint`                    | ESLint (flat config)                              |
| `npm run typecheck`               | TypeScript project build, no emit                 |
| `npm test`                        | Vitest (jsdom + Testing Library)                  |
| `npm run format` / `format:check` | Prettier                                          |

## Stack

Vite 7, React 19, TypeScript 5.9 (strict), `react-router-dom` 7
(`createBrowserRouter`), custom CSS design tokens, in-repo components and inline
SVG icons.

Deliberately **not** used: `HashRouter`, MUI/emotion, `qapp-core`'s published
root entry, any video player library, TipTap and DOMPurify (all deferred to the
feature phases that need them).

## Layout

```text
src/
├── app/          router (lazy route boundaries), providers, owner-editable config
├── assets/       bundled brand artwork
├── components/   common primitives, layout shell, feedback states
├── features/     home, blog, videos, gallery, search, taxonomy, about, contact, owner
├── qortal/       in-repo Qortal integration boundary (nothing else touches the bridge)
├── styles/       design tokens + base/shell/content stylesheets
├── test/         test setup and helpers
├── types/        shared view-model and global bridge types
└── utils/        motion, scroll-overflow and small pure helpers
```

### Qortal integration boundary

`src/qortal/` owns every platform interaction:

- `environment.ts` reads the injected `_qdn*` context once and decodes
  `_qdnName` (`Shadow%20Archives` → `Shadow Archives`); `getRouterBasename()`
  supplies the router basename.
- `bridge.ts` is the only module that calls `window.qortalRequest`, with a
  timeout and an error taxonomy (`unavailable`, `malformed`, `timeout`,
  `rejected`, `error`).
- `auth.ts` implements single-flight `GET_USER_ACCOUNT` with a session-cached
  rejection. It is **not** called at startup: the visitor shell never opens a
  permission dialog.
- `capability.ts` derives `unknown | visitor | authenticated-no-name |
authenticated-non-owner | owner`; it never reports `owner` optimistically.
- `navigation.ts` builds the verified `qortal://APP/<name>` links.

## Phase boundaries

Implemented: routing, design tokens, responsive shell (header top panels, banner,
primary action row, site navigation, footer), loading/empty/error states,
route-level code splitting, accessibility primitives (skip link, focus-visible
ring, reduced-motion handling, 44/48px targets) and a read-only integration
boundary.

Not implemented (by design): Blog/Video/Gallery features, publishing modals,
comments, likes, tips, Q-Mail sending, moderation, deep search and QDN
discovery. No QDN data is fetched and no fake engagement data is shown.

Before the final Blog and Video publish modals are built, the owner-approved
"publishing interoperability first" rule requires inspecting the then-current
Subwire and Q-Tube sources and QDN contracts. That research is not part of Phase
1B and no interoperability is claimed.

## Validation

`npm run lint`, `npm run typecheck`, `npm test` and `npm run build` pass. A
headless-Chrome smoke test against the production build verified rendering from
320px to 2560px without horizontal overflow, ≥44px interactive targets, visible
focus, working keyboard search disclosure and zero external network requests.

Real Qortal host / node dev-proxy behaviour has **not** been verified: no local
Qortal node was available for this work. A real host remains the authoritative
gate for runtime behaviour.
