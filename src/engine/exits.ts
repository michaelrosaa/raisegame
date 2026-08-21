/**
 * Exit eligibility and pricing — acquisition offers, IPO windows, and the
 * standing "stop here" option. These are consequences of the company's
 * state, not content drawn from the random event pool: an acquisition
 * offer should never compete against "the office floods" for the same
 * slot. turn.ts calls canSell/canIPO + rollOffer/rollIPO ahead of the
 * normal weighted draw every year, and attachRetirementOption() on
 * whatever event ends up selected (generated or drawn).
 *
 * Pricing (§8.3): the exit multiple is drawn per offer, seeded — same
 * company, same year, different buyer, different life. Not a single
 * deterministic number.
 */

import type { Character, CharacterTemplate, EventDef, GameState, OptionDef } from './types';
import type { Rng } from './rng';
import { gaussian } from './rng';
import { createCharacterFromTemplate } from './cast';
import { getFounderShare } from './state';
import { calculateLiquidationValue, isProfitable, countryFor, marketCapFor, glamourOf, glamourExitMultipleFactor } from './economy';
import { canonicalIndustry, EXIT, CLIMATE_EXIT, STANDING_RETIREMENT_MIN_YEAR, EXIT_MARKET_REFERENCE, CURRENCY_SHOCK_MIN, CURRENCY_SHOCK_MAX, PUBLIC_MARKET, STANDING_OPTION_SHOW_CHANCE } from './constants';

/** The three standing-option ids exits.ts can append to an event — used by
 * turn.ts to detect whether one actually got attached this year, so it
 * knows whether to roll a fresh cooldown (see constants.ts's
 * STANDING_OPTION_SHOW_CHANCE comment). */
export const STANDING_OPTION_IDS = ['stand-retire', 'stand-sell-shares', 'stand-resign-public'] as const;
import { formatMoney, formatPercent } from './format';

// ============================================================================
// Eligibility
// ============================================================================

export function canSell(state: GameState): boolean {
  return state.annualRevenue >= EXIT.MIN_REVENUE && state.status === 'running';
}

export function canIPO(state: GameState): boolean {
  return (
    state.annualRevenue >= EXIT.IPO_MIN_REVENUE &&
    state.year >= EXIT.IPO_MIN_YEAR &&
    isProfitable(state) &&
    state.status === 'running' &&
    !state.publicCompany // a company can't IPO twice
  );
}

/** Acquirers cluster in rich markets — exitMarket scales the base offer
 * chance relative to EXIT_MARKET_REFERENCE (a tier-5 country's exitMarket,
 * ~0.90, is what EXIT.BASE_OFFER_CHANCE was already tuned against). A
 * tier-1 country's exitMarket (~0.03) makes an offer nearly impossible,
 * which is deliberate — see the design doc's "you can't sell" difficulty
 * dimension. */
function exitMarketFactor(state: GameState): number {
  return countryFor(state.founder.country).exitMarket / EXIT_MARKET_REFERENCE;
}

/** Once eligible, a flat per-year chance (constants.ts's EXIT.BASE_OFFER_CHANCE)
 * scaled by the local exit market — a spurned buyer returning is a little
 * more persistent, everything else about climate/size shows up in the
 * PRICE (CLIMATE_EXIT) rather than in whether an offer shows up at all. */
export function rollOffer(state: GameState, rng: Rng): boolean {
  const returning = state.chainFlags.declinedAcquisition !== undefined ? 1.3 : 1;
  return rng.next() < Math.min(0.9, EXIT.BASE_OFFER_CHANCE * returning * exitMarketFactor(state));
}

export function rollIPO(state: GameState, rng: Rng): boolean {
  return rng.next() < EXIT.BASE_OFFER_CHANCE * exitMarketFactor(state);
}

// ============================================================================
// Pricing (§8.3) — drawn per offer, seeded, never a single deterministic
// number: price = revenue * multiple * CLIMATE_EXIT[climate], where
// multiple = uniform(industry range) * exp(gaussian(0, MULTIPLE_SIGMA)).
// ============================================================================

