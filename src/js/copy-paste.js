import baseUrl from "./base-url";

function verseText(verseElement) {
    const clone = verseElement.cloneNode(true);
    clone.querySelectorAll('.verse-no').forEach(e => e.remove());
    return clone.textContent.trim();
}

function verseReference(verseElement) {
    const chapter = verseElement.closest('[data-chapter]');

    return {
        book: chapter.dataset.book,
        chapter: chapter.dataset.chapter,
        chapterSlug: chapter.dataset.chapterSlug,
        verse: Number.parseInt(verseElement.dataset.verse, 10),
    };
}

function referenceTitle(group) {
    const from = group.from;
    const to = group.to;

    if (from.book !== to.book) return `${from.book} ${from.chapter}:${from.verse} - ${to.book} ${to.chapter}:${to.verse}`;
    if (from.chapter !== to.chapter) return `${from.book} ${from.chapter}:${from.verse}-${to.chapter}:${to.verse}`;
    if (from.verse === to.verse) return `${from.book} ${from.chapter}:${from.verse}`;
    return `${from.book} ${from.chapter}:${from.verse}-${to.verse}`;
}

function referenceUrl(group) {
    const from = group.from;
    const to = group.to;
    if (from.book !== to.book) return undefined;

    let hash = `#${from.verse}`;

    if (from.chapter !== to.chapter) {
        hash = `#${from.verse}-${to.chapter}_${to.verse}`;
    } else if (from.verse !== to.verse) {
        hash = `#${from.verse}-${to.verse}`;
    }

    return new URL(`${baseUrl()}${from.chapterSlug}${hash}`, window.location.origin).toString();
}

function referenceLink(group) {
    const title = referenceTitle(group);
    const url = referenceUrl(group);

    return url ? `[${title}](${url})` : title;
}

function selectedVerseElements(selection) {
    const elements = [];
    const seen = new Set();

    for (let rangeIndex = 0; rangeIndex < selection.rangeCount; rangeIndex++) {
        const range = selection.getRangeAt(rangeIndex);
        document.querySelectorAll('[data-chapter-slug] .verse').forEach((verseElement) => {
            if (!range.intersectsNode(verseElement) || seen.has(verseElement)) return;
            seen.add(verseElement);
            elements.push(verseElement);
        });
    }

    return elements;
}

function groupSelectedVerses(verseElements) {
    return verseElements.reduce((groups, verseElement) => {
        const reference = verseReference(verseElement);
        const previous = groups[groups.length - 1];

        if (!previous || previous.from.chapterSlug !== reference.chapterSlug) {
            groups.push({
                from: reference,
                to: reference,
                verses: [verseElement],
            });
        } else {
            previous.to = reference;
            previous.verses.push(verseElement);
        }

        return groups;
    }, []);
}

function partialSelectionText(selection) {
    const text = [];
    let reference;

    for (let rangeIndex = 0; rangeIndex < selection.rangeCount; rangeIndex++) {
        const range = selection.getRangeAt(rangeIndex);
        const contents = range.cloneContents();

        const fromNode = range.startContainer;
        const fromElement = fromNode.nodeType === Node.TEXT_NODE ? fromNode.parentElement : fromNode;
        const fromVerse = fromElement.closest('[data-verse]');
        if (!fromVerse) continue;
        const toNode = range.endContainer;
        const toElement = toNode.nodeType === Node.TEXT_NODE ? toNode.parentElement : toNode;
        const toVerse = toElement.closest('[data-verse]') ?? fromVerse;

        reference ??= {
            from: verseReference(fromVerse),
            to: verseReference(fromVerse),
        };
        reference.to = verseReference(toVerse);

        contents.querySelectorAll('.verse-no').forEach(e => e.remove());
        text.push(contents.textContent.trim());
    }

    if (reference) text.push(referenceLink({ ...reference, verses: [] }));

    return text.filter(t => t !== "").join("\n");
}

function fullVerseSelectionText(selection) {
    let containsWholeVerse = false;
    for (let rangeIndex = 0; rangeIndex < selection.rangeCount; rangeIndex++) {
        if (selection.getRangeAt(rangeIndex).cloneContents().querySelector('.verse')) {
            containsWholeVerse = true;
        }
    }
    if (!containsWholeVerse) return partialSelectionText(selection);

    const verseElements = selectedVerseElements(selection);
    if (verseElements.length === 0) return partialSelectionText(selection);

    return groupSelectedVerses(verseElements).map((group) => [
        group.verses.map(verseText).join("\n"),
        referenceLink(group),
    ].filter(t => t !== "").join("\n")).join("\n");
}

function initializeCopyPaste() {
    document.addEventListener('copy', (event) => {
        const selection = document.getSelection();

        // check if anchorNode is in a chapter
        if (!selection.anchorNode.parentElement.closest('[data-chapter]')) return;

        const text = fullVerseSelectionText(selection);
        if (!text) return;

        // update the clipboard
        event.clipboardData.setData('text/plain', text);
        event.preventDefault();
    });
}

window.addEventListener('load', initializeCopyPaste);
