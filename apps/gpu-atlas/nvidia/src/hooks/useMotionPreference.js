import { useSyncExternalStore } from 'react';

const media = typeof window === 'undefined' ? null : window.matchMedia('(prefers-reduced-motion: reduce)');
const subscribe = listener => {
  media?.addEventListener('change', listener);
  return () => media?.removeEventListener('change', listener);
};

// Keep camera handoffs and React transitions in sync when the system preference
// changes while the page is open, as well as on the initial render.
export function useMotionPreference() {
  return useSyncExternalStore(subscribe, () => media?.matches || false, () => false);
}
