import { useEffect, useRef, useState } from 'preact/hooks';
import { useLocation } from 'preact-iso';
import { useApp } from '../app-context';
import { parseReferenceQuery, referenceUrl } from '../lib/reference';
import { withBase } from '../lib/urls';
import logo from '../img/book_white.png';

export function Header() {
  const location = useLocation();
  const { manifest } = useApp();
  const [value, setValue] = useState(location.query.q ?? '');
  const timer = useRef<number>();
  const searchEntryFromReader = useRef(false);

  useEffect(() => {
    setValue(location.query.q ?? '');
    if (!location.query.q) searchEntryFromReader.current = false;
  }, [location.query.q]);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  function updateQuery(next: string) {
    setValue(next);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      const url = new URL(window.location.href);
      const hadQuery = url.searchParams.has('q');
      if (!next && searchEntryFromReader.current) {
        searchEntryFromReader.current = false;
        history.back();
        return;
      }
      if (next) url.searchParams.set('q', next);
      else url.searchParams.delete('q');
      url.searchParams.delete('p');
      const pushSearchEntry = Boolean(next) && !hadQuery;
      location.route(`${url.pathname}${url.search}${url.hash}`, !pushSearchEntry);
      if (pushSearchEntry) searchEntryFromReader.current = true;
    }, 120);
  }

  function goToReference() {
    const reference = parseReferenceQuery(value, manifest.books);
    if (reference) {
      window.clearTimeout(timer.current);
      const replaceSearchEntry = searchEntryFromReader.current;
      searchEntryFromReader.current = false;
      location.route(withBase(referenceUrl(reference)), replaceSearchEntry);
      return true;
    }
    return false;
  }

  function addBookFilter() {
    if (/\bbook:/i.test(value)) return;
    updateQuery(`${value.trim()}${value.trim() ? ' ' : ''}book:`);
    requestAnimationFrame(() => document.querySelector<HTMLInputElement>('#search')?.focus());
  }

  return (
    <header class="app-header">
      <a href={withBase('/')} class="brand" aria-label={manifest.translation.siteName}>
        <img src={logo} width="45" height="45" alt="" />
        <span>{manifest.translation.siteName}</span>
      </a>
      <div class="search-box">
        <label class="visually-hidden" for="search">Search or go to a scripture reference</label>
        <input
          id="search"
          type="search"
          value={value}
          placeholder="Search/Go to..."
          autoComplete="off"
          onInput={(event) => updateQuery(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && goToReference()) event.currentTarget.blur();
            if (event.key === 'Escape') updateQuery('');
          }}
        />
        <button type="button" class="book-filter" onClick={addBookFilter} title="Add book filter">book:</button>
      </div>
    </header>
  );
}
