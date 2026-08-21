/**
 * Core type definitions for Raise
 * Single source of truth for all game entities
 * 
 * These types are designed to prevent single-source-of-truth bugs:
 * - Money is always a number, formatted at render time only
 * - Names are stored whole, never recombined
 * - Gender is always stored, pronoun helpers handle references
 * - Funding amounts are stored once, descriptions generated from them
 */

// ============================================================================
// Enumerations
// ============================================================================

export type Rarity = 'common' | 'uncommon' | 'rare' | 'absurd';
export type Climate = 'frothy' | 'cooling' | 'frozen' | 'recovering';
export type Gender = 'f' | 'm' | 'nb';
export type PronounCase = 'subject' | 'object' | 'possessive' | 'reflexive';
export type FundingStage = 'idea' | 'seed' | 'seriesA' | 'seriesB' | 'seriesC' | 'seriesD' | 'lateStage';
/** 'ipo' is retired (Pass D): going public no longer ends the run — it
 * transitions into PublicCompanyState instead (see GameState.publicCompany
 * and the 'goPublic' effect) — kept in the union only so old saved/shared
 * seeds still type-check, alongside 'fraud', which was never wired up in
 * the first place. A public company that later ends does so as 'sale' (an
 * acquisition, private or public — the mechanism is identical), 'failure'
 * (including a collapse — fraud, a failed product, a market wipeout), or
 * the new 'exitedPublic' (walked away or was pushed out, valued at
 * whatever the market was paying at the time — see endings.ts's
 * generateExitedPublicOutcome). */
export type EndingType = 'sale' | 'ipo' | 'retirement' | 'failure' | 'fraud' | 'exitedPublic';
export type CharacterRole = 'investor' | 'mentor' | 'cofounder' | 'rival' | 'acquirer' | 'staff';
/** The canonical industry buckets the growth economy tunes against
 * (REVENUE_PER_HEAD, EXIT.MULTIPLE_RANGE, INDUSTRY). Content's free-text
 * `industry` string (e.g. "Food & Retail", "Strange") is mapped onto one
 * of these via INDUSTRY_MAP in constants.ts — the economy never reads the
 * free-text string directly. */
export type CanonicalIndustry = 'software' | 'hardware' | 'services' | 'food' | 'retail' | 'consumer';
export type EffectType =
  | 'cash'
  | 'monthlyBurn'
  | 'annualRevenue'   // legacy direct-set — content should no longer author this; see growthMultiplier/growthSet/revenueStep
  | 'staff'
  | 'morale'
  | 'funding'        // adds a FundingOffer to cast
  | 'sentiment'      // [characterId, delta]
  | 'failure'        // triggers failure ending
  | 'end'            // triggers ending
  | 'addCharacter'   // adds a character to cast
  | 'removeCharacter'// removes character from cast
  | 'award'          // adds an award
  | 'chainFlag'      // records a narrative flag + the year it was set, for callbacks (e.g. a declined acquirer returning later)
  | 'growthMultiplier' // multiplies this year's and the next (years-1) years' growth rate by `value`
  | 'growthSet'         // overrides the very next growth computation outright, once, then clears itself
  | 'revenueStep'       // a one-time flat addition (or subtraction) to revenue, applied at the next growth tick
  | 'cofounderExit'      // the current cast cofounder (role: 'cofounder') leaves — resolved by role, not a
                          // static characterId, since content can't know in advance which cofounder template
                          // was drawn. `keepsEquity` (EffectValue) controls whether their capTable stake
                          // transfers back to the founder or stays with them as a passive holder.
  | 'investorDeparts'    // the current cast investor (role: 'investor', first found) leaves — same role-based
                          // resolution as cofounderExit, for the same reason (content can't know which
                          // investor template a given run's funding rounds drew). Always returns their
                          // capTable stake to the founder (no keepsEquity variant — a bought-out investor's
                          // shares don't just evaporate). Sets GameState.everLostABacker, which the
                          // "NOBODY LEFT" award (awards.ts) reads.
  | 'rivalAcquired'      // the current cast rival (role: 'rival') is bought out and removed — same role-based
                          // resolution as cofounderExit/investorDeparts. Sets GameState.everAcquiredRival,
                          // which the "BOUGHT A RIVAL" award (awards.ts) reads.
  | 'growEquityCofounder' // moves `value` percentage points from the founder to the current cast cofounder's
                          // existing capTable stake (e.g. "more shares to stay")
  | 'grantNewEquity'     // moves `value` percentage points from the founder to a brand-new capTable holder
                          // (`holderLabel`) — for equity granted to someone not otherwise tracked as a
                          // Character (a third co-founder, a first hire taken on at founding)
  | 'startFamily'        // flips GameState.founderHasFamily true — the actual heir (name/trait/portrait)
                          // is generated at the career layer, not here (see career.ts's startFamily),
                          // since it needs the founder's identity to blend from and doesn't need to
                          // resolve against per-choice state the way funding/loan do. This effect exists
                          // purely so content can gate on the 'hasFamily' condition and never re-offer
                          // the choice once accepted.
  | 'repayLoan'          // clears every outstanding loan immediately: cash -= total remaining balance,
                          // loans emptied. No amount to author — the engine already knows the balance,
                          // the same reasoning `loan` itself never authors a rate.
  | 'loan'               // originates a new Loan — content authors `value` (principal), `years` (term),
                          // and `holderLabel` (lender display name, e.g. "Meridian Community Bank" — no
                          // full Character/portrait, same simplification as grantNewEquity's holderLabel).
                          // The engine prices `annualRate` itself at the moment the choice resolves (see
                          // economy.ts's computeLoanRate) — content never authors a rate, the same reason
                          // it never authors a funding amount: it would go stale against the founder's
                          // reputation/bankruptcy record and the country/climate the moment any of them
                          // changed. See EffectValue.loan.
  // ---- Pass D: life after IPO ----
  | 'goPublic'           // sets GameState.publicCompany from a pre-priced `exitPrice` (the IPO valuation —
                          // exits.ts's buildIPOOfferEvent prices it the same way an acquisition offer prices
                          // itself, so the number the player saw never drifts from the resulting share
                          // price). The company keeps running — this is not an ending.
  | 'sellShares'         // content/standing-option-authored `value` = percentage points of the company
                          // sold at the CURRENT share price: capTable moves from 'You' to a 'Public
                          // market' holder, proceeds land in `founderLiquidCash` (swept into personalCash
                          // when the company eventually ends — see career.ts's endCurrentCompany), not
                          // GameState.cash — this is the founder's own liquidity event, not company
                          // operating cash. Selling more than SELL_NO_IMPACT_PCT in one year (see
                          // constants.ts's PUBLIC_MARKET) also costs share price and analyst sentiment —
                          // "the market reads founder selling as bad news, and it usually is."
  | 'boardPatience'      // additive `value`, clamped 0-100. Hits 0 and the founder is removed — see
                          // turn.ts's public-company tick.
  | 'analystSentiment'   // additive `value`, clamped 0-100. Feeds into economy.ts's updateSharePrice.
  | 'sharePriceShock'    // multiplicative `value` (e.g. -0.30 for "down 30% in a day") applied once,
                          // immediately, on top of whatever updateSharePrice does that year — for a
                          // discrete event-driven jolt (a crash, a downgrade) rather than the ordinary
                          // year-to-year drift.
  | 'takePrivate';       // ends `publicCompany` (back to an ordinary private GameState) by borrowing the
                          // full buyout cost — a new Loan for the non-founder stake at market price — and
                          // restoring the founder to full ownership: "you own it all again, heavily
                          // indebted." Company keeps running; this is not an ending either.

