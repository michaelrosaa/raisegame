/**
 * Failure — danger-state escalation, the insolvency rescue event, cause-of-
 * death classification, and the pivot-point generator that together turn
 * "the company ran out of cash" from a silent, unavoidable game-over into a
 * chapter the player sees coming and can fight.
 *
 * The whole feature hangs off cashLastsMonths (economy.ts) — nothing new
 * to compute, just new thresholds and new consequences at the low end.
 */

import type { Character, CharacterTemplate, EventDef, FailureDetail, DeathCause, GameState, OptionDef, FundingOffer, YearRecord } from './types';
import type { Rng } from './rng';
import { cashLastsMonths } from './economy';
import { computeExitPrice } from './exits';
import { createCharacterFromTemplate } from './cast';
import { formatMoney } from './format';

// ============================================================================
// Danger states
// ============================================================================

export type DangerState = 'healthy' | 'tight' | 'serious' | 'critical';

export function dangerState(state: GameState): DangerState {
  const months = cashLastsMonths(state);
  if (months < 3) return 'critical';
  if (months < 6) return 'serious';
  if (months < 12) return 'tight';
  return 'healthy';
}

// ============================================================================
// Event weighting under pressure — boosts money-category events (and any
// event explicitly tagged 'survival', for the events this file itself
// generates) once cashLastsMonths < 6. The multiplier is applied to
// RARITY_WEIGHTS' output in events.ts's selectEventByRarity, not here —
// this just answers "how much" so that one number is tuned in one place.
// ============================================================================

export const PRESSURE_CASH_THRESHOLD_MONTHS = 6;
export const PRESSURE_CATEGORY_WEIGHT_MULTIPLIER = 4;

// ============================================================================
// Cause of death — one copy pair per cause, dry and specific, never a
// generic "the company failed."
// ============================================================================

export const DEATH_CAUSE_COPY: Record<DeathCause, { statement: (state: GameState) => string; body: string }> = {
  outOfCash: {
    statement: (s) => `Ran out of money in year ${s.year}.`,
    body: 'The payroll ran on a Friday and there was nothing to cover it. Everything else was still working.',
  },
  couldNotRaise: {
    statement: () => 'Nobody would fund it.',
    body: 'Eleven meetings, eleven versions of the same answer. The market had closed six months before you started asking.',
  },
  lostAnchorCustomer: {
    statement: () => 'The biggest customer left.',
    body: 'They were 40% of revenue and they went somewhere cheaper. There was no version of the next year that worked.',
  },
  outCompeted: {
    statement: (s) => {
      const rival = s.cast.find((c) => c.role === 'rival');
      const name = rival ? (rival.firm ?? rival.fullName) : 'A rival';
      return `${name} took the market.`;
    },
    body: 'They raised more, moved faster, and priced below cost for two years. That was always going to end one way.',
  },
  regulation: {
    statement: () => 'A new rule made it impossible.',
    body: 'Written for companies a hundred times your size. Complying would have cost more than the company was worth.',
  },
  currencyCollapse: {
    statement: () => 'The currency took it.',
    body: "Your costs were local. Your revenue wasn't. Forty percent vanished in a week and never came back.",
  },
  pushedOut: {
    statement: () => 'The board removed you.',
    body: "You keep the shares. You just don't work here any more.",
  },
  legal: {
    statement: () => 'The lawsuit finished it.',
    body: 'Four years, a settlement, and a company with nothing left to defend.',
  },
  founderWalked: {
    statement: () => 'You stopped.',
    body: "Some companies don't fail. Some founders just stop.",
  },
};

/** Best-effort classification from signals that are actually available on
 * a GameState at the moment it ends — never a guess dressed up as
 * certainty, but never the generic fallback unless nothing else fits.
 * Order matters: more specific signals are checked first. */
