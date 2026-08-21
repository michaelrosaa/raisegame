/**
 * Game state management
 * Initialization, validation, and mutation helpers
 */

import type { GameState, Founder, Company, CapTableEntry, EffectValue, CountryData, Climate, Loan } from './types';
import countriesContent from '../content/countries.json';
import { monthlyBurn, startingCashFor, computeLoanRate, marketCapFor } from './economy';
import { applyGrowthEffect } from './effects';
import { PUBLIC_MARKET, LOAN, CALENDAR_YEAR_AT_FOUNDING } from './constants';

// ============================================================================
// Country Data — single source of truth is content/countries.json; this is
// just a code-indexed lookup over it, so there is exactly one place a
// country can be added or renamed (there used to be a second, hand-copied
// 6-country table here that silently fell out of sync with the content
// file — Singapore/Australia picks were quietly priced as the US).
// ============================================================================

export const COUNTRIES: Record<string, CountryData> = Object.fromEntries(
  (countriesContent as CountryData[]).map((c) => [c.code, c])
);

// ============================================================================
// Macro Cycle
// ============================================================================

export const MACRO_SEQUENCE: Climate[] = ['frothy', 'cooling', 'frozen', 'recovering'];

// ============================================================================
// State Creation
// ============================================================================

/**
 * Initialize a new game state. `company.ideaCeiling` must already be set by
 * the caller (drawn once, seeded, from the chosen idea — see cast.ts /
 * App.tsx's setup flow) since it needs an Rng draw this function doesn't
 * take one for.
 *
 * `capitalPutIn` — the founder's OWN money at founding (engine/career.ts's
 * re-founding flow, company 2+ of a career). Omitted (or undefined) for the
 * very first company of a career, which still starts on the country's
 * `startingCash` exactly as before — a founder has no personal cash yet to
 * choose an amount from.
 */
export function createGameState(
  seed: string,
  founder: Founder,
  company: Company,
  country: string,
  // Reserved: the chosen idea's moneyNeeded doesn't yet affect starting
  // cash. Industry does, via economy.ts's growth/staff/exit formulas.
  _idea: { moneyNeeded: number; industry: string },
  capitalPutIn?: number,
  founderReputation: number = 50,
  founderBankruptcies: number = 0,
  generation: number = 1,
  founderHasFamily: boolean = false,
  foundedCalendarYear: number = CALENDAR_YEAR_AT_FOUNDING,
  foundedCareerYear: number = 1,
  startedWithLittleCapital: boolean = false
): GameState {
  const base: GameState = {
    seed,
    rngCursor: 0,
    year: 1,
    foundedCalendarYear,
    foundedCareerYear,
    startedWithLittleCapital,
    nextStandingOptionYear: 0,
    founder,
    company,
    generation,
    founderReputation,
    founderBankruptcies,
    founderHasFamily,
    loans: [],
    everTookLoan: false,
    publicCompany: null,
    founderLiquidCash: 0,
    everWentPublic: false,
    everLostABacker: false,
    everAcquiredRival: false,
    totalLayoffs: 0,
    fundingOffersDeclined: 0,
    cash: capitalPutIn ?? startingCashFor(country),
    monthlyBurn: 0, // patched below, once the rest of state exists to compute it from
    annualRevenue: 0,
    staff: 1,
    morale: 75,
    capTable: [{ holder: 'You', percentage: 100.0 }],
    climate: 'frothy',
    macroPhaseEnd: 3, // Will be set properly in macro.ts
    cast: [],
    history: [],
    firedEventIds: [],
    lastGambleYear: null,
    lastRescueYear: null,
    awards: [],
    status: 'setup',
    chainFlags: {},
    growthModifiers: [],
    pendingRevenueStep: 0,
    forcedGrowthOverride: null,
  };

  return { ...base, monthlyBurn: monthlyBurn(base) };
}

// ============================================================================
// Equity Calculations
// ============================================================================

/**
 * Calculate dilution when raising capital
 * Raising `amount` at post-money valuation `V`:
 *   investorPct = amount / V
 *   every existing holder scales by (1 - investorPct)
 */
export function dilute(
  capTable: CapTableEntry[],
  amount: number,
  postMoneyValuation: number,
  holderLabel: string = `Investor Round ${capTable.length}`
): CapTableEntry[] {
  const investorPct = amount / postMoneyValuation;
  if (investorPct < 0 || investorPct > 1) {
    throw new Error(`Invalid dilution: amount ${amount} at valuation ${postMoneyValuation} gives ${investorPct}%`);
  }

  const diluted = capTable.map((entry) => ({
    ...entry,
    percentage: entry.percentage * (1 - investorPct),
  }));

  diluted.push({ holder: holderLabel, percentage: investorPct * 100 });

  return normalizeCaptable(diluted);
}

