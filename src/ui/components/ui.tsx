/**
 * Reusable UI Components — shared primitives used by every screen.
 * Palette/spacing/type follow the Raise desktop design reference exactly:
 * ground #0D0F14, panel #161A23, hairline #2A3242, accent #8B7BF0, plus the
 * fixed semantic set (positive/caution/negative/gold/info). Components read
 * these tokens from tailwind.config.js, never a raw hex.
 */

import React from 'react';
import { formatMoney, formatPercent } from '../../engine/format';
import { IconLogo } from './icons';
import { useIsMobile } from '../hooks/useIsMobile';

// ============================================================================
// Top app bar — logo + wordmark + step progress, shared by every screen.
// 56px tall, 0 28px padding, 1px hairline bottom border. Never scrolls away.
// ============================================================================

export function TopBar({ right }: { right?: React.ReactNode }) {
  return (
    <div className="h-14 shrink-0 px-[var(--sp-28)] flex items-center gap-[var(--sp-40)] border-b border-hairline">
      <div className="flex items-center gap-2.5">
        <div className="w-7 h-7 rounded-lg bg-accent flex items-center justify-center text-ground">
          <IconLogo className="w-4 h-4" />
        </div>
        <span className="text-[length:var(--fs-20)] font-extrabold tracking-tighter">raise</span>
      </div>
      {right && <div className="ml-auto flex items-center gap-2.5">{right}</div>}
    </div>
  );
}

// ============================================================================
// Step breadcrumb (top-right of every screen) — 7px dot + 10px mono label.
// ============================================================================

export interface StepDotsProps {
  steps: string[];
  activeIndex: number;
}

export function StepDots({ steps, activeIndex }: StepDotsProps) {
  return (
    <div className="flex items-center gap-2.5">
      {steps.map((step, i) => (
        <div key={step} className="flex items-center gap-1.5">
          <span className={`w-[7px] h-[7px] rounded-full ${i === activeIndex ? 'bg-accent' : 'bg-lineMuted'}`} />
          <span className={`font-mono text-[length:var(--fs-10)] tracking-[0.13em] ${i === activeIndex ? 'text-accentLight' : 'text-ink7'}`}>{step}</span>
        </div>
      ))}
    </div>
  );
}

// ============================================================================
// Card Container
// ============================================================================

export interface CardProps {
  children: React.ReactNode;
  className?: string;
  interactive?: boolean;
  selected?: boolean;
  onClick?: () => void;
  style?: React.CSSProperties;
}

export function Card({ children, className = '', interactive = false, selected = false, onClick, style }: CardProps) {
  return (
    <div
      onClick={onClick}
      style={style}
      className={`
        bg-panel border rounded-[var(--r-16)]
        ${selected ? 'border-accent' : 'border-line'}
        ${interactive ? 'cursor-pointer hover:border-accent transition-colors' : ''}
        ${className}
      `}
    >
      {children}
    </div>
  );
}

// ============================================================================
// Button Variants — enabled primary reads bg #FFFFFF (`ink`) / text ground;
// disabled reads bg `inset` / text `ink7`. Secondary is a bordered ghost.
// ============================================================================

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  children: React.ReactNode;
}

export function Button({ variant = 'primary', size = 'md', children, className = '', disabled, style, ...props }: ButtonProps) {
  // Mobile-only polish: a bit of tactile press feedback (hover doesn't
  // mean much on touch) and, on the primary button, a soft lift off the
  // dark background so it reads as the obvious thing to tap — especially
  // now that it often sits flush against the bottom of the screen with
  // nothing else around it. isMobile-gated so desktop's classes/shadow are
  // byte-identical to before.
  const isMobile = useIsMobile();
  const baseClass = `font-extrabold rounded-[14px] transition-colors flex items-center justify-center gap-2${
    isMobile ? ' transition-transform duration-100 active:scale-[0.97]' : ''
  }`;

  const variantClass = {
    primary: disabled
      ? 'bg-inset text-ink7 cursor-not-allowed'
      : `bg-ink hover:bg-white text-ground cursor-pointer${isMobile ? ' shadow-[0_4px_18px_rgba(0,0,0,0.35)]' : ''}`,
    secondary: `bg-panel hover:border-accent text-ink border border-lineMuted cursor-pointer${isMobile ? ' shadow-[0_2px_10px_rgba(0,0,0,0.25)]' : ''}`,
    ghost: 'text-ink3 hover:text-ink cursor-pointer',
  }[variant];

  const sizeClass = {
    sm: 'px-[var(--sp-16)] py-2 text-[length:var(--fs-14)]',
    md: 'px-[var(--sp-24)] py-[var(--sp-12)] text-[length:var(--fs-15)]',
    lg: 'px-[var(--sp-26)] py-[var(--sp-15)] text-[length:var(--fs-15)]',
  }[size];

  return (
    <button className={`${baseClass} ${variantClass} ${sizeClass} ${className}`} disabled={disabled} style={style} {...props}>
      {children}
    </button>
  );
}

