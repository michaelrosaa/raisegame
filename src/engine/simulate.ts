/**
 * Headless game simulation — plays full careers to produce balance
 * metrics for the luck-driven growth economy. This is how the game gets
 * balanced, not by playing it thirty times by hand.
 *
 * Three play styles run side by side per report, because a uniformly
 * random player is not a proxy for a real one:
 *   random   — picks blindfolded; useful only as a worst-case floor
 *   sensible — a simple no-game-knowledge heuristic a first-time reader
 *              would actually follow (see chooseSensibleOption)
 *   reckless — chases gambles and capital, ignores the downside
 * Balance targets apply to `sensible`, but the design goal is that
 * "legendary" stays close across all three — the largest outcomes are
 * luck and cannot be bought with care.
 *
 * Usage: npm run simulate            (10,000 careers per style)
 *        npm run simulate -- 50000   (custom run count)
 */

import type { CareerState, CharacterTemplate, Company, CountryData, EventDef, Founder, GameState, Idea, OptionDef, RunResults, BetweenYearOption } from './types';
import { RNG } from './rng';
import { createGameState, getFounderShare } from './state';
import { initializeMacroPhase } from './macro';
import { generatePortraitSeed, pickCompanyColour, castFoundingCrew } from './cast';
import { processPlayerChoice, playerRetires } from './game';
import { advanceYear, type TurnContext } from './turn';
import { resolveRunResults } from './endings';
import { createCareerState, foundCompany, endCurrentCompany, advanceCareerYear, applyBetweenYearAction, BETWEEN_YEAR_OPTIONS, CAREER_LENGTH_YEARS } from './career';
import { drawIdeaCeiling, fundingGateChance, glamourOf } from './economy';
import { eventOffersFunding, applyFundingGateToEvent } from './events';
import { BUCKETS, CAREER_BUCKETS } from './constants';

import countriesContent from '../content/countries.json';
import ideasContent from '../content/ideas.json';
import characterTemplates from '../content/characters.json';
import yearOneEvents from '../content/events/year-one.json';
import everyday from '../content/events/everyday.json';
import everydayVol3 from '../content/events/everyday-vol3.json';
import family from '../content/events/family.json';
import geopolitical from '../content/events/geopolitical.json';
import economic from '../content/events/economic.json';
import internal from '../content/events/internal.json';
import absurd from '../content/events/absurd.json';
import gambles from '../content/events/gambles.json';
import quietYears from '../content/events/quietyears.json';
import postIpo from '../content/events/postipo.json';

const COUNTRIES = countriesContent as CountryData[];
const IDEAS = ideasContent as Idea[];
const CHARACTER_POOL = characterTemplates as CharacterTemplate[];
const YEAR_ONE_EVENT = (yearOneEvents as EventDef[])[0];
const YEAR_ONE_REFOUNDING_EVENT = (yearOneEvents as EventDef[])[1]; // see App.tsx's beginCompanyTurn
const RANDOM_EVENTS: EventDef[] = [
  ...(everyday as EventDef[]),
  ...(everydayVol3 as EventDef[]),
  ...(family as EventDef[]),
  ...(geopolitical as EventDef[]),
  ...(economic as EventDef[]),
  ...(internal as EventDef[]),
  ...(absurd as EventDef[]),
  ...(gambles as EventDef[]),
];
const QUIET_YEAR_EVENTS: EventDef[] = quietYears as EventDef[];
const POST_IPO_EVENTS: EventDef[] = postIpo as EventDef[];
const ALL_POOL_EVENTS: EventDef[] = [YEAR_ONE_EVENT, YEAR_ONE_REFOUNDING_EVENT, ...RANDOM_EVENTS, ...QUIET_YEAR_EVENTS, ...POST_IPO_EVENTS];
const TURN_CONTEXT: TurnContext = { allEvents: RANDOM_EVENTS, quietEvents: QUIET_YEAR_EVENTS, postIpoEvents: POST_IPO_EVENTS, characterPool: CHARACTER_POOL };

// ============================================================================
// Country sampling — players overwhelmingly pick their own country or a
// famous one, not a uniform draw across 196. Balance targets apply to this
// weighted sample, not a flat one; see the per-tier breakdown in the report.
// ============================================================================

const COUNTRIES_BY_TIER: Record<number, CountryData[]> = { 1: [], 2: [], 3: [], 4: [], 5: [] };
for (const c of COUNTRIES) COUNTRIES_BY_TIER[c.tier].push(c);

const TIER_SAMPLE_WEIGHT: Record<number, number> = { 5: 45, 4: 30, 3: 17, 2: 6, 1: 2 };

function pickWeightedCountry(rng: RNG): CountryData {
  const tier = rng.pickWeighted(
    Object.entries(TIER_SAMPLE_WEIGHT).map(([t, weight]) => ({ value: Number(t), weight }))
  );
  return rng.pick(COUNTRIES_BY_TIER[tier]);
}

// Hard safety cap for the harness only — content has ~150 unique
// non-repeating events, so a career genuinely cannot run past that
// regardless of policy. The real game (App.tsx/turn.ts) has no such cap;
// careers there end only by exit, retirement, or failure.
const MAX_YEARS = 200;

// ============================================================================
// Play styles
// ============================================================================

export type PlayStyle = 'random' | 'sensible' | 'reckless';

function estimateExitTakeHome(option: OptionDef, state: GameState): number | null {
  const endEffect = option.effects.find(
    (e) => e.type === 'end' && (e.endingType === 'sale' || e.endingType === 'exitedPublic' || e.endingType === 'retirement') && e.exitPrice !== undefined
  );
  if (!endEffect || endEffect.exitPrice === undefined) return null;
  return (endEffect.exitPrice * getFounderShare(state.capTable)) / 100;
}

/** Going public isn't a take-home-cash decision the way a sale is — the
 * company keeps running, nothing is given up immediately — so it doesn't
 * fit estimateExitTakeHome's "would accepting pay out $X right now" shape.
 * It's still a strictly-good, low-downside move once eligible (per the
 * design doc: "a funding event, not an ending"), so `sensible` should
 * always take it, same spirit as the >$5M take-home rule just phrased for
 * what goPublic actually is. */
function offersGoingPublic(option: OptionDef): boolean {
  return option.effects.some((e) => e.type === 'goPublic');
}

function cashSafetyScore(option: OptionDef): number {
  let score = 0;
  for (const e of option.effects) {
    if (e.type === 'funding') score += 2;
    if (e.type === 'goPublic') score += 2; // upside with the run-continues safety net funding already has
    if (e.type === 'loan') score += 1.5; // cash now, but not free the way equity is — scored below funding
    if (e.type === 'repayLoan') score -= 1; // a deliberate cash outflow, same footing as a negative cash effect
    if (e.type === 'sellShares') score += 1; // real cash, but selling into the float has its own downside — see below
    if (e.type === 'takePrivate') score -= 1; // a huge new loan taken on all at once
    if (e.type === 'cash') score += Math.sign(e.value ?? 0);
    if (e.type === 'revenueStep') score += Math.sign(e.value ?? 0) * 0.5;
    if (e.type === 'growthMultiplier') score += Math.sign((e.value ?? 1) - 1) * 0.5;
    if (e.type === 'sharePriceShock') score += Math.sign(e.value ?? 0) * 0.5;
  }
  return score;
}

