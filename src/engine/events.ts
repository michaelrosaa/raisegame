/**
 * Event selection and filtering
 * Match events to game state, handle conditions, select by rarity
 */

import type { EventDef, GameState, Condition, Rarity, YearRecord } from './types';
import { RNG } from './rng';
import { COUNTRIES } from './state';
import { cashLastsMonths as computeCashLastsMonths } from './economy';
import { renderEventText } from './text';

// ============================================================================
// Condition Evaluation
// ============================================================================

/**
 * Check if a condition is met given current game state
 */
export function conditionMet(condition: Condition, state: GameState): boolean {
  const cashLastsMonths = computeCashLastsMonths(state);

  switch (condition.type) {
    case 'yearMin':
      return state.year >= (condition.value as number);

    case 'yearMax':
      return state.year <= (condition.value as number);

    case 'cashLastsBelow':
      return cashLastsMonths < (condition.value as number);

    case 'cashLastsAbove':
      return state.monthlyBurn <= 0 ? true : cashLastsMonths > (condition.value as number);

    case 'revenueAbove':
      return state.annualRevenue >= (condition.value as number);

    case 'revenueBelow':
      return state.annualRevenue < (condition.value as number);

    case 'staffAbove':
      return state.staff >= (condition.value as number);

    case 'moraleBelow':
      return state.morale < (condition.value as number);

    case 'moraleAbove':
      return state.morale > (condition.value as number);

    case 'generationAbove':
      return state.generation > (condition.value as number);

    case 'climateIs':
      return state.climate === (condition.value as string);

    case 'industryIs':
      return state.company.industry === (condition.value as string);

    case 'countryHasCurrencyRisk':
      // currencyRisk is now a continuous 0-1 annual devaluation probability
      // (see turn.ts's currency-shock step) rather than a boolean — content
      // conditioned on "this country has meaningful currency risk" reads as
      // >= the old mid-tier baseline.
      return (COUNTRIES[state.founder.country]?.currencyRisk ?? 0) >= 0.2;

    case 'hasCofounder':
      // condition.value defaults to true (most content only ever authors
      // {type:'hasCofounder'} or {type:'hasCofounder', value:true}) but a
      // solo-founder-only event needs {value:false} to work, which this
      // used to ignore outright — every hasCofounder condition evaluated as
      // "true" regardless of its stated value, so no event could ever gate
      // on the ABSENCE of a cofounder.
      return state.cast.some((c) => c.role === 'cofounder') === (condition.value !== false);

    case 'hasRival':
      return state.cast.some((c) => c.role === 'rival');

    case 'hasInvestors':
      // Same value-blindness bug as hasCofounder above — see that case.
      return state.capTable.some((entry) => entry.holder !== 'You' && entry.percentage > 0) === (condition.value !== false);

    case 'isProfitable':
      return state.monthlyBurn < 0;

    case 'hasFailedBefore':
      // Inverted in the original: gated on status==='ended' (never true while
      // selecting events for a running game) AND negated the failure check,
      // so any event conditioned on this could never fire.
      return state.history.some((h) => h.endingType === 'failure');

    case 'hasLoan':
      return state.loans.length > 0 === (condition.value !== false);

    case 'bankruptciesBelow':
      return state.founderBankruptcies < (condition.value as number);

    case 'bankruptciesAbove':
      return state.founderBankruptcies > (condition.value as number);

    case 'hasFamily':
      return state.founderHasFamily === (condition.value !== false);

    case 'yearsPublicAbove':
      return (state.publicCompany?.yearsPublic ?? -1) > (condition.value as number);

    default:
      return false;
  }
}

/**
 * Check if all conditions for an event are met
 */
export function allConditionsMet(event: EventDef, state: GameState): boolean {
  if (event.conditions.length === 0) return true;
  return event.conditions.every((c) => conditionMet(c, state));
}

// ============================================================================
// Event Filtering
// ============================================================================

/**
 * Filter events by state conditions
 * Returns events that can fire given current game state
 */
