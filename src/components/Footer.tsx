
import { useApp } from '../app-context';

export function Footer() {
  const { status } = useApp();
  return (
    <footer class="home-footer">
      <p class={`offline-status status-${status.kind}`}>
        <span aria-hidden="true" class="status-dot" />
        {status.label}
      </p>
      <span class="visually-hidden" aria-live="polite" aria-atomic="true">
        {status.kind === 'available' ? 'Scripture is available offline' :
          status.kind === 'updating' ? 'Offline scripture is updating' :
          status.kind === 'saving' ? 'Scripture is being saved for offline use' :
          status.saved === status.total ? 'Offline startup is incomplete' :
          'Offline scripture is incomplete'}
      </span>
    </footer>
  );
}
