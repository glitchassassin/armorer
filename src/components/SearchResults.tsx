import { useEffect, useMemo, useState } from 'preact/hooks';
import { useLocation } from 'preact-iso';
import { useContentApp } from '../app-context';
import { parseReferenceQuery, referenceUrl, type ParsedReference } from '../lib/reference';
import { getSearchWorker } from '../lib/search-client';
import { withBase } from '../lib/urls';

interface Result {
  title: string;
  content: string;
  html?: string;
  path: string;
}

export function SearchResults() {
  const location = useLocation();
  const { manifest, status } = useContentApp();
  const query = location.query.q ?? '';
  const pageValue = Number(location.query.p);
  const page = Number.isInteger(pageValue) && pageValue > 0 ? pageValue : 1;
  const count = 20;
  const [results, setResults] = useState<Result[]>([]);
  const [resultCount, setResultCount] = useState(0);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  const reference = useMemo(() => parseReferenceQuery(query, manifest.books), [query, manifest]);

  useEffect(() => {
    if (query.length < 3) {
      setResults([]);
      setResultCount(0);
      setPending(false);
      return;
    }
    const key = Date.now() + Math.random();
    setPending(true);
    setError(undefined);
    const activeWorker = getSearchWorker();
    activeWorker.onmessage = (event) => {
      if (event.data.key !== key) return;
      setResults(event.data.results);
      setResultCount(event.data.resultCount);
      setError(event.data.error);
      setPending(false);
    };
    activeWorker.postMessage({ query, start: (page - 1) * count, count, key, searchHash: manifest.search.sha256 });
  }, [query, page, status.saved, manifest.search.sha256]);

  const totalPages = Math.ceil(resultCount / count);
  const pages = Array.from(
    { length: Math.max(0, Math.min(totalPages, page + 2) - Math.max(1, page - 2) + 1) },
    (_, index) => Math.max(1, page - 2) + index
  );

  function setPage(next: number, replace = false) {
    const bounded = totalPages > 0 ? Math.min(totalPages, Math.max(1, next)) : 1;
    const url = new URL(window.location.href);
    if (bounded <= 1) url.searchParams.delete('p');
    else url.searchParams.set('p', String(bounded));
    location.route(`${url.pathname}${url.search}${url.hash}`, replace);
    document.querySelector('#search-results')?.scrollTo({ top: 0 });
  }

  useEffect(() => {
    const rawPage = location.query.p;
    if (rawPage !== undefined && (!Number.isInteger(Number(rawPage)) || Number(rawPage) <= 1)) {
      setPage(1, true);
      return;
    }
    if (!pending && totalPages > 0 && page > totalPages) setPage(totalPages, true);
  }, [location.query.p, page, totalPages, pending]);

  return (
    <main id="search-results" class="search-results" aria-busy={pending}>
      <h1 class="visually-hidden">Search</h1>
      <section>
        <h2>References</h2>
        {reference ? (
          <div class="result-list">
            <a class="reference-result" href={withBase(referenceUrl(reference))}>
              {referenceLabel(reference)}
            </a>
            {reference.startVerse && (
              <a class="reference-result" href={withBase(referenceUrl({ book: reference.book, chapter: reference.chapter }))}>
                {reference.book.title} {reference.chapter}
              </a>
            )}
          </div>
        ) : <p class="muted">No results found</p>}
      </section>
      <section>
        <h2>Search Results</h2>
        {pending && results.length === 0 && <p role="status">Searching…</p>}
        {error && <p class="muted">{error}</p>}
        {!pending && !error && query.length >= 3 && results.length === 0 && <p class="muted">No results found</p>}
        {totalPages > 1 && <Pagination page={page} totalPages={totalPages} pages={pages} setPage={setPage} />}
        <ul class="result-list">
          {results.map((result) => (
            <li key={result.path}>
              <a href={withBase(result.path)}>{result.title}</a>
              <p dangerouslySetInnerHTML={{ __html: result.html ?? result.content }} />
            </li>
          ))}
        </ul>
        {totalPages > 1 && <Pagination page={page} totalPages={totalPages} pages={pages} setPage={setPage} />}
      </section>
    </main>
  );
}

function Pagination({ page, totalPages, pages, setPage }: {
  page: number;
  totalPages: number;
  pages: number[];
  setPage: (page: number) => void;
}) {
  return (
    <nav aria-label="Search results page" class="pagination">
      <button type="button" onClick={() => setPage(page - 1)} disabled={page <= 1} aria-label="Previous page">«</button>
      {pages.map((number) => (
        <button type="button" key={number} onClick={() => setPage(number)} aria-current={number === page ? 'page' : undefined}>{number}</button>
      ))}
      <button type="button" onClick={() => setPage(page + 1)} disabled={page >= totalPages} aria-label="Next page">»</button>
    </nav>
  );
}

function referenceLabel(reference: ParsedReference) {
  let label = `${reference.book.title} ${reference.chapter}`;
  if (!reference.startVerse) return label;
  label += `:${reference.startVerse}`;
  if (reference.endVerse) label += reference.endChapter
    ? `-${reference.endChapter}:${reference.endVerse}`
    : `-${reference.endVerse}`;
  return label;
}
