import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { useLocation } from 'preact-iso';
import { useApp, useContentApp } from '../app-context';
import {
  PassageNotFoundError,
  PassageUnavailableError
} from '../lib/content-repository';
import { installClipboardHandler } from '../lib/clipboard';
import { parseFragment, pointInRange, validateRange } from '../lib/reference';
import type { ChapterPackage, VerseRange } from '../lib/types';
import { canonicalChapterPath, withBase } from '../lib/urls';

const WINDOW_RADIUS = 3;

export function Reader({ book, chapter }: { book: string; chapter: string }) {
  const location = useLocation();
  const { repository, manifest, synchronizer } = useContentApp();
  const chapterNumber = Number(chapter);
  const initialPath = canonicalChapterPath(book, chapterNumber);
  const [chapters, setChapters] = useState<Map<string, ChapterPackage>>(new Map());
  const [mountedPaths, setMountedPaths] = useState<string[]>([]);
  const [activePath, setActivePath] = useState(initialPath);
  const [focus, setFocus] = useState<VerseRange>();
  const [unavailable, setUnavailable] = useState<string[]>();
  const [notFound, setNotFound] = useState(false);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const loadingPaths = useRef(new Map<string, number>());
  const navigationGeneration = useRef(0);
  const prependSnapshot = useRef<{ anchorPath: string; top: number }>();
  const selectionExtending = useRef(false);
  const copiedSelection = useRef(false);
  const selectedPaths = useRef(new Set<string>());
  const scrollFrame = useRef<number>();
  const orderedPaths = useMemo(() => repository.orderedPaths(), [repository, manifest]);

  const sortPaths = useCallback((paths: Iterable<string>) => [...new Set(paths)].sort(
    (a, b) => orderedPaths.indexOf(a) - orderedPaths.indexOf(b)
  ), [orderedPaths]);

  useEffect(() => installClipboardHandler(), []);

  useEffect(() => {
    const generation = navigationGeneration.current + 1;
    navigationGeneration.current = generation;
    let cancelled = false;
    async function initialize() {
      setLoading(true);
      setUnavailable(undefined);
      setNotFound(false);
      setFocus(undefined);
      setChapters(new Map());
      setMountedPaths([]);
      setActivePath(initialPath);
      const parsedFocus = parseFragment(window.location.pathname, window.location.hash, manifest);
      try {
        const loaded = parsedFocus
          ? await repository.getChapterRange(parsedFocus)
          : [await repository.getChapter(initialPath)];
        if (cancelled) return;
        const loadedMap = new Map(loaded.map((item) => [item.path, item]));
        const validFocus = parsedFocus && validateRange(parsedFocus, loadedMap) ? parsedFocus : undefined;
        setFocus(validFocus);
        setChapters(loadedMap);
        setMountedPaths(sortPaths(loadedMap.keys()));
        setLoading(false);
        requestAnimationFrame(() => requestAnimationFrame(() => {
          if (generation !== navigationGeneration.current) return;
          if (validFocus) {
            document.querySelector(`[data-chapter-path="${validFocus.path}"] [data-verse="${validFocus.start.verse}"]`)
              ?.scrollIntoView({ block: 'start' });
          } else {
            containerRef.current?.scrollTo({ top: 0 });
          }
          const first = loaded[0];
          const last = loaded[loaded.length - 1];
          void ensurePath(first.previousPath, { prepend: true, generation });
          void ensurePath(last.nextPath, { generation });
        }));
      } catch (error) {
        if (cancelled) return;
        setLoading(false);
        if (error instanceof PassageNotFoundError) setNotFound(true);
        else setUnavailable(error instanceof PassageUnavailableError ? error.paths : [initialPath]);
      }
    }
    void initialize();
    return () => {
      cancelled = true;
      if (navigationGeneration.current === generation) navigationGeneration.current += 1;
      if (scrollFrame.current) cancelAnimationFrame(scrollFrame.current);
      scrollFrame.current = undefined;
      prependSnapshot.current = undefined;
    };
  }, [initialPath, revision, repository, manifest]);

  useEffect(() => {
    const onHashChange = () => setRevision((value) => value + 1);
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  useLayoutEffect(() => {
    const snapshot = prependSnapshot.current;
    const container = containerRef.current;
    if (!snapshot || !container) return;
    const restore = () => {
      const anchor = container.querySelector<HTMLElement>(`[data-chapter-path="${snapshot.anchorPath}"]`);
      if (anchor) container.scrollTop += anchor.getBoundingClientRect().top - snapshot.top;
    };
    restore();
    requestAnimationFrame(restore);
    prependSnapshot.current = undefined;
  }, [mountedPaths]);

  async function ensurePath(path: string | null, options: {
    prepend?: boolean;
    reportUnavailable?: boolean;
    generation?: number;
  } = {}) {
    if (!path) return;
    const { prepend = false, reportUnavailable = false } = options;
    const generation = options.generation ?? navigationGeneration.current;
    if (generation !== navigationGeneration.current) return;
    const container = containerRef.current;
    if (prepend && container) {
      const anchor = container.querySelector<HTMLElement>('[data-chapter-path]');
      if (anchor) prependSnapshot.current = {
        anchorPath: anchor.dataset.chapterPath!,
        top: anchor.getBoundingClientRect().top
      };
    }
    if (chapters.has(path)) {
      setMountedPaths((current) => sortPaths([...current, path]));
      return;
    }
    if (loadingPaths.current.get(path) === generation) return;
    loadingPaths.current.set(path, generation);
    try {
      const loaded = await repository.getChapter(path);
      if (generation !== navigationGeneration.current) return;
      setChapters((current) => {
        const next = new Map(current);
        next.set(path, loaded);
        return next;
      });
      setMountedPaths((current) => sortPaths([...current, path]));
    } catch (error) {
      if (reportUnavailable && generation === navigationGeneration.current) {
        location.route(withBase(path));
      }
    } finally {
      if (loadingPaths.current.get(path) === generation) loadingPaths.current.delete(path);
    }
  }

  function updateSelectedPaths() {
    const selection = document.getSelection();
    const paths = new Set<string>();
    if (selection && !selection.isCollapsed) {
      document.querySelectorAll<HTMLElement>('[data-chapter-path]').forEach((element) => {
        for (let index = 0; index < selection.rangeCount; index += 1) {
          if (selection.getRangeAt(index).intersectsNode(element)) paths.add(element.dataset.chapterPath!);
        }
      });
    }
    selectedPaths.current = paths;
  }

  useEffect(() => {
    const scripture = containerRef.current;
    if (!scripture) return;
    const beginSelection = (event: Event) => {
      if ((event.target as Element | null)?.closest?.('[data-scripture]')) {
        selectionExtending.current = true;
        copiedSelection.current = false;
      }
    };
    const finishSelection = () => {
      selectionExtending.current = false;
      updateSelectedPaths();
    };
    const selectionChanged = () => {
      updateSelectedPaths();
      if (document.getSelection()?.isCollapsed) {
        selectionExtending.current = false;
        copiedSelection.current = false;
        pruneMounted(activePath);
      }
    };
    const copied = () => {
      copiedSelection.current = true;
      selectionExtending.current = false;
      updateSelectedPaths();
      pruneMounted(activePath);
    };
    scripture.addEventListener('pointerdown', beginSelection);
    scripture.addEventListener('touchstart', beginSelection, { passive: true });
    window.addEventListener('pointerup', finishSelection);
    window.addEventListener('touchend', finishSelection, { passive: true });
    document.addEventListener('selectionchange', selectionChanged);
    document.addEventListener('armorer-copy-complete', copied);
    return () => {
      scripture.removeEventListener('pointerdown', beginSelection);
      scripture.removeEventListener('touchstart', beginSelection);
      window.removeEventListener('pointerup', finishSelection);
      window.removeEventListener('touchend', finishSelection);
      document.removeEventListener('selectionchange', selectionChanged);
      document.removeEventListener('armorer-copy-complete', copied);
    };
  }, [activePath, mountedPaths]);

  function pruneMounted(centerPath: string) {
    if (selectionExtending.current) return;
    const center = orderedPaths.indexOf(centerPath);
    if (center < 0) return;
    const keep = new Set(selectedPaths.current);
    for (let index = Math.max(0, center - WINDOW_RADIUS); index <= Math.min(orderedPaths.length - 1, center + WINDOW_RADIUS); index += 1) {
      keep.add(orderedPaths[index]);
    }
    if (focus) {
      const from = orderedPaths.indexOf(canonicalChapterPath(focus.start.bookSlug, focus.start.chapter));
      const to = orderedPaths.indexOf(canonicalChapterPath(focus.end.bookSlug, focus.end.chapter));
      for (let index = Math.min(from, to); index <= Math.max(from, to); index += 1) keep.add(orderedPaths[index]);
    }
    setMountedPaths((current) => {
      if (current.every((path) => keep.has(path))) return current;
      const container = containerRef.current;
      const firstKeptIndex = current.findIndex((path) => keep.has(path));
      if (container && firstKeptIndex > 0) {
        const anchor = container.querySelector<HTMLElement>(`[data-chapter-path="${current[firstKeptIndex]}"]`);
        if (anchor) prependSnapshot.current = {
          anchorPath: current[firstKeptIndex],
          top: anchor.getBoundingClientRect().top
        };
      }
      return current.filter((path) => keep.has(path));
    });
  }

  const onScroll = useCallback(() => {
    if (scrollFrame.current) return;
    scrollFrame.current = requestAnimationFrame(() => {
      scrollFrame.current = undefined;
      const container = containerRef.current;
      if (!container || mountedPaths.length === 0) return;
      if (container.scrollTop < container.clientHeight * 1.5) {
        void ensurePath(chapters.get(mountedPaths[0])?.previousPath ?? null, {
          prepend: true,
          reportUnavailable: true
        });
      }
      if (container.scrollHeight - container.scrollTop - container.clientHeight < container.clientHeight * 1.5) {
        void ensurePath(chapters.get(mountedPaths[mountedPaths.length - 1])?.nextPath ?? null, {
          reportUnavailable: true
        });
      }

      const containerTop = container.getBoundingClientRect().top;
      const targetLine = containerTop + Math.min(180, container.clientHeight * 0.3);
      let nextActive = mountedPaths[0];
      for (const element of container.querySelectorAll<HTMLElement>('[data-chapter-path]')) {
        if (element.getBoundingClientRect().top <= targetLine) nextActive = element.dataset.chapterPath!;
        else break;
      }
      if (nextActive !== activePath) {
        setActivePath(nextActive);
        const nextChapter = chapters.get(nextActive);
        if (nextChapter) document.title = `${manifest.translation.siteName} | ${nextChapter.book.title} ${nextChapter.chapter}`;
        if (!focus) history.replaceState(history.state, '', withBase(nextActive));
        pruneMounted(nextActive);
      }
    });
  }, [mountedPaths, chapters, activePath, focus, manifest]);

  useEffect(() => {
    const item = chapters.get(activePath);
    if (item) document.title = `${manifest.translation.siteName} | ${item.book.title} ${item.chapter}`;
  }, [chapters, activePath, manifest]);

  function clearFocus(event: MouseEvent) {
    if (!focus) return;
    const target = event.target as Element;
    if (target.closest('.verse-focused, a, button, input, textarea, select')) return;
    const url = new URL(window.location.href);
    url.hash = '';
    history.replaceState(history.state, '', `${url.pathname}${url.search}`);
    setFocus(undefined);
  }

  if (loading) return <main class="reader-message" role="status">Loading passage…</main>;
  if (notFound) return <PassageNotFound path={initialPath} />;
  if (unavailable) {
    return <UnavailablePassage path={initialPath} fragment={window.location.hash} onRetry={() => {
      synchronizer.start();
      setRevision((value) => value + 1);
    }} />;
  }

  return (
    <div
      ref={containerRef}
      class={`reader${focus ? ' has-focus' : ''}`}
      data-scripture
      onScroll={onScroll}
      onClick={clearFocus}
    >
      {mountedPaths.map((path) => {
        const item = chapters.get(path);
        return item ? <Chapter key={path} chapter={item} focus={focus} /> : null;
      })}
      {chapters.get(mountedPaths[mountedPaths.length - 1])?.nextPath && (
        <div class="reader-end-space" aria-hidden="true" />
      )}
    </div>
  );
}

function Chapter({ chapter, focus }: { chapter: ChapterPackage; focus?: VerseRange }) {
  return (
    <section
      class="chapter"
      data-chapter-path={chapter.path}
      data-book={chapter.book.title}
      data-book-slug={chapter.book.slug}
      data-chapter={chapter.chapter}
      aria-labelledby={`chapter-${chapter.index}`}
    >
      <h2 class="chapter-heading" id={`chapter-${chapter.index}`}>
        <a href={withBase(`/${chapter.book.slug}/`)}>{chapter.book.title}</a>
        <span aria-hidden="true"> ⟫ </span>
        <a href={withBase(chapter.path)}>Chapter {chapter.chapter}</a>
      </h2>
      <article>
        {chapter.verses.map((verse) => (
          <p
            class={`verse${pointInRange(chapter.book.slug, chapter.chapter, verse.number, focus) ? ' verse-focused' : ''}`}
            data-verse={verse.number}
            key={verse.number}
          >
            <span class="verse-number">{verse.number}</span>
            <span class="verse-text" dangerouslySetInnerHTML={{ __html: verse.html }} />
          </p>
        ))}
      </article>
    </section>
  );
}

function UnavailablePassage({ path, fragment, onRetry }: { path: string; fragment: string; onRetry: () => void }) {
  const { manifest } = useApp();
  const match = path.match(/^\/([^/]+)\/(\d+)\/$/);
  const book = manifest.books.find((candidate) => candidate.slug === match?.[1]);
  const fragmentMatch = fragment.match(/^#(\d+)(?:-(?:(\d+)_)?(\d+))?$/);
  let selection = '';
  if (fragmentMatch) {
    selection = `:${fragmentMatch[1]}`;
    if (fragmentMatch[3]) selection += fragmentMatch[2] ? `-${fragmentMatch[2]}:${fragmentMatch[3]}` : `-${fragmentMatch[3]}`;
  }
  const label = `${book?.title ?? 'Requested passage'} ${match?.[2] ?? ''}${selection}`;
  return (
    <main class="reader-message offline-error" role="alert">
      <div class="error-card">
        <h1>{label} is unavailable offline</h1>
        <p>This passage has not finished synchronizing on this device. Reconnect and retry, or open content that is already available.</p>
        <div class="error-actions">
          <button type="button" onClick={onRetry}>Retry</button>
          <a href={withBase('/available/')}>Available content</a>
          <a href={withBase('/')}>Main page</a>
        </div>
      </div>
    </main>
  );
}

function PassageNotFound({ path }: { path: string }) {
  return (
    <main class="reader-message">
      <div class="error-card">
        <h1>Passage not found</h1>
        <p>{path} is not a valid chapter in this translation.</p>
        <a href={withBase('/')}>Return to the main page</a>
      </div>
    </main>
  );
}