function downsideScore(option: OptionDef): number {
  let score = 0;
  for (const e of option.effects) {
    if (e.type === 'funding' && e.targetDilutionPct) score += e.targetDilutionPct / 10;
    if (e.type === 'loan') score += 1; // an ongoing obligation regardless of how the company does — a real downside, just not equity's kind
    if (e.type === 'sellShares' && (e.value ?? 0) > 2) score += 1; // over the no-price-impact line (constants.ts's PUBLIC_MARKET)
    if (e.type === 'takePrivate') score += 1;
    if ((e.type === 'cash' || e.type === 'morale' || e.type === 'staff' || e.type === 'revenueStep') && (e.value ?? 0) < 0) score += 1;
    if (e.type === 'growthMultiplier' && (e.value ?? 1) < 1) score += 1;
    if (e.type === 'sharePriceShock' && (e.value ?? 0) < 0) score += 1;
    if (e.type === 'boardPatience' && (e.value ?? 0) < 0) score += 1;
    if (e.type === 'analystSentiment' && (e.value ?? 0) < 0) score += 1;
  }
  return score;
}

/** A ranking proxy, not a literal dollar figure — growthMultiplier moves a
 * RATE, not an amount, so it's scaled onto a comparable footing with
 * revenueStep's flat dollars purely so options within the same event can
 * be ordered against each other. */
function revenueScore(option: OptionDef): number {
  let score = 0;
  for (const e of option.effects) {
    if (e.type === 'revenueStep') score += e.value ?? 0;
    if (e.type === 'growthMultiplier') score += ((e.value ?? 1) - 1) * 100_000 * (e.years ?? 1);
    if (e.type === 'annualRevenue') score += e.value ?? 0;
  }
  return score;
}

/**
 * A first-time reader's heuristic — no game knowledge, just what looks
 * plausible from the three cards in front of them:
 *   0. Going public is always taken when offered — nothing is given up,
 *      the company keeps running (see offersGoingPublic's own comment)
 *   1. A great exit (>$5M take-home) is always taken, whatever else is true
 *   2. Below 6 months of runway, prefer whatever adds cash or extends it
 *   3. Otherwise prefer the option with the least visible downside
 *   4. A gamble is only taken when cornered (<4 months runway)
 *   5. Tie-break on the best net effect on revenue
 */
function chooseSensibleOption(event: EventDef, state: GameState, rng: RNG): OptionDef {
  const options = event.options;

  const goPublicOption = options.find(offersGoingPublic);
  if (goPublicOption) return goPublicOption;

  for (const o of options) {
    const takeHome = estimateExitTakeHome(o, state);
    if (takeHome !== null && takeHome > 5_000_000) return o;
  }

  const cashLastsMonths = state.monthlyBurn <= 0 ? Infinity : state.cash / state.monthlyBurn;
  const desperate = cashLastsMonths < 4;

  if (desperate) {
    const gamble = options.find((o) => o.gamble);
    if (gamble) return gamble;
  }

  let candidates = options.filter((o) => !o.gamble);
  if (candidates.length === 0) candidates = options;

  if (cashLastsMonths < 6) {
    const bestScore = Math.max(...candidates.map(cashSafetyScore));
    const safer = candidates.filter((o) => cashSafetyScore(o) === bestScore);
    if (safer.length === 1) return safer[0];
    candidates = safer;
  }

  const minDownside = Math.min(...candidates.map(downsideScore));
  const safest = candidates.filter((o) => downsideScore(o) === minDownside);
  if (safest.length === 1) return safest[0];

  const maxRevenue = Math.max(...safest.map(revenueScore));
  const best = safest.filter((o) => revenueScore(o) === maxRevenue);
  return rng.pick(best);
}

/** Chases gambles and capital, ignores the downside — expected to fail
 * meaningfully more than random, which is the point of reporting it. */
function chooseRecklessOption(event: EventDef, rng: RNG): OptionDef {
  const goPublicOption = event.options.find(offersGoingPublic);
  if (goPublicOption) return goPublicOption;
  const gamble = event.options.find((o) => o.gamble);
  if (gamble) return gamble;
  const funded = event.options.filter((o) => o.effects.some((e) => e.type === 'funding' || e.type === 'loan'));
  if (funded.length > 0) return rng.pick(funded);
  return rng.pick(event.options);
}

function chooseOption(style: PlayStyle, event: EventDef, state: GameState, rng: RNG): OptionDef {
  if (style === 'sensible') return chooseSensibleOption(event, state, rng);
  if (style === 'reckless') return chooseRecklessOption(event, rng);
  return rng.pick(event.options);
}

// ============================================================================
// Invariant checking — "impossible states"
// ============================================================================

export interface InvariantViolation {
  kind: 'capTableSum' | 'negativeCashNoEnding' | 'revenueOverflow' | 'loanBalanceInvalid';
  seed: string;
  year: number;
  detail: string;
}

function checkCapTable(state: GameState, violations: InvariantViolation[]): void {
  const capSum = state.capTable.reduce((s, e) => s + e.percentage, 0);
  if (Math.abs(capSum - 100) > 0.1) {
    violations.push({ kind: 'capTableSum', seed: state.seed, year: state.year, detail: `cap table sums to ${capSum.toFixed(2)}` });
  }
}

// turn.ts's insolvency check is now predictive, not reactive — a rescue
// event, when one fires, always replaces that year's cash decrement
// entirely (see failure.ts's buildRescueEvent), so cash should never
// actually be negative while status is still 'running', at any point.
function checkCashCaughtByAdvance(state: GameState, violations: InvariantViolation[]): void {
  if (state.cash < 0 && state.status !== 'ended') {
    violations.push({ kind: 'negativeCashNoEnding', seed: state.seed, year: state.year, detail: `cash ${state.cash.toFixed(0)} with status ${state.status}` });
  }
}

const REVENUE_OVERFLOW_CEILING = 500_000_000;
function checkRevenueOverflow(state: GameState, violations: InvariantViolation[]): void {
  if (state.annualRevenue > REVENUE_OVERFLOW_CEILING) {
    violations.push({ kind: 'revenueOverflow', seed: state.seed, year: state.year, detail: `revenue ${state.annualRevenue.toFixed(0)} exceeds $500M` });
  }
}

function checkLoanBalances(state: GameState, violations: InvariantViolation[]): void {
  for (const loan of state.loans) {
    if (loan.balance < 0 || loan.balance > loan.principal + 0.01) {
      violations.push({
        kind: 'loanBalanceInvalid',
        seed: state.seed,
        year: state.year,
        detail: `loan ${loan.id} balance ${loan.balance.toFixed(0)} outside [0, principal ${loan.principal.toFixed(0)}]`,
      });
    }
  }
}

