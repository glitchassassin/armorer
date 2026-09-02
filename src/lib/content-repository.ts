import {
  deleteValue,
  getAllKeys,
  getValue,
  openDatabase,
  putValue,
  writeMetaAtomically
} from './database';
import type {
  ChapterPackage,
  OfflineStatus,
  PackageDescriptor,
  TranslationManifest,
  TranslationPointer,
  VerseRange
} from './types';
import { canonicalChapterPath, withBase } from './urls';

const decoder = new TextDecoder();
const encoder = new TextEncoder();

interface StoredSearchPackage {
  schema: number;
  translationId: string;
  searchVersion: string;
  documentCount?: number;
  index: unknown;
  analyzer?: unknown;
}

interface ActiveSearchMetadata {
  version: string;
  contentVersion: string;
  sha256: string;
}

async function sha256(value: BufferSource) {
  const digest = await crypto.subtle.digest('SHA-256', value);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function hashJson(value: unknown) {
  return sha256(encoder.encode(JSON.stringify(value)));
}

async function fetchValidatedJson<T>(url: string, expectedHash: string): Promise<T> {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Request failed (${response.status})`);
  const bytes = await response.arrayBuffer();
  const actualHash = await sha256(bytes);
  if (actualHash !== expectedHash) throw new Error(`Invalid package checksum for ${url}`);
  return JSON.parse(decoder.decode(bytes)) as T;
}

function validDescriptor(value: unknown): value is PackageDescriptor {
  const descriptor = value as PackageDescriptor;
  return Boolean(
    Number.isInteger(descriptor?.index) && descriptor.index >= 0 &&
    typeof descriptor.url === 'string' && descriptor.url.length > 0 &&
    typeof descriptor.sha256 === 'string' && /^[a-f0-9]{64}$/.test(descriptor.sha256) &&
    Number.isInteger(descriptor.bytes) && descriptor.bytes >= 0
  );
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isManifest(value: unknown): value is TranslationManifest {
  const manifest = value as TranslationManifest;
  if (manifest?.schema !== 1 || !manifest.translation || !manifest.content || !manifest.search) return false;
  if (![
    manifest.translation.id,
    manifest.translation.name,
    manifest.translation.shortName,
    manifest.translation.siteName,
    manifest.translation.tagline,
    manifest.translation.language,
    manifest.translation.license,
    manifest.translation.attribution,
    manifest.translation.baseUrl,
    manifest.translation.canonId,
    manifest.content.version,
    manifest.search.version,
    manifest.search.url
  ].every(nonEmptyString)) return false;
  if (manifest.translation.baseUrl !== '/' && !/^\/.*\/$/.test(manifest.translation.baseUrl)) return false;
  if (
    !manifest.content.packages || !Array.isArray(manifest.books) ||
    manifest.search.contentVersion !== manifest.content.version ||
    !/^[a-f0-9]{64}$/.test(manifest.search.sha256) ||
    !Number.isInteger(manifest.search.bytes) || manifest.search.bytes < 0 ||
    !Number.isInteger(manifest.search.documentCount) || manifest.search.documentCount < 0
  ) return false;

  const entries = Object.entries(manifest.content.packages);
  if (!Number.isInteger(manifest.content.packageCount) || manifest.content.packageCount !== entries.length) return false;
  const bookIds = new Set<string>();
  const bookSlugs = new Set<string>();
  let expectedIndex = 0;
  for (const book of manifest.books) {
    if (
      !nonEmptyString(book?.id) || !nonEmptyString(book.title) || !nonEmptyString(book.slug) ||
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(book.slug) ||
      (book.testament !== 'old' && book.testament !== 'new') ||
      !Array.isArray(book.aliases) || !book.aliases.every(nonEmptyString) ||
      !Number.isInteger(book.chapterCount) || book.chapterCount < 1 ||
      bookIds.has(book.id) || bookSlugs.has(book.slug)
    ) return false;
    bookIds.add(book.id);
    bookSlugs.add(book.slug);
    for (let chapter = 1; chapter <= book.chapterCount; chapter += 1) {
      const descriptor = manifest.content.packages[`/${book.slug}/${chapter}/`];
      if (!validDescriptor(descriptor) || descriptor.index !== expectedIndex) return false;
      expectedIndex += 1;
    }
  }
  return expectedIndex === entries.length;
}

function sameManifest(left?: TranslationManifest, right?: TranslationManifest) {
  return Boolean(left && right && JSON.stringify(left) === JSON.stringify(right));
}

async function fetchLatestManifest() {
  const pointerResponse = await fetch(withBase('/data/translation.json'), { cache: 'no-store' });
  if (!pointerResponse.ok) throw new Error(`Translation pointer failed (${pointerResponse.status})`);
  const pointer = await pointerResponse.json() as TranslationPointer;
  if (
    pointer.schema !== 1 || !pointer.manifestUrl || !pointer.sha256 ||
    !pointer.translationId || !pointer.contentVersion || !pointer.searchVersion
  ) throw new Error('Translation pointer is invalid');
  const latest = await fetchValidatedJson<TranslationManifest>(pointer.manifestUrl, pointer.sha256);
  if (
    !isManifest(latest) ||
    latest.translation.id !== pointer.translationId ||
    latest.content.version !== pointer.contentVersion ||
    latest.search.version !== pointer.searchVersion
  ) throw new Error('Translation manifest is invalid');
  return latest;
}

function activeSearchMetadata(manifest: TranslationManifest): ActiveSearchMetadata {
  return {
    version: manifest.search.version,
    contentVersion: manifest.search.contentVersion,
    sha256: manifest.search.sha256
  };
}

export class PassageUnavailableError extends Error {
  paths: string[];

  constructor(paths: string[]) {
    super(`Passage is not available offline: ${paths.join(', ')}`);
    this.name = 'PassageUnavailableError';
    this.paths = paths;
  }
}

export class PassageNotFoundError extends Error {
  constructor(path: string) {
    super(`Unknown passage: ${path}`);
    this.name = 'PassageNotFoundError';
  }
}

export class ContentRepository extends EventTarget {
  readonly database: IDBDatabase;
  manifest: TranslationManifest;
  pendingManifest?: TranslationManifest;
  private inFlight = new Map<string, Promise<ChapterPackage>>();
  private validatedChapterHashes = new Set<string>();
  private validatedSearchHashes = new Set<string>();
  private openedSearchHashes = new Set<string>();

  private constructor(database: IDBDatabase, manifest: TranslationManifest, pending?: TranslationManifest) {
    super();
    this.database = database;
    this.manifest = manifest;
    this.pendingManifest = pending;
  }

  static async open() {
    const database = await openDatabase();
    const storedActive = await getValue<TranslationManifest>(database, 'meta', 'activeManifest');
    const storedPending = await getValue<TranslationManifest>(database, 'meta', 'pendingManifest');
    const cleanup = await getValue<TranslationManifest>(database, 'meta', 'cleanupManifest');
    let repository: ContentRepository | undefined;

    if (isManifest(storedActive)) {
      repository = new ContentRepository(database, storedActive, isManifest(storedPending) ? storedPending : undefined);
      if (isManifest(cleanup)) await repository.recoverInterruptedActivation(cleanup);
    }

    try {
      const latest = await fetchLatestManifest();
      if (!repository) {
        await writeMetaAtomically(database, {
          activeManifest: latest,
          pendingManifest: undefined,
          cleanupManifest: undefined,
          activeSearch: undefined
        });
        repository = new ContentRepository(database, latest);
      } else {
        await repository.stageLatest(latest);
      }
    } catch (error) {
      if (!repository) {
        database.close();
        throw error;
      }
    }

    return repository;
  }

  private async stageLatest(latest: TranslationManifest) {
    if (sameManifest(this.manifest, latest)) {
      if (this.pendingManifest) {
        this.pendingManifest = undefined;
        await writeMetaAtomically(this.database, { pendingManifest: undefined });
      }
      return false;
    }
    if (sameManifest(this.pendingManifest, latest)) return false;
    this.pendingManifest = latest;
    await putValue(this.database, 'meta', 'pendingManifest', latest);
    this.dispatchEvent(new CustomEvent('pending-manifest'));
    return true;
  }

  async checkForUpdates() {
    return this.stageLatest(await fetchLatestManifest());
  }

  orderedPaths(manifest = this.manifest) {
    return Object.entries(manifest.content.packages)
      .sort(([, a], [, b]) => a.index - b.index)
      .map(([path]) => path);
  }

  descriptor(path: string, manifest = this.manifest) {
    return manifest.content.packages[path];
  }

  private validChapterShape(value: unknown, path: string, descriptor: PackageDescriptor, manifest: TranslationManifest): value is ChapterPackage {
    const chapter = value as ChapterPackage;
    const pathMatch = path.match(/^\/([^/]+)\/(\d+)\/$/);
    const book = manifest.books.find((item) => item.slug === pathMatch?.[1]);
    const orderedPaths = this.orderedPaths(manifest);
    const previousPath = descriptor.index > 0 ? orderedPaths[descriptor.index - 1] : null;
    const nextPath = descriptor.index + 1 < orderedPaths.length ? orderedPaths[descriptor.index + 1] : null;
    return Boolean(
      chapter?.schema === 1 &&
      chapter.translationId === manifest.translation.id &&
      chapter.index === descriptor.index &&
      chapter.path === path &&
      book &&
      chapter.book?.id === book.id && chapter.book.title === book.title &&
      chapter.book.slug === book.slug && chapter.book.testament === book.testament &&
      chapter.chapter === Number(pathMatch?.[2]) &&
      chapter.previousPath === previousPath && chapter.nextPath === nextPath &&
      Array.isArray(chapter.verses) && chapter.verses.length > 0 &&
      chapter.verses.every((verse, index) =>
        Number.isInteger(verse.number) && verse.number > 0 &&
        (index === 0 || verse.number > chapter.verses[index - 1].number) &&
        typeof verse.html === 'string' && typeof verse.text === 'string'
      )
    );
  }

  private async storedChapter(path: string, descriptor: PackageDescriptor, manifest: TranslationManifest) {
    const stored = await getValue<ChapterPackage>(this.database, 'chapters', descriptor.sha256);
    if (!this.validChapterShape(stored, path, descriptor, manifest)) {
      if (stored !== undefined) await deleteValue(this.database, 'chapters', descriptor.sha256);
      this.validatedChapterHashes.delete(descriptor.sha256);
      return undefined;
    }
    if (!this.validatedChapterHashes.has(descriptor.sha256)) {
      const actualHash = await hashJson(stored);
      if (actualHash !== descriptor.sha256) {
        await deleteValue(this.database, 'chapters', descriptor.sha256);
        return undefined;
      }
      this.validatedChapterHashes.add(descriptor.sha256);
    }
    return stored;
  }

  async getChapter(path: string): Promise<ChapterPackage> {
    const descriptor = this.descriptor(path);
    if (!descriptor) throw new PassageNotFoundError(path);
    const stored = await this.storedChapter(path, descriptor, this.manifest);
    if (stored) return stored;
    return this.downloadChapter(path, descriptor, this.manifest);
  }

  async getChapterRange(range: VerseRange) {
    if (range.start.bookSlug !== range.end.bookSlug) throw new PassageNotFoundError(range.path);
    const startPath = canonicalChapterPath(range.start.bookSlug, range.start.chapter);
    const endPath = canonicalChapterPath(range.end.bookSlug, range.end.chapter);
    const ordered = this.orderedPaths();
    const startIndex = ordered.indexOf(startPath);
    const endIndex = ordered.indexOf(endPath);
    if (startIndex < 0 || endIndex < 0) throw new PassageNotFoundError(range.path);
    const paths = ordered.slice(Math.min(startIndex, endIndex), Math.max(startIndex, endIndex) + 1);
    try {
      return await Promise.all(paths.map((path) => this.getChapter(path)));
    } catch (error) {
      if (error instanceof PassageNotFoundError) throw error;
      throw new PassageUnavailableError(paths);
    }
  }

  async downloadChapter(path: string, descriptor: PackageDescriptor, manifest: TranslationManifest) {
    const existing = this.inFlight.get(descriptor.sha256);
    if (existing) return existing;
    const promise = (async () => {
      try {
        const chapter = await fetchValidatedJson<ChapterPackage>(descriptor.url, descriptor.sha256);
        if (!this.validChapterShape(chapter, path, descriptor, manifest)) {
          throw new Error(`Chapter package failed validation: ${path}`);
        }
        await putValue(this.database, 'chapters', descriptor.sha256, chapter);
        this.validatedChapterHashes.add(descriptor.sha256);
        this.dispatchEvent(new CustomEvent('package-saved', { detail: path }));
        return chapter;
      } catch (error) {
        throw new PassageUnavailableError([path]);
      }
    })().finally(() => {
      this.inFlight.delete(descriptor.sha256);
    });
    this.inFlight.set(descriptor.sha256, promise);
    return promise;
  }

  async hasChapter(path: string, descriptor: PackageDescriptor, manifest: TranslationManifest) {
    return Boolean(await this.storedChapter(path, descriptor, manifest));
  }

  async availablePaths() {
    const entries = Object.entries(this.manifest.content.packages).sort(([, a], [, b]) => a.index - b.index);
    const available = await Promise.all(entries.map(async ([path, descriptor]) =>
      await this.hasChapter(path, descriptor, this.manifest) ? path : undefined
    ));
    return available.filter((path): path is string => Boolean(path));
  }

  private validSearchShape(value: unknown, manifest: TranslationManifest): value is StoredSearchPackage {
    const search = value as StoredSearchPackage;
    return Boolean(
      search?.schema === 1 &&
      search.translationId === manifest.translation.id &&
      search.searchVersion === manifest.search.version &&
      search.documentCount === manifest.search.documentCount &&
      typeof search.index === 'object' && search.index !== null &&
      (search.analyzer === undefined || typeof search.analyzer === 'object')
    );
  }

  private async storedSearch(manifest: TranslationManifest) {
    const stored = await getValue<StoredSearchPackage>(this.database, 'search', manifest.search.sha256);
    if (!this.validSearchShape(stored, manifest)) {
      if (stored !== undefined) await deleteValue(this.database, 'search', manifest.search.sha256);
      this.validatedSearchHashes.delete(manifest.search.sha256);
      return undefined;
    }
    if (!this.validatedSearchHashes.has(manifest.search.sha256)) {
      const actualHash = await hashJson(stored);
      if (actualHash !== manifest.search.sha256) {
        await deleteValue(this.database, 'search', manifest.search.sha256);
        return undefined;
      }
      this.validatedSearchHashes.add(manifest.search.sha256);
    }
    return stored;
  }

  async hasSearch(manifest: TranslationManifest) {
    return Boolean(await this.storedSearch(manifest));
  }

  private async searchIndexOpenable(manifest: TranslationManifest) {
    if (this.openedSearchHashes.has(manifest.search.sha256)) return true;
    if (!await this.storedSearch(manifest)) return false;
    if (typeof Worker === 'undefined') {
      this.openedSearchHashes.add(manifest.search.sha256);
      return true;
    }

    const worker = new Worker(new URL('../search-worker.ts', import.meta.url), { type: 'module' });
    const key = Math.random();
    const valid = await new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (result: boolean) => {
        if (settled) return;
        settled = true;
        globalThis.clearTimeout(timeout);
        worker.terminate();
        resolve(result);
      };
      const timeout = globalThis.setTimeout(() => finish(false), 30_000);
      worker.addEventListener('message', (event) => {
        if (event.data?.key === key) finish(event.data.valid === true);
      });
      worker.addEventListener('error', () => finish(false));
      worker.postMessage({
        action: 'validate',
        key,
        searchHash: manifest.search.sha256,
        searchVersion: manifest.search.version,
        translationId: manifest.translation.id,
        documentCount: manifest.search.documentCount
      });
    });
    if (valid) this.openedSearchHashes.add(manifest.search.sha256);
    return valid;
  }

  async storeSearch(manifest: TranslationManifest) {
    const payload = await fetchValidatedJson<StoredSearchPackage>(manifest.search.url, manifest.search.sha256);
    if (!this.validSearchShape(payload, manifest)) throw new Error('Search package failed validation');
    await putValue(this.database, 'search', manifest.search.sha256, payload);
    this.validatedSearchHashes.add(manifest.search.sha256);
    this.dispatchEvent(new CustomEvent('search-saved'));
  }

  async activateSearch(manifest = this.manifest) {
    if (!sameManifest(manifest, this.manifest) || !await this.searchIndexOpenable(manifest)) {
      throw new Error('Search package could not be opened');
    }
    await writeMetaAtomically(this.database, { activeSearch: activeSearchMetadata(manifest) });
  }

  private async versionReadable(manifest: TranslationManifest) {
    const entries = Object.entries(manifest.content.packages);
    const chaptersReady = await Promise.all(entries.map(([path, descriptor]) => this.hasChapter(path, descriptor, manifest)));
    return chaptersReady.every(Boolean) && await this.searchIndexOpenable(manifest);
  }

  async activatePending(expected = this.pendingManifest) {
    const pending = this.pendingManifest;
    if (!pending || !expected || !sameManifest(pending, expected)) return false;
    if (!await this.versionReadable(pending)) throw new Error('Staged content could not be opened');
    const previous = this.manifest;
    await writeMetaAtomically(this.database, {
      activeManifest: pending,
      activeSearch: activeSearchMetadata(pending),
      pendingManifest: undefined,
      cleanupManifest: previous
    });
    this.manifest = pending;
    this.pendingManifest = undefined;
    this.dispatchEvent(new CustomEvent('manifest-activated'));
    return true;
  }

  private async recoverInterruptedActivation(cleanup: TranslationManifest) {
    if (await this.versionReadable(this.manifest)) return;
    if (!await this.versionReadable(cleanup)) return;
    const failed = this.manifest;
    await writeMetaAtomically(this.database, {
      activeManifest: cleanup,
      activeSearch: activeSearchMetadata(cleanup),
      pendingManifest: failed,
      cleanupManifest: undefined
    });
    this.manifest = cleanup;
    this.pendingManifest = failed;
  }

  async cleanupObsolete() {
    if (!await this.versionReadable(this.manifest)) throw new Error('Active content could not be opened');
    const keepChapterHashes = new Set(Object.values(this.manifest.content.packages).map((item) => item.sha256));
    if (this.pendingManifest) {
      for (const item of Object.values(this.pendingManifest.content.packages)) keepChapterHashes.add(item.sha256);
    }
    for (const key of await getAllKeys(this.database, 'chapters')) {
      if (!keepChapterHashes.has(String(key))) await deleteValue(this.database, 'chapters', key);
    }

    const activeSearch = await getValue<ActiveSearchMetadata>(this.database, 'meta', 'activeSearch');
    for (const key of await getAllKeys(this.database, 'search')) {
      if (String(key) !== activeSearch?.sha256 && String(key) !== this.pendingManifest?.search.sha256) {
        await deleteValue(this.database, 'search', key);
      }
    }
    await writeMetaAtomically(this.database, { cleanupManifest: undefined });
  }

  async searchReady() {
    const active = await getValue<ActiveSearchMetadata>(this.database, 'meta', 'activeSearch');
    return Boolean(
      active?.version === this.manifest.search.version &&
      active.sha256 === this.manifest.search.sha256 &&
      active.contentVersion === this.manifest.content.version &&
      await this.searchIndexOpenable(this.manifest)
    );
  }
}

type StatusListener = (status: OfflineStatus) => void;

export class Synchronizer {
  private static readonly discoveryInterval = 5 * 60_000;
  private repository: ContentRepository;
  private listeners = new Set<StatusListener>();
  private running?: Promise<void>;
  private retryTimer?: number;
  private retryDelay = 2_000;
  private retryNeeded = false;
  private lastDiscovery = Date.now();
  private status: OfflineStatus = { kind: 'incomplete', saved: 0, total: 1, label: 'Offline content incomplete' };

  constructor(repository: ContentRepository) {
    this.repository = repository;
    window.addEventListener('online', () => void this.discoverAndStart());
    window.addEventListener('offline', () => this.clearRetry());
    window.addEventListener('appinstalled', () => this.start());
    document.addEventListener('visibilitychange', () => {
      if (
        document.visibilityState === 'visible' && navigator.onLine &&
        Date.now() - this.lastDiscovery >= Synchronizer.discoveryInterval
      ) void this.discoverAndStart();
    });
    const externalPackageSaved = () => {
      if (!this.running) void this.refreshStatus();
    };
    repository.addEventListener('package-saved', externalPackageSaved);
    repository.addEventListener('search-saved', externalPackageSaved);
    repository.addEventListener('pending-manifest', () => this.start());
  }

  subscribe(listener: StatusListener) {
    this.listeners.add(listener);
    listener(this.status);
    return () => this.listeners.delete(listener);
  }

  private publish(status: OfflineStatus) {
    this.status = status;
    for (const listener of this.listeners) listener(status);
  }

  async refreshStatus(manifest = this.repository.pendingManifest ?? this.repository.manifest) {
    const entries = Object.entries(manifest.content.packages);
    const chapterStates = await Promise.all(entries.map(([path, descriptor]) =>
      this.repository.hasChapter(path, descriptor, manifest)
    ));
    const pending = manifest === this.repository.pendingManifest;
    const searchReady = pending ? await this.repository.hasSearch(manifest) : await this.repository.searchReady();
    const saved = chapterStates.filter(Boolean).length + (searchReady ? 1 : 0);
    const total = entries.length + 1;
    if (saved === total && !pending) {
      this.publish({ kind: 'available', saved, total, label: 'Available offline' });
    } else if (this.running || pending) {
      this.publish({
        kind: pending ? 'updating' : 'saving',
        saved,
        total,
        label: pending ? `Updating offline content (${saved} of ${total})` : `Saving offline content (${saved} of ${total})`
      });
    } else {
      this.publish({ kind: 'incomplete', saved, total, label: `Offline content incomplete (${saved} of ${total})` });
    }
  }

  private clearRetry() {
    if (this.retryTimer) window.clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
  }

  private scheduleRetry() {
    if (!navigator.onLine || this.retryTimer) return;
    const delay = this.retryDelay;
    this.retryDelay = Math.min(this.retryDelay * 2, 60_000);
    this.retryTimer = window.setTimeout(() => {
      this.retryTimer = undefined;
      this.start();
    }, delay);
  }

  private async discoverAndStart() {
    this.clearRetry();
    this.lastDiscovery = Date.now();
    try {
      await this.repository.checkForUpdates();
    } catch (error) {
      // The current manifest remains active while discovery is retried.
    }
    this.start();
  }

  start() {
    if (this.running) return this.running;
    this.clearRetry();
    this.retryNeeded = false;
    this.running = this.synchronize()
      .then((completed) => {
        this.retryNeeded = !completed;
        if (completed) this.retryDelay = 2_000;
      })
      .catch(() => {
        this.retryNeeded = true;
      })
      .finally(() => {
        this.running = undefined;
        void this.refreshStatus();
        if (this.retryNeeded) this.scheduleRetry();
      });
    void this.refreshStatus();
    return this.running;
  }

  private async synchronize() {
    const locks = (navigator as Navigator & { locks?: LockManager }).locks;
    if (locks) {
      return locks.request(`armorer-sync-${this.repository.manifest.translation.id}`, () => this.synchronizeUnlocked());
    }
    return this.synchronizeUnlocked();
  }

  private async synchronizeUnlocked() {
    const target = this.repository.pendingManifest ?? this.repository.manifest;
    const pending = target === this.repository.pendingManifest;
    const entries = Object.entries(target.content.packages).sort(([, a], [, b]) => a.index - b.index);
    const initialChapterStates = await Promise.all(entries.map(([path, descriptor]) =>
      this.repository.hasChapter(path, descriptor, target)
    ));
    const initialSearchState = await this.repository.hasSearch(target);
    let saved = initialChapterStates.filter(Boolean).length + (initialSearchState ? 1 : 0);
    const total = entries.length + 1;
    const publishProgress = () => this.publish({
      kind: pending ? 'updating' : 'saving',
      saved,
      total,
      label: `${pending ? 'Updating' : 'Saving'} offline content (${saved} of ${total})`
    });
    publishProgress();

    let cursor = 0;
    let stopped = false;
    const worker = async () => {
      while (!stopped && cursor < entries.length) {
        const index = cursor++;
        if (initialChapterStates[index]) continue;
        const [path, descriptor] = entries[index];
        try {
          await this.repository.downloadChapter(path, descriptor, target);
          saved += 1;
          if (saved % 10 === 0) publishProgress();
        } catch (error) {
          stopped = true;
        }
      }
    };

    const searchTask = (async () => {
      let addedSearch = false;
      if (!initialSearchState) {
        try {
          await this.repository.storeSearch(target);
          addedSearch = true;
        } catch (error) {
          return false;
        }
      }
      if (!pending) {
        try {
          await this.repository.activateSearch(target);
        } catch (error) {
          return false;
        }
      }
      if (addedSearch) {
        saved += 1;
        publishProgress();
      }
      return true;
    })();

    const [, searchCompleted] = await Promise.all([
      Promise.all(Array.from({ length: 16 }, worker)),
      searchTask
    ]);
    if (stopped || !searchCompleted) return false;

    if (pending) {
      if (target !== this.repository.pendingManifest) return false;
      await this.repository.activatePending(target);
    }
    await this.repository.cleanupObsolete();
    return true;
  }
}
