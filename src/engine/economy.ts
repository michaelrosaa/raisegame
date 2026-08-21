/**
 * The growth economy: revenue growth, staffing, burn, cash, and the
 * (unchanged) funding-round/liquidation math. Every tunable number here
 * comes from constants.ts — this file has the formulas, not the dials.
 */

import type { Character, Climate, CountryData, FundingOffer, GameState, FundingStage, Idea, Loan, PublicCompanyState } from './types';
import {
  canonicalIndustry,
  CLIMATE_VALUATION,
  CLIMATE_GROWTH,
  LOAN,
  LOAN_CLIMATE_ADJUSTMENT,
  PUBLIC_MARKET,
  PUBLIC_MARKET_LUCK_SIGMA,
  ECONOMY,
  LUCK,
  STAFF,
  REVENUE_PER_HEAD,
  INDUSTRY,
  CEILING_DAMP_START_RATIO,
  CEILING_DAMP_FLOOR,
  IDEA_CEILING_BY_UPSIDE,
  IDEA_CEILING_DEFAULT,
  IDEA_CEILING_SIGMA,
  RETIREMENT_REVENUE_MULTIPLE,
  MARKET_WEALTH_STAFFING_FLOOR,
  MARKET_WEALTH_GROWTH_FACTOR_MIN,
  MARKET_WEALTH_GROWTH_FACTOR_RANGE,
  MARKET_WEALTH_CEILING_FLOOR,
  MARKET_WEALTH_CEILING_RANGE,
  TALENT_FACTOR_MIN,
  TALENT_FACTOR_RANGE,
  BUREAUCRACY_DRAG_YEARS,
  BUREAUCRACY_DRAG_COEF,
  INFRASTRUCTURE_DISRUPTION_MAX_CHANCE,
  INFRASTRUCTURE_DISRUPTION_GROWTH_FACTOR,
  STARTING_CASH_RUNWAY_MULTIPLE,
} from './constants';
// Read the content file directly (not via state.ts's COUNTRIES) — state.ts
// itself imports startingCashFor/monthlyBurn from this module, so going
// through state.ts here would be a circular import.
import countriesContent from '../content/countries.json';

const COUNTRY_BY_CODE: Record<string, CountryData> = Object.fromEntries(
  (countriesContent as CountryData[]).map((c) => [c.code, c])
);

/** A generic mid-tier profile — used only for a hand-typed "somewhere new"
 * country from the setup screen's search fallback, which has no real data
 * behind it. Mirrors the old '?? mid' fallback behaviour. */
const FALLBACK_COUNTRY: CountryData = {
  code: '__fallback__',
  name: 'Somewhere new',
  note: '',
  tier: 3,
  costPerHead: 32_000,
  founderCost: 18_000,
  startingCash: 22_000,
  marketWealth: 0.25,
  fundingAvailability: 0.22,
  exitMarket: 0.22,
  talentPool: 0.55,
  currencyRisk: 0.22,
  bureaucracy: 0.65,
  infrastructure: 0.6,
};

export function countryFor(countryCode: string): CountryData {
  return COUNTRY_BY_CODE[countryCode] ?? FALLBACK_COUNTRY;
}

/** ±15% at reputation 0/100, 1.0 (no-op) at the neutral default of 50 — a
 * good exit behind a founder should make the next raise a bit easier, but
 * this is deliberately small (see the design doc's "reputation → funding,
 * lightly"), not a rebalance of the whole funding model. */
function reputationFundingMultiplier(reputation: number): number {
  return 1 + clamp((reputation - 50) * 0.003, -0.15, 0.15);
}

/** Chance a funding-round event/option is even allowed to appear this year
 * — country fundingAvailability × the overall macro climate × a small
 * reputation nudge × glamour, capped at 1. Shared by turn.ts's yearly draw
 * gate and the Year One funding choice (see events.ts's
 * applyFundingGateToEvent), so "can this country get funded at all right
 * now" is answered the same way everywhere. `reputation`/`glamour` default
 * to neutral (50 / 0.5) so every call site that predates the career system
 * or the glamour field (the harness, first-company setup) behaves exactly
 * as before. */
export function fundingGateChance(country: CountryData, climate: Climate, reputation: number = 50, glamour: number = 0.5): number {
  return Math.min(1, country.fundingAvailability * CLIMATE_GROWTH[climate] * reputationFundingMultiplier(reputation) * glamourFundingChanceFactor(glamour));
}

