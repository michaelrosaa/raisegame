/**
 * The CAREER_LENGTH_YEARS-year career — the layer above GameState. A
 * GameState is "how one company's year plays out" (turn.ts/game.ts,
 * untouched); this file is "which company, if any, is running in a given
 * career year, and what the founder personally has." See the design docs
 * (raise-25-year-career.md, raise-ipo-and-between-years.md) and the
 * approved Pass A plan.
 *
 * Two clocks: GameState.year is always 1-indexed from THAT company's own
 * founding (every existing event condition/ledger keys off it, untouched).
 * CareerState.careerYear is the absolute 1..CAREER_LENGTH_YEARS clock, bumped exactly once
 * per decision — either a company-year advancing (see advanceCareerYear's
 * call site in App.tsx, right where GameState.year itself increments) or a
 * between-year action being taken. Founding a company (the first one, or a
 * re-founding here) never bumps it directly — founding claims the CURRENT
 * career-year slot, the same way the original single-company game's setup
 * flow claims game-year-1 without a separate increment.
 */

import type { CareerState, CompanyRecord, CompanyOutcome, AngelInvestment, BetweenYearOption, Company, Founder, GameState, Gender, Heir, Idea, CharacterTemplate } from './types';
import type { RNG } from './rng';
import { generateSeed } from './rng';
import { createGameState, applyEffects } from './state';
import { startingCashFor } from './economy';
import { initializeMacroPhase } from './macro';
import { castFoundingCrew, generatePortraitSeed } from './cast';
import { resolveRunResults } from './endings';
import { computeEarnedAwards } from './awards';
import { buildFailureDetail } from './failure';
import { formatMoney } from './format';
import { calendarYearFor } from './present';
import { HEIR, CAREER_LENGTH_YEARS, CALENDAR_YEAR_AT_FOUNDING } from './constants';

export { CAREER_LENGTH_YEARS };

const REPUTATION_MIN = 0;
const REPUTATION_MAX = 100;
function clampReputation(v: number): number {
  return Math.max(REPUTATION_MIN, Math.min(REPUTATION_MAX, v));
}

// ============================================================================
// Creating a career / founding a company
// ============================================================================

export function createCareerState(
  seed: string,
  founder: Founder,
  generation: number = 1,
  dynastyWealth: number = 0,
  foundedCalendarYear: number = CALENDAR_YEAR_AT_FOUNDING
): CareerState {
  return {
    seed,
    careerYear: 1,
    foundedCalendarYear,
    founder,
    generation,
    dynastyWealth,
    hasFamily: false,
    familyYear: null,
    heir: null,
    personalCash: 0,
    reputation: 50,
    bankruptcies: 0,
    exits: 0,
    companies: [],
    current: null,
    currentCapitalPutIn: 0,
    pendingAngelInvestments: [],
    nextIdeaDrawBoost: null,
    awards: [],
    retiredEarly: false,
    status: 'active',
  };
}

/** The baseline a fresh business in this idea's band is expected to need —
 * reuses the idea's own authored `moneyNeeded`, so re-founding needs no new
 * content. */
export function expectedCapitalFor(idea: Idea): number {
  return idea.moneyNeeded;
}

// idea.moneyNeeded ($25K-$150K across content) is what the IDEA costs to get
// off the ground, not a realistic scale for "founding capital" — a founder
// with even one modest exit behind them can clear 10-100x that trivially,
// which would saturate any bonus keyed off it on nearly every re-founding
// regardless of how big the exit actually was. startingCashFor(countryId) —
// the same figure a brand-new founder's own starting cash is drawn from —
// is the right yardstick for "a lot more than normal" instead.
const RECOMMENDED_CAPITAL_MONEY_NEEDED_MULTIPLE = 6;
const RECOMMENDED_CAPITAL_COUNTRY_BUDGET_FRACTION = 0.8;

/** Tailored per idea (and country, and glamour), not a flat number — the
 * re-founding screen's "Recommended" quick-select. Scales with what THIS
 * idea actually costs to run (expectedCapitalFor), with the country's
 * normal founding budget as a floor for cheap ideas, then nudged by
 * glamour: a flashy idea rewards going bigger (funding chance/valuation
 * both read glamour — see economy.ts), a boring one doesn't need as much
 * to work. isWellFunded below is deliberately defined AS A MULTIPLE OF
 * THIS figure rather than off a separate basis — clicking "Recommended"
 * must never itself trigger the "that's a lot of money" callout, which
 * happened when the two were computed independently (idea-cost-and-
 * glamour-aware vs. flat country-only) and could disagree for anything
 * but a cheap idea in a rich country. */