// ============================================================================
// Portrait
// ============================================================================

/**
 * Deterministic portrait seed from character name hash
 * All indices are deterministic - no randomness at render time
 */
export interface PortraitSeed {
  background: number;  // 0–13, index into 14-colour palette
  skin: number;        // 0–9, index into 10 tones
  hairShape: number;   // 0–11, index into 12 shapes
  hairColour: number;  // 0–8, index into 9 colours
  clothing: number;    // 0–11, index into 12 colours
  accessory: number;   // 0–7: 0 = none, 1–7 = specific accessories
}

// ============================================================================
// Character
// ============================================================================

export interface Character {
  id: string;
  fullName: string;        // stored whole — NEVER recombine first/last name pools
  gender: Gender;          // required; all copy templates read from this
  role: CharacterRole;
  history: string;         // one line, e.g. "made her money in freight"
  firm?: string;           // e.g. "Alder Lane Partners"
  trait?: string;          // cofounders only — a one-line personality trait content can
                            // read (see events/internal.json's ev-cofounder-trait), e.g.
                            // "disappears when stressed"
  portrait: PortraitSeed;
  sentiment: number;       // 0–100, moves with player decisions
}

/**
 * The shape characters.json actually holds. Content is JSON, and a portrait
 * is generated deterministically from fullName at runtime (see cast.ts) —
 * it can never live in the file itself. Use createCharacter() to turn one
 * of these into a full Character.
 */
export type CharacterTemplate = Omit<Character, 'portrait'>;

// ============================================================================
// Cap Table
// ============================================================================

export interface CapTableEntry {
  holder: string;          // character name or "You"
  percentage: number;      // 0–100, stored to 0.01 precision
}

// ============================================================================
// Funding
// ============================================================================

/**
 * A single funding offer
 * Amount is SINGLE SOURCE OF TRUTH
 * All descriptions are generated from the amount
 */
export interface FundingOffer {
  id: string;
  stage: FundingStage;
  amount: number;          // dollars, SINGLE SOURCE OF TRUTH
  postMoneyValuation: number;
  lead: Character;
  descriptionTemplate: string;  // uses {amount} {lead.fullName} {pronoun} — never literal numbers
}

// ============================================================================
// Debt — no equity, no Character (lenders are a display-name string, same
// simplification grantNewEquity's holderLabel already uses), but a real
// annual cost: costs no ownership, but must be repaid whether or not the
// company works, unlike equity. See economy.ts's computeLoanRate/
// amortizeLoansForYear and state.ts's applyEffect 'loan' case.
// ============================================================================

export interface Loan {
  id: string;
  lenderName: string;      // display only, e.g. "Meridian Community Bank"
  principal: number;       // original amount borrowed
  balance: number;         // remaining principal
  annualRate: number;      // 0-1, fixed at origination — priced once, never repriced mid-loan
  termYears: number;       // original term, for the straight-line principal payment
}

