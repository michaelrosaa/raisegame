/**
 * The yearly turn — the exact order below is load-bearing; deviating
 * changes the balance:
 *   1. Economy moves on its own (growth, staff, burn — before any event),
 *      then any loan balances pay down by this year's straight-line slice.
 *      Cash itself does NOT move yet — see step 3.
 *   1.5. If public, the share price moves and the lockup/board/sentiment
 *      tick forward — see economy.ts's updateSharePrice
 *   2. Macro cycle ticks
 *   3. Insolvency, checked every turn: if this year's burn would take cash
 *      negative, the rescue event intercepts BEFORE that decrement is
 *      applied (cooldown-gated — see failure.ts's rescueEventAvailable);
 *      otherwise the decrement applies for real and, if that's negative,
 *      the company ends right here
 *   3.2. Board removal, public companies only — boardPatience hit 0
 *   3.5. Currency shock roll (country's currencyRisk), ahead of exits
 *   4. Exit opportunities, ahead of the event draw (IPO only if not
 *      already public; acquisition offers still apply either way)
 *   5. Otherwise, the normal (possibly quiet-year) event draw — funding-round
 *      events gated behind the country's fundingAvailability × climate.
 *      Once public, this draws from a completely separate pool instead
 *      (ctx.postIpoEvents) — a public company doesn't see Series A events
 *      or "the office floods," it sees activist investors and downgrades.
 *   6. Retirement (private) or share-sale/resignation (public) ride along
 *      as standing extra options once eligible
 *
 * Note on the Rng type: economy.ts/exits.ts/effects.ts are written against
 * the minimal `Rng` interface (just next()+cursor), but this file also
 * needs the fuller RNG class (pick/nextInt/roll/pickWeighted) for
 * selectEventForYear and the macro cycle — RNG already structurally
 * satisfies Rng, so the same instance flows through everywhere without a
 * second PRNG or any casting.
 */

import type { CharacterTemplate, EventDef, GameState } from './types';
import type { RNG } from './rng';
import { pruneExpiredModifiers, takeRevenueSteps, clearForcedGrowthOverride } from './effects';
import { computeGrowthDetailed, updateStaff, monthlyBurn, amortizeLoansForYear, updateSharePrice, countryFor, fundingGateChance, glamourOf, cashLastsMonths } from './economy';
import { advanceMacroPhase } from './macro';
import { selectEventForYear } from './events';
import { buildRescueEvent, rescueEventAvailable, PRESSURE_CASH_THRESHOLD_MONTHS, PRESSURE_CATEGORY_WEIGHT_MULTIPLIER } from './failure';
import { renderEventText } from './text';
import {
  canSell,
  canIPO,
  rollOffer,
  rollIPO,
  buildAcquisitionOfferEvent,
  buildIPOOfferEvent,
  rollCurrencyShock,
  buildCurrencyShockEvent,
  attachRetirementOption,
  attachShareSaleOption,
  attachResignPublicOption,
  wasLastYearDramatic,
  STANDING_OPTION_IDS,
} from './exits';
import { QUIET_AFTER_DRAMA_PCT, PUBLIC_MARKET, STANDING_OPTION_COOLDOWN_MIN_YEARS, STANDING_OPTION_COOLDOWN_MAX_YEARS } from './constants';

export interface TurnContext {
  allEvents: EventDef[];
  quietEvents: EventDef[];
  postIpoEvents: EventDef[];
  characterPool: CharacterTemplate[];
}

/** Decrement the lockup, drift boardPatience/analystSentiment a step
 * toward their neutral baseline (event choices are the primary mover;
 * this is just mean-reversion so a single swing doesn't stay pinned
 * forever), and count the year. Share price itself moves separately, in
 * economy.ts's updateSharePrice, since it needs this year's growth figure
 * which isn't available yet at the point this is called from below. */
function tickPublicCompanyYear(state: GameState): GameState {
  if (!state.publicCompany) return state;
  const pc = state.publicCompany;
  const driftToward = (value: number, baseline: number) => value + (baseline - value) * PUBLIC_MARKET.DRIFT_TOWARD_BASELINE_RATE;
  return {
    ...state,
    publicCompany: {
      ...pc,
      lockupYearsRemaining: Math.max(0, pc.lockupYearsRemaining - 1),
      yearsPublic: pc.yearsPublic + 1,
      boardPatience: driftToward(pc.boardPatience, PUBLIC_MARKET.INITIAL_BOARD_PATIENCE),
      analystSentiment: driftToward(pc.analystSentiment, PUBLIC_MARKET.INITIAL_ANALYST_SENTIMENT),
    },
  };
}

