import baseUrl from "./base-url";
import { refreshVerseFocus } from "./verse-focus";

const loading = {}

let touching = false;
let touchEndHandlers = [];
document.addEventListener("touchstart", () => touching = true)
function handleTouchEnd(ev) {
    if (ev.touches.length === 0) {
        touchEndHandlers.forEach(fn => fn());
        touchEndHandlers = [];
    }
}
document.addEventListener("touchend", handleTouchEnd)
document.addEventListener("touchcancel", handleTouchEnd)
async function waitForTouchEnd() {
    return new Promise((resolve) => {
        if (!touching) {
            resolve();
        } else {
            touchEndHandlers.push(resolve);
        }
    })
}

export async function loadChapter(chapter) {
    if (!chapter || document.querySelector(`div[data-chapter-slug="${chapter}"]`)) return; // already loaded
    if (loading[chapter]) return loading[chapter];

    loading[chapter] = (async () => {
        const base = baseUrl();

        const res = await fetch(base + chapter);
        const html = await res.text();
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        const content = doc.querySelector(`div[data-chapter-slug="${chapter}"]`);
        if (!content) return;

        const nextChapter = content.getAttribute('data-next-chapter');
        const prevChapter = content.getAttribute('data-prev-chapter');

        // insert content into dom before next chapter or after previous chapter
        const nextChapterDom = nextChapter && document.querySelector(`div[data-chapter-slug="${nextChapter}"]`);
        const prevChapterDom = prevChapter && document.querySelector(`div[data-chapter-slug="${prevChapter}"]`);

        await waitForTouchEnd();

        if (nextChapterDom) {
            const scrollElement = document.querySelector('#site-content');
            const scrollPos = scrollElement.scrollTop;
            nextChapterDom.parentNode.insertBefore(content, nextChapterDom);
            scrollElement.scrollTop = scrollPos + content.getBoundingClientRect().height;
        } else if (prevChapterDom) {
            prevChapterDom.parentNode.insertBefore(content, prevChapterDom.nextSibling);
        } else {
            console.error('Could not find insert position for chapter', chapter, 'between', nextChapter, 'and', prevChapter)
        }

        refreshVerseFocus();
    })();

    await loading[chapter];
    delete loading[chapter];
}

window.ArmorerLoadChapter = loadChapter;

export function chapterIntersected(chapter, full = false) {
    const chapterData = document.querySelector(`div[data-chapter-slug="${chapter}"]`).dataset;
    if (full && !window.ArmorerVerseFocus?.isActive()) {
        document.title = chapterData.title;
        history.replaceState(null, "", baseUrl() + chapter);
    }
    loadChapter(chapterData.nextChapter);
    loadChapter(chapterData.prevChapter);
}
