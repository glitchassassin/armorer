import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';
import preact from '@preact/preset-vite';

const configPath = process.env.ARMORER_TRANSLATION ?? 'translations/kjv.json';
const translation = JSON.parse(readFileSync(resolve(configPath), 'utf8'));
const baseWithLeadingSlash = translation.baseUrl.startsWith('/') ? translation.baseUrl : `/${translation.baseUrl}`;
const base = baseWithLeadingSlash.endsWith('/') ? baseWithLeadingSlash : `${baseWithLeadingSlash}/`;
const htmlEscape = (value: string) => value
  .replaceAll('&', '&amp;')
  .replaceAll('"', '&quot;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;');

function readGeneratedMetadata() {
  const pointer = JSON.parse(readFileSync(resolve('public/data/translation.json'), 'utf8'));
  let manifestPath = pointer.manifestUrl as string;
  if (base !== '/' && manifestPath.startsWith(base)) manifestPath = manifestPath.slice(base.length);
  const manifest = JSON.parse(readFileSync(resolve('public', manifestPath.replace(/^\//, '')), 'utf8'));
  return { translation: manifest.translation, books: manifest.books };
}

export default defineConfig(({ command }) => {
  const prerenderEnabled = command === 'build';
  const metadata = prerenderEnabled ? readGeneratedMetadata() : undefined;
  return {
    base,
    define: {
      __ARMORER_PRERENDER_METADATA__: JSON.stringify(metadata ?? null)
    },
    plugins: [
      preact({
        prerender: {
          enabled: prerenderEnabled,
          renderTarget: '#app',
          prerenderScript: resolve('src/main.tsx'),
          additionalPrerenderRoutes: metadata?.books.map((book: { slug: string }) => `/${book.slug}/`),
          previewMiddlewareEnabled: false,
          previewMiddlewareFallback: '/404'
        }
      }),
      {
        name: 'armorer-translation-html',
        transformIndexHtml(html: string) {
          return html
            .replaceAll('__ARMORER_LANGUAGE__', htmlEscape(translation.language))
            .replaceAll('__ARMORER_DESCRIPTION__', htmlEscape(translation.tagline))
            .replaceAll('__ARMORER_SITE_NAME__', htmlEscape(translation.siteName));
        }
      },
      {
        name: 'armorer-prerender-preview',
        configurePreviewServer(server) {
          server.middlewares.use((request, response, next) => {
            if (!request.url) return next();
            const url = new URL(request.url, 'http://localhost');
            if (/\.[^/]+$/.test(url.pathname)) return next();
            const includesBase = url.pathname.startsWith(base);
            const pathUnderBase = includesBase ? url.pathname.slice(base.length) : url.pathname;
            const relativePath = pathUnderBase.replace(/^\/+|\/+$/g, '');
            const exactFile = resolve('dist', relativePath);
            if (relativePath && existsSync(exactFile) && statSync(exactFile).isFile()) return next();
            const prerendered = resolve('dist', relativePath, 'index.html');
            const file = existsSync(prerendered) ? prerendered : resolve('dist/404/index.html');
            response.statusCode = 200;
            response.setHeader('Content-Type', 'text/html; charset=utf-8');
            response.end(readFileSync(file));
          });
        }
      }
    ],
    build: {
      manifest: true,
      target: ['es2022', 'chrome109', 'firefox115', 'safari16.4'],
      rollupOptions: {
        output: {
          assetFileNames: 'assets/[name]-[hash][extname]',
          chunkFileNames: 'assets/[name]-[hash].js',
          entryFileNames: 'assets/[name]-[hash].js'
        }
      }
    },
    test: {
      environment: 'jsdom',
      setupFiles: ['./tests/setup.ts'],
      include: ['tests/**/*.test.ts']
    }
  };
});
