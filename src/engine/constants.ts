/**
 * Every tunable number in the game economy, and nothing else. Balancing
 * Raise is a matter of editing this file and re-running the simulation
 * harness (npm run simulate) — never scattering a magic number into
 * economy.ts, exits.ts, or turn.ts directly.
 *
 * Tuning order if the harness's acceptance targets are missed (see
 * simulate.ts's printed report — it now reports per-country-tier as well as
 * per-style, since the two are meant to differ). Change ONE dial at a time
 * and re-run:
 *   1. LUCK.SIGMA                    — spread of outcomes
 *   2. ECONOMY.BASE_GROWTH           — overall size of companies
 *   3. ECONOMY.CHURN                 — failure rate
 *   4. content/countries.json's per-tier burn figures — early-game survival
 *   5. EXIT.BASE_OFFER_CHANCE        — how often exits appear
 *   6. MARKET_WEALTH_* / EXIT_MARKET_REFERENCE — the tier-1..5 spread itself
 * Never adjust BUCKETS to hit the distribution — those define what the
 * words "respectable" / "good" / "legendary" mean, not a curve to fit.
 */

/** Length of a career, in absolute years (CareerState.careerYear). Lives
 * here rather than in career.ts so awards.ts can read it without a
 * career.ts <-> awards.ts import cycle (career.ts itself re-exports this
 * for its existing external callers, so `from './career'` still works
 * everywhere it already did). */
export const CAREER_LENGTH_YEARS = 50;

/** The real calendar year a brand-new career's career-year-1 lands on —
 * evaluated once, at module load. Lives here (a leaf module) rather than
 * present.ts so both present.ts and career.ts can read it without a
 * circular import: a re-founded company anchors off its own career's
 * progress (career.ts's foundCompany), and a new generation after a
 * handover anchors off wherever the outgoing career actually left off
 * (career.ts's handOverToHeir) — this constant only ever seeds generation
 * 1's very first company. See present.ts's calendarYear/calendarYearFor. */
export const CALENDAR_YEAR_AT_FOUNDING = new Date().getFullYear();

import type { CanonicalIndustry, Climate } from './types';

// ============================================================================
// Core growth economy
// ============================================================================

export const ECONOMY = {
  BASE_GROWTH: 1.51, // gross growth before modifiers. Nudged down again from 1.62 (itself down from
  // 1.7 in an earlier Pass A pass) for the same reason as LUCK.SIGMA above: tier-5 legendary drifted
  // to ~11-15% against a 1-5% target after several separately-justified rounds this session (rarer
  // exits, a much stronger capital-deployment bonus, glamour's added variance) each compounded on
  // top of the others. Already-successful trajectories compound harder off this dial than weak ones
  // do (see CHURN below), so it's a more surgical lever on the tail than raising CHURN further would
  // be — that would also drag down the median, which the LEGENDARY-rate problem doesn't call for.
  CHURN: 0.27, // subtracted after modifiers; lets bad years shrink revenue. Raised back up from
  // 0.19 on an explicit "make it easier to fail" product call — failure had gotten too rare to
  // feel like a real, live possibility most years. Stops short of the 0.42 an earlier tuning pass
  // tried and reverted (that dragged peak revenue/staff below target along with the failure rate —
  // the outcome-bucket skew that pass was chasing turned out to be economy.ts's
  // calculateLiquidationValue, not the growth rate, so pushing CHURN that far was fixing the wrong
  // thing). 0.27 sits meaningfully above both the original 0.19 and the never-shipped 0.25.
  MATURITY_PIVOT: 50_000, // revenue at which deceleration begins
  MAX_YEAR_MULTIPLIER: 3.0, // cap on stacked event growth multipliers
  MIN_GROWTH: -0.45, // a company cannot lose more than 45% of revenue in a year
  MAX_GROWTH: 4.0, // ceiling on a single year's growth rate
} as const;

/** PRIMARY TUNING DIAL — width of the luck distribution. Raising it makes
 * the game luckier and outcomes more extreme; lowering it makes choices
 * matter more. Change this before changing anything else. */
