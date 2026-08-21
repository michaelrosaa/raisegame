/**
 * Award predicates
 * awards.json holds only label/description (content is JSON, JSON has no functions).
 * The "did the player actually earn this" logic lives here, keyed by award id,
 * so it can read GameState/RunResults directly instead of being duplicated
 * per-component. This is what stops an award rendering as earned (or dashed)
 * independent of what the numbers actually say — e.g. NEVER DILUTED showing
 * as unearned on a run that gave up 0% every single year.
 *
 * A condition that can't yet be verified from tracked state returns false
 * rather than guessing — an award that never fires is safer than one that
 * fires incorrectly. Every award below is a real, earnable condition; none
 * are left as permanent `() => false` stubs — the last three that were
 * (survived-the-freeze, nobody-left, bought-a-rival) needed small state
 * additions (GameState.everLostABacker/everAcquiredRival, YearRecord.climate)
 * and, for the latter two, a specific content choice that actually flips
 * them — see the comments on each below.
 */

import type { CareerState, GameState, RunResults } from './types';
import { countryFor } from './economy';
import { BUCKETS, CAREER_LENGTH_YEARS } from './constants';

type AwardCondition = (state: GameState, results: RunResults) => boolean;
type CareerAwardCondition = (career: CareerState) => boolean;

/**
 * Derive the implied post-money valuation of a funding round from the
 * amount raised and how much the founder's stake moved, without ever
 * storing a second, independently-editable valuation number.
 *   founderShareAfter = founderShareBefore * (1 - investorPct)
 *   investorPct = 1 - founderShareAfter / founderShareBefore
 *   postMoney = amount / investorPct
 */
function impliedPostMoneyValuation(founderShareBefore: number, founderShareAfter: number, amount: number): number {
  if (founderShareBefore <= 0) return 0;
  const investorPct = 1 - founderShareAfter / founderShareBefore;
  if (investorPct <= 0) return 0;
  return amount / investorPct;
}

export const AWARD_CONDITIONS: Record<string, AwardCondition> = {
  'never-diluted': (state) => state.history.every((h) => h.funding === undefined),

  'kept-control': (_state, results) => results.founderFinalShare > 70,

  'big-exit': (_state, results) =>
    (results.endingType === 'sale' || results.endingType === 'ipo') && (results.exitPrice ?? 0) >= 50_000_000,

  unicorn: (state) =>
    state.history.some(
      (h) =>
        h.funding &&
        impliedPostMoneyValuation(h.funding.founderShareBefore, h.funding.founderShareAfter, h.funding.amount) >=
          1_000_000_000
    ),

  profitable: (state) => state.monthlyBurn < 0,

  // Going public is no longer a terminal ending (Pass D) — this used to
  // read results.endingType === 'ipo', which can no longer happen.
  'went-public': (state) => state.everWentPublic,

  // Every real year produces exactly one YearRecord (turn.ts never skips a
  // year), so history.climate is a complete per-year climate timeline —
  // true if a frozen year is in there AND the company made it out the
  // other side rather than failing during (or shortly after) one.
  'survived-the-freeze': (state, results) => results.endingType !== 'failure' && state.history.some((h) => h.climate === 'frozen'),

  'founded-abroad': (state) => state.founder.country !== 'us',

  'three-generations': (state) => state.generation >= 3,

  // Only meaningful once there was actually someone to lose — a company
  // that never raised money trivially has "everyone" (nobody) stay, which
  // isn't the achievement this is meant to recognize. See state.ts's
  // 'investorDeparts' effect (content/events/internal.json's
  // ev-investor-wants-out) for the one thing that can flip this false.
  'nobody-left': (state) => state.history.some((h) => h.funding !== undefined) && !state.everLostABacker,

  gambler: (state) => state.history.some((h) => h.gambleResult === 'won'),

  'the-long-game': (_state, results) => results.years >= 15,

  'quiet-giant': (state) => state.annualRevenue >= 10_000_000 && state.staff <= 20,

  // See state.ts's 'rivalAcquired' effect (content/events/economic.json's
  // ev-rival-in-trouble) for the one thing that can flip this true.
  'bought-a-rival': (state) => state.everAcquiredRival,

  'turned-it-down': (state) =>
    state.history.some((h) => /decline|turn(ed)? down|reject/i.test(h.optionLabel)),

  // A good-or-legendary outcome founded from a tier 1 or 2 country — funding
  // is nearly nonexistent and exits are rare there, so reaching this bucket
  // at all means the business earned its way there without the usual capital
  // or buyer-market advantages. See the design doc's country-difficulty model.
  'against-the-odds': (state, results) =>
    countryFor(state.founder.country).tier <= 2 && results.endingType !== 'failure' && results.founderTakeHome >= BUCKETS.GOOD_MIN,
};

/**
 * All award ids the player has earned: anything already recorded on state
 * (e.g. granted directly by an event effect) plus anything the predicates
 * above confirm against the final results.
 */
export function computeEarnedAwards(state: GameState, results: RunResults): string[] {
  const earned = new Set(state.awards);

  for (const [id, condition] of Object.entries(AWARD_CONDITIONS)) {
    if (condition(state, results)) {
      earned.add(id);
    }
  }

  return Array.from(earned);
}

/**
 * Career-level awards — these need the whole `companies` history (which
 * company came in what order, how each one ended), not any single
 * company's GameState/RunResults, so they live here rather than in
 * AWARD_CONDITIONS above.
 */
export const CAREER_AWARD_CONDITIONS: Record<string, CareerAwardCondition> = {
  serial: (career) => career.companies.length >= 3,

  'never-failed': (career) => career.companies.length > 0 && career.companies.every((c) => c.outcome !== 'failed'),

  phoenix: (career) =>
    career.companies.some(
      (c, i) => c.outcome === 'failed' && career.companies.slice(i + 1).some((later) => later.proceeds >= BUCKETS.GOOD_MIN)
    ),

  'second-time-lucky': (career) =>
    career.companies.some((c, i) => c.outcome === 'failed' && career.companies.slice(i + 1).some((later) => later.outcome !== 'failed')),

  'one-and-only': (career) => career.companies.length === 1 && career.current === null && career.careerYear > CAREER_LENGTH_YEARS,

  'retired-early': (career) => career.retiredEarly,

  'debt-free': (career) =>
    career.companies.length > 0 && career.companies.every((c) => !c.tookLoan) && !(career.current?.everTookLoan ?? false),
};

/**
 * All award ids earned across a whole career: the per-company set already
 * accumulated as companies ended (see CareerState.awards's own comment)
 * plus the career-level predicates above, evaluated fresh every call
 * since they're cheap and `companies` never shrinks.
 */
export function computeCareerAwards(career: CareerState): string[] {
  const earned = new Set(career.awards);

  for (const [id, condition] of Object.entries(CAREER_AWARD_CONDITIONS)) {
    if (condition(career)) {
      earned.add(id);
    }
  }

  return Array.from(earned);
}
