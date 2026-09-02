import { useEffect, useState } from 'preact/hooks';
import { useContentApp } from '../app-context';
import { useDocumentTitle } from '../lib/document-title';
import { withBase } from '../lib/urls';

export function Available() {
  const { repository, manifest, status } = useContentApp();
  const [paths, setPaths] = useState<string[]>();
  useEffect(() => { void repository.availablePaths().then(setPaths); }, [repository, manifest, status.saved]);
  useDocumentTitle(`${manifest.translation.siteName} | Available offline`);

  return (
    <main class="page available-page">
      <h1>Available offline</h1>
      {!paths ? <p>Checking saved chapters…</p> : paths.length === 0 ? (
        <p>No chapters have finished saving yet.</p>
      ) : (
        <ul class="available-list">
          {paths.map((path) => {
            const match = path.match(/^\/([^/]+)\/(\d+)\/$/)!;
            const book = manifest.books.find((candidate) => candidate.slug === match[1]);
            return <li key={path}><a href={withBase(path)}>{book?.title} {match[2]}</a></li>;
          })}
        </ul>
      )}
      <p><a href={withBase('/')}>Return to the main page</a></p>
    </main>
  );
}