export const LUCK = {
  SIGMA: 0.12, // tuned down again from 0.19 (itself down from 0.5, itself down from 0.65) — tier-5
  // legendary had drifted to ~13-15% against a 1-5% target after several rounds of separately-
  // justified changes this session (exits made much rarer, the capital-deployment bonus raised
  // significantly, glamour added its own variance on top) each compounded on top of the others
  // without a holistic re-check. None of those changes get walked back here — they were explicit
  // product calls — this narrows the luck spread further instead, the harness's own documented
  // #1 dial for "spread of outcomes" specifically, so the tail comes back in without touching how
  // often exits happen or how strong a big war chest's growth bonus is.
} as const;

// ============================================================================
// Climate
// ============================================================================

export const CLIMATE_GROWTH: Record<Climate, number> = {
  frothy: 1.15,
  cooling: 1.0,
  frozen: 0.8,
  recovering: 1.05,
};

export const CLIMATE_VALUATION: Record<Climate, number> = {
  frothy: 1.6,
  cooling: 1.0,
  frozen: 0.55,
  recovering: 1.2,
};

export const CLIMATE_EXIT: Record<Climate, number> = {
  frothy: 1.4,
  cooling: 1.0,
  frozen: 0.6,
  recovering: 1.15,
};

// ============================================================================
// Debt (Pass B) — the trade against equity: costs no ownership, but must be
// repaid whether or not the company works. See economy.ts's computeLoanRate/
// canGetLoan/amortizeLoansForYear.
// ============================================================================

export const LOAN = {
  // base = BASE_MIN + BASE_RANGE * countryRiskFactor(country), where
  // countryRiskFactor blends bureaucracy/currencyRisk (both move inversely
  // with tier — see economy.ts). Calibrated so a clean founder in a tier-5
  // country borrows around 7%, matching the design doc's example.
  BASE_MIN: 0.05,
  BASE_RANGE: 0.20,
  BANKRUPTCY_PENALTY: 0.04, // + per bankruptcy on the founder's record
  REPUTATION_DISCOUNT_AT_100: 0.02, // - at reputation 100, scaling linearly down to 0 at reputation 0
  MIN_RATE: 0.04,
  MAX_RATE: 0.35,
  // "After two, most lenders refuse" — the design doc's own wording. Below
  // this, a loan just costs more; at or above it, no lender offers one at
  // all (content gates on the `bankruptciesBelow` condition).
  LOCKOUT_BANKRUPTCIES: 2,
} as const;

/** Credit is a little easier to find in a frothy market, harder in a
 * frozen one — the same shape as CLIMATE_GROWTH/CLIMATE_VALUATION/
 * CLIMATE_EXIT above, just smaller (rate points, not a multiplier). */
export const LOAN_CLIMATE_ADJUSTMENT: Record<Climate, number> = {
  frothy: -0.01,
  cooling: 0,
  frozen: 0.03,
  recovering: 0.01,
};

// ============================================================================
// Family and generational handover (Pass C) — see career.ts's startFamily/
// handOverToHeir.
// ============================================================================

export const HEIR = {
  // The family event's own conditions bound when it can fire (yearMin 6,
  // yearMax 18 — see content/events/family.json); these bound the STARTING
  // AGE computed at handover, in case the gap between familyYear and the
  // career's actual end is very small (retired early right after) or very
  // large (a full CAREER_LENGTH_YEARS-year career).
  MIN_STARTING_AGE: 22,
  MAX_STARTING_AGE: 45,
  // A protégé/successor (the no-family, ad-unlocked path) isn't necessarily
  // young — same range a first-time founder gets.
  SUCCESSOR_AGE_MIN: 24,
  SUCCESSOR_AGE_MAX: 52,
  REPUTATION_DECAY: 0.5, // heir starts at half the outgoing founder's final reputation —
  // "a famous parent opens doors; it isn't the same as your own record" (design doc §9)
  INHERITANCE_FRACTION_MIN: 0.5,
  INHERITANCE_FRACTION_MAX: 0.7, // scales up with how big the estate is — see career.ts's inheritanceFraction
} as const;

// ============================================================================
// Public company (Pass D) — see economy.ts's updateSharePrice/exits.ts's
// share-sale mechanics.
// ============================================================================

