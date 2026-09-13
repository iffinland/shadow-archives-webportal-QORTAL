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

- `environment.ts` reads the injected `_qdn*` context once, decodes `_qdnName`
  (`Shadow%20Archives` → `Shadow Archives`) and derives the explicit runtime
  state: `plain-browser`, `qortal-render-readonly`, `qortal-host`,
  `qortal-dev-proxy`, `qortal-bridge-unidentified`. A published render context
  without a host bridge is a real read-only runtime and is never reported as a
  plain browser. `getRouterBasename()` supplies the router basename.
- `bridgeGlobal.ts` resolves the injected bridge. Core v6.1.9 declares it as a
  top-level `const` in the classic `q-apps.js`, so it is reachable as the bare
  global `qortalRequest` but is **not** a `window` property; both access styles
  are supported. `bridge.ts` is the only module that calls it, with a timeout and
  an error taxonomy (`unavailable`, `malformed`, `timeout`, `rejected`, `error`).
- `services/readPort.ts` selects the read transport from the runtime state: the
  injected bridge when reachable, otherwise the verified same-origin REST routes
  the shim itself uses (`/arbitrary/resources/search`, `/arbitrary/{service}/{name}`).
  This fallback is read-only; writes stay bridge-only and owner-gated.
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

Not implemented (by design): comments, likes, tips, Q-Mail sending, moderation,
deep search and a QDN discovery crawler. Owner publishing for Blog, Video and
Gallery is implemented (see below). No fake engagement data is shown.

The owner-approved "publishing interoperability first" rule requires inspecting
the then-current Q-Tube/Subwire sources and QDN contracts before a publish modal
is built. That research was completed for the Video and Blog verticals and the
resulting contracts are recorded below.

## Owner runtime acceptance — 2026-09-13

**OWNER-RUNTIME PASS:** Gallery publish/read/index/render/reload; Video publish
in Shadow Archives followed by native Q-Tube discovery/playback; Blog publish
in Shadow Archives followed by native SubWire discovery/render; and the optional
Quitter announcement followed by Quitter discovery/render.

The owner explicitly accepted these workflows on 2026-09-13. Implementation:
**DeepSeek**, running through the local Codex CLI harness. Checkpoint/documentation
writer: Codex Local. The source and read-only evidence pins below describe the
verified contract snapshot, not permanent community-app guarantees. Recheck them
before changing interoperability. The owner-tested deployment's exact ZIP hash
and consumer runtime revisions were not supplied with the acceptance.

Canonical acceptance and checkpoint record: Qortal workspace
`docs/shadow-archives-webportal/handoffs/2026-09-13-owner-runtime-checkpoint.md`.

## Video publishing and Q-Tube interoperability

The owner Video workflow publishes one video from Shadow Archives and makes the
same publication discoverable by the current Q-Tube UI. The Shadow Archives
entity/catalog stay canonical; Q-Tube knowledge lives in exactly one adapter
(`services/qtubeVideoContract.ts`) and no Q-Tube code is imported or bundled.

Verified 2026-09-13 against current source and read-only QDN evidence:

- `Qortal/q-tube` `main` `68c3ea70`, `Qortal/Subwire` `master` `a933a6c4`
  (both re-checked as upstream `HEAD`), Qortal Core `6.1.9` (`108bf191`, live
  node reported `qortal-6.1.9-108bf19`), Qortal Hub `12a573b2`.
- Q-Tube publishes the media as one `VIDEO` resource at `qtube_vid_<slug>_<id>`
  and its metadata as a `DOCUMENT` at the same identifier plus `_metadata`, with
  `tag1 = qtube_vid_`. `q-tube/src/utils/checkStructure.ts` is the discovery
  gate: required `title`, `videoReference` (`name`/`identifier`/`service` in the
  Qortal service enum) and `filename`; `duration`/`fileSize` are optional.
- Discovery is `SEARCH_QDN_RESOURCES { service: 'DOCUMENT', identifier:
'qtube_vid_', mode: 'ALL', reverse: true, limit: 20 }` — the identifier is a
  **substring** match and `mode: 'ALL'` is required (Core's default `LATEST`
  returns one resource per publisher/name). No index or playlist resource is
  required for a video to be discovered.
- Q-Tube drops any discovered payload that fails that gate, so the adapter runs
  the same gate on its own payload before publishing (fail closed) and again on
  the served payload during verification.

Published resource model for one video (stable id `<id12>`):

| Resource                               | Service     | Identifier                              |
| -------------------------------------- | ----------- | --------------------------------------- |
| Shadow Archives entity (authoritative) | `DOCUMENT`  | `saw_vid_<id>`                          |
| Poster                                 | `THUMBNAIL` | `saw_vid_thumb_<id>`                    |
| Media bytes (published once)           | `VIDEO`     | `qtube_vid_<id>`                        |
| Q-Tube-compatible metadata (derived)   | `DOCUMENT`  | `qtube_vid_<id>_metadata`               |
| Derived Videos index                   | `DOCUMENT`  | `saw_cat_vid_p###` + `saw_cat_manifest` |

