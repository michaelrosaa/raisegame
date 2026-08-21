import React from 'react';

/** The single breakpoint the whole app's mobile layout hangs off: below
 * this, every screen renders its mobile-specific JSX branch instead of the
 * desktop one; at or above it, desktop is rendered exactly as it always
 * was. 768px matches the spec this was built against ("mobile layout
 * applies below 768px; at 768px and above, the current desktop layout is
 * untouched") — kept as one exported constant so every screen branches on
 * the same number. */
export const MOBILE_BREAKPOINT_PX = 768;

/** Desktop must stay pixel-identical, and this codebase leans heavily on
 * inline `style={{}}` objects for colour/spacing (industry tints, climate
 * backgrounds, token colours) that a CSS media query can never override —
 * only a JS conditional can. So every screen branches its JSX on this
 * hook's return value rather than adding responsive Tailwind classes to
 * the existing desktop markup. SSR-safe default (`false`) since this is a
 * client-only Vite app with no server render pass. */
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = React.useState(() => (typeof window !== 'undefined' ? window.innerWidth < MOBILE_BREAKPOINT_PX : false));

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT_PX - 1}px)`);
    const onChange = () => setIsMobile(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  return isMobile;
}
