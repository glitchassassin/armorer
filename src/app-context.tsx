import { createContext, type ComponentChildren } from 'preact';
import { useContext, useEffect, useMemo, useState } from 'preact/hooks';
import { ContentRepository, Synchronizer } from './lib/content-repository';
import type { OfflineStatus, TranslationManifest, TranslationMetadata } from './lib/types';

interface AppContextValue {
  repository?: ContentRepository;
  synchronizer?: Synchronizer;
  manifest: TranslationMetadata;
  status: OfflineStatus;
  ready: boolean;
}

interface ContentServices extends AppContextValue {
  repository: ContentRepository;
  synchronizer: Synchronizer;
  manifest: TranslationManifest;
  ready: true;
}

const AppContext = createContext<AppContextValue | undefined>(undefined);

export function useApp() {
  const context = useContext(AppContext);
  if (!context) throw new Error('Armorer services are unavailable');
  return context;
}

export function useContentApp(): ContentServices {
  const context = useApp();
  if (!context.ready || !context.repository || !context.synchronizer || !('content' in context.manifest)) {
    throw new Error('Armorer content services are still loading');
  }
  return context as ContentServices;
}

export function AppBootstrap({ children, initialMetadata }: {
  children: ComponentChildren;
  initialMetadata?: TranslationMetadata;
}) {
  const [repository, setRepository] = useState<ContentRepository>();
  const [manifest, setManifest] = useState<TranslationManifest | TranslationMetadata | undefined>(initialMetadata);
  const [synchronizer, setSynchronizer] = useState<Synchronizer>();
  const [status, setStatus] = useState<OfflineStatus>({
    kind: 'incomplete', saved: 0, total: 1, label: 'Offline content incomplete'
  });
  const [shellReady, setShellReady] = useState(false);
  const [error, setError] = useState<Error>();

  useEffect(() => {
    if (!import.meta.env.PROD) {
      setShellReady(true);
      return;
    }
    if (!('serviceWorker' in navigator) || !('caches' in window)) return;
    let active = true;
    const checkShell = async () => {
      let ready = false;
      try {
        const buildId = document.querySelector<HTMLMetaElement>('meta[name="armorer-build"]')?.content;
        const script = document.querySelector<HTMLScriptElement>('script[type="module"]');
        const cacheName = `armorer-app-${buildId}`;
        if (buildId && script?.src && navigator.serviceWorker.controller &&
          (await caches.keys()).includes(cacheName)) {
          const cache = await caches.open(cacheName);
          const indexUrl = new URL('index.html', new URL(import.meta.env.BASE_URL, location.origin));
          const matchOptions = { ignoreSearch: true, ignoreVary: true };
          ready = Boolean(await cache.match(indexUrl.href, matchOptions) &&
            await cache.match(script.src, matchOptions));
        }
      } catch {
        // Missing or inaccessible startup files must not be reported as available offline.
      }
      if (active) setShellReady(ready);
    };
    void checkShell();
    void navigator.serviceWorker.ready.then(checkShell);
    navigator.serviceWorker.addEventListener('controllerchange', checkShell);
    window.addEventListener('pageshow', checkShell);
    return () => {
      active = false;
      navigator.serviceWorker.removeEventListener('controllerchange', checkShell);
      window.removeEventListener('pageshow', checkShell);
    };
  }, []);

  useEffect(() => {
    let active = true;
    ContentRepository.open().then((nextRepository) => {
      if (!active) return;
      const nextSynchronizer = new Synchronizer(nextRepository);
      setRepository(nextRepository);
      setManifest(nextRepository.manifest);
      setSynchronizer(nextSynchronizer);
      nextRepository.addEventListener('manifest-activated', () => setManifest(nextRepository.manifest));
      const begin = () => nextSynchronizer.start();
      const scheduleIdle = window.requestIdleCallback;
      if (scheduleIdle) scheduleIdle(begin, { timeout: 1200 });
      else globalThis.setTimeout(begin, 300);
    }).catch((reason) => {
      if (active) setError(reason instanceof Error ? reason : new Error(String(reason)));
    });
    return () => { active = false; };
  }, []);

  useEffect(() => synchronizer?.subscribe(setStatus), [synchronizer]);

  const displayedStatus = useMemo<OfflineStatus>(() => status.kind === 'available' && !shellReady
    ? { ...status, kind: 'incomplete', label: 'Offline startup not ready' }
    : status, [status, shellReady]);
  const value = useMemo<AppContextValue | undefined>(() => manifest ? {
    repository,
    synchronizer,
    manifest,
    status: displayedStatus,
    ready: Boolean(repository && synchronizer && 'content' in manifest)
  } : undefined, [repository, synchronizer, manifest, displayedStatus]);

  if (error) {
    return (
      <main class="fatal-page" role="alert">
        <div class="error-card">
          <h1>Armorer could not start</h1>
          <p>The application metadata is unavailable. Connect to the internet and try again.</p>
          <button type="button" onClick={() => window.location.reload()}>Retry</button>
        </div>
      </main>
    );
  }
  if (!value) return <div class="initial-loading" role="status" aria-label="Loading Armorer" />;
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