export function findOrphanedConditions(events: EventDef[]): string[] {
  const orphaned: string[] = [];
  for (const event of events) {
    const byType = new Map<string, (number | string | boolean | undefined)[]>();
    for (const c of event.conditions) {
      const list = byType.get(c.type) ?? [];
      list.push(c.value);
      byType.set(c.type, list);
    }
    const yearMin = byType.get('yearMin')?.[0] as number | undefined;
    const yearMax = byType.get('yearMax')?.[0] as number | undefined;
    if (yearMin !== undefined && yearMax !== undefined && yearMin > yearMax) {
      orphaned.push(`${event.id}: yearMin (${yearMin}) > yearMax (${yearMax})`);
    }
    const pairs: [string, string, string][] = [
      ['revenueAbove', 'revenueBelow', 'revenue'],
      ['moraleAbove', 'moraleBelow', 'morale'],
      ['cashLastsAbove', 'cashLastsBelow', 'cash-lasts'],
    ];
    for (const [aboveKey, belowKey, label] of pairs) {
      const above = byType.get(aboveKey)?.[0] as number | undefined;
      const below = byType.get(belowKey)?.[0] as number | undefined;
      if (above !== undefined && below !== undefined && above >= below) {
        orphaned.push(`${event.id}: ${aboveKey} (${above}) >= ${belowKey} (${below}) — no ${label} value satisfies both`);
      }
    }
    const climates = byType.get('climateIs');
    if (climates && new Set(climates).size > 1) {
      orphaned.push(`${event.id}: climateIs appears ${climates.length} times with different values`);
    }
  }
  return orphaned;
}

function describeConditions(event: EventDef): string {
  if (event.conditions.length === 0) return 'no conditions (should always be eligible — check its rarity/pool)';
  return event.conditions.map((c) => `${c.type}${c.value !== undefined ? ` ${c.value}` : ''}`).join(', ');
}

// ============================================================================
// One company — plays a single company's turn loop start to finish. This
// predates the multi-year career wrapper (engine/career.ts) and is still used
// two ways: standalone, for the original per-company balance metrics below
// (peak revenue, exit-offered%, career length, ...), and as the building
// block simulateOneRealCareer composes into a full multi-company career.
// ============================================================================

interface CompanyRunOutcome {
  results: RunResults;
  finalState: GameState;
  yearsRun: number;
  eventsFired: string[];
  weatherEventsFired: number;
  exitOffered: boolean;
  exitTakenYear: number | null;
  peakRevenue: number;
  peakStaff: number;
  countryTier: number;
  fundingOffered: boolean;
}

function simulateOneCompany(seed: string, style: PlayStyle, violations: InvariantViolation[]): CompanyRunOutcome {
  const rng = new RNG(seed);
  const eventsFired: string[] = [];
  let weatherEventsFired = 0;
  let exitOffered = false;
  let exitTakenYear: number | null = null;
  let peakRevenue = 0;
  let peakStaff = 0;
  let fundingOffered = false;

  const country = pickWeightedCountry(rng);
  const idea = rng.pick(IDEAS);
  const founderAge = rng.nextInt(24, 52);
  const founderGender = rng.pick(['f', 'm', 'nb'] as const);
  const founder = {
    name: 'Sim Founder',
    age: founderAge,
    country: country.code,
    gender: founderGender,
    portrait: generatePortraitSeed(`${seed}-founder`, founderGender),
  };
  const company = {
    name: 'Sim Co',
    industry: idea.industry,
    logoIndex: rng.nextInt(0, 6),
    colour: pickCompanyColour(idea.industry),
    ideaCeiling: drawIdeaCeiling(idea, rng, country.marketWealth),
    glamour: idea.glamour ?? 0.5,
  };

  let state = createGameState(seed, founder, company, country.code, { moneyNeeded: idea.moneyNeeded, industry: idea.industry });
  state = { ...state, status: 'running' };
  state = initializeMacroPhase(state, rng);
  state = castFoundingCrew(state, rng, CHARACTER_POOL);

  // Year one is guaranteed, same as the real game.
  {
    const yearOneFundingOpen = rng.next() < fundingGateChance(country, state.climate, undefined, glamourOf(state));
    const yearOneEvent = applyFundingGateToEvent(YEAR_ONE_EVENT, yearOneFundingOpen);
    if (eventOffersFunding(yearOneEvent)) fundingOffered = true;
    const option = chooseOption(style, yearOneEvent, state, rng);
    const step = processPlayerChoice(state, yearOneEvent, option, rng, CHARACTER_POOL);
    state = step.state;
    eventsFired.push(YEAR_ONE_EVENT.id);
    checkCapTable(state, violations);
    checkLoanBalances(state, violations);
    peakRevenue = Math.max(peakRevenue, state.annualRevenue);
    peakStaff = Math.max(peakStaff, state.staff);
  }

  let years = 1;
  while (state.status === 'running' && years < MAX_YEARS) {
    const step = advanceYear(state, rng, TURN_CONTEXT);
    state = step.state;
    years++;
    checkCashCaughtByAdvance(state, violations);
    checkRevenueOverflow(state, violations);
    peakRevenue = Math.max(peakRevenue, state.annualRevenue);
    peakStaff = Math.max(peakStaff, state.staff);
    if (step.hasEnded) break;

    if (!step.event) {
      // Every pool came up empty — an exceptionally long run with nothing
      // left to say. resolveRunResults reads this as a retirement.
      break;
    }

    const event = step.event;
    if (event.id.startsWith('generated-acquisition-') || event.id.startsWith('generated-ipo-')) {
      exitOffered = true;
    }
    if (eventOffersFunding(event)) fundingOffered = true;
    if (event.isWeather) weatherEventsFired++;

    const option = chooseOption(style, event, state, rng);
    const choice = processPlayerChoice(state, event, option, rng, CHARACTER_POOL);
    state = choice.state;
    if (option.id === 'exit-accept' || option.id === 'exit-ipo' || option.id === 'stand-retire') {
      exitTakenYear = state.year;
    }
    eventsFired.push(event.id);
    checkCapTable(state, violations);
    checkLoanBalances(state, violations);
    checkRevenueOverflow(state, violations);
    peakRevenue = Math.max(peakRevenue, state.annualRevenue);
    peakStaff = Math.max(peakStaff, state.staff);
  }

  return {
    results: resolveRunResults(state),
    finalState: state,
    yearsRun: years,
    eventsFired,
    weatherEventsFired,
    exitOffered,
    exitTakenYear,
    peakRevenue,
    peakStaff,
    countryTier: country.tier,
    fundingOffered,
  };
}

// ============================================================================
// One full CAREER_LENGTH_YEARS-year career — composes engine/career.ts's CareerState machine
// with the same chooseOption heuristics above, so the harness exercises the
// exact same founding/playing/ending code paths App.tsx does. Company 1
// always goes through the same direct createGameState path App.tsx's
// handleSetupComplete uses (full country startingCash, neutral reputation);
// company 2+ always goes through career.ts's foundCompany, same as
// App.tsx's handleFoundCompany.
// ============================================================================

interface RealCareerOutcome {
  career: CareerState;
  companiesFounded: number;
  finalPersonalCash: number;
  firstExitYear: number | null;
}

/** Mirrors chooseSensibleOption/chooseRecklessOption's spirit for the
 * between-years standing options: sensible keeps building while there's
 * runway left in the career and parks cash safely near the end; reckless
 * chases the angel bet; random picks uniformly. Not literal game logic —
 * purely a harness heuristic for balance-testing the career loop. */