export function drawExitMultiple(state: GameState, rng: Rng): number {
  const [lo, hi] = EXIT.MULTIPLE_RANGE[canonicalIndustry(state.company.industry)];
  const base = lo + rng.next() * (hi - lo);
  // exitMarket also scales the multiple itself — a thin exit market doesn't
  // just make offers rarer, the offers it does produce pay worse too. Only
  // ever dampens (never boosts past the base-tuned multiple).
  const marketMultiple = Math.min(1, 0.4 + 0.6 * exitMarketFactor(state));
  // "Better acquisition multiples if you survive" for a glamorous business
  // — see economy.ts's glamourExitMultipleFactor.
  return base * Math.exp(gaussian(rng, 0, EXIT.MULTIPLE_SIGMA)) * marketMultiple * glamourExitMultipleFactor(glamourOf(state));
}

export function computeExitPrice(state: GameState, rng: Rng): number {
  const multiple = drawExitMultiple(state, rng);
  return Math.round(state.annualRevenue * multiple * CLIMATE_EXIT[state.climate]);
}

// ============================================================================
// Acquisition offers
// ============================================================================

export type AcquisitionVariant = 'clean' | 'earnout' | 'acquihire' | 'strategic' | 'lowball' | 'conditional';

const VARIANT_COPY: Record<AcquisitionVariant, { headline: string; body: string }> = {
  clean: { headline: 'wants to buy {COMPANY}, no complications', body: 'A straight cash offer. Sign, close, done in a month.' },
  earnout: { headline: 'offers to buy {COMPANY}, half now', body: 'Half the price today, the rest over two years if the numbers hold up.' },
  acquihire: { headline: 'wants the team, not the company', body: 'The product gets shut down. Everyone gets a job offer, you get a modest check.' },
  strategic: { headline: 'will pay a premium for {COMPANY}', body: 'You are worth more to them than to anyone else — for reasons that will not last forever.' },
  lowball: { headline: 'floats a lowball number for {COMPANY}', body: "It's an opening bid, not a final one. Whether it is worth negotiating is another question." },
  conditional: { headline: 'wants to buy {COMPANY}, with conditions', body: 'The price is real. So is the two-year clause that keeps you in the building.' },
};

function resolveAcquirer(state: GameState, rng: Rng, characterPool: CharacterTemplate[]): Character {
  const existing = state.cast.find((c) => c.role === 'acquirer');
  if (existing) return existing;
  const templates = characterPool.filter((c) => c.role === 'acquirer');
  if (templates.length === 0) {
    throw new Error('No acquirer characters available in the character pool');
  }
  const template = templates[Math.floor(rng.next() * templates.length)];
  return createCharacterFromTemplate(template, state.cast);
}

function pickVariant(rng: Rng, returning: boolean): AcquisitionVariant {
  const pool: AcquisitionVariant[] = returning ? ['clean', 'strategic', 'earnout', 'conditional'] : ['clean', 'earnout', 'acquihire', 'strategic', 'lowball', 'conditional'];
  return pool[Math.floor(rng.next() * pool.length)];
}

