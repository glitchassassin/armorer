import { useApp } from '../app-context';
import { useDocumentTitle } from '../lib/document-title';
import { withBase } from '../lib/urls';

export function Book({ book: bookSlug }: { book: string }) {
  const { manifest } = useApp();
  const book = manifest.books.find((candidate) => candidate.slug === bookSlug);
  useDocumentTitle(book ? `${manifest.translation.siteName} | ${book.title}` : `${manifest.translation.siteName} | Book not found`);
  if (!book) return <NotFoundMessage />;
  return (
    <main class="page book-page">
      <h1><a href={withBase(`/${book.slug}/`)}>{book.title}</a></h1>
      <ul class="toc chapter-toc">
        {Array.from({ length: book.chapterCount }, (_, index) => index + 1).map((chapter) => (
          <li key={chapter}><a href={withBase(`/${book.slug}/${chapter}/`)}>{chapter}</a></li>
        ))}
      </ul>
    </main>
  );
}

function NotFoundMessage() {
  return <main class="page error-page"><h1>Book not found</h1><a href={withBase('/')}>Return to the main page</a></main>;
}