export const PUBLIC_MARKET = {
  IPO_SHARE_COUNT: 100_000_000, // notional — only ever matters as marketCap/sharePrice's denominator
  INITIAL_BOARD_PATIENCE: 70,
  INITIAL_ANALYST_SENTIMENT: 60,
  DRIFT_TOWARD_BASELINE_RATE: 0.1, // boardPatience/analystSentiment close 10% of the gap to baseline each year
  // "Converting more than ~2% of your holding in one year drops the share
  // price" (design doc) — selling at or under this in a single 'sellShares'
  // effect costs nothing; every point over it costs price and sentiment.
  SELL_NO_IMPACT_PCT: 2,
  SELL_IMPACT_PRICE_PCT_PER_POINT: 0.02, // -2% share price per point sold over the no-impact threshold
  SELL_IMPACT_SENTIMENT_PER_POINT: 3,
  // Board removal is a forced exit, priced worse than walking away on your
  // own terms — see endings.ts's generateExitedPublicOutcome callers.
  REMOVED_BY_BOARD_PAYOUT_FRACTION: 0.75,
  // takePrivate's buyout loan carries a premium over an ordinary loan —
  // buying out public shareholders in one go is a bigger, riskier ask than
  // a normal business loan.
  TAKE_PRIVATE_RATE_PREMIUM: 0.03,
  TAKE_PRIVATE_LOAN_YEARS: 8,
  // Share price is a random walk (updateSharePrice) with a slight upward
  // bias — compounded over many years public, that has no natural ceiling
  // and can drift arbitrarily far from what the business actually makes
  // (a $16M-revenue company "worth" billions). This caps market cap at a
  // generous-but-real multiple of CURRENT annual revenue every year, the
  // same grounding principle the one-shot acquisition/IPO pricing already
  // has via EXIT.MULTIPLE_RANGE — public markets can overpay more than a
  // rational acquirer, but not by orders of magnitude forever. Turned down
  // further from an initial 25 — even 25x sustained over many years public
  // still let valuations balloon well past what the business itself
  // justified; 12x tracks closer to EXIT.MULTIPLE_RANGE's own (also
  // lowered) high end instead of sitting far above it.
  MAX_MARKET_CAP_REVENUE_MULTIPLE: 12,
} as const;

/** Wider than the (tuned-down) private LUCK.SIGMA — "public markets swing
 * on things that have nothing to do with you." */
export const PUBLIC_MARKET_LUCK_SIGMA = 0.35;

// ============================================================================
// Staffing
// ============================================================================

export const STAFF = {
  HIRE_GAP_FRACTION: 0.3, // close 30% of the gap to target per year
  HIRE_MIN_CASH_MONTHS: 12,
  SHRINK_BELOW_CASH_MONTHS: 6,
  SHRINK_FRACTION: 0.25,
} as const;

export const REVENUE_PER_HEAD: Record<CanonicalIndustry, number> = {
  software: 150_000,
  hardware: 120_000,
  services: 80_000,
  food: 60_000,
  retail: 60_000,
  consumer: 90_000,
};

/** A small multiplicative temperament per industry on top of the shared
 * growth formula — software runs hot, food/retail runs steady. Not given
 * numerically in the design doc (only referenced as INDUSTRY[x].growthFactor);
 * chosen as a mild ±15% spread around 1.0 so it flavors outcomes without
 * dominating the luck roll. Tune here if industries feel too similar or
 * too determinative. */
export const INDUSTRY: Record<CanonicalIndustry, { growthFactor: number }> = {
  software: { growthFactor: 1.15 },
  hardware: { growthFactor: 0.9 },
  services: { growthFactor: 0.95 },
  food: { growthFactor: 0.88 },
  retail: { growthFactor: 0.92 },
  consumer: { growthFactor: 1.05 },
};

/** Maps content's free-text idea.industry string onto a canonical bucket.
 * Content has 5 categories ("Software", "Hardware", "Services",
 * "Food & Retail", "Strange"); the economy only knows the 6 canonical
 * buckets above. "Food & Retail" reads as `food` (the multiple ranges are
 * close enough either way); "Strange" — everything from a satellite
 * imagery startup to a hot sauce brand — reads as `consumer`, the closest
 * catch-all. Any unrecognised string falls back to `services`. */
export const INDUSTRY_MAP: Record<string, CanonicalIndustry> = {
  Software: 'software',
  Hardware: 'hardware',
  Services: 'services',
  'Food & Retail': 'food',
  Strange: 'consumer',
};

export function canonicalIndustry(industry: string): CanonicalIndustry {
  return INDUSTRY_MAP[industry] ?? 'services';
}

