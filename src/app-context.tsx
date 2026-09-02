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
  const [error, setError] = useState<Error>();

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

  const value = useMemo<AppContextValue | undefined>(() => manifest ? {
    repository,
    synchronizer,
    manifest,
    status,
    ready: Boolean(repository && synchronizer && 'content' in manifest)
  } : undefined, [repository, synchronizer, manifest, status]);

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