export function classifyDeathCause(endedState: GameState): DeathCause {
  // Board removal (turn.ts's boardPatience <= 0 check) ends the company
  // with no event and no funding-related struggle — a clean, distinct
  // signal from insolvency.
  if (endedState.publicCompany && endedState.publicCompany.boardPatience <= 0) return 'pushedOut';

  // Currency shocks are generated events with a recognisable id (see
  // exits.ts's buildCurrencyShockEvent) — if one fired in the final
  // couple of years, it's the most likely proximate cause.
  const recentCurrencyShock = endedState.history.slice(-2).some((h) => h.eventId.startsWith('generated-currency-shock-'));
  if (recentCurrencyShock) return 'currencyCollapse';

  // A rival in the cast plus a rival-flavoured event in the final stretch
  // reads as competitive pressure rather than a plain cash-out.
  const recentRivalEvent = endedState.history.slice(-3).some((h) => h.tag && /rival/i.test(h.tag));
  if (endedState.cast.some((c) => c.role === 'rival') && recentRivalEvent) return 'outCompeted';

  // A sharp single-year revenue collapse right before the end reads as
  // losing the business's anchor, not a slow bleed.
  const last3 = endedState.history.slice(-3);
  for (let i = 1; i < last3.length; i++) {
    const prev = last3[i - 1].annualRevenue;
    const curr = last3[i].annualRevenue;
    if (prev > 0 && curr / prev < 0.6) return 'lostAnchorCustomer';
  }

  // Never raised beyond whatever started the company, and cash still ran
  // out — read as "nobody would fund it" rather than a generic cash-out.
  const everRaised = endedState.history.some((h) => h.funding);
  if (!everRaised && endedState.year > 3) return 'couldNotRaise';

  // The reliable, common case: the money ran out. Anything not caught by
  // a more specific signal above lands here or, failing that, the
  // catch-all "founder walked" — both are still specific, flavoured
  // causes, never the generic "the company failed."
  if (endedState.cash < 0 || cashLastsMonths(endedState) < 1) return 'outOfCash';

  return 'founderWalked';
}

// ============================================================================
// Pivot point — "the moment it turned," mined from history. Prioritised
// chain of real signals; always produces something specific.
// ============================================================================

export function generatePivotPoint(endedState: GameState): string {
  const history = endedState.history;

  // 1. A declined offer — acquisition or funding, whichever was more
  // recent (a later refusal is the more likely pivot). exits.ts stamps
  // chainFlags.declinedAcquisition the moment a buyer is turned down;
  // game.ts stamps chainFlags.declinedFunding the moment a funding-
  // carrying event's non-funding option gets chosen instead. Both store
  // only the most recent year under their key, by construction.
  const declinedAcqYear = endedState.chainFlags.declinedAcquisition;
  const declinedFundYear = endedState.chainFlags.declinedFunding;
  if (declinedAcqYear !== undefined && (declinedFundYear === undefined || declinedAcqYear >= declinedFundYear)) {
    const declineRecord = history.find((h) => h.chosenOptionId === 'exit-decline');
    const buyerName = declineRecord ? declineRecord.storyHeadline.replace(/^Turned down /, '') : 'the offer';
    return `The year you turned down ${buyerName} was the last time anyone offered.`;
  }
  if (declinedFundYear !== undefined) {
    return `You turned down funding in year ${declinedFundYear}. Nothing else came.`;
  }

  // 2. Peak revenue, if it wasn't the final year.
  if (history.length > 0) {
    const peak = history.reduce((best, h) => (h.annualRevenue > best.annualRevenue ? h : best), history[0]);
    if (peak.year < history[history.length - 1].year) {
      return `Revenue peaked in year ${peak.year}. It never grew again.`;
    }
  }

  // 3. The largest hiring spike (the biggest single expense in this
  // economy's model) immediately followed by decline — the largest
  // qualifying jump, not just the first one found.
  let bestSpike: { year: number; jump: number } | null = null;
  for (let i = 1; i < history.length; i++) {
    const staffJump = history[i].staff - history[i - 1].staff;
    const laterRevenue = history.slice(i + 1);
    const declinedAfter = laterRevenue.length > 0 && laterRevenue[laterRevenue.length - 1].annualRevenue < history[i].annualRevenue;
    if (staffJump >= 5 && declinedAfter && (!bestSpike || staffJump > bestSpike.jump)) {
      bestSpike = { year: history[i].year, jump: staffJump };
    }
  }
  if (bestSpike) {
    return `You hired ${bestSpike.jump} people in year ${bestSpike.year}. It never grew into them.`;
  }

  // 4. The last gamble lost.
  const lastGambleLoss = [...history].reverse().find((h) => h.gambleResult === 'lost');
  if (lastGambleLoss) {
    return `The gamble in year ${lastGambleLoss.year} didn't land.`;
  }

  // 5. A sharp single-year revenue drop.
  for (let i = 1; i < history.length; i++) {
    const prev = history[i - 1].annualRevenue;
    const curr = history[i].annualRevenue;
    if (prev > 50_000 && curr / prev < 0.6) {
      const pct = Math.round((1 - curr / prev) * 100);
      return `Revenue fell ${pct}% in year ${history[i].year}. It never recovered.`;
    }
  }

  // 6. The last funding round, if it was a while before the end.
  const lastFunding = [...history].reverse().find((h) => h.funding);
  if (lastFunding && lastFunding.funding) {
    return `The last money came in year ${lastFunding.year}, from ${lastFunding.funding.firm}. Nothing after that.`;
  }

  // 7. Fallback — still a specific year, never a vague gesture at "things went wrong."
  const midpoint = Math.max(1, Math.round(endedState.year / 2));
  return `By year ${midpoint}, the numbers had already turned against it.`;
}