export function recommendedCapitalFor(idea: Idea, countryId: string): number {
  const glamourFactor = 0.7 + 0.6 * (idea.glamour ?? 0.5);
  return Math.round(
    Math.max(expectedCapitalFor(idea) * RECOMMENDED_CAPITAL_MONEY_NEEDED_MULTIPLE, startingCashFor(countryId) * RECOMMENDED_CAPITAL_COUNTRY_BUDGET_FRACTION) *
      glamourFactor
  );
}

const CAPITAL_CALLOUT_MULTIPLE = 1.75; // the re-founding screen's "heads up" info line lights up this
// far over the RECOMMENDED amount (not a flat country budget — see recommendedCapitalFor above), so
// the callout and the recommendation can never contradict each other. The growth bonus below starts
// earlier still, continuously from 1x normal founding budget, so a player can already be inside the
// bonus — and even past the recommended amount — before this callout appears at all.
const CAPITAL_BONUS_GROWTH_YEARS = 4;
// Raised from an initial 0.05/0.5 on an explicit "the more money I put in, the easier it should be
// — skyrocketing way faster" product call. A first-ever company never gets this bonus at all (no
// personal capital choice exists yet — it's always exactly the country's normal budget), so the
// asymmetry the request is actually describing — hard the first time, snowballs once there's real
// money to deploy — comes from company 2+ being ABLE to clear this multiplier, not from company 1
// being made harder on its own (constants.ts's ECONOMY.CHURN already does that generally).
const CAPITAL_BONUS_PER_MULTIPLE = 0.1; // +10% growth per multiple of a normal founding budget
// committed, above 1x
const CAPITAL_BONUS_MAX = 1.2; // cap: growth rate can at most 2.2x, however large the war chest

/** Whether a chosen `capitalPutIn` clears the "that's a lot of money" line
 * — exported so the re-founding screen can show the player the same
 * heads-up `foundCompany` reads to decide whether it's worth calling out
 * explicitly (the growth bonus itself, below, doesn't wait for this).
 * Defined as a multiple of recommendedCapitalFor's own figure (not a
 * separate, idea-blind calculation) specifically so the Recommended button
 * can never itself trigger this callout. */
export function isWellFunded(capitalPutIn: number, idea: Idea, countryId: string): boolean {
  return capitalPutIn > recommendedCapitalFor(idea, countryId) * CAPITAL_CALLOUT_MULTIPLE;
}

/** More of the founder's own capital in at founding means more resources
 * to deploy — hiring ahead of need, marketing before it's strictly
 * required, a longer runway to get the product right. A company funded
 * well past a normal founding budget grows faster for it, not slower:
 * every multiple of that normal budget committed above 1x adds more
 * growth. Still capped (CAPITAL_BONUS_MAX) rather than unbounded — an
 * earlier, steeper, idea-cost-relative version of this bonus (no cap
 * worth mentioning, scaled off idea.moneyNeeded instead of a country's
 * normal budget) pushed tier-5 legendary from ~8% to over 20% in the
 * harness, so the scale here is deliberate even though it was raised
 * again afterward on an explicit "make it snowball harder" request — see
 * simulate.ts's report for where that number actually lands. Same
 * function, same call site, for a re-founded company (career.ts's
 * foundCompany) and a successor's first company after a handover
 * (App.tsx's handleHandOver routes through the identical foundCompany
 * flow) — a big war chest works the same way for either. */
function applyCapitalDeploymentBonus(state: GameState, countryId: string, capitalPutIn: number): GameState {
  const normalBudget = startingCashFor(countryId);
  if (normalBudget <= 0 || capitalPutIn <= normalBudget) return state;
  const multiple = capitalPutIn / normalBudget;
  const bonus = Math.min(CAPITAL_BONUS_MAX, (multiple - 1) * CAPITAL_BONUS_PER_MULTIPLE);
  return applyEffects(state, [{ type: 'growthMultiplier', value: 1 + bonus, years: CAPITAL_BONUS_GROWTH_YEARS }]);
}

/** Even a founder with $0 personal cash left can always found something —
 * smaller than a first-timer's runway, but real. Satisfies the design
 * doc's "a career should never become unplayable" floor without needing
 * the debt mechanic (Pass B): this is a subsidy on top of whatever the
 * player actually commits, not a loan against future earnings. */
const FOUNDING_FLOOR_FRACTION = 0.4;

