import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, 'public');

const pointer = JSON.parse(
  await readFile(resolve(output, 'data/translation.json'), 'utf8')
);

const manifestPath = resolve(
  output,
  pointer.manifestUrl.replace(/^\/+/, '')
);

const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));

const siteUrl = 'https://thefreeholybible.com';
const basePath = manifest.translation.baseUrl;

const baseUrl = new URL(basePath, siteUrl).href;

const urls = [
  baseUrl,
  ...manifest.books.flatMap((book) => [
    new URL(`${book.slug}/`, baseUrl).href,
    ...Array.from(
      { length: book.chapterCount },
      (_, index) => new URL(`${book.slug}/${index + 1}/`, baseUrl).href
    )
  ])
];

const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((url) => `  <url><loc>${url}</loc></url>`).join('\n')}
</urlset>
`;

await writeFile(resolve(output, 'sitemap.xml'), sitemap, 'utf8');

console.log(`Generated sitemap with ${urls.length} URLs`);