function chooseBetweenYearAction(style: PlayStyle, career: CareerState, rng: RNG): BetweenYearOption['id'] {
  if (style === 'random') return rng.pick(BETWEEN_YEAR_OPTIONS).id;

  const yearsLeft = CAREER_LENGTH_YEARS - career.careerYear + 1;

  if (style === 'reckless') {
    if (career.personalCash > 10_000 && rng.roll(40)) return 'angel';
    return 'found';
  }

  // sensible
  if (yearsLeft <= 2) return 'invest'; // too late in the career to start something new
  if (career.personalCash <= 0) return 'found'; // nothing to invest — get back to work
  return rng.roll(65) ? 'found' : 'invest';
}

/** Advance the currently-running company by one year, mirroring App.tsx's
 * handleAdvance exactly: an already-ended state (the previous choice ended
 * it — insolvency mid-choice, or an accepted sale/ipo/failure effect) is
 * booked without moving the career clock; otherwise advanceYear runs, the
 * clock always moves once, and the company either continues, ends here, or
 * (rarely) gets swept into an ended career mid-turn if the clock just
 * passed year 25 — see App.tsx's own comment on that branch. */
function playOneCompanyYear(career: CareerState, style: PlayStyle, rng: RNG, violations: InvariantViolation[]): CareerState {
  const cs = career.current;
  if (!cs) return career;

  if (cs.status === 'ended') {
    return endCurrentCompany(career, cs);
  }

  const step = advanceYear(cs, rng, TURN_CONTEXT);
  const advancedCareer = advanceCareerYear(career);
  checkRevenueOverflow(step.state, violations);

  if (step.hasEnded || !step.event) {
    return endCurrentCompany(advancedCareer, step.state);
  }
  if (advancedCareer.status === 'ended') {
    return endCurrentCompany(advancedCareer, playerRetires(step.state));
  }

  const option = chooseOption(style, step.event, step.state, rng);
  const choice = processPlayerChoice(step.state, step.event, option, rng, CHARACTER_POOL);
  checkCapTable(choice.state, violations);
  checkLoanBalances(choice.state, violations);
  checkRevenueOverflow(choice.state, violations);
  return { ...advancedCareer, current: choice.state };
}

function drawSimCompany(idea: Idea, country: CountryData, rng: RNG): Company {
  return {
    name: 'Sim Co',
    industry: idea.industry,
    logoIndex: rng.nextInt(0, 6),
    colour: pickCompanyColour(idea.industry),
    ideaCeiling: drawIdeaCeiling(idea, rng, country.marketWealth),
    glamour: idea.glamour ?? 0.5,
  };
}

/** Found a company and immediately play its guaranteed Year One choice —
 * the two always happen together with no year consumed in between, same
 * as the real game (see career.ts's foundCompany/applyBetweenYearAction
 * doc comments). */
function foundAndPlayYearOne(
  career: CareerState,
  company: Company,
  countryId: string,
  country: CountryData,
  idea: Idea,
  capitalPutIn: number,
  style: PlayStyle,
  rng: RNG,
  violations: InvariantViolation[]
): CareerState {
  let nextCareer = foundCompany(career, company, countryId, idea, capitalPutIn, rng, CHARACTER_POOL);
  const cs = nextCareer.current!;
  // Company 2+ already committed its own capital at founding — see
  // App.tsx's beginCompanyTurn for why this reads the refounding event
  // instead of re-asking how to pay for year one, UNLESS that commitment
  // didn't even clear what the idea needs (startedWithLittleCapital) — same
  // condition as the real game.
  const yearOneEvent = cs.startedWithLittleCapital
    ? applyFundingGateToEvent(YEAR_ONE_EVENT, rng.next() < fundingGateChance(country, cs.climate, cs.founderReputation, glamourOf(cs)))
    : YEAR_ONE_REFOUNDING_EVENT;
  const option = chooseOption(style, yearOneEvent, cs, rng);
  const choice = processPlayerChoice(cs, yearOneEvent, option, rng, CHARACTER_POOL);
  checkCapTable(choice.state, violations);
  checkLoanBalances(choice.state, violations);
  nextCareer = { ...nextCareer, current: choice.state };
  return choice.state.status === 'ended' ? endCurrentCompany(nextCareer, choice.state) : nextCareer;
}

// Harness-only safety cap — a real career is bounded by its own
// CAREER_LENGTH_YEARS-year clock, this just guards against an unforeseen
// infinite loop rather than reflecting any real limit.
const MAX_CAREER_LOOP_ITERATIONS = 2_000;

function simulateOneRealCareer(seed: string, style: PlayStyle, violations: InvariantViolation[]): RealCareerOutcome {
  const rng = new RNG(seed);
  const country = pickWeightedCountry(rng);
  const founderAge = rng.nextInt(24, 52);
  const founderGender = rng.pick(['f', 'm', 'nb'] as const);
  const founder: Founder = {
    name: 'Sim Founder',
    age: founderAge,
    country: country.code,
    gender: founderGender,
    portrait: generatePortraitSeed(`${seed}-founder`, founderGender),
  };

  // Company 1 — identical path to simulateOneCompany / App.tsx's
  // handleSetupComplete: full country startingCash, neutral reputation,
  // no engine/career.ts foundCompany involved (there's no personal cash
  // yet to choose an amount from).
  const firstIdea = rng.pick(IDEAS);
  const firstCompany = drawSimCompany(firstIdea, country, rng);
  let state = createGameState(seed, founder, firstCompany, country.code, { moneyNeeded: firstIdea.moneyNeeded, industry: firstIdea.industry });
  state = { ...state, status: 'running' };
  state = initializeMacroPhase(state, rng);
  state = castFoundingCrew(state, rng, CHARACTER_POOL);

  let career = createCareerState(seed, founder);
  career = { ...career, current: state, currentCapitalPutIn: 0 };

  {
    const yearOneFundingOpen = rng.next() < fundingGateChance(country, state.climate, state.founderReputation, glamourOf(state));
    const yearOneEvent = applyFundingGateToEvent(YEAR_ONE_EVENT, yearOneFundingOpen);
    const option = chooseOption(style, yearOneEvent, state, rng);
    const choice = processPlayerChoice(state, yearOneEvent, option, rng, CHARACTER_POOL);
    checkCapTable(choice.state, violations);
    checkLoanBalances(choice.state, violations);
    career = { ...career, current: choice.state };
    if (choice.state.status === 'ended') career = endCurrentCompany(career, choice.state);
  }

  let companiesFounded = 1;
  let guard = 0;

  while (career.status === 'active' && guard < MAX_CAREER_LOOP_ITERATIONS) {
    guard++;

    if (career.current) {
      career = playOneCompanyYear(career, style, rng, violations);
      continue;
    }

    const actionId = chooseBetweenYearAction(style, career, rng);
    if (actionId === 'found') {
      const idea = rng.pick(IDEAS);
      const company = drawSimCompany(idea, country, rng);
      const capitalPutIn = Math.round(career.personalCash * (style === 'reckless' ? 0.9 : 0.5));
      career = foundAndPlayYearOne(career, company, country.code, country, idea, capitalPutIn, style, rng, violations);
      companiesFounded++;
      continue;
    }
    career = applyBetweenYearAction(career, actionId, rng);
  }

  const firstExitYear = career.companies.find((c) => c.outcome !== 'failed')?.yearEnded ?? null;

  return { career, companiesFounded, finalPersonalCash: career.personalCash, firstExitYear };
}

