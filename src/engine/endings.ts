/**
 * Game endings and career resolution
 * Handle exits, failures, and career conclusion
 */

import type { GameState, RunResults, EndingType, FundingRecord, StageTile } from './types';
import { getFounderShare } from './state';
import { calculateLiquidationValue, marketCapFor } from './economy';
import { computeEarnedAwards } from './awards';
import { formatMoney } from './format';
import { PUBLIC_MARKET } from './constants';
import { closingHeadline } from './failure';

// Exit eligibility (canSell/canIPO) and insolvency (cash < 0, checked
// unconditionally every turn) now live in exits.ts / turn.ts respectively
// — this file only resolves an already-ended state into its RunResults.

// ============================================================================
// Ending Outcomes
// ============================================================================

/**
 * Generate results for an acquisition/sale
 */
export function generateSaleOutcome(state: GameState, salePrice: number): RunResults {
  const founderShare = getFounderShare(state.capTable);
  const takeHome = (salePrice * founderShare) / 100;

  const results: RunResults = {
    seed: state.seed,
    founder: state.founder,
    company: state.company,
    generation: state.generation,
    years: state.year,
    endingType: 'sale',
    finalCash: state.cash,
    exitPrice: salePrice,
    founderFinalShare: founderShare,
    founderTakeHome: takeHome,
    awards: state.awards,
    dramaticHeadline: getMostDramaticHeadline(state),
    stages: buildFundingRecords(state),
  };
  results.awards = computeEarnedAwards(state, results);
  return results;
}

/**
 * Generate results for leaving a public company — resigned on your own
 * terms, or removed by the board (`wasRemoved`, priced lower — see
 * PUBLIC_MARKET.REMOVED_BY_BOARD_PAYOUT_FRACTION — and the reason this
 * needs its own dramaticHeadline rather than reusing getMostDramaticHeadline's
 * usual pick). `price` is always resolved by the caller BEFORE this runs
 * (the standing resign option prices it directly; resolveRunResults prices
 * the board-removal/forced-cutoff cases itself) — this never recomputes it.
 */
export function generateExitedPublicOutcome(state: GameState, price: number, wasRemoved: boolean = false): RunResults {
  const founderShare = getFounderShare(state.capTable);
  const takeHome = (price * founderShare) / 100;

  const results: RunResults = {
    seed: state.seed,
    founder: state.founder,
    company: state.company,
    generation: state.generation,
    years: state.year,
    endingType: 'exitedPublic',
    finalCash: state.cash,
    exitPrice: price,
    founderFinalShare: founderShare,
    founderTakeHome: takeHome,
    awards: state.awards,
    dramaticHeadline: wasRemoved ? `The board voted ${state.founder.name} out` : getMostDramaticHeadline(state),
    stages: buildFundingRecords(state),
  };
  results.awards = computeEarnedAwards(state, results);
  return results;
}

/**
 * Generate results for retirement (founder chose to exit)
 */
export function generateRetirementOutcome(state: GameState, liquidationValueOverride?: number): RunResults {
  const founderShare = getFounderShare(state.capTable);
  // Retirement: assume company is worth roughly cash on hand + estimated ongoing value.
  // A generated "stop here" option (engine/exits.ts) fixes this number at offer time and
  // passes it through so what the player saw never drifts from what they're paid.
  const liquidationValue = liquidationValueOverride ?? calculateLiquidationValue(state);
  const takeHome = (liquidationValue * founderShare) / 100;

  const results: RunResults = {
    seed: state.seed,
    founder: state.founder,
    company: state.company,
    generation: state.generation,
    years: state.year,
    endingType: 'retirement',
    finalCash: state.cash,
    exitPrice: liquidationValue,
    founderFinalShare: founderShare,
    founderTakeHome: takeHome,
    awards: state.awards,
    dramaticHeadline: getMostDramaticHeadline(state),
    stages: buildFundingRecords(state),
  };
  results.awards = computeEarnedAwards(state, results);
  return results;
}

/**
 * Generate results for failure
 */
export function generateFailureOutcome(state: GameState): RunResults {
  const results: RunResults = {
    seed: state.seed,
    founder: state.founder,
    company: state.company,
    generation: state.generation,
    years: state.year,
    endingType: 'failure',
    finalCash: 0,
    founderFinalShare: getFounderShare(state.capTable),
    founderTakeHome: 0,
    awards: state.awards,
    dramaticHeadline: closingHeadline(state),
    stages: buildFundingRecords(state),
  };
  results.awards = computeEarnedAwards(state, results);
  return results;
}

/**
 * Turn a career-ended GameState into its RunResults, picking the right
 * generator from what actually happened — never re-derived per call site.
 * The last history record's endingType is authoritative when present
 * (carried through by processPlayerChoice/fireEvent from either an `end`
 * effect or a content `failure` effect); a bare cash<=0 with no recorded
 * endingType (advanceGameYear's own out-of-cash check) also reads as a
 * failure. A public company that ended without a recorded endingType
 * (board removal, or the career clock forcing a year-25 cutoff mid-play —
 * see turn.ts/App.tsx) is valued at today's market price, penalized if the
 * board did the pushing. Anything else — an explicit private-company
 * retirement, or the event pools running out — reads as a retirement.
 */