// ============================================================================
// Country economy — burn-side dollar figures (costPerHead/founderCost/
// startingCash) now live directly on each country in content/countries.json,
// generated from a 5-tier table by a one-off script (see that file's header
// comment) rather than duplicated here. Burn is deliberately NOT where
// country difficulty mostly comes from — it's roughly proportional (cheap
// staff, thin local prices, they largely cancel). The dials below are where
// the real difficulty gap lives: market wealth, funding/exit access, and
// shock risk. See economy.ts/exits.ts/turn.ts for how each is used.
// ============================================================================

/** expectedStaffFor divides revenue by REVENUE_PER_HEAD * marketWealth — a
 * thin market pays less per customer, so the same dollar of revenue implies
 * more staff to have earned it. Floored so a tier-1 country's very low
 * marketWealth can't blow this up into an absurd staffing requirement. */
export const MARKET_WEALTH_STAFFING_FLOOR = 0.06;

/** Per-year growth-rate factor from market wealth — modest on its own
 * (industryFactor-sized), because the real ceiling effect below does most
 * of the work; this only shapes the early trajectory. */
export const MARKET_WEALTH_GROWTH_FACTOR_MIN = 0.82;
export const MARKET_WEALTH_GROWTH_FACTOR_RANGE = 0.28; // factor = MIN + RANGE * marketWealth

/** The idea's hidden ceiling (economy.ts's drawIdeaCeiling/ceilingDamp) is
 * scaled down by market wealth — this is the main reason a frontier-market
 * founder's realistic best case is "profitable small business" rather than
 * "large exit": the business genuinely cannot get as big in dollar terms,
 * not just that it grows slower. */
export const MARKET_WEALTH_CEILING_FLOOR = 0.12;
export const MARKET_WEALTH_CEILING_RANGE = 0.88; // ceilingFactor = FLOOR + RANGE * marketWealth

/** talentPool feeds the growth-rate factor directly (per the design doc):
 * 0.75 at talentPool=0, 1.15 at talentPool=1. */
export const TALENT_FACTOR_MIN = 0.75;
export const TALENT_FACTOR_RANGE = 0.40;

/** bureaucracy only drags years 1–3 — paperwork/registration/licensing
 * friction that's worst when the company is most fragile and irrelevant
 * once it's established. */
export const BUREAUCRACY_DRAG_YEARS = 3;
export const BUREAUCRACY_DRAG_COEF = 0.3; // growth *= (1 - bureaucracy * this) in years 1-3

/** infrastructure: low-infrastructure countries have a per-year chance of a
 * disruptive event (power, logistics, connectivity) that dents that year's
 * growth. Weather, not punishment — see turn.ts's luckNote for the same
 * framing pattern. */
export const INFRASTRUCTURE_DISRUPTION_MAX_CHANCE = 0.15; // chance = (1 - infrastructure) * this
export const INFRASTRUCTURE_DISRUPTION_GROWTH_FACTOR = 0.82;

/** currencyRisk: annual probability of a devaluation event. When it fires,
 * cash and revenue both take a one-time hit in this range — "the currency
 * can erase you," per the design doc. */
export const CURRENCY_SHOCK_MIN = 0.25;
export const CURRENCY_SHOCK_MAX = 0.45;

/** exitMarket scaling reference — a tier-5 country's exitMarket (~0.90) is
 * what EXIT.BASE_OFFER_CHANCE was already tuned against, so offer chance
 * and price multiple both scale by country.exitMarket / this, rather than
 * by the raw 0–1 value (which would make even the best market feel
 * throttled). See exits.ts. */
export const EXIT_MARKET_REFERENCE = 0.90;

/** Uniform runway cushion on top of content/countries.json's per-tier
 * startingCash — same tuning role the old STARTING_CASH_MULTIPLE dial
 * played: the tier table's raw numbers give only ~1 year of pre-revenue
 * runway even at tier 5, which turned out to be the single biggest lever
 * on the whole harness (median career length/peak revenue/exit-offered all
 * move together off this one dial — see simulate.ts's report). Kept as a
 * separate multiplier rather than edited into the tier table itself so
 * that table stays a faithful copy of the design doc's numbers. Pushed
 * fairly high (3.8x) to clear the median-revenue/staff floors; still not
 * quite enough on its own to clear the exit-offered/career-length floors,
 * which run into the pre-existing offer-chance-vs-career-length tension
 * documented on EXIT.BASE_OFFER_CHANCE below. */