export type CareerOutcomeBucket = 'failed' | 'respectable' | 'good' | 'legendary';

/** Bucket thresholds — constants.ts's CAREER_BUCKETS, on personalCash at
 * the end of a whole career. Not the same axis as categorizeOutcome above
 * (one company's founderTakeHome). */
export function categorizeCareerOutcome(finalPersonalCash: number): CareerOutcomeBucket {
  if (finalPersonalCash < CAREER_BUCKETS.FAILED_MAX) return 'failed';
  if (finalPersonalCash < CAREER_BUCKETS.GOOD_MIN) return 'respectable';
  if (finalPersonalCash < CAREER_BUCKETS.LEGENDARY_MIN) return 'good';
  return 'legendary';
}

export function checkCareerDeterminism(seed: string, style: PlayStyle): boolean {
  const a = simulateOneRealCareer(seed, style, []);
  const b = simulateOneRealCareer(seed, style, []);
  return (
    a.companiesFounded === b.companiesFounded &&
    a.finalPersonalCash === b.finalPersonalCash &&
    JSON.stringify(a.career.companies) === JSON.stringify(b.career.companies)
  );
}

export interface CareerSimulationReport {
  style: PlayStyle;
  totalRuns: number;
  outcomes: Record<CareerOutcomeBucket, number>;
  outcomePct: Record<CareerOutcomeBucket, number>;
  companiesFounded: { median: number; mean: number };
  exits: { median: number; mean: number };
  zeroExitPct: number;
  atLeastOneExitPct: number;
  personalCash: { median: number; mean: number; p10: number; p90: number };
  invariantViolations: InvariantViolation[];
  /** "No compounding runaway" check inputs (design doc §11): good-or-better
   * rate for careers whose first exit landed by year 8 vs. every other
   * career. If an early exit reliably funded a bigger next company, this
   * ratio would run away rather than staying in a sane range. */
  earlyExitGoodOrBetterPct: number;
  otherGoodOrBetterPct: number;
}

export function runCareerSimulation(numRuns: number = 10_000, style: PlayStyle = 'sensible', seedPrefix: string = 'career'): CareerSimulationReport {
  const outcomes: Record<CareerOutcomeBucket, number> = { failed: 0, respectable: 0, good: 0, legendary: 0 };
  const companies: number[] = [];
  const exits: number[] = [];
  const cashes: number[] = [];
  let zeroExit = 0;
  let atLeastOneExit = 0;
  const violations: InvariantViolation[] = [];

  let earlyExitCount = 0;
  let earlyExitGoodOrBetter = 0;
  let otherCount = 0;
  let otherGoodOrBetter = 0;

  for (let i = 0; i < numRuns; i++) {
    const seed = `${seedPrefix}${style[0]}${i.toString(36)}`;
    const outcome = simulateOneRealCareer(seed, style, violations);
    const bucket = categorizeCareerOutcome(outcome.finalPersonalCash);
    const goodOrBetter = bucket === 'good' || bucket === 'legendary';

    outcomes[bucket]++;
    companies.push(outcome.companiesFounded);
    exits.push(outcome.career.exits);
    cashes.push(outcome.finalPersonalCash);
    if (outcome.career.exits === 0) zeroExit++;
    else atLeastOneExit++;

    if (outcome.firstExitYear !== null && outcome.firstExitYear <= 8) {
      earlyExitCount++;
      if (goodOrBetter) earlyExitGoodOrBetter++;
    } else {
      otherCount++;
      if (goodOrBetter) otherGoodOrBetter++;
    }
  }

  const outcomePct: Record<CareerOutcomeBucket, number> = {
    failed: (outcomes.failed / numRuns) * 100,
    respectable: (outcomes.respectable / numRuns) * 100,
    good: (outcomes.good / numRuns) * 100,
    legendary: (outcomes.legendary / numRuns) * 100,
  };

  return {
    style,
    totalRuns: numRuns,
    outcomes,
    outcomePct,
    companiesFounded: { median: median(companies), mean: mean(companies) },
    exits: { median: median(exits), mean: mean(exits) },
    zeroExitPct: (zeroExit / numRuns) * 100,
    atLeastOneExitPct: (atLeastOneExit / numRuns) * 100,
    personalCash: { median: median(cashes), mean: mean(cashes), p10: percentile(cashes, 0.1), p90: percentile(cashes, 0.9) },
    invariantViolations: violations,
    earlyExitGoodOrBetterPct: earlyExitCount > 0 ? (earlyExitGoodOrBetter / earlyExitCount) * 100 : 0,
    otherGoodOrBetterPct: otherCount > 0 ? (otherGoodOrBetter / otherCount) * 100 : 0,
  };
}

// ============================================================================
// Determinism check — same seed + same choices = identical run
// ============================================================================

export function checkDeterminism(seed: string, style: PlayStyle): boolean {
  const a = simulateOneCompany(seed, style, []);
  const b = simulateOneCompany(seed, style, []);
  return (
    a.yearsRun === b.yearsRun &&
    a.results.endingType === b.results.endingType &&
    a.results.founderTakeHome === b.results.founderTakeHome &&
    a.results.founderFinalShare === b.results.founderFinalShare &&
    JSON.stringify(a.eventsFired) === JSON.stringify(b.eventsFired)
  );
}

// ============================================================================
// Aggregate simulation
// ============================================================================

export type OutcomeBucket = 'failed' | 'respectable' | 'good' | 'legendary';

/** Bucket thresholds — constants.ts's BUCKETS, never adjusted here to chase
 * a target distribution. Those numbers define what the words mean. */
export function categorizeOutcome(results: RunResults): OutcomeBucket {
  if (results.endingType === 'failure') return 'failed';
  if (results.founderTakeHome >= BUCKETS.LEGENDARY_MIN) return 'legendary';
  if (results.founderTakeHome >= BUCKETS.GOOD_MIN) return 'good';
  return 'respectable';
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
  return sorted[idx];
}

export interface TierStats {
  tier: number;
  count: number;
  outcomePct: Record<OutcomeBucket, number>;
  peakRevenueMedian: number;
  fundingOfferedPct: number;
}

export interface SimulationReport {
  style: PlayStyle;
  totalRuns: number;
  elapsedMs: number;
  outcomes: Record<OutcomeBucket, number>;
  outcomePct: Record<OutcomeBucket, number>;
  years: { median: number; mean: number };
  founderFinalShare: { median: number; mean: number };
  founderTakeHome: { median: number; mean: number; p10: number; p90: number };
  peakRevenue: { median: number; mean: number; max: number };
  peakStaff: { median: number; mean: number };
  firingFrequency: Record<string, number>;
  unfiredEvents: string[];
  weatherEventFireRate: number; // fraction of fired events tagged isWeather
  orphanedConditions: string[];
  invariantViolations: InvariantViolation[];
  exitOfferedPct: number;
  exitTakenPct: number;
  exitTakenMedianYear: number | null;
  goodOrBetterPct: number; // good + legendary combined — "the lucky idiot" check for reckless
  tiers: TierStats[]; // tier 5 first — see the design doc's per-tier acceptance targets
}

