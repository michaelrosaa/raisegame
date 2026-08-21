/**
 * Small inline stroke icons — flat, geometric, currentColor. No icon
 * library dependency; the set this app needs is small and fixed.
 */

interface IconProps {
  className?: string;
}

const base = 'w-4 h-4';

export function IconLogo({ className = '' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} xmlns="http://www.w3.org/2000/svg">
      <path d="M4 16L10 10L14 14L20 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M15 6H20V11" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconTrendUp({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} xmlns="http://www.w3.org/2000/svg">
      <path d="M4 16L10 10L14 14L20 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M15 6H20V11" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconPieChart({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} xmlns="http://www.w3.org/2000/svg">
      <path d="M12 3V12L19 15.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12 3A9 9 0 1 0 21 12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconUsers({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} xmlns="http://www.w3.org/2000/svg">
      <circle cx="9" cy="8" r="3" stroke="currentColor" strokeWidth="1.8" />
      <path d="M3 20C3 16.5 5.5 14 9 14C12.5 14 15 16.5 15 20" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M15 14.3C17.8 14.8 20 17.1 20 20" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="16" cy="7.5" r="2.3" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

export function IconNewspaper({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} xmlns="http://www.w3.org/2000/svg">
      <rect x="3" y="5" width="14" height="15" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M17 8H20V17.5C20 18.9 18.9 20 17.5 20H17" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M6 9H14M6 12.5H14M6 16H10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export function IconCoins({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} xmlns="http://www.w3.org/2000/svg">
      <ellipse cx="9" cy="7" rx="6" ry="3" stroke="currentColor" strokeWidth="1.8" />
      <path d="M3 7V13C3 14.7 5.7 16 9 16C12.3 16 15 14.7 15 13V7" stroke="currentColor" strokeWidth="1.8" />
      <path d="M9 12.5C12.3 12.5 15 11.2 15 9.5" stroke="currentColor" strokeWidth="1.8" opacity="0" />
      <ellipse cx="15" cy="12" rx="6" ry="3" stroke="currentColor" strokeWidth="1.8" />
      <path d="M9 15.5V18C9 19.7 11.7 21 15 21C18.3 21 21 19.7 21 18V12" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

export function IconHourglass({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} xmlns="http://www.w3.org/2000/svg">
      <path d="M6 3H18M6 21H18M6 3C6 8 9 9.5 9 12C9 14.5 6 16 6 21M18 3C18 8 15 9.5 15 12C15 14.5 18 16 18 21" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconSearch({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} xmlns="http://www.w3.org/2000/svg">
      <circle cx="10.5" cy="10.5" r="6.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M20 20L15.5 15.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export function IconFlag({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} xmlns="http://www.w3.org/2000/svg">
      <path d="M5 21V4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M5 4H18L15 8.5L18 13H5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconWallet({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} xmlns="http://www.w3.org/2000/svg">
      <rect x="3" y="6" width="18" height="13" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M3 10H21" stroke="currentColor" strokeWidth="1.8" />
      <path d="M15 14H18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M7 6L11 3H17L21 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconGraduationCap({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} xmlns="http://www.w3.org/2000/svg">
      <path d="M2 8L12 4L22 8L12 12L2 8Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M6 10V15C6 16.7 8.7 18 12 18C15.3 18 18 16.7 18 15V10" stroke="currentColor" strokeWidth="1.8" />
      <path d="M22 8V14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export function IconArrowRight({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} xmlns="http://www.w3.org/2000/svg">
      <path d="M4 12H20M20 12L14 6M20 12L14 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconCheck({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} xmlns="http://www.w3.org/2000/svg">
      <path d="M4 12L9 17L20 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconShuffle({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} xmlns="http://www.w3.org/2000/svg">
      <path d="M3 6H6.5C9 6 9.5 8 11 10M3 18H6.5C9 18 9.5 16 11 14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M15 6H21M21 6L18 3M21 6L18 9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M15 18H21M21 18L18 15M21 18L18 21" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M13 12L15 14M13 12L15 10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconPhone({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} xmlns="http://www.w3.org/2000/svg">
      <path d="M5 4H9L11 9L8.5 10.5C9.5 12.7 11.3 14.5 13.5 15.5L15 13L20 15V19C20 20.1 19.1 21 18 21C10.8 20.6 3.4 13.2 3 6C3 4.9 3.9 4 5 4Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}

export function IconCrown({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} xmlns="http://www.w3.org/2000/svg">
      <path d="M4 8L8 11L12 5L16 11L20 8L18.5 17H5.5L4 8Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M5.5 19H18.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function IconFlame({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} xmlns="http://www.w3.org/2000/svg">
      <path d="M12 3C12 6 9 7 9 10.5C9 12 10 13 10 13C9.5 12 10 10.5 11 10C11 12 13 12.5 13 14.5C13 15.5 12.3 16 12.3 16C15 15.5 16 13.3 16 11.5C16 8.5 13 8 13 5C13 4 12.6 3.4 12 3Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M8 14C8 17.9 9.8 20 12 20C14.2 20 16 17.9 16 14.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function IconShield({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} xmlns="http://www.w3.org/2000/svg">
      <path d="M12 3L20 6V11C20 16 16.5 19.5 12 21C7.5 19.5 4 16 4 11V6L12 3Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M9 12L11 14L15.5 9.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconGitMerge({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} xmlns="http://www.w3.org/2000/svg">
      <circle cx="7" cy="6" r="2.2" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="7" cy="18" r="2.2" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="17" cy="18" r="2.2" stroke="currentColor" strokeWidth="1.7" />
      <path d="M7 8.2V15.8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M17 15.8V13C17 10 14 10 12 8.5L9 6.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

export function IconMinus({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} xmlns="http://www.w3.org/2000/svg">
      <path d="M5 12H19" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export function IconLink({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} xmlns="http://www.w3.org/2000/svg">
      <path d="M9.5 14.5L14.5 9.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M11 6.5L12.5 5C14 3.5 16.5 3.5 18 5C19.5 6.5 19.5 9 18 10.5L16.5 12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M13 17.5L11.5 19C10 20.5 7.5 20.5 6 19C4.5 17.5 4.5 15 6 13.5L7.5 12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

/** Geometric logo mark shapes for the company logo picker. No caret/chevron — that reads as a collapse control. */
export const LOGO_SHAPES = ['circle', 'triangle', 'square', 'hexagon', 'plus', 'slash', 'shield'] as const;
export type LogoShape = (typeof LOGO_SHAPES)[number];

export function CompanyLogoIcon({ shape, className = base }: { shape: LogoShape; className?: string }) {
  const common = { stroke: 'currentColor', strokeWidth: 1.8, fill: 'none' as const };
  switch (shape) {
    case 'circle':
      return (
        <svg viewBox="0 0 24 24" className={className} xmlns="http://www.w3.org/2000/svg">
          <circle cx="12" cy="12" r="8" {...common} />
        </svg>
      );
    case 'triangle':
      return (
        <svg viewBox="0 0 24 24" className={className} xmlns="http://www.w3.org/2000/svg">
          <path d="M12 4L20 19H4L12 4Z" strokeLinejoin="round" {...common} />
        </svg>
      );
    case 'square':
      return (
        <svg viewBox="0 0 24 24" className={className} xmlns="http://www.w3.org/2000/svg">
          <rect x="4" y="4" width="16" height="16" {...common} />
        </svg>
      );
    case 'hexagon':
      return (
        <svg viewBox="0 0 24 24" className={className} xmlns="http://www.w3.org/2000/svg">
          <path d="M8 4H16L21 12L16 20H8L3 12L8 4Z" strokeLinejoin="round" {...common} />
        </svg>
      );
    case 'plus':
      return (
        <svg viewBox="0 0 24 24" className={className} xmlns="http://www.w3.org/2000/svg">
          <path d="M12 4V20M4 12H20" strokeLinecap="round" {...common} />
        </svg>
      );
    case 'slash':
      return (
        <svg viewBox="0 0 24 24" className={className} xmlns="http://www.w3.org/2000/svg">
          <path d="M18 4L6 20" strokeLinecap="round" {...common} />
        </svg>
      );
    case 'shield':
      return (
        <svg viewBox="0 0 24 24" className={className} xmlns="http://www.w3.org/2000/svg">
          <path d="M12 3L20 6V11C20 16 16.5 19.5 12 21C7.5 19.5 4 16 4 11V6L12 3Z" strokeLinejoin="round" {...common} />
        </svg>
      );
  }
}