export const STARTING_CASH_RUNWAY_MULTIPLE = 5.9;

// ============================================================================
// Exits
// ============================================================================

export const EXIT = {
  MIN_REVENUE: 900_000, // tuned down from 1_100_000 for the country-difficulty model: median
  // revenue was landing just under the old eligibility line, capping exit-offered% and career
  // length together. Still well above the original 500_000, which was raised in an earlier tuning
  // pass because acquisition offers were becoming eligible (and sensible accepts most it sees)
  // early enough to cap median career length regardless of the retirement threshold.
  IPO_MIN_REVENUE: 25_000_000,
  IPO_MIN_YEAR: 8,
  // Deliberately turned back down from the Pass A-tuned 0.30 (itself tuned up from 0.22, then
  // 0.27, to clear the harness's blended "exit offered" floor across weak country tiers — see
  // git history for that reasoning). Explicit product call: exit/acquisition offers — the full
  // generated event, buyer + accept/decline — were showing up often enough to make "sell the
  // company" read as the default shape of nearly every year rather than a real, occasional
  // event. This is a bigger lever than STANDING_OPTION_SHOW_CHANCE below: it governs the
  // generated acquisition-offer EVENT itself (eligible from the moment revenue clears
  // MIN_REVENUE, no year floor), not just the "stop here" option riding along on other events.
  // Career-length/exit-rate acceptance checks will drift below their old targets as a direct,
  // accepted consequence — see constants.ts's file-level tuning-order note.
  BASE_OFFER_CHANCE: 0.12,
  // Turned down further (~35-40% across the board) — even the typical, non-outlier acquisition
  // price this produced still read as too generous against the actual revenue on offer. Software's
  // upper end alone used to hit 8x; combined with MULTIPLE_SIGMA's jitter and a frothy-climate
  // 1.4x, a rare-but-real outlier could clear 20x revenue for one acquisition offer. These ranges
  // and a tightened MULTIPLE_SIGMA below both pull that ceiling in without removing the "a hot
  // market/hot category pays a real premium" flavor entirely.
  MULTIPLE_RANGE: {
    software: [2.5, 5],
    hardware: [1.5, 3],
    services: [1, 2],
    food: [0.7, 1.6],
    retail: [0.5, 1.3],
    consumer: [1.3, 3.2],
  } as Record<CanonicalIndustry, [number, number]>,
  MULTIPLE_SIGMA: 0.18, // tuned down from 0.25 — less extreme upside jitter on top of the
  // (already lower) base range above, so the rare high-multiple outlier stays rare and closer to
  // the base range instead of routinely doubling it.
} as const;

// ============================================================================
// Idea ceilings (§8.1) — content authors an upside band ("Small"/"Good"/
// "Huge"), not a number; this is the typical dramatic ceiling per band that
// the per-run hidden ceiling is drawn around (idea.baseCeiling in the
// design doc). Kept here rather than in ideas.json because it's a balance
// number, not narrative content, and because retrofitting 51 hand-authored
// ideas with a precise ceiling would be exactly the kind of per-file
// judgement call the design doc says to avoid for this pass.
// ============================================================================

export const IDEA_CEILING_BY_UPSIDE: Record<string, number> = {
  Huge: 120_000_000,
  Good: 30_000_000,
  Small: 6_000_000,
};
export const IDEA_CEILING_SIGMA = 0.5;
export const IDEA_CEILING_DEFAULT = 30_000_000; // fallback for an unrecognised upside string

/** ceilingDamp's shape: 1.0 while revenue is comfortably below the ceiling,
 * ramping down to CEILING_DAMP_FLOOR as revenue approaches/exceeds it. */
export const CEILING_DAMP_START_RATIO = 0.3; // damping begins once revenue/ceiling passes this
export const CEILING_DAMP_FLOOR = 0.15;

// ============================================================================
// Outcome buckets — what the words mean. Never adjust these to chase a
// target distribution; adjust the economy that produces the numbers instead.
// ============================================================================

export const BUCKETS = {
  RESPECTABLE_MIN: 100_000,
  GOOD_MIN: 2_000_000,
  LEGENDARY_MIN: 25_000_000,
} as const;

