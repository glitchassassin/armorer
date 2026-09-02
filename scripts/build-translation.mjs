import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import MiniSearch from 'minisearch';
import { analyzeSearchText, ENGLISH_STOP_WORDS } from '../shared/search-language.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const configPath = resolve(root, process.env.ARMORER_TRANSLATION ?? 'translations/kjv.json');
const config = JSON.parse(await readFile(configPath, 'utf8'));
const canonPath = resolve(dirname(configPath), config.canon);
const canon = JSON.parse(await readFile(canonPath, 'utf8'));
const output = resolve(root, 'public');
const dataOutput = resolve(output, 'data');

const requiredConfigFields = [
  'id', 'name', 'shortName', 'siteName', 'tagline', 'contentVersion', 'searchVersion',
  'baseUrl', 'language', 'license', 'attribution', 'source', 'canon'
];
for (const field of requiredConfigFields) {
  if (config[field] === undefined || config[field] === '') throw new Error(`Missing translation configuration field: ${field}`);
}
if (!Array.isArray(canon.books) || canon.books.length === 0 || !canon.id) throw new Error('Canon metadata is invalid');
const bookIds = new Set();
const bookSlugs = new Set();
for (const book of canon.books) {
  if (!book.id || !book.title || !book.slug || !book.testament || !Array.isArray(book.aliases)) {
    throw new Error(`Invalid canon book metadata: ${book?.title ?? book?.id ?? 'unknown'}`);
  }
  if (bookIds.has(book.id) || bookSlugs.has(book.slug)) throw new Error(`Duplicate canon book id or slug: ${book.id}`);
  bookIds.add(book.id);
  bookSlugs.add(book.slug);
}

if (!config.source.adapter) throw new Error('Missing translation source adapter');
const adapterPath = resolve(dirname(configPath), config.source.adapter);
const adapter = await import(pathToFileURL(adapterPath).href);
if (typeof adapter.loadTranslationSource !== 'function') {
  throw new Error(`Translation source adapter must export loadTranslationSource(): ${adapterPath}`);
}
const sourceVerses = await adapter.loadTranslationSource({
  source: config.source,
  canon,
  root,
  configPath
});
if (!Array.isArray(sourceVerses)) throw new Error('Translation source adapter must return an array of verses');
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const baseWithLeadingSlash = config.baseUrl.startsWith('/') ? config.baseUrl : `/${config.baseUrl}`;
const basePath = baseWithLeadingSlash.endsWith('/') ? baseWithLeadingSlash : `${baseWithLeadingSlash}/`;
const assetUrl = (path) => `${basePath}${path}`.replace(/\/+/g, '/');

const byBook = new Map(canon.books.map((book) => [book.id, new Map()]));
for (const verse of sourceVerses) {
  if (
    !verse || typeof verse.bookId !== 'string' || !bookIds.has(verse.bookId) ||
    !Number.isInteger(verse.chapter) || verse.chapter < 1 ||
    !Number.isInteger(verse.number) || verse.number < 1 ||
    typeof verse.html !== 'string' || typeof verse.text !== 'string' ||
    !verse.html.trim() || !verse.text.trim()
  ) {
    throw new Error(`Translation source adapter returned an invalid verse: ${JSON.stringify(verse)}`);
  }
  const chapters = byBook.get(verse.bookId);
  if (!chapters.has(verse.chapter)) chapters.set(verse.chapter, []);
  chapters.get(verse.chapter).push({ number: verse.number, html: verse.html.trim(), text: verse.text.trim() });
}

await rm(dataOutput, { recursive: true, force: true });
await rm(resolve(output, 'icons'), { recursive: true, force: true });
await mkdir(resolve(dataOutput, 'chapters'), { recursive: true });
await mkdir(resolve(dataOutput, 'search'), { recursive: true });
await mkdir(resolve(output, 'icons'), { recursive: true });
if (config.cname) await writeFile(resolve(output, 'CNAME'), `${config.cname}\n`);
else await rm(resolve(output, 'CNAME'), { force: true });

const orderedChapters = [];
for (const book of canon.books) {
  const chapters = byBook.get(book.id);
  if (chapters.size === 0) throw new Error(`Translation source contains no chapters for ${book.title}`);
  const chapterNumbers = [...chapters.keys()].sort((a, b) => a - b);
  const chapterCount = chapterNumbers.at(-1);
  if (chapterNumbers.some((number, index) => number !== index + 1)) {
    throw new Error(`Translation source chapters are not contiguous for ${book.title}`);
  }
  book.chapterCount = chapterCount;
  for (const chapter of chapterNumbers) {
    const verses = chapters.get(chapter).sort((a, b) => a.number - b.number);
    if (verses.length === 0 || verses.some((verse, index) => verse.number < 1 || (index > 0 && verse.number <= verses[index - 1].number))) {
      throw new Error(`Translation source verse numbering is invalid for ${book.title} ${chapter}`);
    }
    orderedChapters.push({ book, chapter, verses });
  }
}

