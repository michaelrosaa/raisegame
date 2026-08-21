/**
 * Character casting and portrait generation
 * Select characters from pool, ensure diversity, generate deterministic portraits
 */

import type { Character, CharacterTemplate, GameState, PortraitSeed, Gender } from './types';
import { RNG } from './rng';

// ============================================================================
// Portrait Generation
// ============================================================================

/**
 * Palette colors for portrait backgrounds
 * 14 distinct colors to ensure no two characters share one in a run
 */
export const BACKGROUND_PALETTE = [
  '#2C3E5C', '#4A3550', '#1F4D3A', '#5C3A2E', '#3D3D6B', '#6B4A1E', '#2E5457',
  '#54324A', '#1E3A5F', '#663D2E', '#3A5230', '#4E2E52', '#5C5230', '#2A4D4D',
];

/**
 * Hair color palette (9 options)
 */
export const HAIR_COLOUR_PALETTE = [
  '#241C18', '#4A3323', '#6E4A2A', '#8C6239', '#B08D57', '#C9C4BC', '#E8E2D5', '#7A2E1E', '#3D3D45',
];

/**
 * Skin tone palette (10 options)
 */
export const SKIN_PALETTE = [
  '#F2D6BE', '#E8C9A8', '#D9AF8B', '#C99B7A', '#B5825F',
  '#9C6844', '#7E5133', '#5F3D26', '#F7E2CE', '#A87553',
];

/**
 * Clothing color palette (12 options)
 */
export const CLOTHING_PALETTE = [
  '#3E5478', '#63496B', '#2F6B4E', '#7A4A38', '#4A4A6E', '#8A6A2E',
  '#365E60', '#6E3A54', '#2A4A72', '#7A5030', '#4A6238', '#5E3A6E',
];

/**
 * Company brand colours — one per industry, so two runs in different
 * industries are distinguishable at a glance. Keyed on content's free-text
 * industry string (see constants.ts's INDUSTRY_MAP for how the same 5
 * strings collapse onto the economy's canonical buckets); "Food & Retail"
 * reads as its `food` reference tint, same reasoning INDUSTRY_MAP already
 * uses. Unrecognised strings fall back to the old hash-of-name palette so
 * this never throws on unfamiliar content.
 */
export const COMPANY_COLOUR_PALETTE = [
  '#7C3AED', '#DB2777', '#059669', '#D97706', '#2563EB', '#DC2626', '#0891B2', '#65A30D',
];

const INDUSTRY_REFERENCE_TINT: Record<string, string> = {
  Software: '#4A8FD4',
  Hardware: '#B4694A',
  Services: '#3AA88A',
  'Food & Retail': '#C4903A',
  Strange: '#9B6EC4',
};

export function pickCompanyColour(industry: string): string {
  return INDUSTRY_REFERENCE_TINT[industry] ?? new RNG(industry).pick(COMPANY_COLOUR_PALETTE);
}

/**
 * Hair shapes (12 descriptive types)
 */
export const HAIR_SHAPES = [
  'short-crop', 'long-straight', 'curly-volume', 'afro', 'bun', 'shaved',
  'receding', 'bob', 'long-wavy', 'braids', 'side-part', 'bald-with-fringe',
];

/**
 * Accessory types (8 options: 0=none, 1-7=types)
 */
export const ACCESSORY_TYPES = [
  'none', 'glasses', 'round-glasses', 'beard', 'moustache', 'earrings', 'headscarf', 'cap',
];

// ============================================================================
// Player-chosen portrait presets — distinct from generatePortraitSeed below
// (which derives a portrait from a name/gender hash for NPCs). The founder
// instead picks one of these directly on the setup screen, hand-picked for
// visual variety across the palettes above rather than randomly rolled.
// ============================================================================

export const PORTRAIT_PRESETS: PortraitSeed[] = [
  { background: 0, skin: 0, hairShape: 0, hairColour: 0, clothing: 0, accessory: 0 },
  { background: 2, skin: 8, hairShape: 2, hairColour: 6, clothing: 3, accessory: 2 },
  { background: 4, skin: 3, hairShape: 8, hairColour: 4, clothing: 6, accessory: 5 },
  { background: 6, skin: 5, hairShape: 3, hairColour: 1, clothing: 9, accessory: 3 },
  { background: 8, skin: 9, hairShape: 5, hairColour: 5, clothing: 1, accessory: 0 },
  { background: 10, skin: 1, hairShape: 9, hairColour: 8, clothing: 11, accessory: 6 },
  { background: 12, skin: 6, hairShape: 1, hairColour: 2, clothing: 4, accessory: 4 },
  { background: 1, skin: 4, hairShape: 11, hairColour: 3, clothing: 7, accessory: 1 },
  { background: 13, skin: 2, hairShape: 6, hairColour: 7, clothing: 10, accessory: 7 },
  { background: 3, skin: 7, hairShape: 4, hairColour: 0, clothing: 5, accessory: 2 },
];