// ============================================================================
// Glamour (content pack 4) — a second axis alongside industry: how much
// outside attention a business attracts, independent of how good it
// actually is. Company.glamour is copied once at founding from the chosen
// Idea's own `glamour` (ui/screens/setup.tsx and foundCompany.tsx); every
// factor below reads it back off GameState so a single number governs the
// whole "flashy but risky vs. boring but reliable" trade documented in the
// content pack: funding shows up more, valuations run higher, outcomes
// swing wider, and failure is more common — or the mirror image for a
// deliberately unglamorous business. Each factor is centered so glamour=0.5
// (the default for any idea that predates this field) is a no-op.
// ============================================================================

export function glamourOf(state: GameState): number {
  return state.company.glamour ?? 0.5;
}

/** "Investors rarely interested" (glamour 0) to "funding offers appear far
 * more often" (glamour 1): 0.6x-1.4x. */
export function glamourFundingChanceFactor(glamour: number): number {
  return 0.6 + 0.8 * glamour;
}

/** "Modest valuations" to "higher valuations at every round": 0.75x-1.35x. */
export function glamourValuationFactor(glamour: number): number {
  return 0.75 + 0.6 * glamour;
}

/** "Narrow, predictable outcomes" to "wider outcome variance — bigger tail
 * both ways": scales the luck roll's sigma, 0.6x-1.4x. */
export function glamourVarianceFactor(glamour: number): number {
  return 0.6 + 0.8 * glamour;
}

/** "Higher failure rate" for glamour, a break for a boring business —
 * additive on top of ECONOMY.CHURN, +/-0.06 at the extremes. */
export function glamourChurnBonus(glamour: number): number {
  return (glamour - 0.5) * 0.12;
}

/** "Better acquisition multiples if you survive" (glamour) vs. "reliable
 * cashflow, capped ceiling" (boring): 0.85x-1.15x on the drawn exit
 * multiple. */
export function glamourExitMultipleFactor(glamour: number): number {
  return 0.85 + 0.3 * glamour;
}

import type { Rng } from './rng';
import { luckRoll, gaussian } from './rng';

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// ============================================================================
// Growth
// ============================================================================

/**
 * The single most important function in the game. Called once per year,
 * before any event fires — see turn.ts. Every factor here multiplies
 * together; CHURN is the only thing subtracted, and only at the end, so a
 * terrible luck roll can still shrink the business rather than merely
 * slow it down.
 *
 * Thin wrapper over computeGrowthDetailed, which also exposes the raw luck
 * value (used by turn.ts's §11 narrative-cause note) without drawing the
 * RNG a second time — determinism requires the luck roll happen exactly
 * once per year regardless of who wants to read it.
 */
export function computeGrowth(state: GameState, rng: Rng): number {
  return computeGrowthDetailed(state, rng).growth;
}