The media identifier is the metadata identifier minus `_metadata` because that
is the convention `Qortal/Subwire` encodes; `videoReference` points at the same
single resource, so no media bytes are ever published twice.

Writes are staged and reported truthfully: (1) media + poster, (2) entity +
Q-Tube metadata, (3) derived index. A timed-out submission is never retried
automatically, an incomplete index never blocks or rolls back the authoritative
content, and the modal always shows the exact QDN coordinates plus a bounded,
read-only Verify. Large media is sent to the host as a `file` (the host encodes
it); everything else uses `data64`.

## Blog publishing and SubWire interoperability

The owner Blog workflow publishes one article from Shadow Archives and makes the
same publication discoverable by the current SubWire UI, with an **optional**
owner-approved Quitter announcement. The Shadow Archives entity stays canonical
(`tiptap-json-v1` body + normalized `bodyText`); SubWire/Quitter knowledge lives
only in the `services/subwireArticleContract.ts` and
`services/quitterAnnouncementContract.ts` adapters, and no SubWire or Quitter
code is imported or bundled.

Verified 2026-09-13 against current source and read-only QDN evidence:

- `Qortal/Subwire` `master` `a933a6c4`, `Qortal/Quitter` `master` `4e4246c3`,
  `Qortal/qapp-core` `master` `0f9d6ac`, Qortal Core `6.1.9` (`108bf191`),
  Qortal Hub `develop` `12a573b2`.
- Both apps derive QDN identifiers with `qapp-core`'s `hashWord`/`buildIdentifier`
  math (`sha256(publicSalt + word)`, URL-safe base64, fixed lengths). The
  identifier math is mirrored once in `services/qappIdentifierContract.ts`; the
  derived prefixes were confirmed against real QDN search results.
- SubWire stores one article as a `DOCUMENT` whose `data64` is JSON
  `{ title, subtitle?, content (GFM Markdown), coverImage {name, src}, timestamp,
name, type: 'essay'|'episode', published }`, with the cover inlined as bare WebP
  base64 (SubWire renders `data:image/webp;base64,<src>`). Discovery is
  `SEARCH_QDN_RESOURCES { service: 'DOCUMENT', identifier: <article prefix>,
prefix: true, mode: 'ALL', reverse: true, limit: 20, excludeBlocked: true }`;
  no index/list resource is required.
- SubWire's Quitter cross-post is a **separate** `DOCUMENT` in Quitter's own
  post namespace (`{ text, timestamp, name, images?: [{src}] }`, WebP base64),
  text `New publication: <title>` + the `qortal://APP/Subwire/article/<name>/<id>`
  deep link. It is optional and requires its own approval. Shadow Archives
  performs the same write directly (no runtime dependency on SubWire).

Published resource model for one post (stable id `<id12>`):

| Resource                                          | Service     | Identifier                                     |
| ------------------------------------------------- | ----------- | ---------------------------------------------- |
| Shadow Archives entity (authoritative, rich text) | `DOCUMENT`  | `saw_post_<id>`                                |
| Cover                                             | `THUMBNAIL` | `saw_post_thumb_<id>`                          |
| SubWire-compatible article (derived Markdown)     | `DOCUMENT`  | `7l1NGsWiY0SgPb-FJVWQM-T60ZadsfPsbLTh-<id>-v1` |
| Derived Blog index                                | `DOCUMENT`  | `saw_cat_post_p###` + `saw_cat_manifest`       |
| Optional Quitter announcement                     | `DOCUMENT`  | `MhNiRYdzkaP9dz-kX47dT-XrFXaYetyErMdF-<id>-v1` |

The derived article is a rebuildable interoperability artifact, never
authoritative; the canonical body keeps Shadow Archives' DOMPurify rendering
boundary. Writes are staged and reported truthfully: (1) cover, (2) entity +
SubWire-compatible article, (3) derived index, then the optional explicit Quitter
step. An incomplete index or a declined/failed Quitter announcement never reports
the whole publication as failed; a timed-out submission is never retried
automatically.

## Validation

`npm run lint`, `npm run typecheck`, `npm test` and `npm run build` pass. A
headless-Chrome smoke test against the production build verified rendering from
320px to 2560px without horizontal overflow, ≥44px interactive targets, visible
focus, working keyboard search disclosure and zero external network requests.

Real Qortal host / node dev-proxy behaviour has **not** been verified: no local
Qortal node was available for this work. A real host remains the authoritative
gate for runtime behaviour.