/**
 * Found company 2+ of a career. (The very first company of a career skips
 * this entirely — it goes through the original SetupScreen -> createGameState
 * flow, since there's no personal cash yet to choose an amount from; see
 * App.tsx's handleSetupComplete.)
 */
export function foundCompany(
  career: CareerState,
  company: Company,
  countryId: string,
  idea: Idea,
  capitalPutIn: number,
  rng: RNG,
  characterPool: CharacterTemplate[]
): CareerState {
  const committed = Math.max(0, Math.min(Math.round(capitalPutIn), Math.round(career.personalCash)));
  const foundingCash = Math.max(committed, Math.round(startingCashFor(countryId) * FOUNDING_FLOOR_FRACTION));
  // Put in nothing, or not even enough to cover what this idea itself
  // needs — this founder still needs somebody else's money to get going,
  // same as a first-timer. App.tsx's beginCompanyTurn reads this to bring
  // back the real "how will you pay for year one" choice instead of the
  // no-funding-needed refounding event.
  const startedWithLittleCapital = committed < expectedCapitalFor(idea);

  let state = createGameState(
    career.seed,
    career.founder,
    company,
    countryId,
    { moneyNeeded: idea.moneyNeeded, industry: idea.industry },
    foundingCash,
    career.reputation,
    career.bankruptcies,
    career.generation,
    career.hasFamily,
    calendarYearFor(career.foundedCalendarYear, career.careerYear),
    career.careerYear,
    startedWithLittleCapital
  );
  state = { ...state, status: 'running' };
  state = initializeMacroPhase(state, rng);
  state = applyCapitalDeploymentBonus(state, countryId, committed);
  state = castFoundingCrew(state, rng, characterPool);

  return {
    ...career,
    personalCash: career.personalCash - committed,
    current: state,
    currentCapitalPutIn: committed,
    nextIdeaDrawBoost: null,
  };
}

// ============================================================================
// Ending a company — the single chokepoint every ending path (sale, IPO,
// failure, insolvency, event-pool exhaustion, or the player's own "retire
// now" button) converges on, since all of them already leave GameState at
// status:'ended' before this is called.
// ============================================================================

const REPUTATION_GAIN_PER_PROCEEDS = 2_000_000; // roughly +1 reputation per $2M taken home, floored/capped below