/** Two more presets, mobile only — the phone portrait grid is 3 across, and
 * ten doesn't fill the last row (4th row would carry a single orphan
 * tile). Twelve fills 4 full rows of 3 exactly. Drawn from the same layer
 * system as PORTRAIT_PRESETS above (background/skin/hairShape/hairColour/
 * clothing/accessory indices into the palettes above it), favouring the
 * two background indices (5, 9) and hair shapes (7, 10) the desktop ten
 * don't already use, for maximum visual variety against them. Desktop
 * never reads this — it keeps exactly the ten PORTRAIT_PRESETS above. */
export const PORTRAIT_PRESETS_MOBILE_EXTRA: PortraitSeed[] = [
  { background: 5, skin: 2, hairShape: 7, hairColour: 4, clothing: 2, accessory: 3 },
  { background: 9, skin: 6, hairShape: 10, hairColour: 7, clothing: 8, accessory: 0 },
];

// ============================================================================
// Deterministic Portrait Generation
// ============================================================================

/** Accessory index constants — see ACCESSORY_TYPES above. Named so the
 * gender-weighting below reads as intent, not magic numbers. */
const ACCESSORY_BEARD = 3;
const ACCESSORY_MOUSTACHE = 4;
const ACCESSORY_EARRINGS = 5;

/**
 * Generate a portrait seed from a character's full name (and, optionally,
 * gender — see below). This ensures:
 * 1. Same name + gender always generates the same portrait
 * 2. Portraits are visually distinct
 * 3. No two characters in a run share a background color
 *
 * Gender only ever narrows which accessory can be rolled, never which hair
 * shape/colour/skin/clothing — beard/moustache are restricted to 'm'/'nb'
 * (never drawn for 'f'), and earrings are weighted higher for 'f'. Omitting
 * gender falls back to the old ungendered accessory roll.
 */
export function generatePortraitSeed(name: string, gender?: Gender, backgroundIndex?: number): PortraitSeed {
  const rng = new RNG(name); // Use name as seed for determinism

  // Always draw the background roll, even when it's about to be overridden,
  // so every other feature is drawn at a fixed RNG position. Otherwise a
  // character's hair/skin/clothing would silently change depending on
  // whether the caller happened to pass a dedup override for background —
  // the "same name always generates same portrait" guarantee only holds if
  // the draw sequence never shifts.
  const rolledBackground = rng.nextInt(0, BACKGROUND_PALETTE.length - 1);

  const seed: PortraitSeed = {
    background: backgroundIndex ?? rolledBackground,
    skin: rng.nextInt(0, SKIN_PALETTE.length - 1),
    hairShape: rng.nextInt(0, HAIR_SHAPES.length - 1),
    hairColour: rng.nextInt(0, HAIR_COLOUR_PALETTE.length - 1),
    clothing: rng.nextInt(0, CLOTHING_PALETTE.length - 1),
    accessory: 0,
  };

  // 40% chance of any accessory at all — drawn once, at a fixed RNG
  // position, regardless of gender, so the sequence never shifts.
  const wantsAccessory = !rng.roll(60);
  if (!wantsAccessory) return seed;

  if (gender === undefined) {
    seed.accessory = rng.nextInt(1, ACCESSORY_TYPES.length - 1);
    return seed;
  }

  // Build the eligible pool for this gender, then weight earrings double
  // for 'f' by listing that index twice — same rng.pick draw either way.
  const pool: number[] = [];
  for (let i = 1; i < ACCESSORY_TYPES.length; i++) {
    if ((i === ACCESSORY_BEARD || i === ACCESSORY_MOUSTACHE) && gender === 'f') continue;
    pool.push(i);
    if (i === ACCESSORY_EARRINGS && gender === 'f') pool.push(i);
  }
  seed.accessory = rng.pick(pool);
  return seed;
}

/**
 * Get color for a portrait component
 */
export function getPortraitColor(seed: PortraitSeed, component: 'background' | 'skin' | 'hairColour' | 'clothing'): string {
  switch (component) {
    case 'background':
      return BACKGROUND_PALETTE[seed.background];
    case 'skin':
      return SKIN_PALETTE[seed.skin];
    case 'hairColour':
      return HAIR_COLOUR_PALETTE[seed.hairColour];
    case 'clothing':
      return CLOTHING_PALETTE[seed.clothing];
  }
}

/**
 * Get descriptive name for a portrait feature
 */
export function getPortraitFeature(seed: PortraitSeed, component: 'hairShape' | 'accessory'): string {
  switch (component) {
    case 'hairShape':
      return HAIR_SHAPES[seed.hairShape];
    case 'accessory':
      return ACCESSORY_TYPES[seed.accessory];
  }
}

// ============================================================================
// Character Selection
// ============================================================================

/**
 * Ensure no two characters share a background color in a run
 * Returns next available background index
 */
export function nextAvailableBackgroundIndex(cast: Character[]): number {
  const usedIndices = new Set(cast.map((c) => c.portrait.background));

  for (let i = 0; i < BACKGROUND_PALETTE.length; i++) {
    if (!usedIndices.has(i)) {
      return i;
    }
  }

  // Shouldn't reach here if we have enough distinct colors
  throw new Error('All background colors used in cast');
}

/**
 * Create a new character from raw data
 * Generates deterministic portrait
 */