// ============================================================================
// Public company (Pass D) — "going public is a funding event, not an
// ending." sharePrice/sharesOutstanding are the only stored numbers;
// marketCap and the founder's paper worth are always derived from them
// (economy.ts's marketCapFor/founderWorthOnPaper), never stored separately,
// same single-source-of-truth reasoning as every other priced thing in this
// engine.
// ============================================================================

export interface PublicCompanyState {
  sharePrice: number;
  sharesOutstanding: number;
  lockupYearsRemaining: number;    // 1 at IPO, decremented once per year; the founder can't sell until 0
  founderSharesSoldPct: number;    // cumulative percentage points sold since IPO — display only
  boardPatience: number;           // 0-100 — hits 0 and the founder is removed
  analystSentiment: number;        // 0-100 — feeds updateSharePrice
  yearsPublic: number;             // ticks up every year public — paces the post-IPO event pool
                                    // (e.g. "the lockup expires" gates on yearsPublicAbove)
}

// ============================================================================
// Effects
// ============================================================================

export interface EffectValue {
  type: EffectType;
  value?: number;                    // for cash, burn, revenue, staff, morale, sentiment
  // How `value` is interpreted for cash/monthlyBurn/annualRevenue/staff:
  //   'absolute'      (default) — value is a dollar/headcount delta, applied as-is
  //   'percent'       — value is a percentage of the CURRENT figure at the moment
  //                     this effect applies (e.g. {type:'annualRevenue', value:25,
  //                     unit:'percent'} means "+25% of revenue right now")
  //   'runwayMonths'  — cash only: value is a number of months of runway to add
  //                     or remove at the CURRENT burn rate (cash += value *
  //                     monthlyBurn). This is how content almost always phrases
  //                     cash effects ("cash lasts +6 months"), because a fixed
  //                     dollar amount means something different at every burn
  //                     rate — writing it as months keeps the stated effect
  //                     accurate regardless of where the run is.
  unit?: 'absolute' | 'percent' | 'runwayMonths';
  characterId?: string;              // for sentiment, removeCharacter, and (with fundingStage) funding, and (with no fundingStage) addCharacter
  fundingOffer?: FundingOffer;       // for funding, once resolved. Content should NOT author this directly —
                                      // amount/valuation depend on climate and current state, so a static
                                      // number in JSON would immediately go stale. Content instead sets
                                      // characterId + fundingStage below, and the engine resolves the real
                                      // offer (see economy.ts computeFundingOffer) at the moment the choice
                                      // is made — this is what keeps "amount" a single source of truth.
  fundingStage?: FundingStage;       // for funding, content-authored: which round this is
  targetDilutionPct?: number;        // for funding, content-authored: optional override of the default dilution
  character?: Character;             // for addCharacter, once resolved (engine-generated events only — content
                                      // should author characterId instead; see game.ts's effect-resolution step,
                                      // which mirrors funding: it turns characterId into a real cast member,
                                      // deduped against the run's cast, at the moment the choice is made)
  endingType?: EndingType;          // for end
  exitPrice?: number;                // for end (sale/ipo/retirement), content-authored generated exits set this
                                      // at the moment the offer is made so the number the player saw never
                                      // drifts from what resolveRunResults pays out — see engine/exits.ts
  awardId?: string;                  // for award
  chainFlagKey?: string;             // for chainFlag — arbitrary string key, e.g. 'declinedAcquisition'
  years?: number;                    // for growthMultiplier — how many upcoming growth ticks `value` applies to;
                                      // for loan — the term in years (straight-line principal payment)
  keepsEquity?: boolean;             // for cofounderExit — false (default) reclaims their stake for the
                                      // founder; true leaves it with them as a passive holder
  holderLabel?: string;              // for grantNewEquity — the new capTable holder's display name;
                                      // for loan — the lender's display name (content-authored directly,
                                      // same reasoning as grantNewEquity's — a bank doesn't need a
                                      // portrait/sentiment-tracked Character)
  loan?: Loan;                       // for loan, once resolved (principal from `value`, term from `years`,
                                      // lenderName from `holderLabel`, annualRate priced by the engine —
                                      // see game.ts's effect-resolution step, which mirrors funding's)
}

/** A growth-rate modifier from a fired event, still in effect. Pruned once
 * `state.year > expiresYear`. See economy.ts's activeGrowthMultiplier. */
export interface ActiveModifier {
  value: number;
  expiresYear: number;
}

export interface GambleOutcome {
  winPct: number;
  winEffects: EffectValue[];
  winText: string;
  winStoryHeadline?: string;   // falls back to the option's storyHeadline if absent
  losePct: number;
  loseEffects: EffectValue[];
  loseText: string;
  loseStoryHeadline?: string;  // falls back to the option's storyHeadline if absent
}

// ============================================================================
// Events and Options
// ============================================================================

export interface Condition {
  type: 'yearMin' | 'yearMax' | 'cashLastsBelow' | 'cashLastsAbove' | 'revenueAbove' | 'revenueBelow' | 'staffAbove' | 'moraleBelow' | 'moraleAbove' | 'climateIs' | 'industryIs' | 'countryHasCurrencyRisk' | 'hasCofounder' | 'hasRival' | 'hasInvestors' | 'isProfitable' | 'hasFailedBefore' | 'generationAbove' | 'hasLoan' | 'bankruptciesBelow' | 'bankruptciesAbove' | 'hasFamily' | 'yearsPublicAbove';
  value?: number | string | boolean;
}

