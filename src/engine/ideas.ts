/**
 * Idea-picking and idea-card display helpers, shared between the setup
 * screen (first company of a career) and the re-founding screen (company
 * 2+ — see career.ts/ui/screens/foundCompany.tsx). Originally lived only in
 * setup.tsx; lifted out here so both screens draw from and describe ideas
 * identically instead of maintaining two copies.
 */

import type { Idea } from './types';
import type { RNG } from './rng';

export function moneyBand(amount: number): string {
  if (amount < 40_000) return 'A little';
  if (amount < 100_000) return 'Some';
  return 'A lot';
}

export function salesTimeline(months: number): string {
  if (months < 12) return `${months} months`;
  const years = Math.round(months / 12);
  return `${years} year${years === 1 ? '' : 's'}`;
}

export function upsideBand(upside: string): { label: string; tone: 'huge' | 'good' | 'small' } {
  if (upside === 'Huge') return { label: 'Huge', tone: 'huge' };
  if (upside === 'Small') return { label: 'Small', tone: 'small' };
  return { label: 'Good', tone: 'good' };
}

export function ideaHeat(idea: Idea): { label: string; variant: 'success' | 'warning' | 'error' } {
  const { tone } = upsideBand(idea.upside);
  if (tone === 'huge') return { label: 'Investors love this', variant: 'success' };
  if (idea.difficulty === 'easy' || idea.difficulty === 'medium') return { label: 'Steady bet', variant: 'warning' };
  return { label: 'Investors are cold', variant: 'error' };
}

/** The one visible signal for glamour (content pack 4) — otherwise a
 * completely invisible number driving funding chance/valuation/variance/
 * failure rate/exit multiple under the hood (economy.ts's glamour* factor
 * functions). ideas.ts's pickIdeas already guarantees one high- and one
 * low-glamour idea in every draw; this is what actually lets a player see
 * — and knowingly choose — which one is which, instead of the trade being
 * real but undetectable. Only the two notable extremes get a badge; the
 * broad neutral middle (including every idea that predates the field,
 * defaulted to 0.5) stays unmarked on purpose, same reasoning ideaHeat
 * above only flags the standout cases. */
export function glamourBadge(idea: Idea): { label: string; tone: 'accent' | 'muted' } | null {
  const glamour = idea.glamour ?? 0.5;
  if (glamour >= 0.7) return { label: 'High profile', tone: 'accent' };
  if (glamour <= 0.3) return { label: 'Low profile', tone: 'muted' };
  return null;
}

/** Only one card per draw may carry the "investors love this" treatment — a
 * badge on the majority would carry no signal. Every other card still shows
 * its own heat, just without the loud badge. */
export function heatForDraw(ideas: Idea[]): boolean[] {
  let usedHot = false;
  return ideas.map((idea) => {
    const isHot = ideaHeat(idea).variant === 'success';
    if (isHot && !usedHot) {
      usedHot = true;
      return true;
    }
    return !isHot;
  });
}

/** How big a next opportunity should look, driven by what the founder's
 * last company actually returned — engine/career.ts's foundCompany reads
 * this off the just-ended CompanyRecord.proceeds (0 for a failure) and the
 * re-founding screen (ui/screens/foundCompany.tsx) passes it into
 * pickIdeas below. A big payday buys a shot at something that costs more
 * to start and swings for more; a small exit — or a failure — gets offered
 * something more modest instead, same reasoning either way. The very first
 * company of a career has no prior outcome to read, so it always draws
 * 'mid' (today's plain, unbiased draw). */
export type IdeaOpportunityTier = 'low' | 'mid' | 'high';

export function ideaOpportunityTierForProceeds(proceeds: number): IdeaOpportunityTier {
  if (proceeds >= 5_000_000) return 'high';
  if (proceeds >= 250_000) return 'mid';
  return 'low';
}

/** Upside rank dominates the sort (a 'Huge'-upside idea always outranks a
 * 'Good' one regardless of cost); moneyNeeded only breaks ties within the
 * same band — so "highest potential" and "highest cost of starting" both
 * point the same direction without one silently overriding the other. */
function opportunitySortKey(idea: Idea): number {
  const upsideRank = idea.upside === 'Huge' ? 2 : idea.upside === 'Small' ? 0 : 1;
  return upsideRank * 1_000_000 + idea.moneyNeeded;
}

/** Biases a pool toward its priciest/highest-upside 40% ('high') or its
 * cheapest/lowest-upside 40% ('low') — 'mid' (or a too-small pool) leaves
 * it untouched, same fallback safety pickIdeas already uses elsewhere. */
function biasPoolByTier(pool: Idea[], tier: IdeaOpportunityTier): Idea[] {
  if (tier === 'mid' || pool.length <= 1) return pool;
  const sorted = [...pool].sort((a, b) => opportunitySortKey(a) - opportunitySortKey(b));
  const cut = Math.max(1, Math.round(sorted.length * 0.4));
  return tier === 'high' ? sorted.slice(-cut) : sorted.slice(0, cut);
}

