/**
 * Seeded random number generator (mulberry32)
 * 
 * CRITICAL: Math.random() must NEVER appear in engine code
 * All randomness must come from this seeded RNG to ensure:
 * 1. Determinism: same seed + same choices = identical career
 * 2. Sharing: runs can be encoded in URLs and perfectly replayed
 * 3. Testing: the simulation harness can run 10k careers deterministically
 */

/**
 * Mulberry32 PRNG implementation
 * Returns values in [0, 1) range
 * Based on: https://stackoverflow.com/questions/521295/seeding-the-random-number-generator-in-javascript
 */
function mulberry32(a: number): () => number {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Convert a string seed to a numeric seed
 * Must be deterministic
 */
function seedToNumber(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    const char = seed.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash);
}

/**
 * RNG instance
 * Manages a sequence of random numbers from a seed
 */
export class RNG {
  private generator: () => number;
  private seed: string;
  /** Draws taken from this instance so far. Public so RNG satisfies the
   * lightweight `Rng` interface (see below) that economy.ts/gaussian/
   * luckRoll are written against, without needing a second PRNG class. */
  cursor: number = 0;

  constructor(seed: string) {
    this.seed = seed;
    const numericSeed = seedToNumber(seed);
    this.generator = mulberry32(numericSeed);
  }

  /**
   * Get next random number [0, 1)
   */
  next(): number {
    this.cursor++;
    return this.generator();
  }

  /**
   * Get random integer in range [min, max]
   */
  nextInt(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }

  /**
   * Get random element from array
   */
  pick<T>(array: T[]): T {
    if (array.length === 0) throw new Error('Cannot pick from empty array');
    return array[Math.floor(this.next() * array.length)];
  }

  /**
   * Shuffle array in place (Fisher-Yates)
   */
  shuffle<T>(array: T[]): T[] {
    const arr = [...array];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  /**
   * Pick weighted random element
   * weights: [{ value, weight }, ...]
   */
  pickWeighted<T>(items: Array<{ value: T; weight: number }>): T {
    const totalWeight = items.reduce((sum, item) => sum + item.weight, 0);
    let random = this.next() * totalWeight;
    
    for (const item of items) {
      random -= item.weight;
      if (random <= 0) {
        return item.value;
      }
    }
    
    // Fallback (shouldn't reach here)
    return items[items.length - 1].value;
  }

  /**
   * Roll a percentile die
   * Returns true with probability percentChance / 100
   */
  roll(percentChance: number): boolean {
    return this.next() * 100 < percentChance;
  }

  /**
   * Get the seed
   */
  getSeed(): string {
    return this.seed;
  }
}

/**
 * Bumped on every generateSeed() call so two calls within the same
 * millisecond still get distinct entropy.
 */
let seedEntropyCounter = 0;

/**
 * Validate a seed format
 * Must be 4 characters with at least 1 digit and 1 letter
 * This prevents it from rendering as English words like "appr"
 */
export function validateSeed(seed: string): { valid: boolean; error?: string } {
  if (seed.length !== 4) {
    return { valid: false, error: 'Seed must be exactly 4 characters' };
  }

  const hasDigit = /\d/.test(seed);
  const hasLetter = /[a-zA-Z]/.test(seed);
  const isAlphanumeric = /^[a-zA-Z0-9]+$/.test(seed);

  if (!isAlphanumeric) {
    return { valid: false, error: 'Seed must be alphanumeric only' };
  }

  if (!hasDigit || !hasLetter) {
    return { valid: false, error: 'Seed must contain at least one digit and one letter' };
  }

  return { valid: true };
}

/**
 * Generate a random valid seed
 * If no RNG is supplied, entropy comes from the current time so repeated
 * calls (e.g. "new game") don't all produce the identical seed — this is
 * the one place fresh, non-deterministic entropy is allowed to enter the
 * system; everything downstream of the resulting seed is fully deterministic.
 */
export function generateSeed(rng?: RNG): string {
  const useRng = rng || new RNG(`${Date.now()}-${seedEntropyCounter++}`);
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
  const digits = '0123456789'.split('');

  let seed = '';
  // Ensure at least 1 letter and 1 digit
  seed += useRng.pick(letters);
  seed += useRng.pick(digits);
  // Fill remaining 2 spots randomly
  for (let i = 2; i < 4; i++) {
    seed += useRng.roll(50) ? useRng.pick(letters) : useRng.pick(digits);
  }

  // Shuffle to avoid patterns
  const shuffled = useRng.shuffle(seed.split('')).join('');
  
  // Verify it's valid (should always be)
  const validation = validateSeed(shuffled);
  if (!validation.valid) {
    return generateSeed(useRng); // Recursively try again if somehow invalid
  }

  return shuffled;
}

// ============================================================================
// Minimal RNG surface for the growth economy — `RNG` above already
// satisfies this (it has both `next()` and a public `cursor`), so
// `makeRng` just returns one; economy.ts/exits.ts/turn.ts are written
// against this interface rather than the full RNG class so they only ever
// touch the one primitive draw method.
// ============================================================================

export interface Rng {
  next(): number;
  cursor: number;
}

export function makeRng(seed: string): Rng {
  return new RNG(seed);
}

/**
 * Box–Muller. ALWAYS consumes exactly two uniform draws so the cursor
 * advances predictably. Do not cache the second normal value — caching
 * breaks determinism across differing call orders (a caller that only
 * sometimes asks for a second gaussian would desync the RNG cursor from
 * a caller that always asks for exactly one).
 */
export function gaussian(rng: Rng, mean = 0, sd = 1): number {
  const u1 = Math.max(rng.next(), 1e-9);
  const u2 = rng.next();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return mean + z * sd;
}

/** Log-normal, median 1.0. This is the luck roll. */
export function luckRoll(rng: Rng, sigma: number): number {
  return Math.exp(gaussian(rng, 0, sigma));
}
