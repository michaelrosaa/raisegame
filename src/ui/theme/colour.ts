/**
 * Solid hex colour mixing for the atmosphere pass — every "dark tint of X
 * over Y" in the visual spec (industry-tinted header, category-tinted event
 * cards, climate-tinted page background) is computed as a real opaque blend
 * rather than an alpha overlay, so the result never depends on what happens
 * to be rendered behind the element.
 */
import type { EventCategory } from '../../engine/types';

// Mirrors tailwind.config.js's `panel`/`card` tokens — kept here too since
// Tailwind's config isn't something app code reaches into at runtime.
export const PANEL_HEX = '#161A23';
export const CARD_HEX = '#1E242F';

export const EVENT_CATEGORY_COLOUR: Record<EventCategory, string> = {
  money: '#4A8FD4',
  people: '#3AA88A',
  trouble: '#C4553A',
  luck: '#C4903A',
  opportunity: '#9B6EC4',
  neutral: '#6E7A8E',
};

export function eventCategoryOf(event: { category?: EventCategory }): EventCategory {
  return event.category ?? 'neutral';
}

export function mixHex(base: string, tint: string, amount: number): string {
  const b = hexToRgb(base);
  const t = hexToRgb(tint);
  const r = Math.round(b.r + (t.r - b.r) * amount);
  const g = Math.round(b.g + (t.g - b.g) * amount);
  const bl = Math.round(b.b + (t.b - b.b) * amount);
  return rgbToHex(r, g, bl);
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace('#', '');
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

function rgbToHex(r: number, g: number, b: number): string {
  const c = (n: number) => n.toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}
