import type { BookMetadata, TranslationManifest, VerseRange } from './types';
import { canonicalChapterPath, parseChapterPath } from './urls';

const FRAGMENT_PATTERN = /^(\d+)(?:-(?:(\d+)_)?(\d+))?$/;

export function parseFragment(pathname: string, hash: string, manifest: TranslationManifest): VerseRange | undefined {
  const chapter = parseChapterPath(pathname, manifest.translation.baseUrl);
  const match = hash.replace(/^#/, '').match(FRAGMENT_PATTERN);
  if (!chapter || !match) return undefined;
  const book = manifest.books.find((candidate) => candidate.slug === chapter.bookSlug);
  if (!book || chapter.chapter < 1 || chapter.chapter > book.chapterCount) return undefined;

  const startVerse = Number(match[1]);
  const endChapter = match[2] ? Number(match[2]) : chapter.chapter;
  const endVerse = match[3] ? Number(match[3]) : startVerse;
  if (startVerse < 1 || endVerse < 1 || endChapter < 1 || endChapter > book.chapterCount) return undefined;

  return {
    start: { bookSlug: book.slug, chapter: chapter.chapter, verse: startVerse },
    end: { bookSlug: book.slug, chapter: endChapter, verse: endVerse },
    path: canonicalChapterPath(book.slug, chapter.chapter),
    fragment: hash.replace(/^#/, '')
  };
}

export function comparePoints(a: VerseRange['start'], b: VerseRange['start']) {
  if (a.chapter !== b.chapter) return a.chapter - b.chapter;
  return a.verse - b.verse;
}

export function orderedRange(range: VerseRange) {
  return comparePoints(range.start, range.end) <= 0
    ? { from: range.start, to: range.end }
    : { from: range.end, to: range.start };
}

export function pointInRange(bookSlug: string, chapter: number, verse: number, range?: VerseRange) {
  if (!range || bookSlug !== range.start.bookSlug) return false;
  const { from, to } = orderedRange(range);
  const point = { bookSlug, chapter, verse };
  return comparePoints(point, from) >= 0 && comparePoints(point, to) <= 0;
}

export function validateRange(range: VerseRange, chapters: Map<string, { verses: { number: number }[] }>) {
  const start = chapters.get(canonicalChapterPath(range.start.bookSlug, range.start.chapter));
  const end = chapters.get(canonicalChapterPath(range.end.bookSlug, range.end.chapter));
  return Boolean(
    start?.verses.some((verse) => verse.number === range.start.verse) &&
    end?.verses.some((verse) => verse.number === range.end.verse)
  );
}

function normalizeReferenceQuery(value: string) {
  return value.toLowerCase().replace(/[.]/g, '').replace(/\s+/g, ' ').trim();
}

function bookNames(book: BookMetadata) {
  return [book.title, book.slug.replace(/-/g, ' '), ...book.aliases]
    .map(normalizeReferenceQuery)
    .sort((a, b) => b.length - a.length);
}

export interface ParsedReference {
  book: BookMetadata;
  chapter: number;
  startVerse?: number;
  endChapter?: number;
  endVerse?: number;
}

export function parseReferenceQuery(query: string, books: BookMetadata[]): ParsedReference | undefined {
  const normalized = normalizeReferenceQuery(query);
  for (const book of books) {
    for (const name of bookNames(book)) {
      const tail = normalized.slice(name.length);
      if (normalized !== name && !(normalized.startsWith(name) && /^\s*\d/.test(tail))) continue;
      const remainder = normalized.slice(name.length).trim();
      if (!remainder) return { book, chapter: 1 };
      const match = remainder.match(/^(\d+)(?::(\d+)(?:-(?:(\d+):)?(\d+))?)?$/);
      if (!match) continue;
      const chapter = Number(match[1]);
      const startVerse = match[2] ? Number(match[2]) : undefined;
      const endChapter = match[3] ? Number(match[3]) : undefined;
      const endVerse = match[4] ? Number(match[4]) : undefined;
      if (chapter < 1 || chapter > book.chapterCount) return undefined;
      if ([startVerse, endChapter, endVerse].some((value) => value !== undefined && value < 1)) return undefined;
      if (endChapter && endChapter > book.chapterCount) return undefined;
      return { book, chapter, startVerse, endChapter, endVerse };
    }
  }
  return undefined;
}

export function referenceUrl(reference: ParsedReference) {
  let fragment = '';
  if (reference.startVerse) {
    fragment = `#${reference.startVerse}`;
    if (reference.endVerse) {
      fragment += reference.endChapter
        ? `-${reference.endChapter}_${reference.endVerse}`
        : `-${reference.endVerse}`;
    }
  }
  return `${canonicalChapterPath(reference.book.slug, reference.chapter)}${fragment}`;
}
