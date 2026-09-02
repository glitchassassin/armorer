import { useApp } from '../app-context';
import { Footer } from '../components/Footer';
import { useDocumentTitle } from '../lib/document-title';
import { withBase } from '../lib/urls';
import logo from '../img/book_white.png';

export function Home() {
  const { manifest } = useApp();
  const oldBooks = manifest.books.filter((book) => book.testament === 'old');
  const newBooks = manifest.books.filter((book) => book.testament === 'new');
  useDocumentTitle(manifest.translation.siteName);

  return (
    <main class="page home-page">
      <section class="intro">
        <img src={logo} width="100" height="100" alt="" />
        <h1>{manifest.translation.siteName}</h1>
        <p>{manifest.translation.tagline}</p>
        <p>No ads, commentaries, notes, or distractions. Just the Bible.</p>
        <p>View the <a href="https://github.com/glitchassassin/armorer">source code</a> or <a href="https://github.com/glitchassassin/armorer/issues">report issues</a> on GitHub.</p>
      </section>
      <hr />
      <TableOfContents title="Old Testament" books={oldBooks} />
      <TableOfContents title="New Testament" books={newBooks} />
      <Footer />
    </main>
  );
}

function TableOfContents({ title, books }: { title: string; books: ReturnType<typeof useApp>['manifest']['books'] }) {
  return (
    <section class="testament">
      <h2>{title}</h2>
      <ul class="toc book-toc">
        {books.map((book) => <li key={book.id}><a href={withBase(`/${book.slug}/`)}>{book.title}</a></li>)}
      </ul>
    </section>
  );
}
