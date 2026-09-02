import { useApp } from '../app-context';

export function Footer() {
  const { manifest, status } = useApp();
  return (
    <footer class="home-footer">
      <div>
        <h2>Credits</h2>
        <p>{manifest.translation.attribution}. {manifest.translation.license}.</p>
        <a href="https://www.flaticon.com/free-icons/study">Study icons created by Freepik — Flaticon</a>
      </div>
      <p class={`offline-status status-${status.kind}`}>
        <span aria-hidden="true" class="status-dot" />
        {status.label}
      </p>
      <span class="visually-hidden" aria-live="polite" aria-atomic="true">
        {status.kind === 'available' ? 'Scripture is available offline' :
          status.kind === 'updating' ? 'Offline scripture is updating' :
          status.kind === 'saving' ? 'Scripture is being saved for offline use' :
          'Offline scripture is incomplete'}
      </span>
    </footer>
  );
}