export function buildAcquisitionOfferEvent(state: GameState, rng: Rng, characterPool: CharacterTemplate[]): EventDef {
  const buyer = resolveAcquirer(state, rng, characterPool);
  const returning = state.chainFlags.declinedAcquisition !== undefined;
  const variant = pickVariant(rng, returning);
  const price = computeExitPrice(state, rng);
  const founderTakeHome = Math.round((price * getFounderShare(state.capTable)) / 100);
  const copy = VARIANT_COPY[variant];
  const buyerName = buyer.firm ?? buyer.fullName;

  const acceptOption: OptionDef = {
    id: 'exit-accept',
    label: `Sell to ${buyerName}`,
    detail: `${formatMoney(price)} total. You take home ${formatMoney(founderTakeHome)} for your ${formatPercent(getFounderShare(state.capTable), 0)}.`,
    effects: [{ type: 'end', endingType: 'sale', exitPrice: price }],
    storyHeadline: `${buyerName} buys ${state.company.name}`,
    tag: 'ACQUIRED',
    icon: 'investor',
  };

  const declineOption: OptionDef = {
    id: 'exit-decline',
    label: 'Turn down the offer',
    detail: `Stay independent. ${buyer.fullName} may or may not come back with a better number.`,
    effects: [
      { type: 'chainFlag', chainFlagKey: 'declinedAcquisition' },
      { type: 'sentiment', characterId: buyer.id, value: -5 },
    ],
    storyHeadline: `Turned down ${buyerName}`,
    tag: 'TURNED IT DOWN',
    icon: 'default',
  };

  return {
    id: `generated-acquisition-${state.year}`,
    rarity: 'rare',
    isGamble: false,
    conditions: [],
    headline: `${buyer.fullName} ${copy.headline.replace('{COMPANY}', state.company.name)}`,
    body: copy.body,
    options: [acceptOption, declineOption],
  };
}

// ============================================================================
// IPO
// ============================================================================

export function buildIPOOfferEvent(state: GameState, rng: Rng): EventDef {
  const price = computeExitPrice(state, rng);
  const founderTakeHome = Math.round((price * getFounderShare(state.capTable)) / 100);

  const acceptOption: OptionDef = {
    id: 'exit-ipo',
    label: 'File for an IPO',
    detail: `List at roughly ${formatMoney(price)}. Your ${formatPercent(getFounderShare(state.capTable), 0)} is worth ${formatMoney(founderTakeHome)} on paper, in shares you cannot sell for a while. The company keeps going — this isn't an exit.`,
    // Not an 'end' effect — going public is a funding event, not an
    // ending (Pass D). 'goPublic' reads this same pre-priced `exitPrice`
    // as the IPO valuation, so the number the player saw here never
    // drifts from the resulting share price.
    effects: [{ type: 'goPublic', exitPrice: price }],
    storyHeadline: `${state.company.name} goes public`,
    tag: 'WENT PUBLIC',
    icon: 'investor',
  };

  const declineOption: OptionDef = {
    id: 'exit-ipo-decline',
    label: 'Turn down the window',
    detail: 'Stay private. The markets may not be this generous again.',
    effects: [{ type: 'chainFlag', chainFlagKey: 'declinedIPO' }],
    storyHeadline: `${state.company.name} passes on going public`,
    tag: 'TURNED IT DOWN',
    icon: 'default',
  };

  return {
    id: `generated-ipo-${state.year}`,
    rarity: 'rare',
    isGamble: false,
    conditions: [],
    headline: 'The market wants you public',
    body: 'Bankers have been calling for a year. The window is open — it will not stay open forever.',
    options: [acceptOption, declineOption],
  };
}

// ============================================================================
// Currency shock — "the currency can erase you." An annual, per-country
// devaluation roll (currencyRisk) ahead of the normal event draw, same
// priority slot as an exit offer. Framed as weather, not punishment — it
// always produces a story headline, never a silent stat change.
// ============================================================================

export function rollCurrencyShock(state: GameState, rng: Rng): boolean {
  return rng.next() < countryFor(state.founder.country).currencyRisk;
}

function drawCurrencyShockSeverity(rng: Rng): number {
  return CURRENCY_SHOCK_MIN + rng.next() * (CURRENCY_SHOCK_MAX - CURRENCY_SHOCK_MIN);
}