export function createCharacter(
  id: string,
  fullName: string,
  gender: Gender,
  role: 'investor' | 'mentor' | 'cofounder' | 'rival' | 'acquirer' | 'staff',
  history: string,
  sentimentInit: number = 50,
  backgroundIndex?: number,
  firm?: string,
  trait?: string
): Character {
  const portrait = generatePortraitSeed(fullName, gender, backgroundIndex);

  return {
    id,
    fullName,
    gender,
    role,
    history,
    firm,
    trait,
    portrait,
    sentiment: Math.max(0, Math.min(100, sentimentInit)),
  };
}

/**
 * Turn a content character (from characters.json) into a full cast member for
 * a specific run. This is the one path that should ever add a character to a
 * run's cast: it always resolves the background against `existingCast` via
 * nextAvailableBackgroundIndex, so "no two characters in the same run share a
 * background colour" can't be forgotten by a caller the way an optional
 * parameter on createCharacter() could be. (Ten of the ten characters in the
 * shipped content collide on background when hashed independently — see
 * nextAvailableBackgroundIndex — which is exactly the failure mode this
 * exists to prevent.)
 */
export function createCharacterFromTemplate(template: CharacterTemplate, existingCast: Character[]): Character {
  return createCharacter(
    template.id,
    template.fullName,
    template.gender,
    template.role,
    template.history,
    template.sentiment,
    nextAvailableBackgroundIndex(existingCast),
    template.firm,
    template.trait
  );
}

/**
 * Check if two characters have identical portraits
 * Should always be false if cast is built correctly
 */
export function portraitsAreIdentical(a: Character, b: Character): boolean {
  const seed1 = a.portrait;
  const seed2 = b.portrait;

  return (
    seed1.background === seed2.background &&
    seed1.skin === seed2.skin &&
    seed1.hairShape === seed2.hairShape &&
    seed1.hairColour === seed2.hairColour &&
    seed1.clothing === seed2.clothing &&
    seed1.accessory === seed2.accessory
  );
}

// ============================================================================
// Founding crew — the one place a run's starting cast gets seeded, so the
// real game and the simulation harness can never drift on this policy.
// ============================================================================

/** A cofounder shows up in roughly 6 of every 10 runs — solo-founder runs
 * stay a real, common variant, but most careers get one, which is what
 * unblocks the hasCofounder-gated content (co-founder friction, disputes,
 * who's-in-charge) from being permanently dead. */
export const COFOUNDER_GRANT_PCT = 60;
/** Taken from the founder's own stake, before any investor money — a
 * meaningful minority stake, not a token grant. */
export const COFOUNDER_EQUITY_PCT = 15;

/**
 * Seed a run's starting cast: always one mentor, and — on the roll — one
 * cofounder with real cap-table equity and a real history entry. This is
 * the only place that should ever do this (see App.tsx / simulate.ts,
 * which both call it identically instead of each rolling their own
 * mentor/cofounder policy).
 */
export function castFoundingCrew(state: GameState, rng: RNG, characterPool: CharacterTemplate[]): GameState {
  let next = state;

  const mentorTemplates = characterPool.filter((c) => c.role === 'mentor');
  if (mentorTemplates.length > 0) {
    const mentor = createCharacterFromTemplate(rng.pick(mentorTemplates), next.cast);
    next = { ...next, cast: [...next.cast, mentor] };
  }

  if (rng.roll(COFOUNDER_GRANT_PCT)) {
    const cofounderTemplates = characterPool.filter((c) => c.role === 'cofounder');
    if (cofounderTemplates.length > 0) {
      const cofounder = createCharacterFromTemplate(rng.pick(cofounderTemplates), next.cast);

      const capTable = next.capTable.map((entry) =>
        entry.holder === 'You' ? { ...entry, percentage: entry.percentage - COFOUNDER_EQUITY_PCT } : entry
      );
      capTable.push({ holder: cofounder.fullName, percentage: COFOUNDER_EQUITY_PCT });

      // Deliberately NOT pushed into `history` — that array is one row per
      // played turn (the ledger renders it 1:1, one row per year), and
      // founding-with-a-cofounder happens before year one's turn even
      // starts. Recording it here used to give year one two rows. The cap
      // table entry, cast member, and header's COFOUNDER chip already show
      // it; the ledger doesn't need a synthetic zeroth turn to as well.
      next = {
        ...next,
        cast: [...next.cast, cofounder],
        capTable,
      };
    }
  }

  return next;
}

/**
 * Validate that all characters in cast have unique background colors
 */
export function validateCastDiversity(cast: Character[]): { valid: boolean; error?: string } {
  const backgrounds = new Map<number, string[]>();

  for (const char of cast) {
    const bg = char.portrait.background;
    if (!backgrounds.has(bg)) {
      backgrounds.set(bg, []);
    }
    backgrounds.get(bg)!.push(char.fullName);
  }

  for (const [bg, names] of backgrounds) {
    if (names.length > 1) {
      return {
        valid: false,
        error: `Characters ${names.join(', ')} share background color ${bg}`,
      };
    }
  }

  return { valid: true };
}
