export interface BookMetadata {
  id: string;
  title: string;
  slug: string;
  testament: 'old' | 'new';
  aliases: string[];
  chapterCount: number;
}

export interface PackageDescriptor {
  index: number;
  url: string;
  sha256: string;
  bytes: number;
}

export interface TranslationManifest {
  schema: number;
  translation: {
    id: string;
    name: string;
    shortName: string;
    siteName: string;
    tagline: string;
    language: string;
    license: string;
    attribution: string;
    baseUrl: string;
    canonId: string;
  };
  books: BookMetadata[];
  content: {
    version: string;
    packageCount: number;
    packages: Record<string, PackageDescriptor>;
  };
  search: {
    version: string;
    contentVersion: string;
    url: string;
    sha256: string;
    bytes: number;
    documentCount: number;
  };
}

export type TranslationMetadata = Pick<TranslationManifest, 'translation' | 'books'>;

export interface TranslationPointer {
  schema: number;
  manifestUrl: string;
  sha256: string;
  translationId: string;
  contentVersion: string;
  searchVersion: string;
}

export interface Verse {
  number: number;
  html: string;
  text: string;
}

export interface ChapterPackage {
  schema: number;
  translationId: string;
  index: number;
  path: string;
  book: Pick<BookMetadata, 'id' | 'title' | 'slug' | 'testament'>;
  chapter: number;
  previousPath: string | null;
  nextPath: string | null;
  verses: Verse[];
}

export type OfflineStatusKind = 'saving' | 'available' | 'incomplete' | 'updating';

export interface OfflineStatus {
  kind: OfflineStatusKind;
  saved: number;
  total: number;
  label: string;
}

export interface VersePoint {
  bookSlug: string;
  chapter: number;
  verse: number;
}

export interface VerseRange {
  start: VersePoint;
  end: VersePoint;
  path: string;
  fragment: string;
}
