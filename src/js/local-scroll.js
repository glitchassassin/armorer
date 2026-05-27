import { applyVerseFocus, initializeVerseFocus } from "./verse-focus";

let interval;

function waitForVisibleContent(fn) {
    if (interval) clearInterval(interval);
    interval = setInterval(() => {
        // wait until site-content is visible again; otherwise,
        // alpine sometimes doesn't have enough time to switch back
        const siteContent = document.getElementById('site-content');
        if (siteContent.style.display === 'none') return;
        clearInterval(interval);

        fn();
    }, 100);
}

initializeVerseFocus();

window.addEventListener('hashchange', () => {
    waitForVisibleContent(() => applyVerseFocus());
})