export function peakRevenueOf(endedState: GameState): number {
  return endedState.history.reduce((max, h) => Math.max(max, h.annualRevenue), endedState.annualRevenue);
}

/** Damage-tile fallback #1 — practically always positive (a company always
 * has at least the founder), so a safe stand-in when peakRevenue reads $0. */
export function staffAtPeakOf(endedState: GameState): number {
  return endedState.history.reduce((max, h) => Math.max(max, h.staff), endedState.staff);
}

/** Damage-tile fallback #2 — see game.ts's fundingOffersDeclined counter. */
export function roundsRefusedOf(endedState: GameState): number {
  return endedState.fundingOffersDeclined;
}

/** Damage-tile fallback #3 — years between the last annual revenue
 * increase and the end. A company that only ever grew (or never lived
 * past year 1) has nothing to measure here, so this is the last resort
 * of the three fallbacks, not the first. */
export function yearsSinceLastGrowthOf(endedState: GameState): number {
  const history = endedState.history;
  let lastGrowthYear = 0;
  for (let i = 1; i < history.length; i++) {
    if (history[i].annualRevenue > history[i - 1].annualRevenue) lastGrowthYear = history[i].year;
  }
  return Math.max(0, endedState.year - lastGrowthYear);
}

/** The story feed's closing headline (Part 4) — "sourced to the news," the
 * same voice as every other headline in the game, not the specific cause
 * (that's DEATH_CAUSE_COPY's job, shown separately on the failure screen).
 * Used as this failed company's dramaticHeadline (endings.ts's
 * generateFailureOutcome) so the scorecard's story pull-quote never falls
 * back to a generic "the company failed" line either. */
export function closingHeadline(state: GameState): string {
  return `${state.company.name} closes after ${state.year} year${state.year === 1 ? '' : 's'}.`;
}

// ============================================================================
// Reputation — scaled by how public and how large the failure was, not a
// flat hit (design doc note: "Reputation drops, scaled by how public and
// how large the failure was").
// ============================================================================

const REPUTATION_FAILURE_BASE = 8;
const REPUTATION_FAILURE_PUBLIC_BONUS = 6;
const REPUTATION_FAILURE_SIZE_SCALE = 6;
const REPUTATION_FAILURE_SIZE_REFERENCE = 500_000; // capital lost at which the size bonus maxes out

export function failureReputationHit(endedState: GameState, capitalLost: number): number {
  let hit = REPUTATION_FAILURE_BASE;
  if (endedState.publicCompany) hit += REPUTATION_FAILURE_PUBLIC_BONUS;
  const sizeFactor = Math.min(1, capitalLost / REPUTATION_FAILURE_SIZE_REFERENCE);
  hit += sizeFactor * REPUTATION_FAILURE_SIZE_SCALE;
  return Math.round(hit);
}

