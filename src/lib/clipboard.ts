import { absoluteCanonicalUrl } from './urls';

interface SelectedVerse {
  text: string;
  book: string;
  bookSlug: string;
  chapter: number;
  verse: number;
  chapterPath: string;
}

function intersects(selectionRange: Range, verseRange: Range) {
  return selectionRange.compareBoundaryPoints(Range.END_TO_START, verseRange) < 0 &&
    selectionRange.compareBoundaryPoints(Range.START_TO_END, verseRange) > 0;
}

function intersectionText(selectionRange: Range, element: Element) {
  const verseRange = document.createRange();
  verseRange.selectNodeContents(element);
  if (!intersects(selectionRange, verseRange)) return '';

  const intersection = document.createRange();
  if (selectionRange.compareBoundaryPoints(Range.START_TO_START, verseRange) <= 0) {
    intersection.setStart(verseRange.startContainer, verseRange.startOffset);
  } else {
    intersection.setStart(selectionRange.startContainer, selectionRange.startOffset);
  }
  if (selectionRange.compareBoundaryPoints(Range.END_TO_END, verseRange) >= 0) {
    intersection.setEnd(verseRange.endContainer, verseRange.endOffset);
  } else {
    intersection.setEnd(selectionRange.endContainer, selectionRange.endOffset);
  }
  return intersection.cloneContents().textContent?.replace(/\s+/g, ' ').trim() ?? '';
}

function selectedVerses(selection: Selection): SelectedVerse[] {
  const verseElements = [...document.querySelectorAll<HTMLElement>('[data-scripture] .verse')];
  const selected: SelectedVerse[] = [];
  for (const verseElement of verseElements) {
    const textElement = verseElement.querySelector('.verse-text');
    if (!textElement) continue;
    const snippets: string[] = [];
    for (let index = 0; index < selection.rangeCount; index += 1) {
      const text = intersectionText(selection.getRangeAt(index), textElement);
      if (text) snippets.push(text);
    }
    if (!snippets.length) continue;
    const chapter = verseElement.closest<HTMLElement>('[data-chapter-path]');
    if (!chapter) continue;
    selected.push({
      text: snippets.join(' '),
      book: chapter.dataset.book!,
      bookSlug: chapter.dataset.bookSlug!,
      chapter: Number(chapter.dataset.chapter),
      verse: Number(verseElement.dataset.verse),
      chapterPath: chapter.dataset.chapterPath!
    });
  }
  return selected;
}

function referenceTitle(group: SelectedVerse[]) {
  const from = group[0];
  const to = group[group.length - 1];
  if (from.chapter !== to.chapter) return `${from.book} ${from.chapter}:${from.verse}-${to.chapter}:${to.verse}`;
  if (from.verse !== to.verse) return `${from.book} ${from.chapter}:${from.verse}-${to.verse}`;
  return `${from.book} ${from.chapter}:${from.verse}`;
}

function referenceLink(group: SelectedVerse[]) {
  const from = group[0];
  const to = group[group.length - 1];
  let fragment = `#${from.verse}`;
  if (from.chapter !== to.chapter) fragment += `-${to.chapter}_${to.verse}`;
  else if (from.verse !== to.verse) fragment += `-${to.verse}`;
  return `[${referenceTitle(group)}](${absoluteCanonicalUrl(`${from.chapterPath}${fragment}`)})`;
}

export function formatScriptureSelection(selection: Selection) {
  const verses = selectedVerses(selection);
  if (!verses.length) return '';
  const groups: SelectedVerse[][] = [];
  for (const verse of verses) {
    const current = groups[groups.length - 1];
    if (!current || current[0].bookSlug !== verse.bookSlug) groups.push([verse]);
    else current.push(verse);
  }
  return groups.map((group) => `${group.map((verse) => verse.text).join('\n')}\n${referenceLink(group)}`).join('\n');
}

export function installClipboardHandler() {
  const handleCopy = (event: ClipboardEvent) => {
    const selection = document.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount) return;
    const common = selection.getRangeAt(0).commonAncestorContainer;
    const element = common.nodeType === Node.ELEMENT_NODE ? common as Element : common.parentElement;
    const startsInScripture = element?.closest('[data-scripture]') ||
      (selection.anchorNode?.nodeType === Node.TEXT_NODE
        ? selection.anchorNode.parentElement?.closest('[data-scripture]')
        : (selection.anchorNode as Element | null)?.closest?.('[data-scripture]'));
    if (!startsInScripture) return;
    const text = formatScriptureSelection(selection);
    if (!text) return;
    event.clipboardData?.setData('text/plain', text);
    event.preventDefault();
    document.dispatchEvent(new CustomEvent('armorer-copy-complete'));
  };
  document.addEventListener('copy', handleCopy);
  return () => document.removeEventListener('copy', handleCopy);
}