// ============================================================================
// Portrait Display
// ============================================================================

export interface PortraitDisplayProps {
  portraitSVG: string;
  name: string;
  size?: 'xs' | 'sm' | 'md' | 'lg';
}

export function PortraitDisplay({ portraitSVG, name, size = 'md' }: PortraitDisplayProps) {
  const sizeClass = {
    xs: 'w-8 h-8',
    sm: 'w-9 h-9',
    md: 'w-10 h-10',
    lg: 'w-16 h-16',
  }[size];

  return (
    <div className="flex flex-col items-center gap-2">
      <div
        className={`${sizeClass} rounded-lg overflow-hidden border border-line shrink-0`}
        dangerouslySetInnerHTML={{ __html: portraitSVG }}
      />
      {name && <div className="text-[length:var(--fs-14)] font-medium text-center">{name}</div>}
    </div>
  );
}

// ============================================================================
// Chips — small mono context tags. Header uses 4 fixed tones (info/accent/
// positive/neutral); anywhere else pick the closest semantic tone.
// ============================================================================

export interface ChipProps {
  label: string;
  variant?: 'default' | 'success' | 'warning' | 'error' | 'accent' | 'info' | 'gold';
  children?: React.ReactNode;
  style?: React.CSSProperties;
}

export function Chip({ label, variant = 'default', children, style }: ChipProps) {
  const toneClass = {
    default: 'bg-fieldRaised text-ink3',
    success: 'bg-positiveBg text-positive',
    warning: 'bg-cautionBg text-caution',
    error: 'bg-negativeBg text-negative',
    accent: 'bg-accentTint text-accentLight',
    info: 'bg-infoBg text-info',
    gold: 'bg-goldBg text-goldLabel',
  }[variant];

  return (
    <div style={style} className={`inline-flex items-center gap-1.5 ${toneClass} px-2 py-1 rounded-[5px] text-[length:var(--fs-9)] font-mono font-bold uppercase tracking-[0.1em] whitespace-nowrap`}>
      {label}
      {children && <span className="opacity-70 normal-case tracking-normal font-normal ml-1">{children}</span>}
    </div>
  );
}

/** A small value chip pinned to the bottom of option cards — "+$0.4M", "you give 12%". */
export function ValueChip({ label, tone = 'default' }: { label: string; tone?: 'default' | 'positive' | 'warning' | 'negative' }) {
  const toneClass = {
    default: 'bg-fieldRaised text-ink3',
    positive: 'bg-fieldRaised text-positive',
    warning: 'bg-fieldRaised text-caution',
    negative: 'bg-fieldRaised text-negative',
  }[tone];
  // No CSS text-transform — chips can carry a formatted money string that
  // formatMoney already cased correctly ("+$26K" must never become "+$26k").
  return <span className={`inline-block ${toneClass} px-2 py-[5px] rounded-[6px] text-[length:var(--fs-10-5)] font-mono`}>{label}</span>;
}

// ============================================================================
// Divider
// ============================================================================

export function Divider() {
  return <div className="h-px bg-line my-[var(--sp-16)]" />;
}

// ============================================================================
// Small step-flow layout helpers — shared by every multi-step screen
// (setup, re-founding a company) so a step's chrome never has to be
// re-authored per screen.
// ============================================================================

export function Eyebrow({ children }: { children: React.ReactNode }) {
  return <div className="font-mono text-[length:var(--fs-10)] tracking-[0.16em] text-accentDim">{children}</div>;
}

export function FieldLabel({ children }: { children: React.ReactNode }) {
  return <label className="block font-mono text-[length:var(--fs-10)] text-ink5 uppercase tracking-[0.14em]">{children}</label>;
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2.5">
      <FieldLabel>{label}</FieldLabel>
      {children}
    </div>
  );
}