const contentPackages = {};
const documents = [];
const analyzer = config.searchAnalyzer === 'porter-en'
  ? { type: 'porter-en', stopWords: ENGLISH_STOP_WORDS }
  : { type: 'identity' };
for (let index = 0; index < orderedChapters.length; index += 1) {
  const { book, chapter, verses } = orderedChapters[index];
  const path = `/${book.slug}/${chapter}/`;
  const previous = orderedChapters[index - 1];
  const next = orderedChapters[index + 1];
  const payload = {
    schema: 1,
    translationId: config.id,
    index,
    path,
    book: { id: book.id, title: book.title, slug: book.slug, testament: book.testament },
    chapter,
    previousPath: previous ? `/${previous.book.slug}/${previous.chapter}/` : null,
    nextPath: next ? `/${next.book.slug}/${next.chapter}/` : null,
    verses
  };
  const serialized = JSON.stringify(payload);
  const hash = sha256(serialized);
  const filename = `chapters/${book.slug}-${chapter}.${hash.slice(0, 16)}.json`;
  await writeFile(resolve(dataOutput, filename), serialized);
  contentPackages[path] = {
    index,
    url: assetUrl(`data/${filename}`),
    sha256: hash,
    bytes: Buffer.byteLength(serialized)
  };
  for (const verse of verses) {
    documents.push({
      id: documents.length,
      title: `${book.title} ${chapter}:${verse.number}`,
      content: verse.text,
      html: verse.html,
      book: book.slug,
      searchText: analyzeSearchText(verse.text, analyzer),
      searchBook: analyzeSearchText(book.slug.replaceAll('-', ' '), analyzer),
      path: `${path}#${verse.number}`
    });
  }
}

const search = new MiniSearch({
  fields: ['searchText', 'searchBook'],
  storeFields: ['title', 'content', 'html', 'book', 'path'],
  searchOptions: { prefix: true, combineWith: 'AND' }
});
search.addAll(documents);
const searchPayload = JSON.stringify({
  schema: 1,
  translationId: config.id,
  searchVersion: config.searchVersion,
  documentCount: documents.length,
  analyzer,
  index: search.toJSON()
});
const searchHash = sha256(searchPayload);
const searchFilename = `search/index.${searchHash.slice(0, 16)}.json`;
await writeFile(resolve(dataOutput, searchFilename), searchPayload);

const manifestCore = {
  schema: 1,
  translation: {
    id: config.id,
    name: config.name,
    shortName: config.shortName,
    siteName: config.siteName,
    tagline: config.tagline,
    language: config.language,
    license: config.license,
    attribution: config.attribution,
    baseUrl: basePath,
    canonId: canon.id
  },
  books: canon.books.map(({ chapterCount, ...book }) => ({ ...book, chapterCount })),
  content: {
    version: config.contentVersion,
    packageCount: orderedChapters.length,
    packages: contentPackages
  },
  search: {
    version: config.searchVersion,
    contentVersion: config.contentVersion,
    url: assetUrl(`data/${searchFilename}`),
    sha256: searchHash,
    bytes: Buffer.byteLength(searchPayload),
    documentCount: documents.length
  }
};
const manifestSerialized = JSON.stringify(manifestCore);
const manifestHash = sha256(manifestSerialized);
const manifestFilename = `translation.${config.id}.${manifestHash.slice(0, 16)}.json`;
await writeFile(resolve(dataOutput, manifestFilename), manifestSerialized);
await writeFile(resolve(dataOutput, 'translation.json'), JSON.stringify({
  schema: 1,
  manifestUrl: assetUrl(`data/${manifestFilename}`),
  sha256: manifestHash,
  translationId: config.id,
  contentVersion: config.contentVersion,
  searchVersion: config.searchVersion
}));

const iconSources = [
  ['android-chrome-192x192.png', 'armorer-192.png', '192x192'],
  ['android-chrome-512x512.png', 'armorer-512.png', '512x512']
];
const manifestIcons = [];
for (const [sourceName, outputName, sizes] of iconSources) {
  const bytes = await readFile(resolve(root, 'src/favicon', sourceName));
  const hashedName = outputName.replace('.png', `.${sha256(bytes).slice(0, 12)}.png`);
  await writeFile(resolve(output, 'icons', hashedName), bytes);
  manifestIcons.push({ src: assetUrl(`icons/${hashedName}`), sizes, type: 'image/png', purpose: 'any maskable' });
}

await writeFile(resolve(output, 'site.webmanifest'), JSON.stringify({
  id: basePath,
  name: `${config.siteName} — ${config.name}`,
  short_name: config.siteName,
  description: config.tagline,
  lang: config.language,
  start_url: basePath,
  scope: basePath,
  display: 'standalone',
  background_color: '#212529',
  theme_color: '#212529',
  icons: manifestIcons
}, null, 2));

console.log(`Built ${config.name}: ${orderedChapters.length} chapters, ${documents.length} verses`);
