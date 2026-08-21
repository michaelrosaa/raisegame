/**
 * Applying a player's chosen option for the year. Advancing the year
 * itself (economy tick, exit offers, event selection) lives in turn.ts —
 * this file is just "the player picked an option, what happens now."
 */

import type { CharacterTemplate, GameState, EventDef, OptionDef, EffectValue } from './types';
import { RNG } from './rng';
import { applyEffects, getFounderShare } from './state';
import { fireEvent, eventOffersFunding } from './events';
import { createCharacterFromTemplate } from './cast';
import { computeFundingOffer, computeLoanRate, monthlyBurn } from './economy';
import { computeExitPrice } from './exits';

/**
 * Process a player's choice of an option
 * Returns updated state after all effects applied
 */
export function processPlayerChoice(
  state: GameState,
  event: EventDef,
  option: OptionDef,
  rng: RNG,
  characterPool: CharacterTemplate[] = []
): {
  state: GameState;
  gambleResult?: 'won' | 'lost';
} {
  const founderShareBefore = getFounderShare(state.capTable);

  // Handle gamble if present. The option's base effects always apply (they're
  // the cost of making the choice at all, or — for a plain, non-random
  // outcome like accepting an acquisition — the choice's entire effect);
  // gamble win/lose effects layer on top rather than replacing them. The
  // original code replaced effectsToApply with only the win/lose effects,
  // which silently dropped the base effects (e.g. a 100%-odds "gamble"
  // wrapping an `end` effect would apply nothing at all and never end the
  // game).
  let gambleResult: 'won' | 'lost' | undefined;
  let effectsToApply: EffectValue[] = [...option.effects];

  if (option.gamble) {
    const won = rng.roll(option.gamble.winPct);
    gambleResult = won ? 'won' : 'lost';
    effectsToApply = [...option.effects, ...(won ? option.gamble.winEffects : option.gamble.loseEffects)];
  }

  // Content never authors a funding amount directly — it would go stale
  // against climate/valuation the moment either changed. A content `funding`
  // effect instead carries characterId + fundingStage; resolve it here into a
  // fully-priced FundingOffer, and cast the investor into `cast` if this is
  // their first appearance (with proper background dedup). `addCharacter`
  // effects follow the same pattern: content authors characterId, resolved
  // into a real cast member here. A bare `end` (sale/ipo) effect without an
  // exitPrice — the handful of legacy content events predating the generated
  // exit system — gets one drawn from the same seeded exit-multiple formula
  // exits.ts uses for generated offers (engine/exits.ts §8.3), so every sale
  // or IPO in the game prices identically, whether drawn from content or
  // generated from state.
  let workingCast = state.cast;
  effectsToApply = effectsToApply.map((effect) => {
    if (effect.type === 'funding' && !effect.fundingOffer && effect.characterId && effect.fundingStage) {
      let lead = workingCast.find((c) => c.id === effect.characterId);
      if (!lead) {
        const template = characterPool.find((t) => t.id === effect.characterId);
        if (!template) {
          throw new Error(`Unknown character id ${effect.characterId} referenced by a funding effect`);
        }
        lead = createCharacterFromTemplate(template, workingCast);
        workingCast = [...workingCast, lead];
      }
      const offer = computeFundingOffer({ ...state, cast: workingCast }, effect.fundingStage, lead, effect.targetDilutionPct);
      return { ...effect, fundingOffer: offer };
    }
    if (effect.type === 'addCharacter' && !effect.character && effect.characterId) {
      const existing = workingCast.find((c) => c.id === effect.characterId);
      if (existing) return effect; // already cast — leaving effect.character unset makes applyEffect's addCharacter a no-op
      const template = characterPool.find((t) => t.id === effect.characterId);
      if (!template) {
        throw new Error(`Unknown character id ${effect.characterId} referenced by an addCharacter effect`);
      }
      const character = createCharacterFromTemplate(template, workingCast);
      workingCast = [...workingCast, character];
      return { ...effect, character };
    }
    if (effect.type === 'end' && (effect.endingType === 'sale' || effect.endingType === 'ipo') && effect.exitPrice === undefined) {
      return { ...effect, exitPrice: computeExitPrice({ ...state, cast: workingCast }, rng) };
    }
    if (effect.type === 'loan' && !effect.loan) {
      // Content authors principal (`value`) + term (`years`) + lender name
      // (`holderLabel`) directly — unlike funding, a loan isn't priced
      // against valuation, so there's no dynamic amount to resolve, only
      // the interest rate (see economy.ts's computeLoanRate — the reason
      // content never authors a rate is the same reason it never authors a
      // funding amount: it would go stale against the founder's
      // reputation/bankruptcy record the moment either changed).
      const loan = {
        id: `loan-${state.year}-${state.loans.length}`,
        lenderName: effect.holderLabel ?? 'A local bank',
        principal: effect.value ?? 0,
        balance: effect.value ?? 0,
        annualRate: computeLoanRate(state),
        termYears: effect.years ?? 5,
      };
      return { ...effect, loan };
    }
    return effect;
  });

  // Apply all effects against a state that already includes any newly-cast investor
  let newState = applyEffects({ ...state, cast: workingCast }, effectsToApply);

  // Recalculate burn rate (staff, revenue may have changed)
  newState.monthlyBurn = monthlyBurn(newState);

  // If this choice raised money, carry the SINGLE SOURCE OF TRUTH amount into the
  // year's history record so the results card can build accurate stage tiles later.
  const fundingEffect = effectsToApply.find((e) => e.type === 'funding' && e.fundingOffer);
  const funding = fundingEffect?.fundingOffer
    ? {
        stage: fundingEffect.fundingOffer.stage,
        amount: fundingEffect.fundingOffer.amount,
        firm: fundingEffect.fundingOffer.lead.firm ?? fundingEffect.fundingOffer.lead.fullName,
        founderShareBefore,
        founderShareAfter: getFounderShare(newState.capTable),
      }
    : undefined;

  // A funding-carrying event where the chosen option wasn't the funding
  // one reads as a real, nameable decision not to take the money — tracked
  // the same way exits.ts tracks a declined acquisition (chainFlags,
  // keyed to the year), so failure.ts's pivot-point generator has a real
  // "last funding offer refused" signal to draw from.
  if (!funding && eventOffersFunding(event)) {
    newState = {
      ...newState,
      chainFlags: { ...newState.chainFlags, declinedFunding: state.year },
      fundingOffersDeclined: newState.fundingOffersDeclined + 1,
    };
  }

  // If this choice ended the career, carry which EndingType it was into
  // history too, so results assembly never has to re-derive it. A content
  // `failure` effect (e.g. "shut down operations") also ends the career but
  // doesn't necessarily zero cash first — without recording 'failure' here,
  // resolveRunResults's cash-based fallback would miss it and mislabel a
  // shutdown as a retirement. A sale/ipo effect's price (just resolved
  // above, generated or legacy-content) is carried through the same way,
  // so what the player saw on the option never drifts from what
  // resolveRunResults pays out later.
  const endEffect = effectsToApply.find((e) => e.type === 'end' && e.endingType);
  const failureEffect = effectsToApply.find((e) => e.type === 'failure');
  let endingType = endEffect?.endingType ?? (failureEffect ? 'failure' : undefined);
  const exitPrice = endEffect?.exitPrice;

  // Insolvency is checked here, immediately after this choice's effects
  // land, not just once a year at the top of the next advanceYear turn —
  // a choice that pushes cash negative ends the career on the spot rather
  // than drifting until the player next clicks Advance. Same rule as
  // turn.ts's per-turn check: cash < 0, unconditionally.
  if (newState.status === 'running' && newState.cash < 0) {
    newState = { ...newState, status: 'ended' };
    endingType = endingType ?? 'failure';
  }

  // Mark event as fired, now that we know the outcome
  newState = fireEvent(newState, event, option.id, gambleResult, funding, endingType, exitPrice);

  return {
    state: newState,
    gambleResult,
  };
}

/**
 * Check if the game should offer an ending option
 * Player can always choose to retire/exit
 */
export function canExitGame(state: GameState): boolean {
  // Can exit anytime after year 1, only when running
  return state.year > 1 && state.status === 'running';
}

/**
 * Player chooses to retire/exit
 */
export function playerRetires(state: GameState): GameState {
  return {
    ...state,
    status: 'ended',
  };
}
