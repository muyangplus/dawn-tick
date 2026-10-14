import { useEffect, useState } from 'react';

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof globalThis.matchMedia === 'function' ? globalThis.matchMedia(query).matches : false,
  );

  useEffect(() => {
    if (typeof globalThis.matchMedia !== 'function') return;
    const media = globalThis.matchMedia(query);
    const listener = (): void => setMatches(media.matches);
    setMatches(media.matches);
    media.addEventListener('change', listener);
    return () => media.removeEventListener('change', listener);
  }, [query]);

  return matches;
}

export type Breakpoint = 'mobile' | 'tablet' | 'desktop';

export function useBreakpoint(): Breakpoint {
  const isDesktop = useMediaQuery('(min-width: 1024px)');
  const isTablet = useMediaQuery('(min-width: 768px)');
  if (isDesktop) return 'desktop';
  return isTablet ? 'tablet' : 'mobile';
}
