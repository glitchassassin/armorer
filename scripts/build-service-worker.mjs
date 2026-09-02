import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(root, 'dist');

async function filesIn(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map(async (entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? filesIn(path) : [path];
  }))).flat();
}

const shellFileNames = (await filesIn(dist))
  .map((file) => relative(dist, file).split(sep).join('/'))
  .filter((file) =>
    file !== 'sw.js' && file !== '404.html' && !file.startsWith('data/') &&
    !file.endsWith('/index.html') && !/^assets\/prerender-.*\.js$/.test(file)
  );
const buildInputs = await Promise.all(shellFileNames.map(async (file) => {
  const bytes = await readFile(resolve(dist, file));
  return [file, createHash('sha256').update(bytes).digest('hex')];
}));
const buildId = createHash('sha256').update(JSON.stringify(buildInputs)).digest('hex').slice(0, 16);
const indexPath = resolve(dist, 'index.html');
const indexTemplate = await readFile(indexPath, 'utf8');
if (!indexTemplate.includes('__ARMORER_BUILD__')) throw new Error('The application build marker is missing');
const htmlFiles = (await filesIn(dist)).filter((file) => file.endsWith('.html'));
await Promise.all(htmlFiles.map(async (file) => {
  const html = await readFile(file, 'utf8');
  await writeFile(file, html.replaceAll('__ARMORER_BUILD__', buildId));
}));
const fallbackHtml = indexTemplate
  .replace(/(<div id="app">)[\s\S]*(<\/div>\s*<noscript>)/, '$1$2')
  .replaceAll('__ARMORER_BUILD__', buildId);
await writeFile(resolve(dist, '404.html'), fallbackHtml);
await mkdir(resolve(dist, '404'), { recursive: true });
await writeFile(resolve(dist, '404/index.html'), fallbackHtml);

const files = await filesIn(dist);
const shellFiles = files
  .map((file) => relative(dist, file).split(sep).join('/'))
  .filter((file) =>
    file !== 'sw.js' && !file.startsWith('data/') && !file.endsWith('/index.html') &&
    !/^assets\/prerender-.*\.js$/.test(file)
  );
const revisions = await Promise.all(shellFiles.map(async (file) => {
  const bytes = await readFile(resolve(dist, file));
  return [file, createHash('sha256').update(bytes).digest('hex')];
}));
const source = `
const BUILD_ID = ${JSON.stringify(buildId)};
const CACHE_NAME = 'armorer-app-' + BUILD_ID;
const BASE = new URL('./', self.location.href).pathname;
const SHELL = ${JSON.stringify(revisions.map(([file, revision]) => ({ url: `./${file}`, revision })))};
const STATE_KEY = new URL('./__armorer_state__', self.registration.scope).href;
const INDEX_URL = new URL('./index.html', self.registration.scope).href;
const ROLLBACK_DELAY = 30_000;

function versionedRequest(entry) {
  const url = new URL(entry.url, self.registration.scope);
  url.searchParams.set('__armorer_revision', entry.revision);
  return new Request(url.href);
}

async function responseMatchesRevision(response, revision) {
  const digest = await crypto.subtle.digest('SHA-256', await response.clone().arrayBuffer());
  const actual = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return actual === revision;
}

async function readState(cacheName = CACHE_NAME) {
  const response = await (await caches.open(cacheName)).match(STATE_KEY);
  if (!response) return undefined;
  try { return await response.json(); } catch (error) { return undefined; }
}

async function writeState(state) {
  await (await caches.open(CACHE_NAME)).put(STATE_KEY, new Response(JSON.stringify(state), {
    headers: { 'content-type': 'application/json' }
  }));
}

async function fallbackCacheName() {
  const names = (await caches.keys()).filter((name) => name.startsWith('armorer-app-') && name !== CACHE_NAME);
  const candidates = [];
  for (const name of names) candidates.push({ name, state: await readState(name) });
  const preferred = candidates.filter(({ state }) => !state || state.status === 'healthy');
  return (preferred.at(-1) || candidates.filter(({ state }) => state?.status !== 'rollback').at(-1))?.name;
}

async function cachedIndex(cacheName) {
  return (await caches.open(cacheName)).match(INDEX_URL, { ignoreSearch: true, ignoreVary: true });
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    const responses = await Promise.all(SHELL.map(async (entry) => {
      const cacheKey = versionedRequest(entry);
      const existing = await caches.match(cacheKey, { ignoreVary: true });
      if (existing && await responseMatchesRevision(existing, entry.revision)) return [cacheKey, existing];
      const response = await fetch(new URL(entry.url, self.registration.scope), { cache: 'reload' });
      if (!response.ok) throw new Error('Failed to cache ' + entry.url);
      if (!await responseMatchesRevision(response, entry.revision)) throw new Error('Invalid shell checksum for ' + entry.url);
      return [cacheKey, response];
    }));
    await Promise.all(responses.map(([cacheKey, response]) => cache.put(cacheKey, response)));
    if (!await readState()) await writeState({ status: 'candidate', attempts: 0, attemptedAt: 0 });
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('message', (event) => {
  if (event.data?.type !== 'APP_HEALTHY' || event.data.buildId !== BUILD_ID) return;
  event.waitUntil((async () => {
    await writeState({ status: 'healthy', attempts: 1, attemptedAt: Date.now() });
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith('armorer-app-') && key !== CACHE_NAME).map((key) => caches.delete(key)));
  })());
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(BASE)) return;

  const pointerPath = BASE + 'data/translation.json';
  if (url.pathname === pointerPath) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      try {
        const response = await fetch(event.request);
        if (response.ok) {
          await cache.delete(event.request, { ignoreSearch: true, ignoreVary: true });
          await cache.put(event.request, response.clone());
        }
        return response;
      } catch (error) {
        return (await cache.match(event.request, { ignoreSearch: true, ignoreVary: true })) || Response.error();
      }
    })());
    return;
  }

  if (url.pathname.startsWith(BASE + 'data/chapters/') || url.pathname.startsWith(BASE + 'data/search/')) return;
  if (event.request.mode === 'navigate') {
    event.respondWith((async () => {
      const state = await readState() || { status: 'candidate', attempts: 0, attemptedAt: 0 };
      const fallback = await fallbackCacheName();
      if (fallback && state.status === 'rollback') return (await cachedIndex(fallback)) || Response.error();
      if (fallback && state.status !== 'healthy') {
        if (state.attempts > 0 && Date.now() - state.attemptedAt >= ROLLBACK_DELAY) {
          await writeState({ ...state, status: 'rollback' });
          return (await cachedIndex(fallback)) || Response.error();
        }
        if (state.attempts === 0) await writeState({ ...state, attempts: 1, attemptedAt: Date.now() });
      }
      return (await cachedIndex(CACHE_NAME)) || Response.error();
    })());
    return;
  }

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    return (await cache.match(event.request, { ignoreSearch: true, ignoreVary: true })) ||
      (await caches.match(event.request, { ignoreSearch: true, ignoreVary: true })) || fetch(event.request);
  })());
});
`;

await writeFile(resolve(dist, 'sw.js'), source.trimStart());
console.log(`Built service worker ${buildId} with ${shellFiles.length} shell assets`);
