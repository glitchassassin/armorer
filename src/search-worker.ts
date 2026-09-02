import MiniSearch from 'minisearch';
import { analyzeSearchText } from '../shared/search-language.js';
import { getValue, openDatabase } from './lib/database';
import { orderSearchResults } from './lib/search-order';

interface SearchRequest {
  action?: 'search';
  key: number;
  query: string;
  start: number;
  count: number;
  searchHash: string;
}

interface ValidateRequest {
  action: 'validate';
  key: number;
  searchHash: string;
  searchVersion: string;
  translationId: string;
  documentCount: number;
}

interface StoredSearch {
  schema: number;
  translationId?: string;
  searchVersion?: string;
  documentCount?: number;
  index: object;
  analyzer?: { type: string; stopWords?: string[] };
}

let searchPromise: Promise<MiniSearch> | undefined;
let loadedHash: string | undefined;

async function loadSearch(expectedHash: string) {
  const database = await openDatabase();
  const active = await getValue<{ sha256: string; contentVersion: string }>(database, 'meta', 'activeSearch');
  const manifest = await getValue<{ content: { version: string }; search: { sha256: string } }>(database, 'meta', 'activeManifest');
  if (
    !active ||
    active.sha256 !== expectedHash ||
    manifest?.search.sha256 !== expectedHash ||
    active.contentVersion !== manifest.content.version
  ) throw new Error('Search index is not available offline yet');
  const payload = await getValue<StoredSearch>(database, 'search', active.sha256);
  if (!payload?.index) throw new Error('Search index is not available offline yet');
  const loaded = MiniSearch.loadJSON(JSON.stringify(payload.index), {
    fields: ['searchText', 'searchBook'],
    storeFields: ['title', 'content', 'html', 'book', 'path'],
    searchOptions: { prefix: true, combineWith: 'AND' }
  });
  Object.assign(loaded, { armorerAnalyzer: payload.analyzer ?? { type: 'identity' } });
  loadedHash = expectedHash;
  return loaded;
}

function parseQuery(query: string) {
  const match = query.match(/(?:^|\s)book:([a-z0-9-]+)/i);
  return {
    text: query.replace(/(?:^|\s)book:([a-z0-9-]+)/i, '').trim(),
    book: match?.[1].toLowerCase()
  };
}

const workerScope = self as unknown as {
  onmessage: ((event: MessageEvent<SearchRequest | ValidateRequest>) => void) | null;
  postMessage: (message: unknown) => void;
};

workerScope.onmessage = async (event: MessageEvent<SearchRequest | ValidateRequest>) => {
  if (event.data.action === 'validate') {
    const { key, searchHash, searchVersion, translationId, documentCount } = event.data;
    try {
      const database = await openDatabase();
      const payload = await getValue<StoredSearch>(database, 'search', searchHash);
      if (
        payload?.schema !== 1 || payload.translationId !== translationId ||
        payload.searchVersion !== searchVersion || payload.documentCount !== documentCount || !payload.index
      ) throw new Error('Search package failed validation');
      const loaded = MiniSearch.loadJSON(JSON.stringify(payload.index), {
        fields: ['searchText', 'searchBook'],
        storeFields: ['title', 'content', 'html', 'book', 'path'],
        searchOptions: { prefix: true, combineWith: 'AND' }
      });
      if (loaded.documentCount !== documentCount) throw new Error('Search index document count is invalid');
      workerScope.postMessage({ key, valid: true });
    } catch (error) {
      workerScope.postMessage({ key, valid: false, error: error instanceof Error ? error.message : String(error) });
    }
    return;
  }
  const { key, query, start, count, searchHash } = event.data;
  try {
    if (!searchPromise || loadedHash !== searchHash) searchPromise = loadSearch(searchHash);
    const search = await searchPromise;
    const parsed = parseQuery(query);
    const analyzer = (search as MiniSearch & { armorerAnalyzer?: { type: string; stopWords?: string[] } }).armorerAnalyzer;
    const searchText = analyzeSearchText(parsed.text, analyzer);
    const results = searchText
      ? orderSearchResults(search.search(searchText, {
          prefix: true,
          combineWith: 'AND',
          filter: parsed.book ? (result) => result.book === parsed.book : undefined
        }))
      : [];
    workerScope.postMessage({
      key,
      resultCount: results.length,
      results: results.slice(start, start + count).map(({ title, content, html, path }) => ({ title, content, html, path }))
    });
  } catch (error) {
    searchPromise = undefined;
    loadedHash = undefined;
    workerScope.postMessage({ key, error: error instanceof Error ? error.message : String(error), results: [], resultCount: 0 });
  }
};