export function endCurrentCompany(career: CareerState, endedState: GameState): CareerState {
  const results = resolveRunResults(endedState);
  // On failure the company's debts don't follow the founder — same rule as
  // the lost capitalPutIn (design doc §6: "the company's debts don't
  // follow you, but its money is gone"). On a real payout, any outstanding
  // loan balance comes off the top before the rest lands in personalCash;
  // this is a deliberate simplification over netting debt into the actual
  // sale-price/valuation formulas in exits.ts, which stay untouched.
  const outstandingDebt = endedState.loans.reduce((sum, l) => sum + l.balance, 0);
  // Money already raised by selling public shares (Pass D) is the
  // founder's own, already banked — it survives even a later failure; a
  // subsequent collapse doesn't un-sell shares sold years earlier.
  const rawProceeds = Math.max(0, results.founderTakeHome - outstandingDebt) + endedState.founderLiquidCash;
  // A sale that nets the founder nothing — debt (or, on the insolvency
  // rescue's distressed-sale option, a harsh discount plus whatever debt
  // already existed) ate the entire payout — reads as a failure from
  // where the founder is standing, not a successful exit, whatever the
  // event that ended it called itself. A real payout, however small,
  // still counts as a sale.
  const soldForNothing = results.endingType === 'sale' && rawProceeds <= 0;
  const isFailure = results.endingType === 'failure' || soldForNothing;
  const proceeds = isFailure ? 0 : rawProceeds;
  // 'ipo' never appears here (Pass D: going public isn't a terminal ending
  // any more — see types.ts's EndingType comment); 'exitedPublic' falls
  // through to 'retired' below, which is the right bucket for it — a
  // resignation or board removal is a walk-away, not someone else buying
  // the whole company.
  const outcome: CompanyOutcome = isFailure ? 'failed' : results.endingType === 'sale' ? 'sold' : 'retired';

  const record: CompanyRecord = {
    name: endedState.company.name,
    industry: endedState.company.industry,
    colour: endedState.company.colour,
    // yearFounded stays correct even when career.careerYear has ticked past
    // CAREER_LENGTH_YEARS (turn.ts's advanceYear always processes one more
    // company-year before the career-length check downstream in
    // App.tsx's handleAdvance ever sees it — the one case this matters is a
    // company that ends in the exact same advance the career clock also
    // runs out in) — the +1 overshoot appears in both career.careerYear and
    // endedState.year and cancels out in the subtraction. yearEnded doesn't
    // get that same cancellation (nothing subtracts from it), so it's
    // clamped directly — a career record should never claim a year beyond
    // the 50 that exist. See summarizeCareer's yearsSpentBuildingFor and
    // results.tsx's buildSegments for the other two places this same
    // overshoot has to be capped.
    yearFounded: career.careerYear - (endedState.year - 1),
    yearEnded: Math.min(career.careerYear, CAREER_LENGTH_YEARS),
    outcome,
    capitalPutIn: career.currentCapitalPutIn,
    proceeds,
    founderSharePctAtEnd: results.founderFinalShare,
    tookLoan: endedState.everTookLoan,
    dramaticHeadline: results.dramaticHeadline,
    hadGamble: endedState.history.some((h) => h.gambleResult),
    failure: isFailure ? buildFailureDetail(endedState, career.currentCapitalPutIn) : undefined,
  };

  const reputationDelta = isFailure ? -(record.failure!.reputationHit) : Math.min(15, Math.max(2, Math.round(proceeds / REPUTATION_GAIN_PER_PROCEEDS)));

  // Per-company awards (never-diluted, unicorn, went-public, ...) are
  // evaluated once, right here, against the full endedState/results this
  // company actually produced — a CompanyRecord alone doesn't retain
  // enough to re-derive them later. See CareerState.awards's own comment.
  const earnedThisCompany = computeEarnedAwards(endedState, results);

  // "Exit" means someone else bought it (sold, private or public — see
  // career.ts's own outcome-mapping comment above) — the design doc ties
  // exits+=1 specifically to acquisition/IPO, not to the player's own
  // solo wind-down (this codebase's per-company "retire now"/resign
  // button, outcome 'retired'). That one still pays out into
  // personalCash — it's real money — it just isn't what the "at least one
  // exit" stat is asking about, which is specifically "has this founder
  // actually sold something," not "did a company end without failing."
  // (canRetireCareer, below, used to key off this too — it no longer does.)
  const isRealExit = outcome === 'sold';

  return {
    ...career,
    companies: [...career.companies, record],
    personalCash: career.personalCash + proceeds,
    reputation: clampReputation(career.reputation + reputationDelta),
    bankruptcies: career.bankruptcies + (isFailure ? 1 : 0),
    exits: career.exits + (isRealExit ? 1 : 0),
    awards: Array.from(new Set([...career.awards, ...earnedThisCompany])),
    current: null,
    currentCapitalPutIn: 0,
  };
}

// ============================================================================
// The absolute clock
// ============================================================================

/** Bump the career year exactly once — call this, and only this, wherever
 * a company-year actually advances (turn.ts's advanceYear) or a
 * between-year action is taken. Ages the founder by one year alongside it
 * (turn.ts separately ages the currently-running company's own GameState
 * copy of the founder in lockstep — the two are redundant but never
 * diverge, since both fire exactly once per real year a company is
 * active). Resolves any angel investments maturing this year and flips
 * the career to 'ended' once the clock passes 25, regardless of what's
 * happening with `current` at that moment (the plan's "career continues
 * to year 25 regardless"). */
export function advanceCareerYear(career: CareerState): CareerState {
  const nextYear = career.careerYear + 1;
  const maturing = career.pendingAngelInvestments.filter((a) => a.matureYear <= nextYear);
  const stillPending = career.pendingAngelInvestments.filter((a) => a.matureYear > nextYear);
  const payout = maturing.reduce((sum, a) => sum + a.payout, 0);

  return {
    ...career,
    careerYear: nextYear,
    founder: { ...career.founder, age: career.founder.age + 1 },
    personalCash: career.personalCash + payout,
    pendingAngelInvestments: stillPending,
    status: nextYear > CAREER_LENGTH_YEARS ? 'ended' : career.status,
  };
}

// ============================================================================
// Career summary — shared by the results screen and award predicates so
// neither has to recompute "how many companies did this career sell" from
// scratch.
// ============================================================================

export interface CareerSummary {
  companiesFounded: number;
  companiesSold: number;
  companiesIPOd: number;
  companiesFailed: number;
  yearsSpentBuilding: number; // sum of years each company was active
  ageAtEnd: number;
}