export function computeGrowthDetailed(state: GameState, rng: Rng): { growth: number; luck: number } {
  // A growthSet effect overrides the whole computation outright, once,
  // and skips the luck roll entirely — that's the point of forcing a value.
  if (state.forcedGrowthOverride !== null) {
    return { growth: clamp(state.forcedGrowthOverride, ECONOMY.MIN_GROWTH, ECONOMY.MAX_GROWTH), luck: 1 };
  }

  const r = Math.max(state.annualRevenue, 1);
  const country = countryFor(state.founder.country);

  // 1. Deceleration with scale. Never exceeds 1.0.
  const maturity = 1 / (1 + Math.log10(Math.max(r, ECONOMY.MATURITY_PIVOT) / ECONOMY.MATURITY_PIVOT));

  // 2. Staffing adequacy.
  const expected = expectedStaffFor(r, state.company.industry, country.marketWealth);
  const ratio = state.staff / Math.max(expected, 0.25);
  const staffFactor = 0.5 + 0.5 * Math.min(ratio, 1.5);

  // 3. Morale.
  const moraleFactor = 0.7 + 0.006 * state.morale;

  // 4. Climate.
  const climateFactor = CLIMATE_GROWTH[state.climate];

  // 5. Industry temperament.
  const industryFactor = INDUSTRY[canonicalIndustry(state.company.industry)].growthFactor;

  // 6. Active event multipliers, stacked and capped.
  const eventMultiplier = Math.min(activeGrowthMultiplier(state), ECONOMY.MAX_YEAR_MULTIPLIER);

  // 7. THE LUCK ROLL — the single most important line in the game. A
  // glamorous business swings harder both ways (glamourVarianceFactor);
  // a boring one is steadier.
  const luck = luckRoll(rng, LUCK.SIGMA * glamourVarianceFactor(glamourOf(state)));

  // 8. The hidden ceiling on this idea (already scaled by market wealth at
  // draw time — see drawIdeaCeiling).
  const ceiling = ceilingDamp(r, state.company.ideaCeiling);

  // 9. Market wealth — a thin market grows slower even before the ceiling
  // bites (the ceiling is the dominant effect; this shapes the early years).
  const marketFactor = MARKET_WEALTH_GROWTH_FACTOR_MIN + MARKET_WEALTH_GROWTH_FACTOR_RANGE * country.marketWealth;

  // 10. Talent pool — thin local talent slows compounding structurally.
  const talentFactor = TALENT_FACTOR_MIN + TALENT_FACTOR_RANGE * country.talentPool;

  // 11. Bureaucracy — a drag on the fragile early years only.
  const bureaucracyFactor = state.year <= BUREAUCRACY_DRAG_YEARS ? 1 - country.bureaucracy * BUREAUCRACY_DRAG_COEF : 1;

  // 12. Infrastructure — thin infrastructure means an occasional disruptive
  // year (power, logistics, connectivity), rolled every year so the RNG
  // cursor stays deterministic regardless of country.
  const infraRoll = rng.next();
  const infraFactor = infraRoll < (1 - country.infrastructure) * INFRASTRUCTURE_DISRUPTION_MAX_CHANCE ? INFRASTRUCTURE_DISRUPTION_GROWTH_FACTOR : 1;

  const gross =
    ECONOMY.BASE_GROWTH *
    maturity *
    staffFactor *
    moraleFactor *
    climateFactor *
    industryFactor *
    eventMultiplier *
    luck *
    ceiling *
    marketFactor *
    talentFactor *
    bureaucracyFactor *
    infraFactor;

  // A glamorous business burns hotter (higher failure rate); a boring one
  // gets a small break — see glamourChurnBonus.
  const net = gross - (ECONOMY.CHURN + glamourChurnBonus(glamourOf(state)));

  return { growth: clamp(net, ECONOMY.MIN_GROWTH, ECONOMY.MAX_GROWTH), luck };
}

/** Product of every unexpired growthMultiplier effect, capped at
 * ECONOMY.MAX_YEAR_MULTIPLIER. Expired modifiers are pruned separately
 * (see effects.ts's pruneExpiredModifiers) — this just multiplies whatever
 * is left. */
export function activeGrowthMultiplier(state: GameState): number {
  const product = state.growthModifiers.reduce((acc, m) => acc * m.value, 1);
  return Math.min(product, ECONOMY.MAX_YEAR_MULTIPLIER);
}

/**
 * 1.0 while revenue is comfortably below the idea's hidden ceiling, ramping
 * down to CEILING_DAMP_FLOOR as revenue approaches or passes it. Some
 * businesses are quietly capped at $2M and some at $200M — the setup
 * screen's "COULD GET: Huge" is the advertised potential, never a promise.
 */
export function ceilingDamp(revenue: number, ceiling: number): number {
  if (ceiling <= 0) return CEILING_DAMP_FLOOR;
  const ratio = revenue / ceiling;
  if (ratio <= CEILING_DAMP_START_RATIO) return 1.0;
  const t = Math.min(1, (ratio - CEILING_DAMP_START_RATIO) / (1 - CEILING_DAMP_START_RATIO));
  return Math.max(CEILING_DAMP_FLOOR, 1 - (1 - CEILING_DAMP_FLOOR) * t);
}

// ============================================================================
// Staffing
// ============================================================================

/** revenuePerHead scales with market wealth — the same dollar of revenue
 * implies more staff to have earned it in a thin market, where each
 * customer pays less. Floored (MARKET_WEALTH_STAFFING_FLOOR) so a tier-1
 * country's very low marketWealth can't demand an absurd headcount. */
export function expectedStaffFor(revenue: number, industry: string, marketWealth: number = 1): number {
  const wealthFactor = Math.max(MARKET_WEALTH_STAFFING_FLOOR, marketWealth);
  return revenue / (REVENUE_PER_HEAD[canonicalIndustry(industry)] * wealthFactor);
}

/**
 * Staff grows automatically when there's cash and demand, and shrinks
 * under real cash pressure — this runs every year regardless of what
 * event fires. Events can still hire or fire explicitly on top of this
 * via a `staff` effect.
 */