export function resolveRunResults(state: GameState): RunResults {
  const last = state.history[state.history.length - 1];
  // Every sale/exitedPublic effect — generated (exits.ts) or content-
  // authored — gets its price resolved at choice time (see game.ts's
  // processPlayerChoice), so exitPrice should always be present here. The
  // plain-multiple fallback below should never actually fire; it exists so
  // a missing price degrades gracefully instead of crashing the results
  // screen.
  if (last?.endingType === 'sale') return generateSaleOutcome(state, last.exitPrice ?? state.annualRevenue * 3);
  // exitPrice is always the FULL company value (marketCap), same
  // convention 'sale'/'retirement' already use — generateExitedPublicOutcome
  // applies founderShare exactly once, itself.
  if (last?.endingType === 'exitedPublic') return generateExitedPublicOutcome(state, last.exitPrice ?? marketCapFor(state.publicCompany!));
  if (last?.endingType === 'failure' || state.cash <= 0) return generateFailureOutcome(state);
  if (state.publicCompany) {
    const wasRemoved = state.publicCompany.boardPatience <= 0;
    const price = marketCapFor(state.publicCompany) * (wasRemoved ? PUBLIC_MARKET.REMOVED_BY_BOARD_PAYOUT_FRACTION : 1);
    return generateExitedPublicOutcome(state, price, wasRemoved);
  }
  // 'ipo' is a retired endingType (Pass D replaced it with the goPublic
  // transition) kept only for the one legacy content event still authored
  // against it (economic.json's event-ipo-window, a buyout-dressed-as-an-IPO
  // that never actually lists the company). It already has a real,
  // market-priced exitPrice from processPlayerChoice's pre-pass — read the
  // same way 'retirement' does, so that number is never silently discarded
  // in favor of a freshly recomputed liquidationValue.
  return generateRetirementOutcome(state, last?.endingType === 'retirement' || last?.endingType === 'ipo' ? last.exitPrice : undefined);
}

// ============================================================================
// Results Assembly
// ============================================================================

/**
 * Find the most dramatic headline for the results card pull-quote
 * Prefer gamble outcomes, then major events
 */
export function getMostDramaticHeadline(state: GameState): string {
  // Find a gamble result if one exists
  const gambleRecord = state.history.find((h) => h.gambleResult);
  if (gambleRecord) {
    return gambleRecord.storyHeadline;
  }

  // Find a notable event (ending, major milestone)
  const notableRecord = state.history[Math.floor(state.history.length * 0.75)];
  if (notableRecord) {
    return notableRecord.storyHeadline;
  }

  // Fallback
  return state.history.length > 0 ? state.history[state.history.length - 1].storyHeadline : 'A journey begins';
}

/**
 * Build funding rounds record for card display
 * One entry per year a funding offer was actually accepted — pulled straight
 * from history, never recomputed, so the card can never disagree with itself.
 */
export function buildFundingRecords(state: GameState): FundingRecord[] {
  return state.history
    .filter((entry) => entry.funding !== undefined)
    .map((entry) => ({
      year: entry.year,
      stage: entry.funding!.stage,
      amount: entry.funding!.amount,
      firm: entry.funding!.firm,
      founderShareBefore: entry.funding!.founderShareBefore,
      founderShareAfter: entry.funding!.founderShareAfter,
    }));
}

/**
 * Build the results card's stage tile grid: one tile per year that had a
 * chosen outcome (reading straight from history, never re-deriving numbers),
 * plus a final gold tile for how the career actually ended.
 */
export function buildStageTiles(state: GameState, results: RunResults): StageTile[] {
  const tiles: StageTile[] = state.history.map((h) => ({
    year: h.year,
    label: h.tag ?? h.optionLabel.toUpperCase(),
    amount: h.funding?.amount ?? 0,
    actor: h.funding?.firm ?? 'Nobody but you',
    equityNote: h.funding
      ? `gave up ${Math.max(0, h.funding.founderShareBefore - h.funding.founderShareAfter).toFixed(0)} pts`
      : 'kept every point',
    highlight: h.funding ? 'purple' : 'default',
  }));

  if (results.endingType === 'sale' || results.endingType === 'ipo') {
    const acquirer = state.cast.find((c) => c.role === 'acquirer');
    tiles.push({
      year: results.years,
      label: results.endingType === 'sale' ? 'SOLD' : 'WENT PUBLIC',
      amount: results.exitPrice ?? 0,
      actor: acquirer?.firm ?? acquirer?.fullName ?? 'Acquirer',
      equityNote: `+${formatMoney(results.founderTakeHome)}`,
      highlight: 'gold',
    });
  }

  return tiles;
}

// ============================================================================
// Title Generation (for results card)
// ============================================================================

/**
 * Generate title based on founder's final share and ending
 * Matches specification exactly
 */
export function generateTitle(founderShare: number, endingType: EndingType): string {
  if (endingType === 'failure') {
    return 'An expensive lesson';
  }

  if (founderShare > 70) {
    return 'Kept control';
  }
  if (founderShare >= 50) {
    return 'Gave away half';
  }
  if (founderShare >= 25) {
    return "Investors' company";
  }

  return 'A minority of your own company';
}

/**
 * Generate subtitle describing the founder's final position. Always reads
 * the real founderShare/years rather than picking flavor text independent
 * of them — "Took the money and kept the company" over a 38% stake and
 * "Barely diluted" over 50% both shipped in the prototype; this is what
 * stops that recurring.
 */
export function generateSubtitle(
  founderShare: number,
  endingType: EndingType,
  years: number,
  tookOutsideMoney: boolean
): string {
  if (endingType === 'failure') {
    return `Ran out of runway in year ${years}`;
  }

  const share = Math.round(founderShare);

  if (founderShare > 70) {
    return tookOutsideMoney
      ? `Investors are on the register, and ${share}% of it still answers to you.`
      : `Bootstrapped the whole way — nobody else is on the register.`;
  }
  if (founderShare >= 50) {
    return `You gave up real ground, but ${share}% keeps you in control.`;
  }
  if (founderShare >= 25) {
    return `Investors call more of the shots now — you're left with ${share}%.`;
  }

  return `A minority stake: just ${share}% is still yours.`;
}