/**
 * Normalize cap table to sum to exactly 100
 * Adjusts the largest holder to account for rounding errors
 */
export function normalizeCaptable(capTable: CapTableEntry[]): CapTableEntry[] {
  if (capTable.length === 0) return capTable;

  const sum = capTable.reduce((acc, entry) => acc + entry.percentage, 0);
  const error = 100 - sum;

  if (Math.abs(error) < 0.001) {
    return capTable; // Already normalized
  }

  const normalized = [...capTable];
  let maxIndex = 0;
  let maxValue = 0;

  // Find largest holder and adjust them
  for (let i = 0; i < normalized.length; i++) {
    if (normalized[i].percentage > maxValue) {
      maxValue = normalized[i].percentage;
      maxIndex = i;
    }
  }

  normalized[maxIndex].percentage += error;
  return normalized;
}

/**
 * Find founder's current share of cap table
 */
export function getFounderShare(capTable: CapTableEntry[]): number {
  const founderEntry = capTable.find((entry) => entry.holder === 'You');
  return founderEntry?.percentage ?? 0;
}

// ============================================================================
// State Mutations
// ============================================================================

/**
 * Turn a content-authored effect value into the actual delta to apply,
 * given how the effect says to interpret it. See EffectValue.unit for what
 * each mode means — 'percent' and 'runwayMonths' both need a "current"
 * figure to resolve against, which the caller supplies. Cash/staff/morale
 * are the only fields still directly effect-able this way — revenue moves
 * through the growth system now (see effects.ts's applyGrowthEffect).
 */
function resolveDelta(effect: EffectValue, currentValue: number, burn: number): number {
  const value = effect.value ?? 0;
  switch (effect.unit) {
    case 'percent':
      return currentValue * (value / 100);
    case 'runwayMonths':
      return value * burn;
    default:
      return value;
  }
}

/**
 * Apply an effect to game state
 * Returns mutated state
 */