export function updateStaff(state: GameState): number {
  const marketWealth = countryFor(state.founder.country).marketWealth;
  const target = Math.ceil(expectedStaffFor(state.annualRevenue, state.company.industry, marketWealth));
  const months = cashLastsMonths(state);

  if (months < STAFF.SHRINK_BELOW_CASH_MONTHS) {
    return Math.max(1, Math.floor(state.staff * (1 - STAFF.SHRINK_FRACTION)));
  }
  if (months > STAFF.HIRE_MIN_CASH_MONTHS && target > state.staff) {
    return state.staff + Math.ceil((target - state.staff) * STAFF.HIRE_GAP_FRACTION);
  }
  return state.staff;
}

// ============================================================================
// Burn and cash
// ============================================================================

/** Starting cash for a country: enough runway to get moving, not a
 * cushion — authored per-country in content/countries.json, scaled by
 * STARTING_CASH_RUNWAY_MULTIPLE. */
export function startingCashFor(countryCode: string): number {
  return Math.round(countryFor(countryCode).startingCash * STARTING_CASH_RUNWAY_MULTIPLE);
}

/** A small flat operating overhead — tools, a shared desk, basic ops —
 * separate from people costs. Kept minimal on purpose: survival should
 * depend on the growth/luck system, not on being quietly taxed to death
 * by a hidden constant. */
const FLAT_OVERHEAD_PER_YEAR = 6_000;

// ============================================================================
// Debt (Pass B) — see types.ts's Loan and constants.ts's LOAN for the
// shape/dials. Priced once at origination (computeLoanRate), then paid
// down at a fixed straight-line schedule every year (amortizeLoansForYear,
// called once per turn from turn.ts's advanceYear) — never repriced
// mid-loan, so a later change in reputation/climate doesn't retroactively
// change what an existing loan costs, only what a NEW one would.
// ============================================================================

/** 0 (tier-5-clean, frothy market) .. ~1 (tier-1, twice-bankrupt, frozen
 * market) — blends bureaucracy/currencyRisk, both of which already move
 * inversely with country tier (see constants.ts's country-economy notes),
 * into a single risk factor for the base rate. */
function countryRiskFactor(country: CountryData): number {
  return clamp((country.bureaucracy + country.currencyRisk) / 2, 0, 1);
}

/**
 * The annual rate a NEW loan would be priced at right now — a clean
 * first-time founder in a strong market borrows cheaply; a repeat-failure
 * founder in a weak, frozen market pays much more, matching the design
 * doc's "7% clean, 22% for a twice-bankrupt founder" example.
 */
export function computeLoanRate(state: GameState): number {
  const country = countryFor(state.founder.country);
  const base = LOAN.BASE_MIN + LOAN.BASE_RANGE * countryRiskFactor(country);
  const bankruptcyPenalty = LOAN.BANKRUPTCY_PENALTY * state.founderBankruptcies;
  const reputationDiscount = LOAN.REPUTATION_DISCOUNT_AT_100 * (state.founderReputation / 100);
  const climateAdjustment = LOAN_CLIMATE_ADJUSTMENT[state.climate];
  return clamp(base + bankruptcyPenalty - reputationDiscount + climateAdjustment, LOAN.MIN_RATE, LOAN.MAX_RATE);
}

/** "After two [bankruptcies], most lenders refuse" — content-authored loan
 * events gate on this via the `bankruptciesBelow` condition; exposed here
 * too for anywhere engine code wants the same answer without duplicating
 * the threshold. */
export function canGetLoan(state: GameState): boolean {
  return state.founderBankruptcies < LOAN.LOCKOUT_BANKRUPTCIES;
}

/** Straight-line: an equal slice of the original principal every year, plus
 * interest on whatever balance is still outstanding. Simpler than an
 * amortizing/annuity schedule (a fixed payment where the interest/principal
 * split shifts over time) and just as real a cost — chosen for this pass
 * because it's straightforward to reason about and to verify in the
 * harness, not because the annuity math would be hard. */
export function loanAnnualPayment(loan: Loan): number {
  const principalPayment = loan.principal / loan.termYears;
  const interestPayment = loan.balance * loan.annualRate;
  return principalPayment + interestPayment;
}

function totalLoanAnnualPayment(state: GameState): number {
  return state.loans.reduce((sum, l) => sum + loanAnnualPayment(l), 0);
}

function totalLoanMonthlyPayment(state: GameState): number {
  return totalLoanAnnualPayment(state) / 12;
}

