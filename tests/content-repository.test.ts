import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ContentRepository, PassageUnavailableError } from '../src/lib/content-repository';
import { getValue, putValue } from '../src/lib/database';
import type { ChapterPackage, TranslationManifest } from '../src/lib/types';

const encoder = new TextEncoder();

async function digest(value: unknown) {
  const bytes = encoder.encode(typeof value === 'string' ? value : JSON.stringify(value));
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function chapter(version: string): ChapterPackage {
  return {
    schema: 1,
    translationId: 'test',
    index: 0,
    path: '/john/1/',
    book: { id: 'john', title: 'John', slug: 'john', testament: 'new' },
    chapter: 1,
    previousPath: null,
    nextPath: null,
    verses: [{ number: 1, html: `Text ${version}`, text: `Text ${version}` }]
  };
}

function searchPackage(searchVersion: string) {
  return {
    schema: 1,
    translationId: 'test',
    searchVersion,
    documentCount: 1,
    analyzer: { type: 'identity' },
    index: { documentCount: 1 }
  };
}

async function manifest(version: string, options: { searchVersion?: string; chapterValue?: ChapterPackage } = {}) {
  const chapterValue = options.chapterValue ?? chapter(version);
  const searchVersion = options.searchVersion ?? `search-${version}`;
  const searchValue = searchPackage(searchVersion);
  return {
    schema: 1,
    translation: {
      id: 'test', name: 'Test', shortName: 'T', siteName: 'Armorer', tagline: 'Test', language: 'en',
      license: 'Test', attribution: 'Test', baseUrl: '/', canonId: 'test'
    },
    books: [{ id: 'john', title: 'John', slug: 'john', testament: 'new', aliases: [], chapterCount: 1 }],
    content: {
      version,
      packageCount: 1,
      packages: {
        '/john/1/': {
          index: 0,
          url: `/chapter-${version}.json`,
          sha256: await digest(chapterValue),
          bytes: JSON.stringify(chapterValue).length
        }
      }
    },
    search: {
      version: searchVersion,
      contentVersion: version,
      url: `/search-${searchVersion}.json`,
      sha256: await digest(searchValue),
      bytes: JSON.stringify(searchValue).length,
      documentCount: 1
    }
  } as TranslationManifest;
}

async function openSeedDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('armorer-offline-v2', 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('meta');
      request.result.createObjectStore('chapters');
      request.result.createObjectStore('search');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

beforeEach(() => {
  Object.defineProperty(globalThis, 'indexedDB', { value: new IDBFactory(), configurable: true });
  vi.restoreAllMocks();
});

describe('version activation', () => {
  it('activates staged content and search metadata together after every package is readable', async () => {
    const active = await manifest('v1');
    const pendingChapter = chapter('v2');
    const pending = await manifest('v2', { chapterValue: pendingChapter });
    const pendingSearch = searchPackage(pending.search.version);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    const seed = await openSeedDatabase();
    await putValue(seed, 'meta', 'activeManifest', active);
    await putValue(seed, 'meta', 'pendingManifest', pending);
    await putValue(seed, 'chapters', pending.content.packages['/john/1/'].sha256, pendingChapter);
    await putValue(seed, 'search', pending.search.sha256, pendingSearch);
    seed.close();

    const repository = await ContentRepository.open();
    expect(repository.manifest.content.version).toBe('v1');
    expect(await repository.activatePending()).toBe(true);

    expect(repository.manifest.content.version).toBe('v2');
    expect(await getValue<TranslationManifest>(repository.database, 'meta', 'activeManifest')).toMatchObject({ content: { version: 'v2' } });
    expect(await getValue(repository.database, 'meta', 'activeSearch')).toEqual({
      version: pending.search.version,
      contentVersion: 'v2',
      sha256: pending.search.sha256
    });
    expect(await getValue(repository.database, 'meta', 'pendingManifest')).toBeUndefined();
    repository.database.close();
  });

  it('stages a search-only update instead of replacing the working manifest', async () => {
    const activeChapter = chapter('v1');
    const active = await manifest('v1', { searchVersion: 'search-v1', chapterValue: activeChapter });
    const latest = await manifest('v1', { searchVersion: 'search-v2', chapterValue: activeChapter });
    const latestSerialized = JSON.stringify(latest);
    const pointer = {
      schema: 1,
      manifestUrl: '/latest.json',
      sha256: await digest(latestSerialized),
      translationId: 'test',
      contentVersion: 'v1',
      searchVersion: 'search-v2'
    };
    vi.stubGlobal('fetch', vi.fn(async (url: string) =>
      new Response(url.endsWith('translation.json') ? JSON.stringify(pointer) : latestSerialized)
    ));
    const seed = await openSeedDatabase();
    await putValue(seed, 'meta', 'activeManifest', active);
    seed.close();

    const repository = await ContentRepository.open();
    expect(repository.manifest.search.version).toBe('search-v1');
    expect(repository.pendingManifest?.search.version).toBe('search-v2');
    repository.database.close();
  });

  it('keeps the working version active when a staged update is incomplete', async () => {
    const activeChapter = chapter('v1');
    const active = await manifest('v1', { chapterValue: activeChapter });
    const pending = await manifest('v2');
    const activeSearch = searchPackage(active.search.version);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    const seed = await openSeedDatabase();
    await putValue(seed, 'meta', 'activeManifest', active);
    await putValue(seed, 'meta', 'pendingManifest', pending);
    await putValue(seed, 'meta', 'activeSearch', {
      version: active.search.version,
      contentVersion: active.content.version,
      sha256: active.search.sha256
    });
    await putValue(seed, 'chapters', active.content.packages['/john/1/'].sha256, activeChapter);
    await putValue(seed, 'search', active.search.sha256, activeSearch);
    seed.close();

    const repository = await ContentRepository.open();
    await expect(repository.activatePending()).rejects.toThrow('Staged content could not be opened');
    expect(repository.manifest.content.version).toBe('v1');
    expect(repository.pendingManifest?.content.version).toBe('v2');
    expect(await getValue<TranslationManifest>(repository.database, 'meta', 'activeManifest')).toMatchObject({ content: { version: 'v1' } });
    repository.database.close();
  });

  it('rolls back an interrupted activation when the replacement cannot be opened', async () => {
    const workingChapter = chapter('v1');
    const working = await manifest('v1', { chapterValue: workingChapter });
    const failed = await manifest('v2');
    const workingSearch = searchPackage(working.search.version);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    const seed = await openSeedDatabase();
    await putValue(seed, 'meta', 'activeManifest', failed);
    await putValue(seed, 'meta', 'cleanupManifest', working);
    await putValue(seed, 'meta', 'activeSearch', {
      version: failed.search.version,
      contentVersion: failed.content.version,
      sha256: failed.search.sha256
    });
    await putValue(seed, 'chapters', working.content.packages['/john/1/'].sha256, workingChapter);
    await putValue(seed, 'search', working.search.sha256, workingSearch);
    seed.close();

    const repository = await ContentRepository.open();
    expect(repository.manifest.content.version).toBe('v1');
    expect(repository.pendingManifest?.content.version).toBe('v2');
    expect(await getValue(repository.database, 'meta', 'cleanupManifest')).toBeUndefined();
    expect(await getValue(repository.database, 'meta', 'activeSearch')).toEqual({
      version: working.search.version,
      contentVersion: working.content.version,
      sha256: working.search.sha256
    });
    repository.database.close();
  });
});

describe('package validation', () => {
  it('does not store a download whose checksum is invalid', async () => {
    const active = await manifest('v1');
    active.content.packages['/john/1/'].sha256 = '0'.repeat(64);
    const seed = await openSeedDatabase();
    await putValue(seed, 'meta', 'activeManifest', active);
    seed.close();
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('translation.json')) throw new Error('offline');
      return new Response('{"invalid":true}');
    }));

    const repository = await ContentRepository.open();
    await expect(repository.getChapter('/john/1/')).rejects.toBeInstanceOf(PassageUnavailableError);
    expect(await repository.hasChapter('/john/1/', active.content.packages['/john/1/'], active)).toBe(false);
    repository.database.close();
  });

  it('rejects a corrupt stored record even when it uses the expected key', async () => {
    const active = await manifest('v1');
    const descriptor = active.content.packages['/john/1/'];
    const seed = await openSeedDatabase();
    await putValue(seed, 'meta', 'activeManifest', active);
    await putValue(seed, 'chapters', descriptor.sha256, { schema: 1, translationId: 'test', verses: [] });
    seed.close();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));

    const repository = await ContentRepository.open();
    expect(await repository.hasChapter('/john/1/', descriptor, active)).toBe(false);
    expect(await getValue(repository.database, 'chapters', descriptor.sha256)).toBeUndefined();
    repository.database.close();
  });
});
