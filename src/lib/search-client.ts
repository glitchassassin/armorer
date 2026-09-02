function createSearchWorker() {
  return new Worker(new URL('../search-worker.ts', import.meta.url), { type: 'module' });
}

let searchWorker = typeof window === 'undefined' || typeof Worker === 'undefined'
  ? undefined
  : createSearchWorker();

export function getSearchWorker() {
  if (!searchWorker) searchWorker = createSearchWorker();
  return searchWorker;
}