export interface OptionDef {
  id: string;
  label: string;                    // e.g. "Take the money"
  detail: string;                   // e.g. "Join as CTO"
  effects: EffectValue[];
  gamble?: GambleOutcome;           // if present, this option is a gamble
  storyHeadline: string;            // e.g. "Priya joins as advisor"
  tag?: string;                     // short status label, e.g. "PREPAID DEALS" — shown in header/ledger/stage tiles when this option is chosen. Falls back to a derived label when absent (see engine/present.ts).
  icon?: 'investor' | 'mentor' | 'solo' | 'default'; // which icon the option card shows; falls back to a derived icon when absent.
  mentorHint?: string;              // one line, DOWNSIDE ONLY — the cost or risk of THIS option, never its
                                      // upside and never the outcome. In a mostly-luck economy, skill's one
                                      // job is lowering ruin risk, not raising the ceiling (see turn.ts's
                                      // header) — a hint that pointed at upside would be tipping the luck
                                      // roll itself, which no amount of skill should be able to do. Shown via
                                      // the "Call {MENTOR}" rewarded hint; when absent, the UI's generic
                                      // fallback ("...'ll tell you the catch on one option") already honors
                                      // this, so leaving it unset is always safe.
}

// Purely a display hint for event-card colouring (ui/screens/game.tsx) — no
// event content was rewritten to add this; unassigned events default to
// 'neutral' at render time (see ui/theme/colour.ts's EVENT_CATEGORY_COLOUR).
export type EventCategory = 'money' | 'people' | 'trouble' | 'luck' | 'opportunity' | 'neutral';

export interface EventDef {
  id: string;
  rarity: Rarity;
  isGamble: boolean;                // true if any option contains a gamble
  isWeather?: boolean;               // roughly 1 in 6 events: options all lead somewhere similar — not
                                      // every year needs a real decision inside it. Tagged so the simulation
                                      // harness can report the actual rate against that ~1/6 design target.
  category?: EventCategory;         // optional display-only tag; absent/unrecognised reads as 'neutral'
  conditions: Condition[];          // all must be met to fire
  headline: string;                 // e.g. "Your mentor calls"
  body: string;                     // e.g. "She has a new position..."
  options: OptionDef[];
}

// ============================================================================
// Year History
// ============================================================================

export interface YearRecord {
  year: number;
  eventId: string;
  eventHeadline: string;
  chosenOptionId: string;
  optionLabel: string;
  tag?: string;                     // copied from the chosen OptionDef.tag, if any — header status chip, ledger row, stage tile all read this one place
  storyHeadline: string;            // what went in the feed
  annualRevenue: number;            // state.annualRevenue at the moment this year's choice resolved — a
                                      // snapshot, not a running total. The ledger's REVENUE column reads this
                                      // per row instead of the live (always-current) state.annualRevenue, which
                                      // used to make every row show today's figure regardless of that year's.
  staff: number;                     // state.staff at the same moment — same snapshot reasoning as
                                      // annualRevenue above. engine/failure.ts's pivot-point generator reads
                                      // the year-over-year deltas across history to spot a hiring spike
                                      // right before a decline ("you hired eleven people the year before...").
  climate: Climate;                  // state.climate at the moment this year's choice resolved — a snapshot,
                                      // same reasoning as annualRevenue above. Every real year produces exactly
                                      // one YearRecord (turn.ts never skips a year), so history is a complete
                                      // climate timeline for this company; the SURVIVED THE FREEZE award
                                      // (awards.ts) reads it for "was ever frozen, and didn't fail."
  gambleResult?: 'won' | 'lost';    // if this was a gamble
  endingType?: EndingType;          // if this ended the career
  exitPrice?: number;                // set when endingType is sale/ipo/retirement AND the choice fixed a price at
                                      // offer time (generated exits — see engine/exits.ts). Absent for the small
                                      // number of content-authored 'end' effects, which fall back to
                                      // calculateAcquisitionPrice/calculateIPOPrice at resolution time.
  funding?: {                       // set only when this choice's effects included a 'funding' effect
    stage: FundingStage;
    amount: number;                 // SINGLE SOURCE OF TRUTH, copied from the FundingOffer that was accepted
    firm: string;
    founderShareBefore: number;
    founderShareAfter: number;
  };
}

// ============================================================================
// Company
// ============================================================================

export interface Company {
  name: string;
  industry: string;                 // free-text content string, e.g. "Software", "Strange" — mapped to a
                                     // CanonicalIndustry via INDUSTRY_MAP (constants.ts) wherever the economy
                                     // needs one; never compared against directly in economy code
  logoIndex: number;                // 0–11, index into geometric logo shapes
  colour: string;                   // hex colour for this industry/company
  ideaCeiling: number;              // hidden per-run cap on how big this specific idea can get — drawn once at
                                     // setup from the idea's upside band + log-normal noise, NEVER shown to the
                                     // player. "COULD GET: Huge" is the advertised potential, not a promise —
                                     // see economy.ts's ceilingDamp and exits.ts §8.1 in the design doc.
  glamour: number;                  // 0–1, copied once at founding from the chosen Idea's own `glamour` (content
                                     // pack 4) — how much outside attention a business attracts, independent of
                                     // industry or how good it actually is. A second axis alongside industry:
                                     // funding chance/valuation/exit multiple/outcome variance/failure rate all
                                     // read this (see economy.ts's glamourOf and its glamour* factor functions).
                                     // Falls back to a neutral 0.5 for any idea that predates the field.
}