/** Counts distinct absolute career years any company was active in, rather
 * than summing each company's own (yearEnded - yearFounded + 1) span —
 * those spans can share a boundary year (re-founding "claims the current
 * year's slot rather than consuming a year on its own", so ending one
 * company and founding the next can both land on the same careerYear) and
 * naively summing them double-counts that shared year. */
function yearsSpentBuildingFor(career: CareerState): number {
  const buildingYears = new Set<number>();
  for (const c of career.companies) {
    for (let y = c.yearFounded; y <= c.yearEnded; y++) buildingYears.add(y);
  }
  if (career.current) {
    const state = career.current;
    // Same overshoot as endCurrentCompany's yearEnded — cap at the real
    // 50-year boundary rather than whatever state.year happens to be.
    const endYear = Math.min(state.foundedCareerYear + state.year - 1, CAREER_LENGTH_YEARS);
    for (let y = state.foundedCareerYear; y <= endYear; y++) buildingYears.add(y);
  }
  return buildingYears.size;
}

export function summarizeCareer(career: CareerState): CareerSummary {
  return {
    companiesFounded: career.companies.length + (career.current ? 1 : 0),
    companiesSold: career.companies.filter((c) => c.outcome === 'sold').length,
    companiesIPOd: career.companies.filter((c) => c.outcome === 'ipo').length,
    companiesFailed: career.companies.filter((c) => c.outcome === 'failed').length,
    yearsSpentBuilding: yearsSpentBuildingFor(career),
    // founder.age is a LIVE current age (advanceCareerYear increments it
    // every real year — see types.ts's Founder.age), so by the time a
    // career ends it's already the end age; no arithmetic needed here. A
    // previous version of this line added (careerYear - 1) on top of that,
    // double-counting the elapsed years and producing ages like 136 for a
    // 50-year career — see ui/screens/results.tsx's founder strip, which
    // back-computes the *starting* age as age - (careerYear - 1) instead.
    ageAtEnd: career.founder.age,
  };
}

/** Results-card title, mirroring endings.ts's per-company generateTitle
 * but for a whole career. Kept here rather than in endings.ts to avoid a
 * circular import (this file already reads endings.ts's resolveRunResults). */
export function careerTitle(career: CareerState, summary: CareerSummary): string {
  if (summary.companiesFounded === 0) return 'Never got started';
  if (career.retiredEarly) return 'Retired early';
  const wins = summary.companiesSold + summary.companiesIPOd;
  if (wins === 0) return summary.companiesFailed > 0 ? 'Never quite landed one' : 'A working life';
  if (summary.companiesFounded === 1) return 'One company, the whole career';
  if (wins === summary.companiesFounded) return `Sold every one — all ${summary.companiesFounded}`;
  return `Sold ${wins} of ${summary.companiesFounded}`;
}

export function careerSubtitle(career: CareerState, summary: CareerSummary): string {
  if (summary.companiesFounded === 0) return `${CAREER_LENGTH_YEARS} years, and never founded a thing.`;
  if (career.retiredEarly) {
    return `Called it at age ${summary.ageAtEnd}, ${CAREER_LENGTH_YEARS - career.careerYear + 1} years early, with ${formatMoney(career.personalCash)} banked.`;
  }
  if (summary.companiesFailed === summary.companiesFounded) {
    return `${summary.companiesFounded} ${summary.companiesFounded === 1 ? 'try' : 'tries'}, none of them worked.`;
  }
  if (summary.companiesFailed > 0 && summary.companiesSold + summary.companiesIPOd > 0) {
    return `Failed ${summary.companiesFailed === 1 ? 'once' : `${summary.companiesFailed} times`}, then didn't.`;
  }
  return `${summary.yearsSpentBuilding} years spent building, out of ${CAREER_LENGTH_YEARS}.`;
}

/** Always available between years, regardless of exits/dynastyWealth —
 * previously gated on having sold at least one company (or, for a
 * successor, inheriting dynasty wealth), which meant a founder whose only
 * company so far had FAILED never saw a retire option next to "Rest"/
 * "Start now" at all. Walking away with whatever's left (even $0) should
 * always be a real choice, not one earned by already having succeeded. */
export function canRetireCareer(career: CareerState): boolean {
  return career.status === 'active' && career.current === null;
}

export function retireCareerEarly(career: CareerState): CareerState {
  return { ...career, status: 'ended', retiredEarly: true };
}

// ============================================================================
// Between-year standing options
// ============================================================================

