/**
 * Pronoun utilities
 * Ensures no hardcoded pronouns in copy - all route through this helper
 * This prevents bugs like "the 30 people who follow her in" about a male character
 */

import type { Character, Gender } from './types';

type Pronoun = 'she' | 'he' | 'they' | 'her' | 'him' | 'them' | 'hers' | 'his' | 'theirs' | 'herself' | 'himself' | 'themself';

/**
 * Get a pronoun for a character in a specific case
 * Always use this instead of hardcoding pronouns in copy
 * 
 * Examples:
 *   pronoun(character, 'subject')   // "she", "he", "they"
 *   pronoun(character, 'object')    // "her", "him", "them"
 *   pronoun(character, 'possessive') // "hers", "his", "theirs"
 *   pronoun(character, 'reflexive') // "herself", "himself", "themself"
 */
export function pronoun(character: Character, caseType: 'subject' | 'object' | 'possessive' | 'reflexive'): Pronoun {
  return pronounByGender(character.gender, caseType);
}

/**
 * Get a pronoun for a gender in a specific case
 */
export function pronounByGender(gender: Gender, caseType: 'subject' | 'object' | 'possessive' | 'reflexive'): Pronoun {
  if (gender === 'f') {
    switch (caseType) {
      case 'subject': return 'she';
      case 'object': return 'her';
      case 'possessive': return 'hers';
      case 'reflexive': return 'herself';
    }
  } else if (gender === 'm') {
    switch (caseType) {
      case 'subject': return 'he';
      case 'object': return 'him';
      case 'possessive': return 'his';
      case 'reflexive': return 'himself';
    }
  } else {
    // gender === 'nb'
    switch (caseType) {
      case 'subject': return 'they';
      case 'object': return 'them';
      case 'possessive': return 'theirs';
      case 'reflexive': return 'themself';
    }
  }
}

/**
 * Get possessive form for a character name
 * "Priya" → "Priya's", "James" → "James's"
 */
export function possessive(name: string): string {
  if (name.endsWith('s')) {
    return `${name}'s`;
  }
  return `${name}'s`;
}

/**
 * Get subject pronoun with capital letter for start of sentence
 */
export function pronounCapitalized(character: Character, caseType: 'subject' | 'object' | 'possessive' | 'reflexive'): string {
  const p = pronoun(character, caseType);
  return p.charAt(0).toUpperCase() + p.slice(1);
}

/**
 * Render a template string with character references
 * Replaces {char.pronoun.subject}, {char.pronoun.object}, etc.
 * 
 * Example template:
 *   "{name} reaches out. {pronoun.subject} wants to know if {pronoun.object} can help."
 *   → "Priya reaches out. She wants to know if her can help."
 */
export function renderTemplate(template: string, character: Character, name: string = character.fullName): string {
  let result = template;
  
  // Replace {name} with character name
  result = result.replace(/{name}/g, name);
  
  // Replace pronouns
  result = result.replace(/{pronoun\.subject}/g, pronoun(character, 'subject'));
  result = result.replace(/{pronoun\.Subject}/g, pronounCapitalized(character, 'subject'));
  result = result.replace(/{pronoun\.object}/g, pronoun(character, 'object'));
  result = result.replace(/{pronoun\.Object}/g, pronounCapitalized(character, 'object'));
  result = result.replace(/{pronoun\.possessive}/g, pronoun(character, 'possessive'));
  result = result.replace(/{pronoun\.Possessive}/g, pronounCapitalized(character, 'possessive'));
  result = result.replace(/{pronoun\.reflexive}/g, pronoun(character, 'reflexive'));
  result = result.replace(/{pronoun\.Reflexive}/g, pronounCapitalized(character, 'reflexive'));
  result = result.replace(/{possessive}/g, possessive(name));
  
  return result;
}

/**
 * Capitalize first letter of a string
 */
export function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