// ============================================================================
// Founder
// ============================================================================

export interface Founder {
  name: string;
  age: number;                      // LIVE current age, not fixed at founding — career.ts's
                                     // advanceCareerYear and turn.ts's advanceYear both increment this by
                                     // 1 every real year (in lockstep, never diverging). Starts at 24–52
                                     // for a first founder, or via career.ts's heirStartingAge for an
                                     // heir; ui/screens/results.tsx's founder strip back-computes the
                                     // starting age as age - (careerYear - 1) rather than storing it
                                     // separately.
  country: string;
  gender: Gender;
  portrait: PortraitSeed;
  trait?: string;                   // heirs only (Pass C) — a one-line personality trait, display-only
                                     // (shown on the handover confirmation; not read by any event, unlike
                                     // a cofounder's trait and its {COFOUNDER_TRAIT} token)
}

/** A generated successor — either a real heir (the family event fired and
 * was accepted) or, if not, a protégé/business-partner's-kid/former-
 * employee framing for the same mechanic (design doc §9: "not a
 * biological retcon"). Portrait is blended from the outgoing founder's
 * (see career.ts's generateHeir) so there's a visible family resemblance
 * either way. */
export interface Heir {
  name: string;
  gender: Gender;
  trait: string;
  portrait: PortraitSeed;
}

// ============================================================================
// Game State
// ============================================================================

