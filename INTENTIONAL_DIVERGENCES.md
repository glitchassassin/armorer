# Intentional divergences from published Armorer

This file records differences that are deliberate. Behavior not listed here should remain compatible with the published application unless a platform, offline, or accessibility requirement requires a change.

## Architecture and delivery

- Replace Eleventy and Alpine with a Preact, Vite, and `preact-iso` application. Prerender the main page and book directories, then hydrate them into the client application.
- Operate as an offline-first PWA with self-hosted code, fonts, icons, scripture packages, and search indexes. OS-level installation remains optional.
- Use a shared application shell instead of prerendered chapter pages. Deep links and offline navigation resolve through the client application; the build emits no chapter documents.
- Synchronize the corpus automatically and silently. Show synchronization status only beside Credits in the main-page footer; do not add prompts, banners, or notifications.
- Version application code, scripture content, and search data independently. Stage and validate updates before atomic activation, retain the working version through failure, and recover from interrupted or cleared storage.
- Produce separate translation builds for separate subdomains, each with its own scope, storage, metadata, attribution, and base URL. Do not add a runtime translation selector.

## Reader, selection, and search

- Bound ordinary chapter DOM growth while keeping adjacent chapters in continuous native-selection flow. Preserve chapters involved in an active text selection until selection work finishes.
- Treat verse fragments as application state. Do not use verse HTML IDs or native anchor scrolling. Support forward and backward cross-chapter ranges within a book.
- Show a themed passage-unavailable page when required content has not synchronized, including retry and navigation to the main page or available content.
- For cross-book clipboard selections, emit a separate canonical Markdown reference group for each book.
- Run full-text search locally in a worker from a prebuilt offline index. Order every matching result by canonical book, chapter, and verse; matching semantics, filters, and pagination otherwise remain parity concerns.

## Visual and accessibility

- Keep the justified Books of the Bible layout.
- Keep the rebuilt scrollbar treatment and table-of-contents border colors.
- Keep the combined Credits and offline-status footer.
- Do not impose a minimum chapter height.
- Add semantic structure, keyboard focus treatment, restrained live status announcements, reduced-motion support, and other accessibility improvements without changing the established visual language.
- Otherwise preserve the published dark theme, Merriweather typography, spacing, header/search layout, sticky chapter headings, verse numbers, highlights, table-of-contents layout, and responsive behavior.