export interface TurnResult {
  state: GameState;
  event: EventDef | null;
  hasEnded: boolean;
}

/** §11 — when the luck roll is extreme, the year needs a narrative cause a
 * player can point to, not a number they can smell an RNG behind. Folded
 * into the presented event's body (the blurb under the decision heading)
 * rather than the option-specific story headline, since the luck roll
 * happens before any option is even drawn and shouldn't overwrite a
 * specific, already-good outcome line like "Turned down Alder Lane". */
function luckNote(luck: number, state: GameState): string | null {
  if (luck > 2.5) return renderEventText('{COMPANY} has the year nobody predicted.', state);
  if (luck < 0.4) return renderEventText('A flat year for {COMPANY} — the market moved elsewhere.', state);
  return null;
}

export function advanceYear(state: GameState, rng: RNG, ctx: TurnContext): TurnResult {
  if (state.status === 'ended') {
    return { state, event: null, hasEnded: true };
  }

  let s: GameState = {
    ...state,
    year: state.year + 1,
    founder: { ...state.founder, age: state.founder.age + 1 },
  };

  // 1. Economy moves on its own — growth, staff, and burn all resolve
  // before cash itself changes, so step 3 below can PREDICT whether this
  // year's decrement would go negative and intercept it before it
  // happens, rather than reacting after the fact. Loan balances still pay
  // down here regardless of what step 3 decides — amortization is pure
  // bookkeeping against the balance, not a cash movement (that's already
  // inside monthlyBurn).
  s = pruneExpiredModifiers(s);
  const { growth, luck } = computeGrowthDetailed(s, rng);
  s = clearForcedGrowthOverride(s);
  const { state: stepped, amount: revenueStep } = takeRevenueSteps(s);
  s = stepped;
  s.annualRevenue = Math.max(0, s.annualRevenue * (1 + growth) + revenueStep);
  s.staff = updateStaff(s);
  s.monthlyBurn = monthlyBurn(s);
  s = amortizeLoansForYear(s);

  // 1.5. Public company tick — share price moves off this year's growth
  // figure (not a second roll), then lockup/board/sentiment advance.
  if (s.publicCompany) {
    s = updateSharePrice(s, growth, rng);
    s = tickPublicCompanyYear(s);
  }

  // 2. Macro cycle
  s = advanceMacroPhase(s, rng);

  // 3. Insolvency — predicted, not reacted to. `projectedCash` is what
  // this year's decrement WOULD leave the company with, computed before
  // it's actually applied. When it would go negative, the rescue event
  // (engine/failure.ts's buildRescueEvent) intercepts BEFORE the decrement
  // happens, so a founder gets a real choice instead of waking up already
  // underwater — but only when one hasn't fired too recently
  // (rescueEventAvailable's cooldown: it must not pop up every single
  // year a company stays on the brink). Once a rescue isn't available, or
  // a prior rescue's choice didn't fully fix things, the rule is literal:
  // if the runway goes under zero months, the company fails — no event,
  // no second chance. A company can still die with zero warning if a
  // single catastrophic event's own effects push cash negative in one
  // turn (game.ts's processPlayerChoice has its own, separate post-choice
  // check for exactly that); that's the explicitly-allowed rare
  // exception, not the norm.
  const projectedCash = s.cash - s.monthlyBurn * 12;
  if (projectedCash < 0) {
    if (rescueEventAvailable(s)) {
      return { state: { ...s, lastRescueYear: s.year }, event: buildRescueEvent(s, rng, ctx.characterPool), hasEnded: false };
    }
    return { state: { ...s, cash: projectedCash, status: 'ended' }, event: null, hasEnded: true };
  }
  s.cash = projectedCash;

  // 3.2. Board removal — public companies only. Mirrors the insolvency
  // check just above: an immediate end, no event that year.
  // resolveRunResults reads publicCompany.boardPatience directly off this
  // returned state to price the (penalized) payout — see endings.ts.
  if (s.publicCompany && s.publicCompany.boardPatience <= 0) {
    return { state: { ...s, status: 'ended' }, event: null, hasEnded: true };
  }

  // 3.5. Currency shock — rolled every year regardless of what else
  // happens, ahead of exit opportunities, so a devaluation always gets its
  // own year rather than being crowded out by an acquisition offer.
  let event: EventDef | null = null;
  if (rollCurrencyShock(s, rng)) {
    event = buildCurrencyShockEvent(s, rng);
  }

  // 4. Exit opportunities, ahead of the event draw. IPO only if not
  // already public (canIPO guards this); an acquisition offer can still
  // land on a public company — the mechanism (and the 'sale' ending it
  // produces) is identical either way.
  if (!event) {
    if (canIPO(s) && rollIPO(s, rng)) {
      event = buildIPOOfferEvent(s, rng);
    } else if (canSell(s) && rollOffer(s, rng)) {
      event = buildAcquisitionOfferEvent(s, rng, ctx.characterPool);
    }
  }

  // 5. Otherwise, normal event. Once public, this draws from a completely
  // separate pool (ctx.postIpoEvents) instead of the private-company pool
  // — a public company doesn't see Series A events or "the office
  // floods," it sees activist investors and downgrades — falling back to
  // the shared quiet-year pool if that pool ever runs dry (no funding
  // gate to roll; there are no funding-round events in either public path).
  if (!event) {
    if (s.publicCompany) {
      event = selectEventForYear(ctx.postIpoEvents, s, rng) ?? selectEventForYear(ctx.quietEvents, s, rng);
    } else {
      const breather = wasLastYearDramatic(s) && rng.roll(QUIET_AFTER_DRAMA_PCT);
      const fundingGateOpen = rng.next() < fundingGateChance(countryFor(s.founder.country), s.climate, s.founderReputation, glamourOf(s));
      // A glamorous business draws more of its drama from the gamble pool
      // (press, rivals, high-stakes bets) than a boring one does — a cheap
      // proxy for content pack 4's "more press/rival events vs. more
      // operational events" without re-tagging the whole event library.
      const gambleProbability = 0.15 * (0.5 + glamourOf(s));
      // Under real financial pressure, the pool shifts toward money —
      // survival-flavoured content should crowd out "the office floods."
      const moneyWeightMultiplier = cashLastsMonths(s) < PRESSURE_CASH_THRESHOLD_MONTHS ? PRESSURE_CATEGORY_WEIGHT_MULTIPLIER : 1;
      event = breather
        ? selectEventForYear(ctx.quietEvents, s, rng, gambleProbability, fundingGateOpen, moneyWeightMultiplier) ??
          selectEventForYear(ctx.allEvents, s, rng, gambleProbability, fundingGateOpen, moneyWeightMultiplier)
        : selectEventForYear(ctx.allEvents, s, rng, gambleProbability, fundingGateOpen, moneyWeightMultiplier) ??
          selectEventForYear(ctx.quietEvents, s, rng, gambleProbability, fundingGateOpen, moneyWeightMultiplier);
    }
  }

  // 6. Retirement (private) or share-sale/resignation (public) ride along
  // as standing extra options when eligible — attachRetirementOption is
  // itself a no-op once public (canRetire guards it), so this is safe to
  // always call in this order.
  if (event) {
    const hadStandingOption = event.options.some((o) => (STANDING_OPTION_IDS as readonly string[]).includes(o.id));
    event = attachRetirementOption(event, s, rng);
    event = attachShareSaleOption(event, s, rng);
    event = attachResignPublicOption(event, s, rng);

    // A standing option just surfaced this year (and wasn't already there
    // from something else) — push the earliest it's allowed to roll again
    // out by a fresh random gap, so the next appearance is spaced out
    // rather than governed by the same flat per-year chance every time.
    // See constants.ts's STANDING_OPTION_SHOW_CHANCE comment.
    const hasStandingOptionNow = event.options.some((o) => (STANDING_OPTION_IDS as readonly string[]).includes(o.id));
    if (!hadStandingOption && hasStandingOptionNow) {
      s = { ...s, nextStandingOptionYear: s.year + rng.nextInt(STANDING_OPTION_COOLDOWN_MIN_YEARS, STANDING_OPTION_COOLDOWN_MAX_YEARS) };
    }

    const note = luckNote(luck, s);
    if (note) {
      event = { ...event, body: `${note} ${event.body}` };
    }
  }

  return { state: s, event, hasEnded: false };
}
