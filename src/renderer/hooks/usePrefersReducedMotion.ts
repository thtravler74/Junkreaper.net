import { useEffect, useState } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

/**
 * Riding an elevator is the whole point of this UI, so the animation is not
 * removed for reduced-motion users - it is collapsed to an instant cut, which
 * keeps the floor counter and status text meaningful without the travel.
 */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => window.matchMedia?.(QUERY).matches ?? false);

  useEffect(() => {
    const media = window.matchMedia?.(QUERY);
    if (!media) return;
    const onChange = (event: MediaQueryListEvent): void => setReduced(event.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  return reduced;
}