const ANGEL_COMMIT_FRACTION = 0.15;
const ANGEL_MATURE_MIN_YEARS = 5;
const ANGEL_MATURE_MAX_YEARS = 8;
const PASSIVE_RETURN_MIN = 0.04;
const PASSIVE_RETURN_RANGE = 0.05;
const TAKE_JOB_CASH = 15_000;
const TAKE_JOB_REPUTATION = 2;

/** Heavily skewed toward returning ~nothing, per the design doc — a rare
 * bet returns a great deal, most don't. Rolled once, at commit time (not
 * at maturity): a multi-year pending queue that rolled its outcome lazily
 * on the scheduled year would have to reproduce the exact same RNG-cursor
 * position on a seed replay regardless of what else drew from the shared
 * RNG in between, which is a much easier property to break than it sounds.
 * Locking the outcome in immediately and only delaying the cash arriving
 * sidesteps that entirely. */
function rollAngelMultiplier(rng: RNG): number {
  const r = rng.next();
  if (r < 0.5) return rng.next() * 0.3; // 50%: 0 - 0.3x
  if (r < 0.8) return 0.5 + rng.next() * 1.5; // 30%: 0.5 - 2x
  if (r < 0.95) return 2 + rng.next() * 4; // 15%: 2 - 6x
  return 6 + rng.next() * 14; // 5%: 6 - 20x
}

/** Flavor only in this pass — no linked Character is generated for the
 * founder being backed (the doc's "might be your acquirer later" cameo is
 * a nice-to-have, not core mechanic; see the Pass A plan's Simplifications). */
const ANGEL_FOUNDER_NAMES = [
  'a founder you met at a conference',
  'someone two desks over at your old office',
  'a friend-of-a-friend with a deck',
  'someone who cold-emailed you',
  'a former colleague going out on their own',
];

export const BETWEEN_YEAR_OPTIONS: BetweenYearOption[] = [
  {
    id: 'invest',
    label: 'Put the money to work',
    detail: () => 'Passive investment. Returns 4-9% a year — safe, dull, and over enough idle years it adds up.',
  },
  {
    id: 'angel',
    label: 'Back other founders',
    detail: (career) =>
      career.personalCash > 0
        ? `Commit ${formatMoney(Math.round(career.personalCash * ANGEL_COMMIT_FRACTION))} as an angel bet. Most return nothing; a rare one returns a great deal, years from now.`
        : 'Commit a slice of what you have as an angel bet — you need something to commit first.',
  },
  {
    id: 'job',
    label: 'Take a job',
    detail: () => 'A salary, no risk, and access. Modest cash, a little reputation, a better next idea draw.',
  },
  {
    id: 'search',
    label: 'Look properly for the next thing',
    detail: () => 'Spend the year searching instead of founding. Five ideas next time instead of three, and a higher floor.',
  },
  {
    id: 'rest',
    label: 'Rest',
    detail: (career) =>
      career.founder.age >= 60
        ? 'Family, and the start of stepping back. Nobody would blame you.'
        : "Family, travel, doing nothing. No cost, no gain — sometimes that's exactly what's needed.",
  },
  {
    id: 'found',
    label: 'Start now',
    detail: () => 'Skip the deliberation. Found something immediately.',
  },
];

/**
 * Apply a chosen between-year option and advance the clock by one year —
 * every option here is a single-click year, unlike company-play's separate
 * choose/advance steps. 'found' is the one exception: it's a no-op here
 * (career unchanged) because founding claims THIS year's slot rather than
 * consuming a year on its own — see foundCompany's own doc comment.
 */
export function applyBetweenYearAction(career: CareerState, optionId: BetweenYearOption['id'], rng: RNG): CareerState {
  switch (optionId) {
    case 'invest': {
      const rate = PASSIVE_RETURN_MIN + rng.next() * PASSIVE_RETURN_RANGE;
      return advanceCareerYear({ ...career, personalCash: Math.round(career.personalCash * (1 + rate)) });
    }
    case 'angel': {
      const amount = Math.round(career.personalCash * ANGEL_COMMIT_FRACTION);
      if (amount <= 0) return advanceCareerYear(career);
      const multiplier = rollAngelMultiplier(rng);
      const investment: AngelInvestment = {
        amount,
        matureYear: career.careerYear + rng.nextInt(ANGEL_MATURE_MIN_YEARS, ANGEL_MATURE_MAX_YEARS),
        payout: Math.round(amount * multiplier),
        founderName: rng.pick(ANGEL_FOUNDER_NAMES),
      };
      return advanceCareerYear({
        ...career,
        personalCash: career.personalCash - amount,
        pendingAngelInvestments: [...career.pendingAngelInvestments, investment],
      });
    }
    case 'job':
      return advanceCareerYear({
        ...career,
        personalCash: career.personalCash + TAKE_JOB_CASH,
        reputation: clampReputation(career.reputation + TAKE_JOB_REPUTATION),
        nextIdeaDrawBoost: 'job',
      });
    case 'search':
      return advanceCareerYear({ ...career, nextIdeaDrawBoost: 'search' });
    case 'rest':
      return advanceCareerYear(career);
    case 'found':
      return career;
  }
}