export interface GameState {
  seed: string;                     // 4 chars: ≥1 digit + ≥1 letter
  rngCursor: number;               // index into seeded RNG sequence
  year: number;
  foundedCalendarYear: number;      // the real calendar year THIS company's year 1 lands on — computed
                                     // once at founding from the owning CareerState's own
                                     // foundedCalendarYear + its careerYear at that moment (see
                                     // engine/career.ts's foundCompany). Lets calendar-year display
                                     // (engine/present.ts's calendarYear) stay continuous across a
                                     // career's companies AND across a dynasty's generations, instead of
                                     // every re-founding or handover reading as if time itself reset.
  foundedCareerYear: number;        // the absolute CareerState.careerYear this company was founded in
                                     // (1 for a career's first company) — same continuity idea as
                                     // foundedCalendarYear above, but for the whole-number "YEAR N"
                                     // counter (ui/screens/game.tsx's ledger header) rather than a real
                                     // calendar year. Reset to 1 for a new generation's own career, same
                                     // as CareerState.careerYear itself — see career.ts's foundCompany.
  startedWithLittleCapital: boolean; // for company 2+ (career.ts's foundCompany): true when the
                                     // founder's own committed capital didn't even clear the idea's own
                                     // expectedCapitalFor — i.e. they still need outside money to get
                                     // going, same as a first-time founder. App.tsx's beginCompanyTurn
                                     // reads this to decide whether the classic "how will you pay for
                                     // year one" funding-source choice should reappear instead of the
                                     // no-funding-needed refounding event. Always false for a career's
                                     // very first company (irrelevant there — it always shows the real
                                     // funding-source event regardless).
  nextStandingOptionYear: number;   // earliest state.year the standing "stop here"/"sell shares"/
                                     // "resign" option is allowed to be rolled for again — 0 until one
                                     // has ever been shown. See constants.ts's STANDING_OPTION_SHOW_CHANCE
                                     // and turn.ts's advanceYear, which is the only place this is bumped.
  founder: Founder;
  company: Company;
  generation: number;               // 1 for first founder, 2+ for dynasty
  founderReputation: number;        // 0-100, 50 = neutral. Snapshotted from CareerState.reputation
                                     // at founding (engine/career.ts's foundCompany) — nudges funding
                                     // terms (economy.ts's computeFundingOffer/fundingGateChance) for
                                     // companies 2+ of a career. The very first company always starts
                                     // at 50 (no track record yet), so this is a no-op there.
  founderBankruptcies: number;      // snapshotted from CareerState.bankruptcies at founding, same
                                     // reasoning as founderReputation — prices loan interest
                                     // (economy.ts's computeLoanRate) and gates loan eligibility
                                     // (canGetLoan) for companies 2+. Zero for the first company.
  founderHasFamily: boolean;        // snapshotted from CareerState.hasFamily at founding, same
                                     // reasoning as founderReputation/founderBankruptcies — lets the
                                     // 'hasFamily' condition gate event-the-family-option so it's never
                                     // offered twice in one career, regardless of which company (1st,
                                     // 2nd, ...) is currently running. Flips true mid-company via the
                                     // 'startFamily' effect; App.tsx syncs the transition back onto
                                     // CareerState — see career.ts's startFamily.
  loans: Loan[];                    // outstanding loans this company has taken — see economy.ts's
                                     // amortizeLoansForYear (called once per turn.ts advanceYear) and
                                     // monthlyBurn, which folds each loan's annual payment in
  everTookLoan: boolean;            // true forever once a 'loan' effect has ever applied, even after
                                     // the loan is fully repaid and removed from `loans` — the only way
                                     // to answer "did this company ever borrow" once a paid-off loan
                                     // stops existing; feeds the DEBT FREE award (see engine/awards.ts)
  publicCompany: PublicCompanyState | null; // null while private. Set by the 'goPublic' effect,
                                     // cleared back to null by 'takePrivate' — either way the company
                                     // keeps running; going public is not an ending (Pass D).
  founderLiquidCash: number;        // dollars raised by selling public shares this run ('sellShares'
                                     // effect) — kept separate from GameState.cash (company operating
                                     // cash) since it's the founder's own money, not the company's. Swept
                                     // into CareerState.personalCash on top of any exit proceeds when
                                     // this company finally ends — see career.ts's endCurrentCompany.
  everWentPublic: boolean;          // true forever once 'goPublic' has ever applied — feeds the WENT
                                     // PUBLIC award (awards.ts), which used to read an EndingType that
                                     // no longer exists as a terminal outcome.
  everLostABacker: boolean;         // true forever once an 'investorDeparts' effect has ever applied —
                                     // feeds the NOBODY LEFT award (awards.ts): every backer stayed
                                     // means this never flipped true.
  everAcquiredRival: boolean;       // true forever once a 'rivalAcquired' effect has ever applied —
                                     // feeds the BOUGHT A RIVAL award (awards.ts).
  totalLayoffs: number;             // cumulative count of every staff-count decrease ever applied (see
                                     // state.ts's applyEffect 'staff' case) — the running staff field only
                                     // ever shows who's there NOW; this is the only place "how many people
                                     // were let go over the company's life" survives. Feeds the failure
                                     // screen's PEOPLE LET GO tile (ui/screens/failure.tsx).
  fundingOffersDeclined: number;    // cumulative count of every funding-carrying event where the chosen
                                     // option wasn't the funding one (see game.ts's processPlayerChoice) —
                                     // feeds the failure screen's ROUNDS REFUSED fallback tile.
  cash: number;                     // dollars
  monthlyBurn: number;             // dollars per month (can be negative if profitable)
  annualRevenue: number;           // dollars per year
  staff: number;
  morale: number;                   // 0–100
  capTable: CapTableEntry[];       // must always sum to 100 ±0.01
  climate: Climate;
  macroPhaseEnd: number;           // year when current climate phase ends
  cast: Character[];                // characters in this run
  history: YearRecord[];            // year-by-year log
  firedEventIds: string[];          // events already used (never repeat)
  lastGambleYear: number | null;    // year of last gamble, for spacing
  lastRescueYear: number | null;    // year the insolvency rescue event last fired, for spacing — see
                                     // engine/failure.ts's rescueEventAvailable; it must not pop up every
                                     // single year a company is on the brink
  awards: string[];                 // award IDs earned
  status: 'setup' | 'running' | 'ended';
  chainFlags: Record<string, number>; // narrative flags -> the year they were set, e.g. chainFlags.declinedAcquisition
                                       // lets a declined buyer return later with a better offer, without GameState
                                       // needing a bespoke field for every possible callback
  growthModifiers: ActiveModifier[];  // unexpired growthMultiplier effects from fired events — see
                                       // economy.ts's activeGrowthMultiplier and effects.ts's pruneExpiredModifiers
  pendingRevenueStep: number;         // accumulated revenueStep effects not yet folded into annualRevenue —
                                       // consumed and reset to 0 by turn.ts's takeRevenueSteps every year
  forcedGrowthOverride: number | null; // set by a growthSet effect; consumed once by the next computeGrowth call
                                        // then cleared back to null
}

// ============================================================================
// Results and Sharing
// ============================================================================

export interface RunResults {
  seed: string;
  founder: Founder;
  company: Company;
  generation: number;
  years: number;
  endingType: EndingType;
  finalCash: number;
  exitPrice?: number;               // for sale/IPO
  founderFinalShare: number;        // percentage, 0–100
  founderTakeHome: number;          // dollars
  awards: string[];
  dramaticHeadline: string;         // pull-quote for card
  stages: FundingRecord[];          // all funding rounds
}

export interface FundingRecord {
  year: number;
  stage: FundingStage;
  amount: number;
  firm: string;
  founderShareBefore: number;
  founderShareAfter: number;
}

/**
 * One tile in the results card's stage grid — one per year that had a
 * chosen outcome, plus a final tile for how the career ended.
 */
export interface StageTile {
  year: number;
  label: string;       // e.g. "NO INVESTORS", "PREPAID DEALS", "SOLD"
  amount: number;       // dollars moved this beat, 0 if none — SINGLE SOURCE OF TRUTH, never re-typed
  actor: string;        // firm/person, or "Nobody but you"
  equityNote: string;   // "kept every point" | "gave up 12 pts" | "+$17M"
  highlight: 'default' | 'purple' | 'gold';
}

// ============================================================================
// Country Data
// ============================================================================

