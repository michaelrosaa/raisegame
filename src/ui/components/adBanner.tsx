import { useIsMobile } from '../hooks/useIsMobile';

/**
 * The one banner, in the one fixed position, present on desktop. It
 * reserves its own strip at the bottom of the app shell (see App.tsx) —
 * every screen sizes to the space above it, so it can never cover
 * content, and it never moves between screens (including the results
 * card, which stays ad-free: the banner sits below the card's own action
 * row, not inside or over the card itself).
 *
 * Placeholder unit — a real ad network mounts here (Google Ad Manager /
 * AdSense display unit is the obvious fit for a static banner). No
 * network is wired up; see src/ads/adProvider.ts for the equivalent note
 * on the rewarded side.
 *
 * Mobile has no ad banner at all — removed outright (not just collapsed
 * when empty) so every mobile screen's fixed action bar sits flush at the
 * true bottom of the viewport, and gets the full ~50-64px that used to be
 * reserved for the strip back as usable content space. Desktop keeps the
 * exact original markup, unconditional, untouched.
 */
export const AD_BAR_HEIGHT_PX = 64; // matches h-16 — desktop only

export function AdBanner() {
  const isMobile = useIsMobile();
  if (isMobile) return null;
  return (
    <div className="h-16 shrink-0 border-t border-hairline bg-panel flex items-center justify-center">
      <span className="font-mono text-[length:var(--fs-9)] uppercase tracking-[0.2em] text-ink7">Advertisement</span>
    </div>
  );
}
