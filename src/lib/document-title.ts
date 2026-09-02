import { useEffect } from 'preact/hooks';

export function useDocumentTitle(title: string) {
  useEffect(() => { document.title = title; }, [title]);
}
