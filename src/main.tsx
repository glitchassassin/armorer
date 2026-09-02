import { hydrate, prerender as renderToString } from 'preact-iso';
import { App } from './App';
import type { TranslationMetadata } from './lib/types';
import { withBase } from './lib/urls';
import './styles.css';

const initialMetadata = __ARMORER_PRERENDER_METADATA__ ?? undefined;

hydrate(<App initialMetadata={initialMetadata} />, typeof document === 'undefined' ? undefined : document.getElementById('app')!);

if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL });
  });
}

export async function prerender({ url }: { ssr: true; url: string }) {
  if (!initialMetadata) throw new Error('Prerender metadata is unavailable');
  const { locationStub } = await import('preact-iso/prerender');
  locationStub(withBase(url));
  const result = await renderToString(<App initialMetadata={initialMetadata} />);
  const slug = url.split('/').filter(Boolean)[0];
  const book = initialMetadata.books.find((candidate) => candidate.slug === slug);
  return {
    html: result.html,
    links: new Set<string>(),
    head: {
      lang: initialMetadata.translation.language,
      title: book
        ? `${initialMetadata.translation.siteName} | ${book.title}`
        : initialMetadata.translation.siteName
    }
  };
}