export function runSimulation(numRuns: number = 10_000, style: PlayStyle = 'sensible', seedPrefix: string = 'sim'): SimulationReport {
  const start = performance.now();

  const outcomes: Record<OutcomeBucket, number> = { failed: 0, respectable: 0, good: 0, legendary: 0 };
  const years: number[] = [];
  const shares: number[] = [];
  const takeHomes: number[] = [];
  const peakRevenues: number[] = [];
  const peakStaffs: number[] = [];
  const firingFrequency: Record<string, number> = {};
  for (const e of ALL_POOL_EVENTS) firingFrequency[e.id] = 0;
  const violations: InvariantViolation[] = [];
  let offeredCount = 0;
  let takenCount = 0;
  const takenYears: number[] = [];
  let weatherFired = 0;
  let totalFired = 0;

  const byTier: Record<number, { outcomes: Record<OutcomeBucket, number>; count: number; peakRevenues: number[]; fundingOffered: number }> = {};
  for (let t = 1; t <= 5; t++) byTier[t] = { outcomes: { failed: 0, respectable: 0, good: 0, legendary: 0 }, count: 0, peakRevenues: [], fundingOffered: 0 };

  for (let i = 0; i < numRuns; i++) {
    const seed = `${seedPrefix}${style[0]}${i.toString(36)}`;
    const outcome = simulateOneCompany(seed, style, violations);

    const bucket = categorizeOutcome(outcome.results);
    outcomes[bucket]++;
    years.push(outcome.yearsRun);
    shares.push(outcome.results.founderFinalShare);
    takeHomes.push(outcome.results.founderTakeHome);
    peakRevenues.push(outcome.peakRevenue);
    peakStaffs.push(outcome.peakStaff);
    for (const id of outcome.eventsFired) {
      if (id in firingFrequency) firingFrequency[id]++;
    }
    if (outcome.exitOffered) offeredCount++;
    if (outcome.exitTakenYear !== null) {
      takenCount++;
      takenYears.push(outcome.exitTakenYear);
    }
    weatherFired += outcome.weatherEventsFired;
    totalFired += outcome.eventsFired.length;

    const tierBucket = byTier[outcome.countryTier];
    tierBucket.outcomes[bucket]++;
    tierBucket.count++;
    tierBucket.peakRevenues.push(outcome.peakRevenue);
    if (outcome.fundingOffered) tierBucket.fundingOffered++;
  }

  const elapsedMs = performance.now() - start;

  const outcomePct: Record<OutcomeBucket, number> = {
    failed: (outcomes.failed / numRuns) * 100,
    respectable: (outcomes.respectable / numRuns) * 100,
    good: (outcomes.good / numRuns) * 100,
    legendary: (outcomes.legendary / numRuns) * 100,
  };

  const tiers: TierStats[] = [5, 4, 3, 2, 1].map((t) => {
    const b = byTier[t];
    return {
      tier: t,
      count: b.count,
      outcomePct: {
        failed: b.count > 0 ? (b.outcomes.failed / b.count) * 100 : 0,
        respectable: b.count > 0 ? (b.outcomes.respectable / b.count) * 100 : 0,
        good: b.count > 0 ? (b.outcomes.good / b.count) * 100 : 0,
        legendary: b.count > 0 ? (b.outcomes.legendary / b.count) * 100 : 0,
      },
      peakRevenueMedian: median(b.peakRevenues),
      fundingOfferedPct: b.count > 0 ? (b.fundingOffered / b.count) * 100 : 0,
    };
  });

  return {
    style,
    totalRuns: numRuns,
    elapsedMs,
    outcomes,
    tiers,
    outcomePct,
    years: { median: median(years), mean: mean(years) },
    founderFinalShare: { median: median(shares), mean: mean(shares) },
    founderTakeHome: { median: median(takeHomes), mean: mean(takeHomes), p10: percentile(takeHomes, 0.1), p90: percentile(takeHomes, 0.9) },
    peakRevenue: { median: median(peakRevenues), mean: mean(peakRevenues), max: Math.max(...peakRevenues) },
    peakStaff: { median: median(peakStaffs), mean: mean(peakStaffs) },
    firingFrequency,
    unfiredEvents: Object.entries(firingFrequency)
      .filter(([, count]) => count === 0)
      .map(([id]) => id),
    weatherEventFireRate: totalFired > 0 ? weatherFired / totalFired : 0,
    orphanedConditions: findOrphanedConditions(ALL_POOL_EVENTS),
    invariantViolations: violations,
    exitOfferedPct: (offeredCount / numRuns) * 100,
    exitTakenPct: (takenCount / numRuns) * 100,
    exitTakenMedianYear: takenYears.length > 0 ? median(takenYears) : null,
    goodOrBetterPct: outcomePct.good + outcomePct.legendary,
  };
}

// ============================================================================
// CLI report
// ============================================================================

const TARGET: Record<PlayStyle, Record<OutcomeBucket, number>> = {
  reckless: { failed: 62, respectable: 26, good: 11, legendary: 1.5 },
  random: { failed: 55, respectable: 31, good: 13, legendary: 2 },
  sensible: { failed: 45, respectable: 35, good: 17, legendary: 2.5 },
};