export function buildCurrencyShockEvent(state: GameState, rng: Rng): EventDef {
  const pct = Math.round(drawCurrencyShockSeverity(rng) * 100);

  const continueOption: OptionDef = {
    id: 'currency-shock-continue',
    label: 'Ride it out',
    detail: `Cash and revenue both take the hit in dollar terms. The business itself hasn't changed — the currency it's priced in has.`,
    effects: [
      { type: 'cash', value: -pct, unit: 'percent' },
      { type: 'annualRevenue', value: -pct, unit: 'percent' },
      // A devaluation doesn't just erase a day's cash — it disrupts the
      // business for a while after (repricing, contracts, supply costs
      // catching up). Chronically shock-prone countries (high currencyRisk)
      // can end up with several of these overlapping at once, which is the
      // point: repeated shocks compound, they don't just add up.
      { type: 'growthMultiplier', value: 0.78, years: 2 },
    ],
    storyHeadline: `The currency drops ${pct}% overnight`,
    tag: 'DEVALUATION',
    icon: 'default',
  };

  return {
    id: `generated-currency-shock-${state.year}`,
    rarity: 'rare',
    isGamble: false,
    conditions: [],
    headline: 'The currency just moved',
    body: `Overnight, the local currency loses ${pct}% of its dollar value. ${state.company.name}'s cash and revenue both shrink in dollar terms — nothing about the business itself changed.`,
    options: [continueOption],
  };
}

// ============================================================================
// Standing retirement option — "stop here", appended to whatever event is
// showing once the company is profitable and past a maturity threshold.
// Distinct from the always-available early "retire now and cash out" exit:
// this one is the dignified version, offered because there is finally
// something worth stopping for. Retirement pricing is deliberately NOT
// part of the seeded exit-multiple system — it's the one exit the founder
// fully controls the timing of, so it stays the plain calculateLiquidationValue
// formula (economy.ts).
//
// Eligibility alone doesn't mean it's ATTACHED every single year — once
// eligible, each attach* function below also rolls STANDING_OPTION_SHOW_CHANCE
// so "stop here"/"sell shares"/"resign" surface intermittently rather than
// stapled onto every remaining event for the rest of the run. The always-
// available "retire now" button elsewhere in the UI still exists for a
// player who wants to act immediately regardless of whether it happened to
// roll this year.
//
// MAX_EVENT_OPTIONS caps how many choices a player is ever shown at once —
// content never authors more than 3 to begin with, but a handful of
// 3-option events would otherwise become 4 the moment a standing option
// rides along on top. Each attach* function below skips attaching entirely
// once an event is already at the cap, rather than trimming an authored
// option to make room — the standing option simply doesn't surface that
// year (same as any other year it doesn't win its show-chance roll).
// ============================================================================

const MAX_EVENT_OPTIONS = 3;

export function canRetire(state: GameState): boolean {
  // Once public, "stop here" means something different — see
  // buildResignPublicOption below, priced off the real market cap instead
  // of the private calculateLiquidationValue guess.
  return state.status === 'running' && state.year >= STANDING_RETIREMENT_MIN_YEAR && isProfitable(state) && !state.publicCompany;
}

export function buildRetirementOption(state: GameState): OptionDef {
  const liquidationValue = calculateLiquidationValue(state);
  const founderTakeHome = Math.round((liquidationValue * getFounderShare(state.capTable)) / 100);

  return {
    id: 'stand-retire',
    label: 'Stop here',
    detail: `Sell your stake and go. Roughly ${formatMoney(founderTakeHome)} for you, and no more of this.`,
    effects: [{ type: 'end', endingType: 'retirement', exitPrice: liquidationValue }],
    storyHeadline: `${state.founder.name} cashes out and calls it done`,
    tag: 'RETIRED',
    icon: 'solo',
  };
}

export function attachRetirementOption(event: EventDef, state: GameState, rng: Rng): EventDef {
  if (!canRetire(state)) return event;
  if (event.options.some((o) => o.id === 'stand-retire')) return event;
  if (event.options.length >= MAX_EVENT_OPTIONS) return event;
  if (state.year < state.nextStandingOptionYear) return event;
  if (rng.next() >= STANDING_OPTION_SHOW_CHANCE) return event;
  return { ...event, options: [...event.options, buildRetirementOption(state)] };
}

// ============================================================================
// Public-company standing options (Pass D) — "sell some of your stake" and
// "resign and cash out everything," appended once the lockup has passed.
// Distinct from the private standing retirement option above (guarded off
// once public, canRetire) — these price off the real market cap, not a
// private-company liquidation guess.
// ============================================================================