/** Where the player actually stands, scaled by the two facts that matter
 * most right after a failure: how much personal cash is left, and how
 * much career is left to make it back. A founder with nothing and twenty
 * years to go is in a completely different spot than one with a healthy
 * cushion and one year left — the line has to say so, not default to a
 * gentle "one dent in the reputation" regardless of severity. */
export function standingLine(personalCash: number, careerYearsLeft: number): string {
  const yearsPart = careerYearsLeft <= 0 ? 'no years left to try again' : `${careerYearsLeft} year${careerYearsLeft === 1 ? '' : 's'} to go`;
  if (personalCash <= 0) return `Nothing left, ${yearsPart}.`;
  if (personalCash < 100_000) return `${formatMoney(personalCash)} left, ${yearsPart}.`;
  return `${formatMoney(personalCash)} still in the bank, ${yearsPart}.`;
}

/** The epitaph — the failure screen's pull-quote headline. Picking the
 * literal last history entry (the old approach) tends to surface whatever
 * routine operational note happened to fire that year ("Built proper
 * uptime monitoring") as the company's dying words, which reads as a bug,
 * not a headstone. Prefer, in order, whichever of these actually happened:
 * a funding-related headline (money changing hands is always the most
 * consequential story a company has), a declined-offer headline (the
 * moment someone else's exit became this one instead), or the headline
 * from the company's best year by revenue — and only fall back to the
 * literal last entry if history is empty (a company that failed before
 * any event ever fired). */
function pickEpitaphEntry(endedState: GameState): YearRecord | undefined {
  const history = endedState.history;
  const fundingEntry = [...history].reverse().find((h) => h.funding);
  if (fundingEntry) return fundingEntry;
  const declineEntry = [...history].reverse().find((h) => h.chosenOptionId === 'exit-decline' || h.chosenOptionId === 'exit-ipo-decline');
  if (declineEntry) return declineEntry;
  if (history.length > 0) {
    return history.reduce((best, h) => (h.annualRevenue > best.annualRevenue ? h : best), history[0]);
  }
  return undefined;
}

// ============================================================================
// Building the FailureDetail — called once, at the moment a company ends
// as a failure, while endedState.history still has everything this needs.
// ============================================================================

export function buildFailureDetail(endedState: GameState, capitalLost: number): FailureDetail {
  const cause = classifyDeathCause(endedState);
  const epitaphEntry = pickEpitaphEntry(endedState);
  return {
    cause,
    causeStatement: DEATH_CAUSE_COPY[cause].statement(endedState),
    peakRevenue: peakRevenueOf(endedState),
    peopleLetGo: endedState.totalLayoffs,
    staffAtPeak: staffAtPeakOf(endedState),
    roundsRefused: roundsRefusedOf(endedState),
    yearsSinceLastGrowth: yearsSinceLastGrowthOf(endedState),
    pivotPoint: generatePivotPoint(endedState),
    finalHeadline: epitaphEntry ? epitaphEntry.storyHeadline : `${endedState.company.name} closes.`,
    finalHeadlineYearsBeforeEnd: epitaphEntry ? Math.max(0, endedState.year - epitaphEntry.year) : 0,
    reputationHit: failureReputationHit(endedState, capitalLost),
  };
}

// ============================================================================
// The insolvency rescue — fires BEFORE this year's automatic economic tick
// would push cash negative (see turn.ts), not after, so a founder never
// wakes up already underwater. It doesn't repeat every single year a
// company stays on the brink — rescueEventAvailable below gates it behind
// a cooldown, so once it's been offered, the very next brush with danger
// is not automatically softened. All three options are non-fatal by
// construction: since turn.ts skips the year's cash decrement entirely
// whenever this event fires, none of them need to "cover a deficit" —
// there isn't one yet.
// ============================================================================

export const RESCUE_COOLDOWN_YEARS = 3;

