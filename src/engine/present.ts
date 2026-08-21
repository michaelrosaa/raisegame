/**
 * Pure derivation of small display facts from GameState/RunResults — the
 * calendar year, cash-runway tone, and the header's dynamic status tag.
 * Kept out of ui/ because none of this is a rendering concern: it's "what
 * does this number mean," which belongs next to the state it reads so
 * there is exactly one place that decides it.
 */

import type { GameState } from './types';
import { isProfitable } from './economy';
import { dangerState } from './failure';
import { CALENDAR_YEAR_AT_FOUNDING } from './constants';

export type Tone = 'positive' | 'neutral' | 'warning' | 'negative';

export { CALENDAR_YEAR_AT_FOUNDING };

/** `anchorCalendarYear` is the real calendar year relative-year 1 lands on
 * (GameState.foundedCalendarYear for a company, CareerState.foundedCalendarYear
 * for a career/generation); `relativeYear` is the 1-indexed year counted from
 * there. Generic on purpose — a company's own GameState.year and a career's
 * absolute careerYear both go through this same function, each with their
 * own anchor, so re-founding a company and handing over to a new generation
 * both stay calendar-continuous instead of either one snapping back to
 * "today." See career.ts's foundCompany/handOverToHeir for where each
 * anchor actually gets computed. */
export function calendarYearFor(anchorCalendarYear: number, relativeYear: number): number {
  return anchorCalendarYear - 1 + relativeYear;
}

export function calendarYear(state: GameState): number {
  return calendarYearFor(state.foundedCalendarYear, state.year);
}

export interface LabelWithTone {
  label: string;
  tone: Tone;
}

/**
 * CASH LASTS tone, matching formatRunway's four bands: profitable and
 * comfortable (>30mo) both read as good news; the 6–30 month middle band is
 * plain; under 6 months is the one that should actually alarm someone.
 */
export function cashLastsTone(state: GameState): Tone {
  if (state.monthlyBurn <= 0) return 'positive';
  const months = state.cash / state.monthlyBurn;
  if (months < 6) return 'negative';
  if (months < 12) return 'warning';
  return 'positive';
}

/**
 * The header's third tag: FOUNDING before any choice is made, PROFITABLE
 * whenever that's true (a financial fact takes priority over history), else
 * whatever the most recently chosen option tagged itself as.
 */
export function companyStatusTag(state: GameState): string {
  if (isProfitable(state)) return 'PROFITABLE';
  // Serious/critical danger overrides whatever the last chosen option's tag
  // was — a founder needs the header to say what's actually happening now,
  // not what happened last year. See engine/failure.ts's dangerState.
  const danger = dangerState(state);
  if (danger === 'serious' || danger === 'critical') return 'RUNNING OUT';

  for (let i = state.history.length - 1; i >= 0; i--) {
    const tag = state.history[i].tag;
    if (tag) return tag;
  }

  return 'FOUNDING';
}
