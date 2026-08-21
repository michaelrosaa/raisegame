/**
 * Applying the growth-system event effects: growthMultiplier, growthSet,
 * and revenueStep. Events modify growth, not revenue directly — see
 * economy.ts's computeGrowth, which reads what this file writes.
 *
 * Timing note: a choice's effects apply AFTER that year's growth has
 * already been computed (growth runs first in turn.ts's advanceYear,
 * before the event is even presented) — so a growthMultiplier granted by a
 * choice made in year Y first affects growth starting year Y+1. `years: N`
 * means N growth ticks (Y+1 .. Y+N), which is why expiresYear is set to
 * `state.year + years` and pruned with `state.year <= expiresYear`
 * (evaluated at the top of each subsequent year, after the year counter
 * has already been incremented) rather than a strict `<`.
 */

import type { EffectValue, GameState } from './types';

export function applyGrowthEffect(state: GameState, effect: EffectValue): GameState {
  switch (effect.type) {
    case 'growthMultiplier': {
      const years = effect.years ?? 1;
      const modifier = { value: effect.value ?? 1, expiresYear: state.year + years };
      return { ...state, growthModifiers: [...state.growthModifiers, modifier] };
    }
    case 'growthSet':
      return { ...state, forcedGrowthOverride: effect.value ?? 0 };
    case 'revenueStep':
      return { ...state, pendingRevenueStep: state.pendingRevenueStep + (effect.value ?? 0) };
    default:
      return state;
  }
}

/** Drop modifiers whose window has passed. Called once per year, before
 * computeGrowth, so activeGrowthMultiplier only ever sees live modifiers. */
export function pruneExpiredModifiers(state: GameState): GameState {
  const live = state.growthModifiers.filter((m) => state.year <= m.expiresYear);
  if (live.length === state.growthModifiers.length) return state;
  return { ...state, growthModifiers: live };
}

/** Consume and clear the accumulated one-time revenue steps for this
 * year's growth tick — the amount is folded into annualRevenue once, by
 * the caller, then this resets to 0 so it isn't reapplied next year. */
export function takeRevenueSteps(state: GameState): { state: GameState; amount: number } {
  if (state.pendingRevenueStep === 0) return { state, amount: 0 };
  return { state: { ...state, pendingRevenueStep: 0 }, amount: state.pendingRevenueStep };
}

/** A growthSet override applies to exactly one year's growth computation,
 * then clears — called right after computeGrowth reads it. */
export function clearForcedGrowthOverride(state: GameState): GameState {
  if (state.forcedGrowthOverride === null) return state;
  return { ...state, forcedGrowthOverride: null };
}
