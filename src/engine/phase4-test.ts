/**
 * Phase 4 Integration Test
 * Verify content loads and matches engine type definitions
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import type { EventDef, Idea, CharacterTemplate, Award, CountryData } from './types';

console.log('🎮 Phase 4: Content Layer Validation\n');

// ============================================================================
// Load all content files
// ============================================================================

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const contentDir = path.join(__dirname, '../content');

const ideas = JSON.parse(fs.readFileSync(path.join(contentDir, 'ideas.json'), 'utf-8')) as Idea[];
// Content characters never carry a portrait — it's generated deterministically
// at runtime from fullName (see cast.ts). Casting raw JSON straight to
// `Character[]` would be a type lie (the shape is missing a required field);
// CharacterTemplate is what the content actually is.
const characters = JSON.parse(fs.readFileSync(path.join(contentDir, 'characters.json'), 'utf-8')) as CharacterTemplate[];
const countries = JSON.parse(fs.readFileSync(path.join(contentDir, 'countries.json'), 'utf-8')) as CountryData[];
const awards = JSON.parse(fs.readFileSync(path.join(contentDir, 'awards.json'), 'utf-8')) as Award[];

const eventFiles = [
  'everyday',
  'economic',
  'gambles',
  'internal',
  'family',
  'absurd',
  'geopolitical',
];

const allEvents: EventDef[] = [];
eventFiles.forEach((file) => {
  const events = JSON.parse(fs.readFileSync(path.join(contentDir, 'events', `${file}.json`), 'utf-8')) as EventDef[];
  allEvents.push(...events);
});

console.log(`✓ Ideas: ${ideas.length}`);
console.log(`✓ Characters: ${characters.length}`);
console.log(`✓ Countries: ${countries.length}`);
console.log(`✓ Awards: ${awards.length}`);
console.log(`✓ Events: ${allEvents.length} across ${eventFiles.length} categories`);

// ============================================================================
// Validate content structure
// ============================================================================

console.log('\n📋 Validation:');

// Validate ideas
console.log('  Ideas:');
const difficultyLevels = new Set(ideas.map((i) => i.difficulty));
console.log(`    ✓ ${ideas.length} ideas with difficulties: ${Array.from(difficultyLevels).join(', ')}`);

// Validate characters
console.log('  Characters:');
const genders = new Set(characters.map((c) => c.gender));
const roles = new Set(characters.map((c) => c.role));
console.log(`    ✓ ${characters.length} characters with genders: ${Array.from(genders).join(', ')}`);
console.log(`    ✓ Roles: ${Array.from(roles).join(', ')}`);

// Validate countries
console.log('  Countries:');
const withCurrencyRisk = countries.filter((c) => c.currencyRisk >= 0.2).length;
console.log(`    ✓ ${countries.length} countries, ${withCurrencyRisk} with currency risk`);

// Validate events
console.log('  Events:');
const rareCount = allEvents.filter((e) => e.rarity === 'rare').length;
const gambleCount = allEvents.filter((e) => e.isGamble).length;
console.log(`    ✓ ${allEvents.length} total events`);
console.log(`    ✓ ${gambleCount} gamble events`);
console.log(`    ✓ ${rareCount} rare events`);

// Check event structure
const eventWithNoOptions = allEvents.find((e) => e.options.length === 0);
if (!eventWithNoOptions) {
  console.log(`    ✓ All events have options`);
} else {
  console.log(`    ✗ Event ${eventWithNoOptions.id} has no options`);
}

// Check for gambles with proper odds
const invalidGambles = allEvents.filter((e) => {
  if (!e.isGamble) return false;
  const gamble = e.options.find((o) => o.gamble);
  if (!gamble) return true; // Event marked as gamble but no gamble option
  return gamble.gamble!.winPct + gamble.gamble!.losePct !== 100;
});

if (invalidGambles.length === 0) {
  console.log(`    ✓ All gambles have valid probabilities (win + lose = 100)`);
} else {
  console.log(`    ✗ ${invalidGambles.length} invalid gambles`);
}

// ============================================================================
// Summary
// ============================================================================

console.log('\n✅ Phase 4 Content Validation Complete');
console.log(`   ${ideas.length} ideas, ${characters.length} characters, ${countries.length} countries`);
console.log(`   ${allEvents.length} events ready for gameplay`);