/**
 * Pay down every loan's balance by one year's straight-line principal
 * slice, dropping any that are fully repaid. Called once per turn — see
 * turn.ts's advanceYear — AFTER that year's payment has already been
 * deducted from cash via monthlyBurn, so a loan's balance always reflects
 * "what's left after this year's payment," not "what's left before it."
 */
export function amortizeLoansForYear(state: GameState): GameState {
  if (state.loans.length === 0) return state;
  const loans = state.loans
    .map((loan) => ({ ...loan, balance: Math.max(0, loan.balance - loan.principal / loan.termYears) }))
    .filter((loan) => loan.balance > 0.01);
  return { ...state, loans };
}

/**
 * `founderCost` covers the founder's own living/ops costs; `costPerHead`
 * applies only to staff hired BEYOND the founder. Burn is deliberately the
 * least important lever on country difficulty — it's roughly proportional
 * across countries, and mostly cancels against thin local revenue per head
 * (see expectedStaffFor). The real difficulty gap is market wealth,
 * funding/exit access, and shock risk.
 *
 * Loan repayments (Pass B) fold in here too, not as a separate deduction
 * elsewhere — this is the one function cashLastsMonths, calculatePreMoneyValuation's
 * burnAdjustment, and the CASH LASTS header metric all already read, so a
 * loan's cost shows up everywhere burn already mattered without any of
 * them needing to know loans exist.
 */
export function monthlyBurn(state: GameState): number {
  const country = countryFor(state.founder.country);
  const people = country.founderCost + Math.max(0, state.staff - 1) * country.costPerHead;
  return (people + FLAT_OVERHEAD_PER_YEAR) / 12 - state.annualRevenue / 12 + totalLoanMonthlyPayment(state);
}

export function cashLastsMonths(state: GameState): number {
  const b = monthlyBurn(state);
  return b > 0 ? state.cash / b : Infinity;
}

// ============================================================================
// Funding rounds (unchanged mechanic — see types.ts EffectValue.fundingStage)
// ============================================================================

/**
 * Pre-money valuation for a funding round. Revenue- and staff-based, with
 * climate sensitivity now read from constants.ts's CLIMATE_VALUATION
 * (previously a separate, duplicate table in state.ts).
 */
export function calculatePreMoneyValuation(state: GameState): number {
  const climateMultiplier = CLIMATE_VALUATION[state.climate];

  const revenueMultiple = state.annualRevenue > 0 ? 3 + climateMultiplier : 0;
  const revenueBased = state.annualRevenue * revenueMultiple;

  const perStaffValue = 150_000 * climateMultiplier;
  const staffBased = state.staff * perStaffValue;

  const burnAdjustment = state.monthlyBurn < 0 ? 1.2 : 0.9;
  const burn12Month = state.monthlyBurn * 12;
  const burnDeduction = Math.max(0, -burn12Month * 2);

  return Math.max(50_000, (revenueBased + staffBased - burnDeduction) * burnAdjustment);
}

function stageCeilingValuation(stage: FundingStage, baseValuation: number): number {
  const ceilings: Record<FundingStage, number> = {
    idea: baseValuation * 0.5,
    seed: baseValuation * 1,
    seriesA: baseValuation * 2,
    seriesB: baseValuation * 4,
    seriesC: baseValuation * 8,
    seriesD: baseValuation * 15,
    lateStage: baseValuation * 30,
  };
  return ceilings[stage];
}

/**
 * Resolve a content-authored funding reference (characterId + stage) into a
 * fully-priced FundingOffer. Content never writes a dollar figure — it
 * would go stale against climate/state the moment either changed.
 *
 * `state.founderReputation` (default 50, neutral) nudges the valuation a
 * founder's reputation buys — same equity given up, more cash for a
 * founder with a good exit behind them. See reputationFundingMultiplier.
 */
export function computeFundingOffer(state: GameState, stage: FundingStage, lead: Character, targetDilutionPct: number = 15): FundingOffer {
  const baseValuation = calculatePreMoneyValuation(state);
  const postMoneyValuation =
    Math.max(stageCeilingValuation(stage, baseValuation), 200_000) *
    reputationFundingMultiplier(state.founderReputation) *
    glamourValuationFactor(glamourOf(state));
  const amount = Math.round(postMoneyValuation * (targetDilutionPct / 100));

  return {
    id: `funding-${stage}-${state.year}-${lead.id}`,
    stage,
    amount,
    postMoneyValuation,
    lead,
    descriptionTemplate: '{lead} invests {amount} at this round.',
  };
}

