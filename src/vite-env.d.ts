/// <reference types="vite/client" />

import type { TranslationMetadata } from './lib/types';

declare global {
  const __ARMORER_PRERENDER_METADATA__: TranslationMetadata | null;
}

export {};