export function applyEffect(state: GameState, effect: EffectValue): GameState {
  const newState = { ...state };

  switch (effect.type) {
    case 'cash':
      newState.cash += resolveDelta(effect, newState.cash, newState.monthlyBurn);
      break;

    case 'monthlyBurn':
      // monthlyBurn is a derived value (economy.ts) recalculated every turn
      // from staff/revenue/country — it is no longer directly effect-able.
      // Kept as a recognized no-op rather than removed from EffectType so
      // any stray legacy content referencing it fails loudly in validation
      // rather than silently doing the wrong thing.
      break;

    case 'annualRevenue':
      // Legacy direct-set path — see EffectType's comment. No current
      // content authors this after the growth-system migration; kept as a
      // safety net so an unmigrated effect still does *something*
      // reasonable rather than being silently dropped.
      newState.annualRevenue = Math.max(0, newState.annualRevenue + resolveDelta(effect, newState.annualRevenue, newState.monthlyBurn));
      break;

    case 'growthMultiplier':
    case 'growthSet':
    case 'revenueStep':
      return applyGrowthEffect(newState, effect);

    case 'staff': {
      const staffBefore = newState.staff;
      newState.staff += Math.round(resolveDelta(effect, newState.staff, newState.monthlyBurn));
      newState.staff = Math.max(1, newState.staff); // Always at least founder
      if (newState.staff < staffBefore) newState.totalLayoffs += staffBefore - newState.staff;
      break;
    }

    case 'morale':
      // Morale is always absolute points, never percent/runway — it's
      // already a 0-100 scale, "percent of morale" isn't a meaningful idea.
      newState.morale += effect.value ?? 0;
      newState.morale = Math.max(0, Math.min(100, newState.morale)); // Clamp 0-100
      break;

    case 'sentiment':
      // Find character and adjust sentiment (immutably — never mutate a shared cast entry)
      if (effect.characterId) {
        newState.cast = newState.cast.map((c) =>
          c.id === effect.characterId ? { ...c, sentiment: Math.max(0, Math.min(100, c.sentiment + (effect.value ?? 0))) } : c
        );
      }
      break;

    case 'addCharacter':
      if (effect.character) {
        newState.cast = [...newState.cast, effect.character];
      }
      break;

    case 'removeCharacter':
      if (effect.characterId) {
        newState.cast = newState.cast.filter((c) => c.id !== effect.characterId);
      }
      break;

    case 'funding':
      if (effect.fundingOffer) {
        const offer = effect.fundingOffer;
        newState.cash += offer.amount;
        newState.capTable = dilute(newState.capTable, offer.amount, offer.postMoneyValuation, offer.lead.firm ?? offer.lead.fullName);
      }
      break;

    case 'loan':
      // No dilution — that's the whole point of debt. `effect.loan` is
      // resolved (rate priced, id assigned) by game.ts's processPlayerChoice
      // before this ever runs, mirroring funding's fundingOffer resolution.
      if (effect.loan) {
        newState.cash += effect.loan.principal;
        newState.loans = [...newState.loans, effect.loan];
        newState.everTookLoan = true;
      }
      break;

    case 'startFamily':
      // The actual heir (name/trait/portrait) is generated at the career
      // layer once App.tsx observes this flip — see career.ts's startFamily
      // and its own comment on why that split exists.
      newState.founderHasFamily = true;
      break;

    case 'repayLoan': {
      const totalBalance = newState.loans.reduce((sum, l) => sum + l.balance, 0);
      newState.cash -= totalBalance;
      newState.loans = [];
      break;
    }

    case 'goPublic': {
      // Priced by exits.ts's buildIPOOfferEvent (or the pre-resolution pass
      // in game.ts, for a bare content-authored effect) into `exitPrice`,
      // exactly like a sale/ipo 'end' effect used to be — this just reads
      // it. The company keeps running: no status change.
      const valuation = effect.exitPrice ?? newState.annualRevenue * 8;
      newState.publicCompany = {
        sharePrice: valuation / PUBLIC_MARKET.IPO_SHARE_COUNT,
        sharesOutstanding: PUBLIC_MARKET.IPO_SHARE_COUNT,
        lockupYearsRemaining: 1,
        founderSharesSoldPct: 0,
        boardPatience: PUBLIC_MARKET.INITIAL_BOARD_PATIENCE,
        analystSentiment: PUBLIC_MARKET.INITIAL_ANALYST_SENTIMENT,
        yearsPublic: 0,
      };
      newState.everWentPublic = true;
      break;
    }

    case 'sellShares': {
      if (!newState.publicCompany) break;
      const founderPct = newState.capTable.find((e) => e.holder === 'You')?.percentage ?? 0;
      const pct = Math.max(0, Math.min(effect.value ?? 0, founderPct));
      if (pct <= 0) break;

      const proceeds = marketCapFor(newState.publicCompany) * (pct / 100);
      newState.founderLiquidCash += proceeds;

      const diluted = newState.capTable.map((e) => (e.holder === 'You' ? { ...e, percentage: e.percentage - pct } : e));
      const existingPublicMarket = diluted.find((e) => e.holder === 'Public market');
      newState.capTable = normalizeCaptable(
        existingPublicMarket
          ? diluted.map((e) => (e.holder === 'Public market' ? { ...e, percentage: e.percentage + pct } : e))
          : [...diluted, { holder: 'Public market', percentage: pct }]
      );

      // "Converting more than ~2% in one year drops the share price" — the
      // market reads founder selling as bad news, and it usually is.
      const excess = Math.max(0, pct - PUBLIC_MARKET.SELL_NO_IMPACT_PCT);
      const priceImpact = 1 - PUBLIC_MARKET.SELL_IMPACT_PRICE_PCT_PER_POINT * excess;
      const sentimentImpact = -PUBLIC_MARKET.SELL_IMPACT_SENTIMENT_PER_POINT * excess;
      newState.publicCompany = {
        ...newState.publicCompany,
        founderSharesSoldPct: newState.publicCompany.founderSharesSoldPct + pct,
        sharePrice: Math.max(0.01, newState.publicCompany.sharePrice * priceImpact),
        analystSentiment: Math.max(0, Math.min(100, newState.publicCompany.analystSentiment + sentimentImpact)),
      };
      break;
    }

    case 'boardPatience':
      if (newState.publicCompany) {
        newState.publicCompany = {
          ...newState.publicCompany,
          boardPatience: Math.max(0, Math.min(100, newState.publicCompany.boardPatience + (effect.value ?? 0))),
        };
      }
      break;

    case 'analystSentiment':
      if (newState.publicCompany) {
        newState.publicCompany = {
          ...newState.publicCompany,
          analystSentiment: Math.max(0, Math.min(100, newState.publicCompany.analystSentiment + (effect.value ?? 0))),
        };
      }
      break;

    case 'sharePriceShock':
      if (newState.publicCompany) {
        newState.publicCompany = {
          ...newState.publicCompany,
          sharePrice: Math.max(0.01, newState.publicCompany.sharePrice * (1 + (effect.value ?? 0))),
        };
      }
      break;

    case 'takePrivate': {
      if (!newState.publicCompany) break;
      const marketCap = marketCapFor(newState.publicCompany);
      const founderPct = newState.capTable.find((e) => e.holder === 'You')?.percentage ?? 0;
      const buyoutCost = marketCap * ((100 - founderPct) / 100);
      const buyoutLoan: Loan = {
        id: `loan-buyout-${newState.year}`,
        lenderName: 'A consortium of banks',
        principal: buyoutCost,
        balance: buyoutCost,
        annualRate: Math.min(LOAN.MAX_RATE, computeLoanRate(newState) + PUBLIC_MARKET.TAKE_PRIVATE_RATE_PREMIUM),
        termYears: PUBLIC_MARKET.TAKE_PRIVATE_LOAN_YEARS,
      };
      newState.loans = [...newState.loans, buyoutLoan];
      newState.everTookLoan = true;
      newState.capTable = normalizeCaptable([{ holder: 'You', percentage: 100 }]);
      newState.publicCompany = null;
      break;
    }

    case 'failure':
      newState.status = 'ended';
      break;

    case 'end':
      // Which EndingType this was (sale/ipo/retirement/fraud) is threaded
      // through to the YearRecord by processPlayerChoice/fireEvent — this
      // only needs to stop the year loop.
      newState.status = 'ended';
      break;

    case 'award':
      if (effect.awardId && !newState.awards.includes(effect.awardId)) {
        newState.awards = [...newState.awards, effect.awardId];
      }
      break;

    case 'chainFlag':
      if (effect.chainFlagKey) {
        newState.chainFlags = { ...newState.chainFlags, [effect.chainFlagKey]: newState.year };
      }
      break;

    case 'cofounderExit': {
      // Resolved by role, not a static characterId — content can't know in
      // advance which cofounder template a given run drew (see text.ts's
      // {COFOUNDER} token for the same pattern).
      const cofounder = newState.cast.find((c) => c.role === 'cofounder');
      if (cofounder) {
        newState.cast = newState.cast.filter((c) => c.id !== cofounder.id);
        if (!effect.keepsEquity) {
          const stake = newState.capTable.find((e) => e.holder === cofounder.fullName)?.percentage ?? 0;
          newState.capTable = normalizeCaptable(
            newState.capTable
              .filter((e) => e.holder !== cofounder.fullName)
              .map((e) => (e.holder === 'You' ? { ...e, percentage: e.percentage + stake } : e))
          );
        }
      }
      break;
    }

    case 'investorDeparts': {
      // Resolved by role, first found — same reasoning as cofounderExit:
      // content can't know in advance which investor template a given
      // run's funding rounds drew, and a company can have more than one on
      // the cap table at once. Always reclaims their stake (unlike
      // cofounderExit, there's no "keeps equity" variant here — a bought-
      // out investor's shares don't just evaporate).
      const investor = newState.cast.find((c) => c.role === 'investor');
      if (investor) {
        newState.cast = newState.cast.filter((c) => c.id !== investor.id);
        const stake = newState.capTable.find((e) => e.holder === (investor.firm ?? investor.fullName))?.percentage ?? 0;
        newState.capTable = normalizeCaptable(
          newState.capTable
            .filter((e) => e.holder !== (investor.firm ?? investor.fullName))
            .map((e) => (e.holder === 'You' ? { ...e, percentage: e.percentage + stake } : e))
        );
        newState.everLostABacker = true;
      }
      break;
    }

    case 'rivalAcquired': {
      // Resolved by role — same pattern as cofounderExit/investorDeparts.
      // A rival has no capTable stake to reclaim; they're just gone.
      const rival = newState.cast.find((c) => c.role === 'rival');
      if (rival) {
        newState.cast = newState.cast.filter((c) => c.id !== rival.id);
        newState.everAcquiredRival = true;
      }
      break;
    }

    case 'growEquityCofounder': {
      const amount = effect.value ?? 0;
      const cofounder = newState.cast.find((c) => c.role === 'cofounder');
      if (cofounder) {
        newState.capTable = normalizeCaptable(
          newState.capTable.map((e) => {
            if (e.holder === 'You') return { ...e, percentage: Math.max(0, e.percentage - amount) };
            if (e.holder === cofounder.fullName) return { ...e, percentage: e.percentage + amount };
            return e;
          })
        );
      }
      break;
    }

    case 'grantNewEquity': {
      const amount = effect.value ?? 0;
      const label = effect.holderLabel ?? 'A new co-founder';
      const diluted = newState.capTable.map((e) => (e.holder === 'You' ? { ...e, percentage: Math.max(0, e.percentage - amount) } : e));
      const existing = diluted.find((e) => e.holder === label);
      newState.capTable = normalizeCaptable(
        existing ? diluted.map((e) => (e.holder === label ? { ...e, percentage: e.percentage + amount } : e)) : [...diluted, { holder: label, percentage: amount }]
      );
      break;
    }
  }

  return newState;
}

/**
 * Apply multiple effects in sequence
 */
export function applyEffects(state: GameState, effects: EffectValue[]): GameState {
  let current = { ...state };
  for (const effect of effects) {
    current = applyEffect(current, effect);
  }
  return current;
}
