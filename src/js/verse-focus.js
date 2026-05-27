let activeFocus;
let initialized = false;
let revision = 0;

function normalizeSlug(pathname) {
    return pathname.endsWith("/") ? pathname : `${pathname}/`;
}

function chapterParts(slug) {
    const match = normalizeSlug(slug).match(/^(.+\/)(\d+)\/$/);
    if (!match) return undefined;

    return {
        bookSlug: match[1],
        chapter: Number.parseInt(match[2], 10),
    };
}

function chapterSlug(bookSlug, chapter) {
    return `${bookSlug}${chapter}/`;
}

function parseVerseHash(hash, pathname = window.location.pathname) {
    const rawHash = hash.replace(/^#/, "");
    if (!rawHash) return undefined;

    const match = rawHash.match(/^(\d+)(?:-(?:(\d+)_)?(\d+))?$/);
    if (!match) return undefined;

    const start = Number.parseInt(match[1], 10);
    const endChapter = match[2] ? Number.parseInt(match[2], 10) : undefined;
    const end = match[3] ? Number.parseInt(match[3], 10) : start;
    const startSlug = normalizeSlug(pathname);
    const parts = chapterParts(startSlug);
    if (!parts) return undefined;

    return {
        startSlug,
        endSlug: chapterSlug(parts.bookSlug, endChapter ?? parts.chapter),
        bookSlug: parts.bookSlug,
        startChapter: parts.chapter,
        endChapter: endChapter ?? parts.chapter,
        startVerse: start,
        endVerse: end,
    };
}

function removeVerseFocusClasses() {
    document.querySelectorAll(".verse-focused").forEach((element) => element.classList.remove("verse-focused"));
}

function compareReference(a, b) {
    if (a.chapter !== b.chapter) return a.chapter - b.chapter;
    return a.verse - b.verse;
}

async function ensureFocusedChaptersLoaded(focus) {
    const loadChapter = window.ArmorerLoadChapter;
    if (!loadChapter) return;

    let slug = focus.startSlug;
    const direction = focus.endChapter >= focus.startChapter ? "nextChapter" : "prevChapter";
    const visited = new Set();

    while (slug !== focus.endSlug && !visited.has(slug)) {
        visited.add(slug);

        const chapter = document.querySelector(`[data-chapter-slug="${slug}"]`);
        const nextSlug = chapter?.dataset?.[direction];
        if (!nextSlug) return;

        await loadChapter(nextSlug);
        slug = nextSlug;
    }
}

function verseInFocus(chapter, verse, focus) {
    if (!chapterParts(chapter.slug) || !chapter.slug.startsWith(focus.bookSlug)) return false;

    const start = { chapter: focus.startChapter, verse: focus.startVerse };
    const end = { chapter: focus.endChapter, verse: focus.endVerse };
    const from = compareReference(start, end) <= 0 ? start : end;
    const to = compareReference(start, end) <= 0 ? end : start;
    const current = { chapter: chapter.number, verse };

    return compareReference(current, from) >= 0 && compareReference(current, to) <= 0;
}

function applyFocusClasses(focus) {
    removeVerseFocusClasses();

    document.querySelectorAll("[data-chapter-slug]").forEach((chapterElement) => {
        const slug = chapterElement.dataset.chapterSlug;
        const parts = chapterParts(slug);
        if (!parts || parts.bookSlug !== focus.bookSlug) return;

        chapterElement.querySelectorAll("[data-verse]").forEach((verseElement) => {
            const verse = Number.parseInt(verseElement.dataset.verse, 10);
            if (verseInFocus({ slug, number: parts.chapter }, verse, focus)) {
                verseElement.classList.add("verse-focused");
            }
        });
    });
}

function scrollToFocusStart(focus) {
    const chapter = document.querySelector(`[data-chapter-slug="${focus.startSlug}"]`);
    const element = chapter?.querySelector(`[data-verse="${focus.startVerse}"] .verse-no`);
    if (element) element.scrollIntoView();
}

export async function applyVerseFocus({ scroll = true } = {}) {
    const focus = parseVerseHash(window.location.hash);

    if (!focus) {
        activeFocus = undefined;
        revision++;
        removeVerseFocusClasses();
        return false;
    }

    activeFocus = focus;
    const appliedRevision = ++revision;
    await ensureFocusedChaptersLoaded(focus);
    if (appliedRevision !== revision) return false;

    applyFocusClasses(focus);
    if (scroll) scrollToFocusStart(focus);
    return true;
}

export function refreshVerseFocus() {
    if (!isVerseFocusActive()) return;
    applyVerseFocus({ scroll: false });
}

export function clearVerseFocus() {
    activeFocus = undefined;
    revision++;
    removeVerseFocusClasses();
    if (window.location.hash) {
        const url = new URL(window.location);
        url.hash = "";
        history.replaceState(null, document.title, url.toString());
    }
}

export function isVerseFocusActive() {
    return !!activeFocus;
}

export function initializeVerseFocus() {
    if (initialized) return;
    initialized = true;

    window.ArmorerVerseFocus = {
        apply: applyVerseFocus,
        clear: clearVerseFocus,
        isActive: isVerseFocusActive,
        refresh: refreshVerseFocus,
    };

    window.addEventListener("load", () => applyVerseFocus());
    document.addEventListener("click", (event) => {
        if (!isVerseFocusActive()) return;
        if (event.target.closest(".verse-focused")) return;
        if (event.target.closest("a, button, input, textarea, select")) return;

        clearVerseFocus();
    });
}