export function filterEventsByConditions(events: EventDef[], state: GameState): EventDef[] {
  return events.filter((event) => allConditionsMet(event, state));
}

/**
 * Remove previously fired events from pool
 * Never repeat an event within a run
 */
export function filterFiredEvents(events: EventDef[], state: GameState): EventDef[] {
  return events.filter((event) => !state.firedEventIds.includes(event.id));
}

/** True if any option on this event carries a funding effect — used to gate
 * funding-round events behind a country's fundingAvailability (see turn.ts).
 * Content authors funding as characterId + fundingStage (resolved to a real
 * offer later — see game.ts), never a literal dollar amount, but the
 * presence of the effect type alone is enough to know an event is "about"
 * a funding round. */
export function eventOffersFunding(event: EventDef): boolean {
  return event.options.some((o) => o.effects.some((e) => e.type === 'funding'));
}

/** Strips funding-carrying options from an event when the funding gate is
 * closed — used for Year One's "how will you pay for year one" choice,
 * which (unlike the rest of the pool) is guaranteed content rather than
 * something selectEventForYear can simply skip. Never strips down to zero
 * options: if every option happened to carry funding, the event is left
 * alone rather than presenting an empty choice. */
export function applyFundingGateToEvent(event: EventDef, gateOpen: boolean): EventDef {
  if (gateOpen) return event;
  const withoutFunding = event.options.filter((o) => !o.effects.some((e) => e.type === 'funding'));
  return withoutFunding.length > 0 ? { ...event, options: withoutFunding } : event;
}

/**
 * Filter eligible events for selection. `fundingGateOpen` — rolled once per
 * year in turn.ts against the country's fundingAvailability × climate —
 * drops funding-round events entirely when closed, so a tier-1 founder
 * essentially never sees one (bootstrap or die), rather than merely seeing
 * a worse offer.
 */
export function getEligibleEvents(events: EventDef[], state: GameState, fundingGateOpen: boolean = true): EventDef[] {
  const byConditions = filterEventsByConditions(events, state);
  const unfired = filterFiredEvents(byConditions, state);
  return fundingGateOpen ? unfired : unfired.filter((e) => !eventOffersFunding(e));
}

// ============================================================================
// Rarity Weighting
// ============================================================================

/**
 * Rarity weight distribution
 * Returned as counts out of 100 for easy probability calculation
 */
export const RARITY_WEIGHTS: Record<Rarity, number> = {
  common: 60,
  uncommon: 25,
  rare: 12,
  absurd: 3,
};

/**
 * Select an event by weighted rarity. `moneyWeightMultiplier` (default 1,
 * a no-op) boosts money-category events under financial pressure — see
 * failure.ts's PRESSURE_CATEGORY_WEIGHT_MULTIPLIER and turn.ts's call site.
 */
export function selectEventByRarity(events: EventDef[], rng: RNG, moneyWeightMultiplier: number = 1): EventDef {
  if (events.length === 0) throw new Error('Cannot select event from empty pool');
  if (events.length === 1) return events[0];

  // Build weighted list
  const weighted = events.map((event) => ({
    value: event,
    weight: RARITY_WEIGHTS[event.rarity] * (event.category === 'money' ? moneyWeightMultiplier : 1),
  }));

  return rng.pickWeighted(weighted);
}

// ============================================================================
// Gamble Logic
// ============================================================================

/**
 * Check if a gamble can fire this year
 * Rules:
 * 1. At most 1-2 gambles per career (3 for very long ones)
 * 2. Minimum 3 years between gambles
 * 3. Gamble must be eligible
 */
export function canFireGamble(state: GameState, gambleEvent: EventDef, minYearsSinceLast: number = 3): boolean {
  if (!gambleEvent.isGamble) return false;

  // Count gambles already fired
  const gamblesFired = state.history.filter((h) => h.gambleResult).length;

  // Career length caps
  const careerLength = state.year;
  const gambleQuota = careerLength < 15 ? 1 : careerLength < 25 ? 2 : 3;

  if (gamblesFired >= gambleQuota) return false;

  // Spacing check
  if (state.lastGambleYear !== null && state.year - state.lastGambleYear < minYearsSinceLast) {
    return false;
  }

  return true;
}

