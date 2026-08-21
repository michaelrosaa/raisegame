/**
 * The one seam between the game and monetization. Nothing outside this
 * file should know or care whether an ad SDK is actually wired up.
 *
 * Status: this is a MOCK provider. There is no real ad network integrated
 * — doing that requires a publisher account and real credentials (Google
 * Ad Manager / AdSense, AppLovin MAX, IronSource, etc.) that don't exist
 * for this project yet. Swap requestRewardedAd's body for a real SDK call
 * later; every call site in ui/ already treats the result as "may or may
 * not have actually played," never as "may or may not be granted" — the
 * reward always happens (see the rule below), so nothing else needs to
 * change when a real network goes in.
 *
 * Design rule, non-negotiable: every rewarded placement has a silent free
 * fallback. If no ad fills, the player gets the unlock anyway, with no
 * error, no "ad unavailable" message, no nag. The `filled` flag exists for
 * our own visibility (analytics later), not for the UI to branch on.
 */

export type AdPlacement = 'idea-reroll' | 'mentor-hint' | 'dynasty-generation';

/** The first handoff (generation 1 -> 2) is always free — it's the core
 * dynasty loop, not a monetization moment. Every handoff beyond that
 * (2 -> 3, 3 -> 4, ...) is rewarded-ad-gated, same silent-fallback rule
 * as everything else. */
export const FREE_DYNASTY_GENERATIONS = 2;

export interface RewardedAdResult {
  /** Whether a real ad actually played. Callers must NOT use this to
   * decide whether to grant the reward — it always is. It exists only so
   * we can eventually log fill rate per placement. */
  filled: boolean;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Roughly matches typical rewarded-video fill rates — used only so the
 * mock provider exercises the fallback path sometimes instead of always
 * "succeeding," since the fallback is exactly the behavior most likely to
 * go untested if it always fills. */
const MOCK_FILL_RATE = 0.92;

/**
 * Request a rewarded ad for a placement. Resolves once the simulated
 * ad-load/watch flow completes — callers show a loading state for this
 * duration, then grant the reward unconditionally. This is never a
 * full-screen takeover and never blocks navigation; it's scoped to
 * whatever small control triggered it (a button, a chip), matching "no
 * interstitials, no ad ever interrupts play."
 */
export async function requestRewardedAd(placement: AdPlacement): Promise<RewardedAdResult> {
  await sleep(900 + Math.random() * 500);
  const filled = Math.random() < MOCK_FILL_RATE;
  if (!filled && import.meta.env.DEV) {
    // Dev-only visibility into the fallback path — never surfaced to the player.
    console.debug(`[ads] ${placement}: no fill, granting reward via silent fallback`);
  }
  return { filled };
}