/** 1 (frontier) – 5 (prime) — which row of the tier table (see the
 * generation script referenced in constants.ts) this country's economics
 * were derived from before per-country jitter and hand-overrides. ~196
 * countries is too many to hand-tune individually; the tier is what keeps
 * every country mechanically distinct-ish without 196 bespoke profiles. */
export type CountryTier = 1 | 2 | 3 | 4 | 5;

/**
 * A country's full economic profile. Unlike the old model (a single
 * cost-per-head dial), difficulty here comes mostly from market wealth,
 * funding/exit access, and shock risk — NOT from burn, which is roughly
 * proportional across countries (cheap staff, thin revenue per customer,
 * they largely cancel). See economy.ts/exits.ts/turn.ts for how each field
 * is actually used.
 */
export interface CountryData {
  code: string;                     // ISO 3166-1 alpha-2, lowercase — 'us', 'gb', 'ng'
  name: string;                     // the country, never the demonym; never a city
  note: string;                     // the picker tagline, e.g. "deep money, brutal competition"
  tier: CountryTier;

  // Burn — proportional to local cost of living/staffing, not the main
  // source of difficulty (see the file comment above).
  costPerHead: number;               // annual, per HIRED staff member (excludes the founder)
  founderCost: number;               // annual, the founder's own living/ops cost
  startingCash: number;              // seed cash at game start

  // The dominant source of difficulty.
  marketWealth: number;              // 0–1, direct multiplier on revenue and revenue-per-head
  fundingAvailability: number;       // 0–1, gates whether funding-round events are ever offered
  exitMarket: number;                // 0–1, gates acquisition/IPO offer frequency and scales price
  talentPool: number;                // 0–1, feeds the growth-rate factor (thin talent slows compounding)
  currencyRisk: number;              // 0–1, annual probability of a devaluation shock event
  bureaucracy: number;               // 0–1, drags effective growth in years 1–3
  infrastructure: number;            // 0–1, higher = fewer disruptive-event growth hits
}

// ============================================================================
// Idea (Business Idea)
// ============================================================================

export interface Idea {
  id: string;
  name: string;
  description: string;
  industry: string;
  moneyNeeded: number;
  monthsToFirstSales: number;
  upside: string;                   // e.g. "10x return"
  difficulty: 'easy' | 'medium' | 'hard';
  glamour?: number;                 // 0–1, how much outside attention this business attracts —
                                     // independent of upside/difficulty (content pack 4). Optional:
                                     // ideas authored before this field falls back to a neutral 0.5
                                     // wherever it's read (economy.ts's glamourOf), rather than
                                     // requiring every existing idea to be re-scored by hand.
}

// ============================================================================
// Career — the CAREER_LENGTH_YEARS-year, possibly-multi-company wrapper around GameState.
// A GameState is "how one company's year plays out"; CareerState is "which
// company (if any) is running in a given career year, and what the founder
// personally has." GameState.year keeps meaning exactly what it always has
// (1-indexed from THAT company's founding) so every existing event
// condition/ledger/calendar-year helper is untouched — careerYear is a
// separate, absolute 1..25 clock layered on top.
// ============================================================================

/** How a company's run in the career actually ended — kept separate from
 * GameState's own EndingType because 'retired' here means "the player
 * pressed the per-company retire button," which resolveRunResults reads as
 * EndingType 'retirement'; the two vocabularies overlap but aren't the same
 * axis (a CompanyRecord always has exactly one of these, GameState's
 * history may have none if it's still running). */
export type CompanyOutcome = 'sold' | 'failed' | 'ipo' | 'retired';

export interface CompanyRecord {
  name: string;
  industry: string;
  colour: string;
  yearFounded: number;              // career year
  yearEnded: number;                // career year
  outcome: CompanyOutcome;
  capitalPutIn: number;             // the founder's own money at founding (0 for the very first company)
  proceeds: number;                 // dollars that landed in personalCash — 0 for 'failed'; for a
                                     // successful exit, already net of any outstanding loan balance
                                     // (see career.ts's endCurrentCompany)
  founderSharePctAtEnd: number;
  tookLoan: boolean;                 // whether this company ever borrowed — feeds the DEBT FREE award
  dramaticHeadline: string;         // reused from endings.ts's getMostDramaticHeadline at the moment it ended
  hadGamble: boolean;                 // whether any year of this company resolved a gamble — lets a whole-
                                      // career pull-quote (ui/screens/results.tsx) prefer this company's
                                      // dramaticHeadline the same way getMostDramaticHeadline already prefers
                                      // gamble years within a single company's own history
  failure?: FailureDetail;           // set only when outcome === 'failed' — everything ui/screens/failure.tsx
                                      // needs to render the failure screen, computed once at the moment the
                                      // company ends (engine/career.ts's endCurrentCompany) while the full
                                      // year-by-year GameState.history this is mined from still exists. Never
                                      // recomputed later — CompanyRecord doesn't retain the full history.
}

// ============================================================================
// Failure — see engine/failure.ts for the classifier/generator that builds
// this, and ui/screens/failure.tsx for the screen that reads it.
// ============================================================================

export type DeathCause =
  | 'outOfCash'
  | 'couldNotRaise'
  | 'lostAnchorCustomer'
  | 'outCompeted'
  | 'regulation'
  | 'currencyCollapse'
  | 'pushedOut'
  | 'legal'
  | 'founderWalked';