function canActOnPublicStake(state: GameState): boolean {
  return !!state.publicCompany && state.publicCompany.lockupYearsRemaining <= 0 && state.status === 'running';
}

export function buildShareSaleOption(state: GameState): OptionDef {
  const pc = state.publicCompany!;
  const pct = Math.min(PUBLIC_MARKET.SELL_NO_IMPACT_PCT, getFounderShare(state.capTable));
  const proceeds = Math.round(marketCapFor(pc) * (pct / 100));
  return {
    id: 'stand-sell-shares',
    label: `Sell ${pct}% of your stake`,
    detail: `${formatMoney(proceeds)} in cash, quietly — small enough that the market won't read anything into it.`,
    effects: [{ type: 'sellShares', value: pct }],
    storyHeadline: 'Sold a small slice of the stake',
    tag: 'SOLD QUIETLY',
    icon: 'solo',
  };
}

export function attachShareSaleOption(event: EventDef, state: GameState, rng: Rng): EventDef {
  if (!canActOnPublicStake(state)) return event;
  if (event.options.some((o) => o.id === 'stand-sell-shares')) return event;
  if (event.options.length >= MAX_EVENT_OPTIONS) return event;
  if (state.year < state.nextStandingOptionYear) return event;
  if (rng.next() >= STANDING_OPTION_SHOW_CHANCE) return event;
  return { ...event, options: [...event.options, buildShareSaleOption(state)] };
}

/** A full walk-away only makes sense once there's been time to actually
 * build something worth walking away from — otherwise "IPO, then resign
 * next year" reads as an anticlimax rather than a real ending. */
const MIN_YEARS_PUBLIC_TO_RESIGN = 2;

export function canResignPublic(state: GameState): boolean {
  return canActOnPublicStake(state) && (state.publicCompany?.yearsPublic ?? 0) >= MIN_YEARS_PUBLIC_TO_RESIGN;
}

export function buildResignPublicOption(state: GameState): OptionDef {
  const pc = state.publicCompany!;
  const founderPct = getFounderShare(state.capTable);
  // exitPrice is the FULL company value, same convention as sale/retirement
  // (buildAcquisitionOfferEvent's `price`, buildRetirementOption's
  // `liquidationValue`) — generateExitedPublicOutcome applies founderShare
  // exactly once, itself. founderTakeHome here is only for the display
  // string, computed the same way, never fed back in.
  const marketCap = marketCapFor(pc);
  const founderTakeHome = Math.round(marketCap * (founderPct / 100));
  return {
    id: 'stand-resign-public',
    label: 'Resign and cash out',
    detail: `Sell everything you still hold at today's price. Roughly ${formatMoney(founderTakeHome)}, and you're done here.`,
    effects: [{ type: 'end', endingType: 'exitedPublic', exitPrice: Math.round(marketCap) }],
    storyHeadline: `${state.founder.name} resigns and cashes out`,
    tag: 'RESIGNED',
    icon: 'solo',
  };
}

export function attachResignPublicOption(event: EventDef, state: GameState, rng: Rng): EventDef {
  if (!canResignPublic(state)) return event;
  if (event.options.some((o) => o.id === 'stand-resign-public')) return event;
  if (event.options.length >= MAX_EVENT_OPTIONS) return event;
  if (state.year < state.nextStandingOptionYear) return event;
  if (rng.next() >= STANDING_OPTION_SHOW_CHANCE) return event;
  return { ...event, options: [...event.options, buildResignPublicOption(state)] };
}

// ============================================================================
// Quiet-year rhythm — after a dramatic year (a gamble resolved, or an exit
// offer was turned down), the pool of low-stakes filler events becomes a
// deliberate breather rather than a last-resort fallback for an exhausted
// main pool. See turn.ts's advanceYear for where this is consulted.
// ============================================================================

export function wasLastYearDramatic(state: GameState): boolean {
  const last = state.history[state.history.length - 1];
  if (!last) return false;
  return last.gambleResult !== undefined || last.tag === 'TURNED IT DOWN';
}
