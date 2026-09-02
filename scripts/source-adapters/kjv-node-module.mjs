import { createRequire } from 'node:module';
import { resolve } from 'node:path';

function plainText(value) {
  return value.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

export function normalizeKjvText(value) {
  if (typeof value !== 'string') throw new Error('The KJV source contains a non-string verse');
  const html = value
    .replace(/# ?/g, '')
    .replace(/\[(.+?)\]/g, '<em>$1</em>')
    .replace(/LORD'S/g, '<span class="small-caps">Lord\'s</span>')
    .replace(/LORD/g, '<span class="small-caps">Lord</span>')
    .replace(/their's/g, 'theirs')
    .replace(/your's/g, 'yours')
    .trim();
  return { html, text: plainText(html) };
}

export function normalizeKjvSource(sourceData, canon, sourceBookNames = {}) {
  if (!sourceData || typeof sourceData !== 'object' || Array.isArray(sourceData)) {
    throw new Error('The KJV source module must export a verse-keyed object');
  }

  const names = new Map();
  for (const book of canon.books) {
    names.set(book.title.toLowerCase(), book);
    for (const sourceName of sourceBookNames[book.title] ?? []) names.set(sourceName.toLowerCase(), book);
  }

  return Object.entries(sourceData).map(([reference, rawText]) => {
    const match = reference.match(/^(.+?) (\d+):(\d+)$/);
    if (!match) throw new Error(`Cannot parse KJV source reference: ${reference}`);
    const book = names.get(match[1].toLowerCase());
    if (!book) throw new Error(`No canon metadata for KJV source book: ${match[1]}`);
    return {
      bookId: book.id,
      chapter: Number(match[2]),
      number: Number(match[3]),
      ...normalizeKjvText(rawText)
    };
  });
}

export async function loadTranslationSource({ source, canon, root }) {
  if (!source.module) throw new Error('The KJV source adapter requires source.module');
  const require = createRequire(resolve(root, 'package.json'));
  return normalizeKjvSource(require(source.module), canon, source.sourceBookNames);
}