function money(n: number): string {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${Math.round(n)}`;
}

function printDistributionTable(reports: SimulationReport[]): void {
  console.log('Outcome distribution (target in brackets, per style):');
  const header = ['bucket'.padEnd(12), ...reports.map((r) => r.style.padStart(18))].join(' ');
  console.log('  ' + header);
  (['failed', 'respectable', 'good', 'legendary'] as OutcomeBucket[]).forEach((bucket) => {
    const cells = reports.map((r) => `${r.outcomePct[bucket].toFixed(1)}% (${TARGET[r.style][bucket]}%)`.padStart(18));
    console.log(`  ${bucket.padEnd(12)} ${cells.join(' ')}`);
  });
  console.log('');
}

/** Per-country-tier breakdown — a much higher tier-1 failure rate and
 * near-zero tier-1 legendary outcomes are correct here, not a bug. Country
 * sampling for the whole harness is weighted (TIER_SAMPLE_WEIGHT) toward
 * how players actually pick, not uniform across 196 countries. */
function printTierTable(report: SimulationReport): void {
  console.log(`Per-country-tier breakdown (${report.style}, weighted sample — T5=45% T4=30% T3=17% T2=6% T1=2% of careers):`);
  console.log(
    '  ' +
      ['tier'.padEnd(6), 'n'.padStart(6), 'failed'.padStart(9), 'respect.'.padStart(9), 'good'.padStart(8), 'legend.'.padStart(8), 'peak rev median'.padStart(17), 'funding offered'.padStart(17)].join(' ')
  );
  for (const t of report.tiers) {
    console.log(
      '  ' +
        [
          `T${t.tier}`.padEnd(6),
          t.count.toString().padStart(6),
          `${t.outcomePct.failed.toFixed(1)}%`.padStart(9),
          `${t.outcomePct.respectable.toFixed(1)}%`.padStart(9),
          `${t.outcomePct.good.toFixed(1)}%`.padStart(8),
          `${t.outcomePct.legendary.toFixed(2)}%`.padStart(8),
          money(t.peakRevenueMedian).padStart(17),
          `${t.fundingOfferedPct.toFixed(1)}%`.padStart(17),
        ].join(' ')
    );
  }
  console.log('');
}

interface AcceptanceCheck {
  label: string;
  pass: boolean;
  detail: string;
}

function runAcceptanceChecks(reports: SimulationReport[], deterministic: boolean): AcceptanceCheck[] {
  const sensible = reports.find((r) => r.style === 'sensible')!;
  const reckless = reports.find((r) => r.style === 'reckless')!;
  const totalViolations = reports.reduce((s, r) => s + r.invariantViolations.length, 0);
  const p10 = sensible.founderTakeHome.p10;
  const p90 = sensible.founderTakeHome.p90;
  const spreadRatio = p10 > 0 ? p90 / p10 : Infinity;

  const t = Object.fromEntries(sensible.tiers.map((x) => [x.tier, x]));
  const failedMonotonic = t[5].outcomePct.failed < t[4].outcomePct.failed && t[4].outcomePct.failed < t[3].outcomePct.failed && t[3].outcomePct.failed < t[2].outcomePct.failed && t[2].outcomePct.failed < t[1].outcomePct.failed;
  const tier1NonFailedPct = 100 - t[1].outcomePct.failed;
  const revenueRatio = t[1].peakRevenueMedian > 0 ? t[5].peakRevenueMedian / t[1].peakRevenueMedian : Infinity;

  return [
    { label: 'sensible median peak revenue > $1.5M', pass: sensible.peakRevenue.median > 1_500_000, detail: money(sensible.peakRevenue.median) },
    { label: 'sensible median staff at peak > 8', pass: sensible.peakStaff.median > 8, detail: sensible.peakStaff.median.toFixed(1) },
    { label: 'exit offered in >= 40% of sensible careers', pass: sensible.exitOfferedPct >= 40, detail: `${sensible.exitOfferedPct.toFixed(1)}%` },
    { label: 'median sensible career 9-14 years', pass: sensible.years.median >= 9 && sensible.years.median <= 14, detail: `${sensible.years.median.toFixed(0)}y` },
    {
      label: '90th-pct sensible take-home >= 50x 10th-pct',
      pass: spreadRatio >= 50,
      detail: p10 === 0 ? `p10=$0, p90=${money(p90)} (ratio undefined/infinite, treated as pass)` : `${spreadRatio.toFixed(1)}x (p10=${money(p10)}, p90=${money(p90)})`,
    },
    { label: '>= 1% of reckless careers reach good or better', pass: reckless.goodOrBetterPct >= 1, detail: `${reckless.goodOrBetterPct.toFixed(2)}%` },
    { label: '>= 30% of sensible careers still fail (weighted country sample)', pass: sensible.outcomePct.failed >= 30, detail: `${sensible.outcomePct.failed.toFixed(1)}%` },
    { label: 'zero invariant violations', pass: totalViolations === 0, detail: `${totalViolations} found` },
    { label: 'no career exceeding $500M revenue', pass: reports.every((r) => r.peakRevenue.max <= REVENUE_OVERFLOW_CEILING), detail: money(Math.max(...reports.map((r) => r.peakRevenue.max))) },
    { label: 'same seed + same choices = identical run', pass: deterministic, detail: deterministic ? 'verified' : 'FAILED — see checkDeterminism' },
    {
      label: 'per-tier failure rate monotonic: T5 < T4 < T3 < T2 < T1',
      pass: failedMonotonic,
      detail: [5, 4, 3, 2, 1].map((n) => `T${n} ${t[n].outcomePct.failed.toFixed(1)}%`).join(', '),
    },
    { label: 'tier-1 legendary rate < 0.3%', pass: t[1].outcomePct.legendary < 0.3, detail: `${t[1].outcomePct.legendary.toFixed(2)}%` },
    { label: 'tier-5 legendary rate ~3% (1-5%)', pass: t[5].outcomePct.legendary >= 1 && t[5].outcomePct.legendary <= 5, detail: `${t[5].outcomePct.legendary.toFixed(2)}%` },
    { label: 'tier-1 careers still reach respectable-or-better at a reasonable rate (>= 15%) — hard, not hopeless', pass: tier1NonFailedPct >= 15, detail: `${tier1NonFailedPct.toFixed(1)}%` },
    { label: 'tier-1 founders offered funding in < 10% of careers', pass: t[1].fundingOfferedPct < 10, detail: `${t[1].fundingOfferedPct.toFixed(1)}%` },
    {
      label: 'median peak revenue differs >= 8x between tier 5 and tier 1',
      pass: revenueRatio >= 8,
      detail: `${revenueRatio.toFixed(1)}x (T5 ${money(t[5].peakRevenueMedian)}, T1 ${money(t[1].peakRevenueMedian)})`,
    },
  ];
}

function printReports(reports: SimulationReport[]): void {
  const totalMs = reports.reduce((s, r) => s + r.elapsedMs, 0);
  const rate = reports[0].totalRuns / (reports[0].elapsedMs / 1000);
  console.log(`\nRan ${reports[0].totalRuns.toLocaleString()} careers x ${reports.length} styles in ${totalMs.toFixed(0)}ms total (~${rate.toFixed(0)}/s per style)\n`);

  printDistributionTable(reports);

  const sensibleForTiers = reports.find((r) => r.style === 'sensible');
  if (sensibleForTiers) printTierTable(sensibleForTiers);

  console.log('Career length (years):');
  for (const r of reports) console.log(`  ${r.style.padEnd(10)} median ${r.years.median.toFixed(0).padStart(3)}   mean ${r.years.mean.toFixed(1)}`);

  console.log('\nFounder final share:');
  for (const r of reports) console.log(`  ${r.style.padEnd(10)} median ${r.founderFinalShare.median.toFixed(0)}%   mean ${r.founderFinalShare.mean.toFixed(0)}%`);

  console.log('\nFounder take-home:');
  for (const r of reports) console.log(`  ${r.style.padEnd(10)} median ${money(r.founderTakeHome.median).padStart(8)}   mean ${money(r.founderTakeHome.mean)}   p10 ${money(r.founderTakeHome.p10)}   p90 ${money(r.founderTakeHome.p90)}`);

  console.log('\nPeak revenue reached during the career:');
  for (const r of reports) console.log(`  ${r.style.padEnd(10)} median ${money(r.peakRevenue.median).padStart(8)}   mean ${money(r.peakRevenue.mean)}   max ${money(r.peakRevenue.max)}`);

  console.log('\nPeak staff:');
  for (const r of reports) console.log(`  ${r.style.padEnd(10)} median ${r.peakStaff.median.toFixed(1)}   mean ${r.peakStaff.mean.toFixed(1)}`);

  console.log('\nExit offers:');
  for (const r of reports) {
    const takenYear = r.exitTakenMedianYear !== null ? `median year ${r.exitTakenMedianYear.toFixed(0)}` : 'n/a';
    console.log(`  ${r.style.padEnd(10)} offered ${r.exitOfferedPct.toFixed(1)}%   took ${r.exitTakenPct.toFixed(1)}%   ${takenYear}`);
  }

  console.log('\nWeather events (target: ~1/6 = 16.7% of fired events):');
  for (const r of reports) console.log(`  ${r.style.padEnd(10)} ${(r.weatherEventFireRate * 100).toFixed(1)}% of fired events`);

  const primary = reports.find((r) => r.style === 'sensible') ?? reports[0];
  console.log(`\nEvents that never fired under ${primary.style} play (${primary.unfiredEvents.length} of ${Object.keys(primary.firingFrequency).length}):`);
  if (primary.unfiredEvents.length === 0) {
    console.log('  none');
  } else {
    const byId = new Map(ALL_POOL_EVENTS.map((e) => [e.id, e]));
    for (const id of primary.unfiredEvents) {
      const event = byId.get(id);
      console.log(`  - ${id}: ${event ? describeConditions(event) : '(unknown event)'}`);
    }
  }

  console.log(`\nOrphaned conditions (${primary.orphanedConditions.length}):`);
  if (primary.orphanedConditions.length === 0) {
    console.log('  none');
  } else {
    for (const line of primary.orphanedConditions) console.log(`  - ${line}`);
  }

  const totalViolations = reports.reduce((s, r) => s + r.invariantViolations.length, 0);
  console.log(`\nImpossible states detected across all styles (${totalViolations}):`);
  if (totalViolations === 0) {
    console.log('  none');
  } else {
    for (const r of reports) {
      for (const v of r.invariantViolations.slice(0, 10)) {
        console.log(`  - [${r.style}/${v.kind}] seed ${v.seed} year ${v.year}: ${v.detail}`);
      }
    }
  }

  const deterministic = checkDeterminism('determinism-check-seed', 'sensible');
  console.log('\nAcceptance checks:');
  for (const check of runAcceptanceChecks(reports, deterministic)) {
    console.log(`  [${check.pass ? 'PASS' : 'FAIL'}] ${check.label} — ${check.detail}`);
  }
  console.log('');
}

// ============================================================================
// Pass A CLI report — the CAREER_LENGTH_YEARS-year career loop. Printed as its own section
// alongside the per-company report above, which stays meaningful as "how
// one company's run behaves" (still exercised as the building block every
// career composes).
// ============================================================================

function runCareerAcceptanceChecks(report: CareerSimulationReport, deterministic: boolean): AcceptanceCheck[] {
  const runawayRatio = report.otherGoodOrBetterPct > 0 ? report.earlyExitGoodOrBetterPct / report.otherGoodOrBetterPct : Infinity;
  return [
    {
      label: 'companies per career median 2-3 (sensible)',
      pass: report.companiesFounded.median >= 2 && report.companiesFounded.median <= 3,
      detail: report.companiesFounded.median.toFixed(1),
    },
    {
      label: 'at least one exit in ~55% of careers (sensible)',
      pass: report.atLeastOneExitPct >= 45 && report.atLeastOneExitPct <= 65,
      detail: `${report.atLeastOneExitPct.toFixed(1)}%`,
    },
    {
      label: 'zero exits in ~25% of careers (sensible)',
      pass: report.zeroExitPct >= 15 && report.zeroExitPct <= 35,
      detail: `${report.zeroExitPct.toFixed(1)}%`,
    },
    { label: 'zero career-level invariant violations', pass: report.invariantViolations.length === 0, detail: `${report.invariantViolations.length} found` },
    { label: 'same seed + same choices = identical career', pass: deterministic, detail: deterministic ? 'verified' : 'FAILED — see checkCareerDeterminism' },
    {
      label: 'no compounding runaway: early-exit good-or-better rate <= 6x everyone else',
      pass: runawayRatio <= 6,
      detail: `${runawayRatio === Infinity ? 'undefined (no one else reached good-or-better)' : runawayRatio.toFixed(1) + 'x'} (early ${report.earlyExitGoodOrBetterPct.toFixed(1)}%, other ${report.otherGoodOrBetterPct.toFixed(1)}%)`,
    },
  ];
}

function printCareerReport(reports: CareerSimulationReport[]): void {
  console.log(`\n\n=== Pass A: ${CAREER_LENGTH_YEARS}-year career ===\n`);

  console.log(`Career outcome distribution (bracketed on personalCash at year ${CAREER_LENGTH_YEARS} / early retirement):`);
  const header = ['bucket'.padEnd(12), ...reports.map((r) => r.style.padStart(14))].join(' ');
  console.log('  ' + header);
  (['failed', 'respectable', 'good', 'legendary'] as CareerOutcomeBucket[]).forEach((bucket) => {
    const cells = reports.map((r) => `${r.outcomePct[bucket].toFixed(1)}%`.padStart(14));
    console.log(`  ${bucket.padEnd(12)} ${cells.join(' ')}`);
  });

  console.log('\nCompanies founded per career:');
  for (const r of reports) console.log(`  ${r.style.padEnd(10)} median ${r.companiesFounded.median.toFixed(1)}   mean ${r.companiesFounded.mean.toFixed(1)}`);

  console.log('\nExits per career:');
  for (const r of reports) {
    console.log(`  ${r.style.padEnd(10)} median ${r.exits.median.toFixed(1)}   mean ${r.exits.mean.toFixed(1)}   zero-exit ${r.zeroExitPct.toFixed(1)}%   >=1 exit ${r.atLeastOneExitPct.toFixed(1)}%`);
  }

  console.log('\npersonalCash at career end:');
  for (const r of reports) {
    console.log(`  ${r.style.padEnd(10)} median ${money(r.personalCash.median).padStart(8)}   mean ${money(r.personalCash.mean)}   p10 ${money(r.personalCash.p10)}   p90 ${money(r.personalCash.p90)}`);
  }

  const sensible = reports.find((r) => r.style === 'sensible') ?? reports[0];
  const deterministic = checkCareerDeterminism('career-determinism-check-seed', 'sensible');
  console.log('\nAcceptance checks (sensible):');
  for (const check of runCareerAcceptanceChecks(sensible, deterministic)) {
    console.log(`  [${check.pass ? 'PASS' : 'FAIL'}] ${check.label} — ${check.detail}`);
  }
  console.log('');
}

const isMain = (() => {
  try {
    return import.meta.url === `file://${process.argv[1]}`;
  } catch {
    return false;
  }
})();

if (isMain) {
  const arg = process.argv[2];
  const numRuns = arg ? parseInt(arg, 10) : 10_000;
  const styles: PlayStyle[] = ['sensible', 'random', 'reckless'];
  const reports = styles.map((style) => runSimulation(numRuns, style));
  printReports(reports);

  const careerReports = styles.map((style) => runCareerSimulation(numRuns, style));
  printCareerReport(careerReports);
}