// Content pack 4's glamour bands, matched exactly ("High glamour (0.7–1.0)",
// "Low glamour (0.0–0.3)") — the draw rule below reads these, not the tier
// bias above; the two are independent axes (cost/upside vs. how much
// outside attention a business attracts) and never fight each other.
const HIGH_GLAMOUR = 0.7;
const LOW_GLAMOUR = 0.3;

function glamourOf(idea: Idea): number {
  return idea.glamour ?? 0.5;
}

/** "Never offer three high-glamour or three low-glamour options. Always at
 * least one of each, so the trade is visible every time" (content pack 4).
 * Swaps in a qualifying idea from the full exclude-filtered pool when the
 * drawn set is missing one side — bumping whichever drawn idea sits
 * furthest from the missing side, so the swap costs the draw as little
 * variety as possible. A pool too thin to satisfy this (e.g. deep into a
 * single run with most ideas already excluded) is left as drawn rather
 * than forced. */
function ensureGlamourDiversity(drawn: Idea[], pool: Idea[], rng: RNG): Idea[] {
  const result = [...drawn];
  const usedIds = new Set(result.map((i) => i.id));

  function swapIn(qualifies: (glamour: number) => boolean, otherBand: (glamour: number) => boolean, prefer: (a: number, b: number) => boolean) {
    const candidates = pool.filter((i) => qualifies(glamourOf(i)) && !usedIds.has(i.id));
    if (candidates.length === 0) return;
    const chosen = rng.pick(candidates);

    // Never evict the sole remaining representative of the OTHER band —
    // a natural draw that already contains exactly one high-glamour idea
    // must keep it while fixing up the low side, otherwise this pass would
    // silently undo whatever the draw (or the other pass) already got
    // right. A redundant second copy of that band is fair game to sacrifice.
    const otherBandIdx = result.map((i, idx) => (otherBand(glamourOf(i)) ? idx : -1)).filter((idx) => idx !== -1);
    const protect = otherBandIdx.length === 1 ? new Set(otherBandIdx) : new Set<number>();

    let swapOutIdx = -1;
    for (let idx = 0; idx < result.length; idx++) {
      if (protect.has(idx)) continue;
      if (swapOutIdx === -1 || prefer(idx, swapOutIdx)) swapOutIdx = idx;
    }
    if (swapOutIdx === -1) return;
    usedIds.delete(result[swapOutIdx].id);
    usedIds.add(chosen.id);
    result[swapOutIdx] = chosen;
  }

  if (!result.some((i) => glamourOf(i) >= HIGH_GLAMOUR)) {
    swapIn((g) => g >= HIGH_GLAMOUR, (g) => g <= LOW_GLAMOUR, (a, b) => glamourOf(result[a]) < glamourOf(result[b]));
  }
  if (!result.some((i) => glamourOf(i) <= LOW_GLAMOUR)) {
    swapIn((g) => g <= LOW_GLAMOUR, (g) => g >= HIGH_GLAMOUR, (a, b) => glamourOf(result[a]) > glamourOf(result[b]));
  }

  return result;
}

/** Draw 3 ideas at random, excluding any already seen this run (falls back
 * to the full pool if fewer than 3 remain unseen). `boost` widens this to 5
 * options with a higher upside floor — engine/career.ts's "look properly"
 * between-year action spends a year buying a better hand. `tier` (see
 * ideaOpportunityTierForProceeds above) narrows the pool by outcome before
 * either of those draws happen; falls back to the untiered pool whenever
 * the biased slice can't fill the draw. Every draw is then checked against
 * ensureGlamourDiversity above regardless of tier/boost. */
export function pickIdeas(ideas: Idea[], rng: RNG, exclude: Set<string>, boost: boolean = false, tier: IdeaOpportunityTier = 'mid'): Idea[] {
  const pool = ideas.filter((i) => !exclude.has(i.id));
  const source = pool.length >= 3 ? pool : ideas;
  const count = boost ? 5 : 3;
  if (!boost) {
    const tiered = biasPoolByTier(source, tier);
    const drawPool = tiered.length >= count ? tiered : source;
    return ensureGlamourDiversity(rng.shuffle(drawPool).slice(0, count), pool, rng);
  }

  // Higher upside floor: prefer non-'Small' ideas when there are enough of
  // them, same fallback-to-full-pool safety as the plain draw.
  const strong = source.filter((i) => upsideBand(i.upside).tone !== 'small');
  const boostedSource = strong.length >= count ? strong : source;
  const tieredBoosted = biasPoolByTier(boostedSource, tier);
  const drawPool = tieredBoosted.length >= count ? tieredBoosted : boostedSource;
  return ensureGlamourDiversity(rng.shuffle(drawPool).slice(0, count), pool, rng);
}