export function StepFooter({
  hint,
  disabled,
  onNext,
  label,
  onBack,
}: {
  hint: string;
  disabled: boolean;
  onNext: () => void;
  label: string;
  onBack?: () => void;
}) {
  return (
    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-[var(--sp-16)] pt-1">
      <div>
        {onBack && (
          <Button variant="secondary" size="lg" onClick={onBack}>
            ← Back
          </Button>
        )}
      </div>
      <span className="text-[length:var(--fs-12-5)] text-ink6 text-center truncate min-w-0">{hint}</span>
      <Button variant="primary" size="lg" disabled={disabled} onClick={onNext} className="justify-self-end">
        {label} →
      </Button>
    </div>
  );
}

/** A small "← Back" link for mobile step flows — rendered inline at the top
 * of a step's own scrolling content (next to its eyebrow/heading), not in
 * the fixed action bar, which per spec holds the primary button only. */
/** A round, bordered icon button — reads as a real "back" control (native
 * tap affordance, clear boundary) rather than a bare text link floating in
 * the corner. 40px so it clears the 44px-ish tap-target bar without
 * crowding the step label it usually sits opposite. */
export function MobileBackLink({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-label="Back"
      className="shrink-0 flex items-center justify-center rounded-full bg-field border border-lineStrong text-ink3 active:scale-95 active:bg-fieldRaised transition-transform"
      style={{ width: 40, height: 40 }}
    >
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <path d="M10 3 L5 8 L10 13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}

export function StatCell({ label, value, tone = 'default' }: { label: string; value: string; tone?: 'default' | 'positive' }) {
  return (
    <div className="flex-1 min-w-0 bg-field rounded-[9px] px-1.5 py-[9px] flex flex-col gap-[3px] items-center">
      <div className="font-mono text-[length:var(--fs-9)] tracking-[0.1em] text-ink5 whitespace-nowrap">{label.toUpperCase()}</div>
      <div className={`text-[length:var(--fs-14)] font-extrabold whitespace-nowrap ${tone === 'positive' ? 'text-positive' : 'text-ink'}`}>{value}</div>
    </div>
  );
}

// ============================================================================
// Mobile-only layout primitives. There's no ad banner on mobile any more
// (removed outright — see adBanner.tsx), so the fixed action bar sits
// flush at the true bottom of the viewport (safe-area inset only) and
// screens get all of that space back. useMobileContentBottomPadPx/
// useMobilePageBottomPadPx stay as functions (not plain constants) so
// every call site that already reads them keeps working unchanged.
// ============================================================================

/** The fixed action bar's own height: 12px padding + a 48px button + 12px
 * padding. Screens with a MobileActionBar reserve this when padding their
 * scrollable content. */
export const MOBILE_ACTION_BAR_HEIGHT_PX = 72;

/** Total bottom padding a mobile screen's scrollable region needs when it
 * has a MobileActionBar, so its last element is never hidden behind it. */
export function useMobileContentBottomPadPx(): number {
  return MOBILE_ACTION_BAR_HEIGHT_PX;
}

/** For mobile screens with no separate primary action (between-years) —
 * just enough breathing room at the bottom of ordinary scrolling content. */
export function useMobilePageBottomPadPx(): number {
  return 14;
}

/** The one repeated primary action, flush against the true bottom of the
 * viewport (safe-area inset only — no ad strip beneath it any more),
 * always reachable by thumb: Continue on every setup screen, "Advance to
 * {year}", "Carry on", "Play again". Background #0D0F14 with a 1px top
 * border plus a soft upward shadow for separation from the content
 * scrolling underneath it, 12px padding, contains the primary button
 * (full width, 48px tall) and nothing else — no hint text, no secondary
 * link, so it never competes with the one action it exists to keep
 * reachable. */
export function MobileActionBar({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="fixed inset-x-0 bottom-0 z-30"
      style={{
        background: '#0D0F14',
        borderTop: '1px solid #2A3242',
        boxShadow: '0 -8px 24px rgba(0,0,0,0.35)',
        padding: '12px 14px',
        paddingBottom: 'calc(12px + env(safe-area-inset-bottom))',
      }}
    >
      {children}
    </div>
  );
}

// Re-exported here so components importing format helpers from `ui` (a
// handful of small display cells) don't need a second import line.
export { formatMoney, formatPercent };