/** Career-level outcome buckets (Pass A — the CAREER_LENGTH_YEARS-year career) — bracket on
 * `personalCash` at the end of a whole career, NOT the same axis as BUCKETS
 * above (which still describes a single company's founderTakeHome). A
 * career can contain several companies, so these thresholds are naturally
 * higher: $250K respectable is "a working life," not "barely made it." */
export const CAREER_BUCKETS = {
  FAILED_MAX: 250_000,
  GOOD_MIN: 5_000_000,
  LEGENDARY_MIN: 50_000_000,
} as const;

// ============================================================================
// Turn rhythm (carried over from the previous pass, not part of the new
// growth model but still tunable game-feel numbers, so they live here too)
// ============================================================================

export const QUIET_AFTER_DRAMA_PCT = 40; // chance next year is a deliberate breather after a gamble/decline
export const COFOUNDER_GRANT_PCT = 60;
export const COFOUNDER_EQUITY_PCT = 15;
export const WEATHER_EVENT_FRACTION = 1 / 6; // roughly one event in six is tagged isWeather

/** Standing "stop here" retirement option (exits.ts's canRetire) requires
 * profitability AND this many years in. Tuned up from an initial 4: at 4,
 * the sensible heuristic — which has no reason to prefer growing over a
 * safe zero-downside exit once one exists — was retiring the moment it
 * became available, capping median career length around 5 regardless of
 * how much runway/growth tuning gave it. 10 gives the growth economy real
 * time to compound before "just stop" becomes an option at all.
 *
 * Tried pushing this to 13 during Pass A tuning, to fix the career-level
 * "zero exits in ~25% of careers" check (the standing option is available
 * every year once eligible, unlike a real sale/IPO offer, which only
 * competes for the year via a probability roll — see
 * EXIT.BASE_OFFER_CHANCE — so `sensible` was usually retiring itself
 * before a real offer arrived, making an actual sale/IPO much rarer
 * across a career than "ended some way that wasn't failure"). Reverted:
 * it also gives strong trajectories three more years to compound before
 * the easy exit exists, which pushed tier-5 legendary from ~4% to over
 * 10% — a straight trade of one acceptance check for a worse failure on
 * another. Left as a known-open gap rather than force-fit; see
 * simulate.ts's report. */
export const STANDING_RETIREMENT_MIN_YEAR = 10;

/** Once eligible (canRetire / canActOnPublicStake / canResignPublic), the
 * standing "stop here" / "sell shares" / "resign" options don't staple
 * themselves onto literally every remaining event for the rest of the
 * run. Two layers keep it rare and irregular rather than a steady drumbeat:
 * each eligible year rolls against this (low) chance at all — turn.ts skips
 * the roll entirely while state.year < state.nextStandingOptionYear — and
 * every time the option actually surfaces, turn.ts draws a fresh random
 * cooldown (STANDING_OPTION_COOLDOWN_MIN/MAX_YEARS below) before it's
 * allowed to surface again. The cooldown only kicks in after a first
 * appearance (state.nextStandingOptionYear starts at 0), so that first
 * offer is governed purely by this chance; every one after it is spaced out
 * by a randomized gap on top, which is what keeps the *pattern* — not just
 * the frequency — from reading as mechanical. */
export const STANDING_OPTION_SHOW_CHANCE = 0.1;

/** Randomized gap (in years) enforced after a standing option actually
 * surfaces, before turn.ts will roll for it again — see
 * STANDING_OPTION_SHOW_CHANCE above. */
export const STANDING_OPTION_COOLDOWN_MIN_YEARS = 4;
export const STANDING_OPTION_COOLDOWN_MAX_YEARS = 8;

/** Retirement liquidation value = cash + annualRevenue * this. Tuned down
 * from 2.0: retirement is the dominant exit path once STANDING_RETIREMENT_MIN_YEAR
 * is reached (most careers get there before a real acquisition/IPO offer
 * arrives), and at 2.0 it was pricing a "quietly stop" ending as generously
 * as a real sale for most careers — 62% of sensible careers landed in the
 * "good" bucket (target 17%) purely from retiring on schedule, not from
 * anything dramatic happening. 1.0 keeps retirement a real, positive
 * outcome without it outcompeting an actual exit on the results card. */
export const RETIREMENT_REVENUE_MULTIPLE = 1.0;