// ============================================================================
// Family and generational handover (Pass C) — design doc §8-9. A generation
// is "how one founder's career went"; the dynasty is the sequence of them.
// Identity (name/trait/portrait) is generated the moment the family event is
// accepted, not at handover time, so the story remembers who the heir is
// regardless of how the rest of the career goes; only their starting age is
// computed later, once it's known how many years actually passed.
// ============================================================================

const HEIR_FIRST_NAMES: Record<Gender, string[]> = {
  f: ['Wren', 'Sasha', 'Noor', 'Imogen', 'Talia', 'Freya', 'Priya', 'Yara', 'Camille', 'Lior'],
  m: ['Kai', 'Milo', 'Rafi', 'Idris', 'Theo', 'Amos', 'Ezra', 'Dov', 'Sami', 'Wes'],
  nb: ['River', 'Ari', 'Quinn', 'Sage', 'Remy', 'Kit', 'Nico', 'Ash', 'Lior', 'Rowan'],
};

/** Kid-flavored, not business-partner-flavored — deliberately reads
 * differently from a cofounder's `trait` (see characters.json). Display
 * only; see Founder.trait's own comment for why nothing reads it back. */
const HEIR_TRAITS = [
  'asks too many questions',
  'was already better at this than you were',
  'watched you build it and wants to build something else entirely',
  'remembers every year you missed',
  'was never impressed by any of it',
  'learned to negotiate from watching you lose',
  'wants to prove they never needed the head start',
  'actually likes the industry, which surprised everyone',
  'kept every one of your old notebooks',
  'still asks how the first company failed, not how it sold',
];

/** A successor who isn't blood family — a protégé, a business partner's
 * kid, someone who worked for the outgoing founder for years. Same voice
 * family, different frame; used when !hasFamily and the player pays the
 * ad to continue the dynasty anyway (design doc §9: "not a biological
 * retcon"). */
const SUCCESSOR_TRAITS = [
  'learned the business by watching every mistake up close',
  'was the only one who stayed for all of it',
  'has opinions about how it should have been done',
  'never got the credit they were owed the first time',
  'took the job nobody else wanted and made something of it',
  'still calls it "the company," never "your company"',
];

function blendPortrait(name: string, gender: Gender, parentPortrait: Founder['portrait']) {
  const base = generatePortraitSeed(name, gender);
  // A visible family resemblance: skin tone and hair colour carry over,
  // everything else (shape, clothing, accessory) is the heir's own draw.
  return { ...base, skin: parentPortrait.skin, hairColour: parentPortrait.hairColour };
}

function generateHeir(founder: Founder, rng: RNG, traitPool: string[]): Heir {
  const gender = rng.pick(['f', 'm', 'nb'] as const);
  const name = rng.pick(HEIR_FIRST_NAMES[gender]);
  return {
    name,
    gender,
    trait: rng.pick(traitPool),
    portrait: blendPortrait(name, gender, founder.portrait),
  };
}

/**
 * Called by App.tsx the moment it observes GameState.founderHasFamily flip
 * true (the family event's 'startFamily' effect just applied to the
 * currently-running company). Generates the heir right now and records the
 * career year it happened in.
 */
export function startFamily(career: CareerState, rng: RNG): CareerState {
  return {
    ...career,
    hasFamily: true,
    familyYear: career.careerYear,
    heir: generateHeir(career.founder, rng, HEIR_TRAITS),
  };
}

function heirStartingAge(career: CareerState): number {
  const yearsSince = career.familyYear !== null ? career.careerYear - career.familyYear : HEIR.MIN_STARTING_AGE;
  return Math.max(HEIR.MIN_STARTING_AGE, Math.min(HEIR.MAX_STARTING_AGE, yearsSince));
}

/** Bigger estates afford better estate planning — scales from 50% to 70%
 * of persoanlCash as the amount grows toward a legendary-sized fortune. */
