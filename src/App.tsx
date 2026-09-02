import { ErrorBoundary, LocationProvider, Route, Router, useLocation } from 'preact-iso';
import { useEffect } from 'preact/hooks';
import { AppBootstrap, useApp } from './app-context';
import { Header } from './components/Header';
import { SearchResults } from './components/SearchResults';
import { Available } from './routes/Available';
import { Book } from './routes/Book';
import { Home } from './routes/Home';
import { NotFound } from './routes/NotFound';
import { Reader } from './routes/Reader';
import type { TranslationMetadata } from './lib/types';

export function App({ initialMetadata }: { initialMetadata?: TranslationMetadata }) {
  return (
    <AppBootstrap initialMetadata={initialMetadata}>
      <LocationProvider scope={import.meta.env.BASE_URL}>
        <ErrorBoundary>
          <AppLayout />
        </ErrorBoundary>
      </LocationProvider>
    </AppBootstrap>
  );
}

function AppLayout() {
  const location = useLocation();
  const { manifest, ready } = useApp();
  const query = location.query.q ?? '';
  const routeBase = import.meta.env.BASE_URL === '/' ? '' : import.meta.env.BASE_URL.replace(/\/$/, '');
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    void navigator.serviceWorker.ready.then((registration) => {
      const buildId = document.querySelector<HTMLMetaElement>('meta[name="armorer-build"]')?.content;
      (navigator.serviceWorker.controller ?? registration.active)?.postMessage({ type: 'APP_HEALTHY', buildId });
    });
  }, []);
  return (
    <div class="site-wrapper">
      <Header />
      {query ? (ready ? <SearchResults /> : <ContentLoading />) : (
        <div id="site-content" class="site-content">
          <Router onRouteChange={() => { document.documentElement.lang = manifest.translation.language; }}>
            <Route path={`${routeBase}/`} component={Home} />
            <Route path={`${routeBase}/available/`} component={AvailableRoute} />
            <Route path={`${routeBase}/:book/:chapter/`} component={ReaderRoute} />
            <Route path={`${routeBase}/:book/`} component={Book} />
            <Route default component={NotFound} />
          </Router>
        </div>
      )}
    </div>
  );
}

function AvailableRoute() {
  return useApp().ready ? <Available /> : <ContentLoading />;
}

function ReaderRoute({ book, chapter }: { book: string; chapter: string }) {
  return useApp().ready ? <Reader book={book} chapter={chapter} /> : <ContentLoading />;
}

function ContentLoading() {
  return <main class="initial-loading" role="status" aria-label="Loading scripture content" />;
}
