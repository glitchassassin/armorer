import { withBase } from '../lib/urls';

export function NotFound() {
  return (
    <main class="page error-page">
      <h1>Page not found</h1>
      <p>The requested page does not exist.</p>
      <a href={withBase('/')}>Return to the main page</a>
    </main>
  );
}