function inheritanceFraction(personalCash: number): number {
  const t = Math.max(0, Math.min(1, personalCash / 50_000_000));
  return HEIR.INHERITANCE_FRACTION_MIN + (HEIR.INHERITANCE_FRACTION_MAX - HEIR.INHERITANCE_FRACTION_MIN) * t;
}

/**
 * Whether continuing the dynasty from here needs a rewarded ad. The very
 * first handover (generation 1 → 2) is always free, regardless of whether
 * it's a real heir (hasFamily) or an ad-unlocked protégé — every handover
 * from generation 2 onward is ad-gated, with the usual silent free
 * fallback if no ad fills (see ads/adProvider.ts).
 */
export function handoverNeedsAd(career: CareerState): boolean {
  return career.generation > 1;
}

/**
 * Ends the dynasty's current generation and begins the next — a fresh
 * CareerState for the heir (or, if !hasFamily, a generated successor in the
 * same shape; see SUCCESSOR_TRAITS). Call once the outgoing career has
 * already ended (status:'ended'). `rng` draws a fresh seed for the new
 * generation's own share link, and — only when there's no heir yet to draw
 * an identity from — the successor's name/trait/portrait too.
 */
export function handOverToHeir(career: CareerState, rng: RNG): CareerState {
  const heir = career.heir ?? generateHeir(career.founder, rng, SUCCESSOR_TRAITS);
  const age = career.heir ? heirStartingAge(career) : rng.nextInt(HEIR.SUCCESSOR_AGE_MIN, HEIR.SUCCESSOR_AGE_MAX);

  const heirFounder: Founder = {
    name: heir.name,
    age,
    country: career.founder.country,
    gender: heir.gender,
    portrait: heir.portrait,
    trait: heir.trait,
  };

  const inherited = Math.round(career.personalCash * inheritanceFraction(career.personalCash));
  const newSeed = generateSeed(rng);
  // The new generation's clock restarts at career-year 1 (their own fresh
  // CAREER_LENGTH_YEARS run), but the calendar doesn't — anchor it at
  // whatever real year the outgoing career had actually reached, so the
  // dynasty's timeline reads as continuous across the handover rather than
  // snapping back to whenever the whole game session started.
  const handoverCalendarYear = calendarYearFor(career.foundedCalendarYear, career.careerYear);

  let next = createCareerState(newSeed, heirFounder, career.generation + 1, career.dynastyWealth + career.personalCash, handoverCalendarYear);
  next = {
    ...next,
    personalCash: inherited,
    reputation: clampReputation(career.reputation * HEIR.REPUTATION_DECAY),
  };
  return next;
}

/** The one alternative to handOverToHeir's usual "the outgoing company is
 * already liquidated to cash" assumption: when the career clock runs out
 * while a company is still healthy and running (see App.tsx's
 * handleAdvance — the only place this can happen, since a company ending
 * on its own always finishes and liquidates first), the successor can
 * inherit it directly instead of starting fresh. Revenue, staff, cash,
 * cap table, history, cast, loans, state.year — everything about the
 * BUSINESS's actual operation carries over completely untouched; only the
 * fields describing WHO is running it (and how that reads on screen)
 * update to the new generation's own perspective.
 *
 * foundedCalendarYear is left alone — the real-world calendar date this
 * company's year 1 happened on doesn't change just because leadership did,
 * and calendar-year display (present.ts's calendarYear) should stay
 * continuous straight through the handover.
 *
 * foundedCareerYear DOES get re-anchored, though: it exists purely to
 * drive the ledger's "YEAR N" counter (game.tsx's LedgerTab), and that
 * counter is meant to read as "how long has the CURRENT leader been
 * building this," the same way CareerState.careerYear itself resets to 1
 * for the new generation — not a decades-spanning number accumulated
 * across two different people's tenures. Re-anchoring it so the very next
 * ledger row reads "YEAR 1" (state.year keeps counting up from whatever it
 * already was — only the OFFSET added to it changes) achieves that without
 * touching state.year itself, which is still live game logic (yearMin
 * conditions, gamble spacing, etc.) and must not reset. */
export function inheritRunningCompany(state: GameState, newCareer: CareerState): GameState {
  return {
    ...state,
    founder: newCareer.founder,
    founderReputation: newCareer.reputation,
    founderBankruptcies: newCareer.bankruptcies,
    founderHasFamily: newCareer.hasFamily,
    generation: newCareer.generation,
    foundedCareerYear: 2 - state.year,
  };
}