export function rescueEventAvailable(state: GameState): boolean {
  return state.lastRescueYear === null || state.year - state.lastRescueYear >= RESCUE_COOLDOWN_YEARS;
}

function resolveEmergencyLender(state: GameState, rng: Rng, characterPool: CharacterTemplate[]): Character {
  const existing = state.cast.find((c) => c.role === 'investor');
  if (existing) return existing;
  const templates = characterPool.filter((c) => c.role === 'investor');
  if (templates.length === 0) throw new Error('No investor characters available in the character pool');
  const template = templates[Math.floor(rng.next() * templates.length)];
  return createCharacterFromTemplate(template, state.cast);
}

export function buildRescueEvent(state: GameState, rng: Rng, characterPool: CharacterTemplate[]): EventDef {
  const monthsLeft = Math.max(0, Math.floor(cashLastsMonths(state)));
  const burn = Math.max(1, state.monthlyBurn);

  // Option 1 — emergency raise: guaranteed to land (no funding-gate roll),
  // sized to buy real runway, priced harshly (a distressed round costs more
  // equity per dollar than a normal one) rather than at the usual formula.
  const lead = resolveEmergencyLender(state, rng, characterPool);
  const targetCash = burn * 14;
  const raiseAmount = Math.max(50_000, Math.round(targetCash - state.cash));
  const postMoneyValuation = raiseAmount / 0.35; // ~35% given up — a desperate round, not a good one
  const fundingOffer: FundingOffer = {
    id: `rescue-funding-${state.year}`,
    stage: 'seed',
    amount: raiseAmount,
    postMoneyValuation,
    lead,
    descriptionTemplate: '{lead} invests {amount} at this round.',
  };
  const raiseOption: OptionDef = {
    id: 'rescue-raise',
    label: `Take an emergency round from ${lead.firm ?? lead.fullName}`,
    detail: `${formatMoney(raiseAmount)} on hard terms — about a third of the company. It buys real time.`,
    effects: [{ type: 'funding', fundingOffer, characterId: lead.id }],
    storyHeadline: `${lead.firm ?? lead.fullName} bails out {COMPANY}`,
    tag: 'EMERGENCY ROUND',
    icon: 'investor',
  };

  // Option 2 — deep cuts: no cash injection needed. This year's automatic
  // decrement is skipped entirely whenever this event fires (see turn.ts),
  // so cash is never actually underwater yet — cutting staff just lowers
  // the burn that would otherwise threaten next year.
  const staffCut = Math.max(1, Math.ceil(state.staff * 0.5));
  const cutOption: OptionDef = {
    id: 'rescue-cuts',
    label: `Let ${staffCut} people go`,
    detail: 'Down to the smallest team that can keep the lights on. It buys time, not growth.',
    effects: [{ type: 'staff', value: -staffCut, unit: 'absolute' }],
    storyHeadline: `${state.company.name} cuts to the bone`,
    tag: 'DEEP CUTS',
    icon: 'default',
  };

  // Option 3 — distressed sale: a real, guaranteed exit at a harsh
  // discount. Never $0 — always a genuine, if diminished, payout.
  const fullPrice = computeExitPrice(state, rng);
  const distressedPrice = Math.max(50_000, Math.round(fullPrice * 0.4));
  const saleOption: OptionDef = {
    id: 'rescue-sale',
    label: 'Take the distressed sale on the table',
    detail: `${formatMoney(distressedPrice)}, well under what this was worth a year ago. It closes clean.`,
    effects: [{ type: 'end', endingType: 'sale', exitPrice: distressedPrice }],
    storyHeadline: `${state.company.name} sells at a steep discount`,
    tag: 'DISTRESSED SALE',
    icon: 'investor',
  };

  return {
    id: `rescue-${state.year}`,
    rarity: 'rare',
    isGamble: false,
    conditions: [],
    headline: 'This is the last year unless something changes.',
    body: `${monthsLeft} month${monthsLeft === 1 ? '' : 's'} of runway left at the current burn. Whatever happens this year decides it.`,
    options: [raiseOption, cutOption, saleOption],
  };
}
