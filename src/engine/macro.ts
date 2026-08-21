/**
 * Macro cycle management
 * Manages the 4-cycle: frothy → cooling → frozen → recovering
 * Players see only mood in the header and market impact on valuations
 */

import type { GameState, Climate } from './types';
import { MACRO_SEQUENCE } from './state';
import { RNG } from './rng';

// ============================================================================
// Macro Cycle State Machine
// ============================================================================

/**
 * Initialize the macro cycle for a new game
 * Each phase lasts 2-5 years
 */
export function initializeMacroPhase(state: GameState, rng: RNG): GameState {
  const phaseDuration = rng.nextInt(2, 5);
  const phaseEnd = state.year + phaseDuration;

  return {
    ...state,
    climate: 'frothy', // Always start in frothy times
    macroPhaseEnd: phaseEnd,
  };
}

/**
 * Advance macro cycle if current phase ends
 * Called once per year
 */
export function advanceMacroPhase(state: GameState, rng: RNG): GameState {
  if (state.year < state.macroPhaseEnd) {
    return state; // Current phase continues
  }

  // Find current position in cycle
  const currentIndex = MACRO_SEQUENCE.indexOf(state.climate);
  const nextIndex = (currentIndex + 1) % MACRO_SEQUENCE.length;
  const nextClimate = MACRO_SEQUENCE[nextIndex];

  const phaseDuration = rng.nextInt(2, 5);
  const phaseEnd = state.year + phaseDuration;

  return {
    ...state,
    climate: nextClimate,
    macroPhaseEnd: phaseEnd,
  };
}

/**
 * Get the flavor text for current climate phase
 * Displayed in header chip
 */
export function getClimateFlavorText(climate: Climate): string {
  const flavors: Record<Climate, string> = {
    frothy: 'Investors are eager. Money is plentiful.',
    cooling: 'Market sentiment shifting. Funding tightens.',
    frozen: 'Capital dried up. Survival mode.',
    recovering: 'Green shoots. Cautious optimism.',
  };
  return flavors[climate];
}

/**
 * Get the climate header chip display string
 */
export function getClimateChip(climate: Climate): string {
  const labels: Record<Climate, string> = {
    frothy: 'MONEY IS FROTHY',
    cooling: 'MONEY IS COOLING',
    frozen: 'MONEY IS FROZEN',
    recovering: 'MONEY IS RECOVERING',
  };
  return labels[climate];
}

/**
 * How many years left in current phase?
 */
export function yearsLeftInPhase(state: GameState): number {
  return Math.max(0, state.macroPhaseEnd - state.year);
}

/**
 * Is this a critical macro year? (phase about to end)
 */
export function isCriticalMacroYear(state: GameState): boolean {
  return yearsLeftInPhase(state) <= 1;
}
