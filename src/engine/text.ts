/**
 * Token substitution for event copy.
 * Content is written once and reused across runs, so it can't hardcode a
 * name — it writes {INVESTOR}, {RIVAL}, {COFOUNDER}, {MENTOR}, {ACQUIRER},
 * {COMPANY}, {FOUNDER}, {COUNTRY} instead, and this resolves each token
 * against the run's actual state at render time. A token for a role with
 * nobody cast yet falls back to a generic phrase rather than rendering
 * "{INVESTOR}" literally — content should still make sense the first time
 * a role token fires, before anyone in that role exists in the cast.
 */

import type { Character, CharacterRole, GameState } from './types';
import { COUNTRIES } from './state';

const ROLE_FALLBACK: Record<CharacterRole, string> = {
  investor: 'an investor',
  mentor: 'your mentor',
  cofounder: 'your co-founder',
  rival: 'a rival',
  acquirer: 'a buyer',
  staff: 'someone on the team',
};

/**
 * Most relevant cast member for a role: the most recently added one, since
 * that's the one the run's story has most recently been about.
 */
function castMemberForRole(state: GameState, role: CharacterRole): Character | undefined {
  for (let i = state.cast.length - 1; i >= 0; i--) {
    if (state.cast[i].role === role) return state.cast[i];
  }
  return undefined;
}

function roleToken(state: GameState, role: CharacterRole): string {
  const character = castMemberForRole(state, role);
  return character ? character.fullName : ROLE_FALLBACK[role];
}

const ROLE_TOKENS: Record<string, CharacterRole> = {
  INVESTOR: 'investor',
  MENTOR: 'mentor',
  COFOUNDER: 'cofounder',
  RIVAL: 'rival',
  ACQUIRER: 'acquirer',
};

/** Cofounders are the only role that carries a trait — content conditioned
 * on hasCofounder:true (see events/internal.json's ev-cofounder-trait) can
 * safely assume one exists by the time this token is read; the fallback
 * only matters if the same copy is ever reused without that guard. */
function cofounderTraitToken(state: GameState): string {
  const cofounder = castMemberForRole(state, 'cofounder');
  return cofounder?.trait ?? 'keeps you guessing';
}

/**
 * Resolve every {TOKEN} in a piece of content copy against current state.
 * Safe to call on text with no tokens at all — it's a no-op.
 */
export function renderEventText(template: string, state: GameState): string {
  let result = template;

  result = result.replace(/\{COMPANY\}/g, state.company.name);
  result = result.replace(/\{FOUNDER\}/g, state.founder.name);
  result = result.replace(/\{COUNTRY\}/g, COUNTRIES[state.founder.country]?.name ?? state.founder.country);
  if (/\{COFOUNDER_TRAIT\}/.test(result)) {
    result = result.replace(/\{COFOUNDER_TRAIT\}/g, cofounderTraitToken(state));
  }

  for (const [token, role] of Object.entries(ROLE_TOKENS)) {
    const pattern = new RegExp(`\\{${token}\\}`, 'g');
    if (pattern.test(result)) {
      result = result.replace(pattern, roleToken(state, role));
    }
  }

  return result;
}
