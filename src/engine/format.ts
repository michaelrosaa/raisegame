/**
 * Formatting utilities for display
 * All money and numbers are formatted here, never in components
 */

/**
 * Format a number as USD currency
 * Examples: 1000 → "$1K", 1500000 → "$1.5M", 2100000000 → "$2.1B", 45 → "$45"
 */
export function formatMoney(amount: number): string {
  if (amount === 0) return '$0';

  const absAmount = Math.abs(amount);
  const sign = amount < 0 ? '-' : '';

  if (absAmount >= 1_000_000_000) {
    const billions = absAmount / 1_000_000_000;
    return `${sign}$${billions >= 10 ? Math.round(billions) : billions.toFixed(1)}B`;
  }
  if (absAmount >= 1_000_000) {
    const millions = absAmount / 1_000_000;
    return `${sign}$${millions >= 10 ? Math.round(millions) : millions.toFixed(1)}M`;
  }
  if (absAmount >= 1_000) {
    const thousands = absAmount / 1_000;
    return `${sign}$${thousands >= 10 ? Math.round(thousands) : thousands.toFixed(1)}K`;
  }
  return `${sign}$${Math.round(absAmount)}`;
}

/**
 * Format runway in plain language — nobody thinks in eleven-year runways:
 *   burn negative (making more than it spends) → "profitable"
 *   > 30 months of runway                      → "comfortable"
 *   6–30 months                                 → "18 mo" (the exact figure)
 *   < 6 months                                   → "4 mo" (still exact — the
 *                                                  caller is expected to show
 *                                                  this in red; see present.ts's
 *                                                  cashLastsTone)
 */
export function formatRunway(cash: number, monthlyBurn: number): string {
  if (monthlyBurn <= 0) return 'profitable';
  const months = Math.floor(cash / monthlyBurn);
  if (months > 30) return 'comfortable';
  return `${months} mo`;
}

/**
 * Format percentage with specific decimal places
 */
export function formatPercent(num: number, decimals: number = 1): string {
  return `${num.toFixed(decimals)}%`;
}

/**
 * Format large numbers with commas and abbreviations
 * 1234567 → "1.2M", 45000 → "45K"
 */
export function formatNumber(num: number): string {
  if (num >= 1_000_000_000) {
    return (num / 1_000_000_000).toFixed(1) + 'B';
  }
  if (num >= 1_000_000) {
    return (num / 1_000_000).toFixed(1) + 'M';
  }
  if (num >= 1_000) {
    return (num / 1_000).toFixed(1) + 'K';
  }
  return num.toString();
}

/**
 * Format a number as it should appear in copy
 * Used in sentence templates like "You raised {formattedAmount}"
 */
export function formatMoneyInCopy(amount: number): string {
  // In copy, prefer spelled-out billions, millions
  if (amount >= 1_000_000_000) {
    const billions = amount / 1_000_000_000;
    return `$${billions >= 10 ? Math.round(billions) : Math.round(billions * 10) / 10}B`;
  }
  if (amount >= 1_000_000) {
    const millions = amount / 1_000_000;
    return `$${millions >= 100 ? Math.round(millions / 100) * 100 : Math.round(millions)}M`;
  }
  if (amount >= 1_000) {
    const thousands = amount / 1_000;
    return `$${Math.round(thousands)}K`;
  }
  return `$${amount}`;
}

/**
 * Truncate to a maximum character budget, breaking at the last complete
 * word rather than mid-word — CSS `text-overflow: ellipsis` clips by
 * rendered pixel width, which cuts wherever a glyph happens to land
 * ("Cas...", "someti..."); this clips by word boundary instead, so a
 * truncated line always ends on a whole word before the appended "…".
 */
export function truncateAtWord(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const slice = text.slice(0, maxChars);
  const lastSpace = slice.lastIndexOf(' ');
  const cut = lastSpace > 0 ? slice.slice(0, lastSpace) : slice;
  return `${cut.trimEnd()}…`;
}

/**
 * Check if a cap table sums to 100 within tolerance
 * Returns [isSumValid, actualSum, error]
 */
export function validateCapTable(entries: Array<{ percentage: number }>): [boolean, number, string] {
  const sum = entries.reduce((acc, entry) => acc + entry.percentage, 0);
  const error = Math.abs(sum - 100);
  const isValid = error <= 0.01;
  
  return [isValid, sum, isValid ? '' : `Cap table sums to ${sum.toFixed(2)}%, not 100`];
}