/**
 * Select event for the current year
 * Handles gamble probability and rarity selection
 */
export function selectEventForYear(
  allEvents: EventDef[],
  state: GameState,
  rng: RNG,
  gambleProbability: number = 0.15, // 15% chance if eligible
  fundingGateOpen: boolean = true,
  moneyWeightMultiplier: number = 1
): EventDef | null {
  const eligible = getEligibleEvents(allEvents, state, fundingGateOpen);

  if (eligible.length === 0) {
    return null;
  }

  // Separate gambles from regular events
  const gambles = eligible.filter((e) => e.isGamble);
  const regular = eligible.filter((e) => !e.isGamble);

  // Try to select a gamble
  if (gambles.length > 0) {
    const selectableGambles = gambles.filter((g) => canFireGamble(state, g));

    if (selectableGambles.length > 0 && rng.roll(gambleProbability * 100)) {
      return selectEventByRarity(selectableGambles, rng, moneyWeightMultiplier);
    }
  }

  // Select regular event by rarity. On a long-running career the regular
  // pool can run dry while gambles are still eligible (every non-gamble
  // event already fired) — selectEventByRarity throws on an empty array,
  // so fall back to a gamble here (still respecting quota/spacing) rather
  // than crash the turn. If even that comes up empty, there's genuinely
  // nothing left this year — same as the eligible.length===0 case above.
  if (regular.length === 0) {
    const selectableGambles = gambles.filter((g) => canFireGamble(state, g));
    if (selectableGambles.length === 0) return null;
    return selectEventByRarity(selectableGambles, rng, moneyWeightMultiplier);
  }
  return selectEventByRarity(regular, rng, moneyWeightMultiplier);
}

// ============================================================================
// Story Generation
// ============================================================================

/**
 * Mark an event as fired in the history
 */
export function fireEvent(
  state: GameState,
  event: EventDef,
  chosenOptionId: string,
  gambleResult?: 'won' | 'lost',
  funding?: YearRecord['funding'],
  endingType?: YearRecord['endingType'],
  exitPrice?: number
): GameState {
  const option = event.options.find((o) => o.id === chosenOptionId);
  if (!option) {
    throw new Error(`Option ${chosenOptionId} not found in event ${event.id}`);
  }

  // Pick the gamble-outcome-specific headline when there is one, else the
  // option's own. Resolved against `state` (post-effects, so a character
  // this very choice just cast is already available to reference) exactly
  // once here — the story feed and results card read the resolved text
  // straight out of history forever after, never re-resolving it, so a
  // later change in cast can't retroactively rewrite what already happened.
  const rawStoryHeadline =
    gambleResult === 'won'
      ? option.gamble?.winStoryHeadline ?? option.storyHeadline
      : gambleResult === 'lost'
        ? option.gamble?.loseStoryHeadline ?? option.storyHeadline
        : option.storyHeadline;

  const record = {
    year: state.year,
    eventId: event.id,
    eventHeadline: renderEventText(event.headline, state),
    chosenOptionId,
    optionLabel: renderEventText(option.label, state),
    tag: option.tag,
    storyHeadline: renderEventText(rawStoryHeadline, state),
    annualRevenue: state.annualRevenue,
    staff: state.staff,
    climate: state.climate,
    gambleResult,
    funding,
    endingType,
    exitPrice,
  };

  const newHistory = [...state.history, record];
  const newFiredIds = [...state.firedEventIds, event.id];
  const newLastGambleYear = gambleResult ? state.year : state.lastGambleYear;

  return {
    ...state,
    history: newHistory,
    firedEventIds: newFiredIds,
    lastGambleYear: newLastGambleYear,
  };
}
