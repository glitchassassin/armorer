<p align="center" width="100%">
  <img src="https://github.com/glitchassassin/armorer/raw/main/src/img/armorer_social.png" width="33%" alt="Armorer">
</p>

# Armorer

Armorer is an offline-first, minimal scripture reader built with Preact, `preact-iso`, and Vite. It preserves the original chapter URLs, fragment selections, local search, continuous infinite reader, native text selection, and scripture-specific clipboard output.

## Develop

Armorer requires Node.js 22.12 or newer.

```sh
npm ci
npm run dev
```

The development command generates translation packages before starting Vite. Production output is generated with:

```sh
npm run build
```

The build emits the client application, revisioned fonts and images, content-addressed chapter and search packages, `404.html` for static-host deep links, the web app manifest, and a generated service worker in `dist/`. It prerenders meaningful HTML for the main page and the 66 book-directory pages with the supported `@preact/preset-vite` and `preact-iso` workflow. Those pages hydrate into the same client application.

Scripture chapter routes remain client-rendered. The build does not emit 1,189 chapter documents, and offline navigation does not depend on prerendered pages. Static hosts should route missing application URLs through `404.html`; the client then restores chapter paths and fragments from synchronized content.

## Verification

```sh
npm test
npm run typecheck
npm run test:e2e
```

Playwright tests exercise prerendered HTML and hydration, desktop and mobile layouts, offline launch and search, synchronized and unsynchronized passages, range restoration, history, bidirectional scrolling, selection-aware pruning, clipboard formatting, and storage recovery.

## Translation builds

Translation builds are configured by JSON rather than runtime UI. The default build uses [`translations/kjv.json`](translations/kjv.json). Select another configuration with `ARMORER_TRANSLATION`:

```sh
ARMORER_TRANSLATION=translations/example.json npm run build
```

A translation configuration supplies:

- translation ID, display names, language, base URL, and attribution;
- independent content and search versions;
- a source-adapter module and its source-specific settings;
- canon and book metadata, including slugs and reference aliases.

Each build is intended for its own subdomain. Browser origin isolation plus the configured PWA scope gives every translation independent IndexedDB data, service-worker caches, installation metadata, and URLs. Shared components contain no KJV-specific labels.

Prerendered links, metadata, app assets, manifest URLs, and the service-worker scope honor the configured `baseUrl`. Run preview with the same translation configuration used for the build, for example:

```sh
ARMORER_TRANSLATION=translations/example.json npx vite preview
```

The generic packager loads the adapter named by `source.adapter`. An adapter exports `loadTranslationSource({ source, canon, root, configPath })` and returns an array of normalized verses:

```js
[{ bookId: 'john', chapter: 3, number: 16, html: '…', text: '…' }]
```

Adapters own source parsing, book-name mapping, markup conversion, punctuation corrections, and other source-specific behavior. The KJV package implementation is isolated in [`scripts/source-adapters/kjv-node-module.mjs`](scripts/source-adapters/kjv-node-module.mjs). The generic packager validates normalized verses and produces the shared chapter, manifest, and search package schemas.

## Offline and update model

- The application shell is pre-cached only after every revisioned asset validates as a successful response.
- Chapters are independently content-addressed. Unchanged chapter files keep their hashes across translation versions.
- Search is a separate, prebuilt MiniSearch package loaded and queried in a worker.
- Initial content becomes usable chapter by chapter while background synchronization continues.
- Translation updates download into staging keys, validate SHA-256 checksums, and retain the active manifest until all required chapter packages are readable.
- Manifest activation uses one IndexedDB transaction. Obsolete content is removed only after the replacement package opens successfully.
- Interrupted downloads resume by checking content hashes already present in IndexedDB.
- Invalid downloads never replace active data. Cleared or evicted storage is recreated from the revisioned manifests when connectivity returns.
- Old application caches remain until the replacement reports a successful startup. A candidate that cannot start falls back to the last healthy shell.

## URLs

Canonical chapter URLs are `/{book-slug}/{chapter}/`.

Application-level verse selections use the preserved fragment grammar:

- `#<verse>`
- `#<startVerse>-<endVerse>`
- `#<startVerse>-<endChapter>_<endVerse>`

Examples:

- `/psalms/119/#100`
- `/psalms/119/#100-105`
- `/john/3/#36-4_3`

Search query and page state use `q` and `p` query parameters.
