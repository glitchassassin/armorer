import { describe, expect, it } from 'vitest';
import { parseFragment, parseReferenceQuery, referenceUrl } from '../src/lib/reference';
import type { TranslationManifest } from '../src/lib/types';

const manifest = {
  translation: { baseUrl: '/' },
  books: [
    { id: 'psalms', title: 'Psalms', slug: 'psalms', testament: 'old', aliases: ['psalm', 'ps'], chapterCount: 150 },
    { id: 'john', title: 'John', slug: 'john', testament: 'new', aliases: ['jn'], chapterCount: 21 }
  ]
} as TranslationManifest;

describe('fragment grammar', () => {
  it.each([
    ['/psalms/119/', '#100', 119, 100, 119, 100],
    ['/psalms/119/', '#100-105', 119, 100, 119, 105],
    ['/john/3/', '#36-4_3', 3, 36, 4, 3],
    ['/john/4/', '#3-3_36', 4, 3, 3, 36]
  ])('parses %s%s', (path, hash, startChapter, startVerse, endChapter, endVerse) => {
    const parsed = parseFragment(path, hash, manifest)!;
    expect(parsed.start).toMatchObject({ chapter: startChapter, verse: startVerse });
    expect(parsed.end).toMatchObject({ chapter: endChapter, verse: endVerse });
  });

  it.each(['#', '#3-', '#3-4:5', '#0', '#3-999_2', '#words'])('rejects %s', (hash) => {
    expect(parseFragment('/john/3/', hash, manifest)).toBeUndefined();
  });
});

describe('reference queries', () => {
  it('accepts aliases and cross-chapter ranges', () => {
    const parsed = parseReferenceQuery('Jn 3:36-4:3', manifest.books)!;
    expect(parsed.book.title).toBe('John');
    expect(referenceUrl(parsed)).toBe('/john/3/#36-4_3');
  });

  it('preserves compact published reference syntax', () => {
    expect(referenceUrl(parseReferenceQuery('John3:16', manifest.books)!)).toBe('/john/3/#16');
    expect(referenceUrl(parseReferenceQuery('Jn3:16', manifest.books)!)).toBe('/john/3/#16');
  });

  it('accepts a chapter-only reference', () => {
    expect(referenceUrl(parseReferenceQuery('Psalm 119', manifest.books)!)).toBe('/psalms/119/');
  });

  it('rejects chapters outside the configured canon', () => {
    expect(parseReferenceQuery('John 22', manifest.books)).toBeUndefined();
  });
});