export interface FailureDetail {
  cause: DeathCause;
  causeStatement: string;    // DEATH_CAUSE_COPY[cause].statement resolved against the ended GameState
                              // (e.g. a rival's actual name) — resolved once here because the failure
                              // screen only ever sees the persisted CompanyRecord, never the GameState.
  peakRevenue: number;
  peopleLetGo: number;
  staffAtPeak: number;       // fallback damage-tile metric when peakRevenue/peopleLetGo would read as zero
  roundsRefused: number;     // fallback damage-tile metric — see fundingOffersDeclined
  yearsSinceLastGrowth: number; // fallback damage-tile metric — years since the last annual revenue increase
  pivotPoint: string;        // the "moment it turned" line, mined from history
  finalHeadline: string;     // the last story-feed entry — the company's epitaph
  finalHeadlineYearsBeforeEnd: number; // gap between the epitaph's year and the year the company actually ended —
                                        // 0 means it's dated the same year (no gap to explain); a nonzero value
                                        // gets called out on the failure screen so an out-of-step epitaph (e.g. a
                                        // rescue headline for a company that still ran out of money) reads as
                                        // context, not a bug
  reputationHit: number;     // positive number, how many reputation points this cost
}

/** A "back other founders" commitment — the payout multiplier is rolled at
 * commit time (not at maturity) so a multi-year pending queue can never
 * desync the seeded RNG cursor from a replay of the same seed; only the
 * cash arriving is delayed. See engine/career.ts. */
export interface AngelInvestment {
  amount: number;
  matureYear: number;               // career year the payout lands
  payout: number;                   // amount * the multiplier, already resolved
  founderName: string;              // flavor only — no linked Character in this pass
}

export interface CareerState {
  seed: string;
  careerYear: number;               // 1..CAREER_LENGTH_YEARS, the absolute clock
  foundedCalendarYear: number;      // the real calendar year THIS career's careerYear-1 lands on —
                                     // CALENDAR_YEAR_AT_FOUNDING for a brand-new dynasty's first
                                     // generation, or wherever the outgoing career actually left off for
                                     // every generation after that (see career.ts's
                                     // createCareerState/handOverToHeir, present.ts's calendarYearFor).
  founder: Founder;                 // persists across every company in the career
  generation: number;               // 1 for the first founder, 2+ for an heir/successor
  dynastyWealth: number;             // cumulative personalCash ever earned across every generation of
                                      // this dynasty — never reset by a handover (only by "play again",
                                      // which abandons the dynasty entirely). See career.ts's handOverToHeir.
  hasFamily: boolean;                // true once event-the-family-option fired and was accepted
  familyYear: number | null;         // the career year the decision was made — feeds the heir's starting
                                      // age at handover (career.ts's heirStartingAge). Null if !hasFamily.
  heir: Heir | null;                 // generated the moment hasFamily flips true (career.ts's startFamily)
                                      // — identity is fixed early, age is computed later at handover, so
                                      // the story remembers who the heir is regardless of when the career
                                      // actually ends.
  personalCash: number;             // the score
  reputation: number;                // 0-100
  bankruptcies: number;
  exits: number;                     // companies sold or IPO'd — NOT incremented by a solo
                                      // "retire this company" wind-down (real money, just not
                                      // an exit); gates canRetireCareer. See endCurrentCompany.
  companies: CompanyRecord[];        // ended companies, in founding order
  current: GameState | null;         // the running company, or null between companies
  currentCapitalPutIn: number;       // the founder's own money at `current`'s founding — carried
                                      // alongside `current` (not on GameState itself) purely so
                                      // endCurrentCompany can record it on the CompanyRecord later;
                                      // meaningless while `current` is null.
  pendingAngelInvestments: AngelInvestment[];
  /** Consumed by the next foundCompany call: 'search' widens the idea draw
   * to 5 options with a higher upside floor; 'job' modestly improves it.
   * Cleared back to null once used. */
  nextIdeaDrawBoost: 'search' | 'job' | null;
  /** Union of every per-company award earned so far (see engine/awards.ts's
   * original per-GameState AWARD_CONDITIONS, evaluated once — at the
   * moment each company ends, by endCurrentCompany — and accumulated
   * here, since a CompanyRecord doesn't retain the full GameState/
   * RunResults those predicates need). Career-level-only awards (SERIAL,
   * PHOENIX, ...) are NOT stored here — they're cheap to recompute fresh
   * from `companies` at results time; see awards.ts's computeCareerAwards. */
  awards: string[];
  retiredEarly: boolean;
  status: 'active' | 'ended';
}

export interface BetweenYearOption {
  id: 'invest' | 'angel' | 'job' | 'search' | 'rest' | 'found';
  label: string;
  detail: (career: CareerState) => string;
}

// ============================================================================
// Award
// ============================================================================

/**
 * Award content — plain data only, matching awards.json exactly.
 * Content is JSON, and JSON cannot encode a function, so the "did the player
 * earn this" predicate does NOT live here. It lives in engine/awards.ts,
 * keyed by id. Keeping it out of this type is what stops someone from
 * writing `condition` into JSON and having it silently do nothing.
 */
export interface Award {
  id: string;
  label: string;
  description: string;
}