/** What a founder walks away with by choosing to stop rather than sell or
 * list — cash on hand plus a rough multiple of trailing revenue. Retirement
 * pricing is deliberately NOT part of the seeded exit-multiple system (see
 * exits.ts §8.3) — it's the one exit the founder fully controls the timing
 * of, so it stays a plain, predictable formula. */
export function calculateLiquidationValue(state: GameState): number {
  return state.cash + state.annualRevenue * RETIREMENT_REVENUE_MULTIPLE;
}

export function isProfitable(state: GameState): boolean {
  return state.monthlyBurn < 0;
}

// ============================================================================
// Public company (Pass D) — sharePrice/sharesOutstanding are the only
// stored numbers; everything else derives from them, single source of
// truth, same as every other priced thing in this engine.
// ============================================================================

export function marketCapFor(pc: PublicCompanyState): number {
  return pc.sharePrice * pc.sharesOutstanding;
}

/** What the founder's current stake is worth AT THE CURRENT SHARE PRICE —
 * "paper wealth," not personalCash. Distinct from founderLiquidCash, which
 * is money already actually sold and banked. */
export function founderWorthOnPaper(state: GameState): number {
  if (!state.publicCompany) return 0;
  return marketCapFor(state.publicCompany) * (getFounderShareFrom(state) / 100);
}

// getFounderShare already lives in state.ts, which imports FROM this file
// (monthlyBurn/startingCashFor) — importing it back here would be
// circular, so this is a tiny, self-contained duplicate of exactly the one
// line it needs (find the 'You' capTable entry), not a re-export.
function getFounderShareFrom(state: GameState): number {
  return state.capTable.find((e) => e.holder === 'You')?.percentage ?? 0;
}

/**
 * Moves the share price by one year — growth (reusing the SAME growth
 * figure this year's revenue tick already computed, not a second roll),
 * analyst sentiment, and a wide independent luck roll: "public markets
 * swing on things that have nothing to do with you." Called once per turn
 * (turn.ts's advanceYear), after that year's growth/revenue tick, before
 * anything else public-company-specific happens.
 */
export function updateSharePrice(state: GameState, growth: number, rng: Rng): GameState {
  if (!state.publicCompany) return state;
  const pc = state.publicCompany;
  const sentimentFactor = 0.85 + 0.3 * (pc.analystSentiment / 100); // 0.85 - 1.15
  const growthFactor = clamp(1 + growth * 0.5, 0.5, 2);
  const luck = luckRoll(rng, PUBLIC_MARKET_LUCK_SIGMA);
  const rawNextPrice = Math.max(0.01, pc.sharePrice * growthFactor * sentimentFactor * luck);
  // A share-price random walk has no natural ceiling — compounded over
  // many years public, it can drift arbitrarily far from what the company
  // actually makes (see PUBLIC_MARKET.MAX_MARKET_CAP_REVENUE_MULTIPLE's
  // comment). Clamp market cap back to a generous-but-real multiple of
  // THIS year's actual revenue every year, so a lucky run can still make
  // the stock genuinely soar without the payout becoming nonsensical.
  const maxMarketCap = Math.max(state.annualRevenue, 1) * PUBLIC_MARKET.MAX_MARKET_CAP_REVENUE_MULTIPLE;
  const maxPrice = maxMarketCap / pc.sharesOutstanding;
  const nextPrice = Math.min(rawNextPrice, maxPrice);
  return { ...state, publicCompany: { ...pc, sharePrice: nextPrice } };
}

// ============================================================================
// Idea ceiling (§8.1) — drawn once at setup, never shown to the player.
// ============================================================================

/** The idea's typical dramatic ceiling (from its upside band) with
 * log-normal noise — some businesses are quietly capped at $2M, some at
 * $200M, and the player never finds out which until they hit it. */
/**
 * `marketWealth` scales the ceiling itself (default 1 = no scaling, for any
 * caller that predates country-aware ceilings). This is the main reason a
 * frontier-market founder's realistic best case is "profitable small
 * business" rather than "large exit" — the business genuinely cannot get as
 * big in dollar terms, not just that it grows slower on the way there.
 */
export function drawIdeaCeiling(idea: Idea, rng: Rng, marketWealth: number = 1): number {
  const base = IDEA_CEILING_BY_UPSIDE[idea.upside] ?? IDEA_CEILING_DEFAULT;
  const ceilingFactor = MARKET_WEALTH_CEILING_FLOOR + MARKET_WEALTH_CEILING_RANGE * marketWealth;
  return base * Math.exp(gaussian(rng, 0, IDEA_CEILING_SIGMA)) * ceilingFactor;
}
