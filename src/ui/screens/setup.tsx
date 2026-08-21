/**
 * Setup Screen — three steps: who you are, what you're building, what you
 * call it. Ends by handing App.tsx everything it needs to create the run.
 *
 * Step 1 collects exactly two things — name and country — and nothing
 * else. The country picker is the substantial part of this screen: every
 * country carries a short, dry description of what founding a business
 * there is actually like, because that's the entire mechanism that turns
 * "pick your flag" into a real decision.
 */

import React from 'react';
import type { Founder, Company, CountryData, Idea, PortraitSeed } from '../../engine/types';
import { RNG } from '../../engine/rng';
import { pickCompanyColour, PORTRAIT_PRESETS, PORTRAIT_PRESETS_MOBILE_EXTRA } from '../../engine/cast';
import { generatePortraitSVG } from '../../engine/portraits';
import { drawIdeaCeiling } from '../../engine/economy';
import { pickIdeas } from '../../engine/ideas';
import { StepDots, TopBar, Eyebrow, FieldLabel, Field, StepFooter, MobileActionBar, MobileBackLink, Button, useMobileContentBottomPadPx } from '../components/ui';
import { IdeaGrid } from '../components/ideaCard';
import { IconSearch, IconShuffle, CompanyLogoIcon, LOGO_SHAPES, type LogoShape } from '../components/icons';
import companyNameExamples from '../../content/companyNames.json';
import { useRewardedAd } from '../../ads/useRewardedAd';
import { useIsMobile } from '../hooks/useIsMobile';

const SETUP_STEPS = ['FOUNDER', 'PORTRAIT', 'IDEA', 'NAME'];

// Mobile-only: "Northbeam" doesn't fit on one line in the narrow equal-width
// chip row, so it's swapped for "Fernway" here (desktop keeps the full list).
const MOBILE_COMPANY_NAME_EXAMPLES = ['Ledgerly', 'Shiftwell', 'Mise', 'Pass', 'Fernway'];

export interface SetupScreenProps {
  countries: CountryData[];
  ideas: Idea[];
  rng: RNG;
  onComplete: (founder: Omit<Founder, 'portrait'>, company: Omit<Company, 'colour'>, countryId: string, idea: Idea, portrait: PortraitSeed) => void;
}

// ============================================================================
// Country picker — §4 of the step-1 spec
// ============================================================================

// Matched by stable ISO code, not by display name.
const POPULAR_COUNTRY_CODES = ['us', 'gb', 'in', 'de', 'it', 'br', 'ng', 'sg'];

/** Match-only aliases, keyed to a stable ISO code — the displayed name never changes. */
const COUNTRY_ALIASES: Record<string, string> = {
  turkey: 'tr',
  uk: 'gb',
  britain: 'gb',
  england: 'gb',
  usa: 'us',
  us: 'us',
  america: 'us',
  uae: 'ae',
  holland: 'nl',
  korea: 'kr',
  'czech republic': 'cz',
};

function normalizeForSearch(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

/**
 * First letter of every word, uppercase, live as the player types. Never
 * lowercases anything they typed — one-directional.
 *
 * NOT `v.replace(/\b\p{L}/gu, ...)` — that looks Unicode-aware (the `u`
 * flag, the `\p{L}` property escape) but isn't: `\b` itself is always
 * defined against ASCII `\w`/`\W`, `u` flag or not, so it fails exactly
 * the accented-first-letter case it's meant to handle. "çağla" comes out
 * "çAĞLa" — every accented letter reads as its own word boundary, and the
 * genuine first letter doesn't. Walking the string and tracking "was the
 * previous code point a letter" sidesteps `\b` entirely.
 */
function titleCase(v: string): string {
  let result = '';
  let prevWasLetter = false;
  for (const ch of v) {
    const isLetter = /\p{L}/u.test(ch);
    result += isLetter && !prevWasLetter ? ch.toUpperCase() : ch;
    prevWasLetter = isLetter;
  }
  return result;
}

interface DisplayCountry {
  code: string | null;
  name: string;
  note: string;
  custom?: boolean;
  tier?: number;
}

/** A small signal-strength-style difficulty indicator — filled bars =
 * country tier (5 = prime/easiest, 1 = frontier/hardest). Players should
 * choose a hard country deliberately, not discover the difficulty spike
 * mid-career. */
const TIER_COLOUR: Record<number, string> = {
  5: '#4ADE80',
  4: '#A3E635',
  3: '#FACC15',
  2: '#FB923C',
  1: '#F87171',
};
const TIER_BAR_HEIGHTS = [4, 6, 8, 10, 12];

function TierBars({ tier }: { tier: number }) {
  const colour = TIER_COLOUR[tier] ?? '#8B93A7';
  return (
    <div className="flex items-end gap-[2px] shrink-0" aria-hidden="true">
      {TIER_BAR_HEIGHTS.map((h, i) => (
        <div
          key={i}
          className="w-[3px] rounded-[1px]"
          style={{ height: h, backgroundColor: i < tier ? colour : '#3A3E4A' }}
        />
      ))}
    </div>
  );
}

function searchCountries(countries: CountryData[], rawQuery: string): CountryData[] {
  const q = normalizeForSearch(rawQuery);
  const aliasCode = COUNTRY_ALIASES[q];
  return countries.filter((c) => normalizeForSearch(c.name).includes(q) || (aliasCode !== undefined && c.code === aliasCode));
}

export function SetupScreen({ countries, ideas, rng, onComplete }: SetupScreenProps) {
  const isMobile = useIsMobile();
  const contentBottomPad = useMobileContentBottomPadPx();
  const [step, setStep] = React.useState<0 | 1 | 2 | 3>(0);
  // 12 on mobile (a 3-across grid needs a multiple of 3 to avoid an orphan
  // tile in the last row), the original 10 everywhere else — see cast.ts's
  // PORTRAIT_PRESETS_MOBILE_EXTRA.
  //
  // Index 5 (row 2, rightmost in the 3-wide mobile grid) swaps its
  // headscarf accessory for none — headscarf REPLACES the hair layer with a
  // solid dome down to the jaw (see portraits.ts's headscarfSVG), leaving no
  // visible skin or silhouette at all, unlike every other tile in the grid.
  // Desktop keeps the original PORTRAIT_PRESETS untouched (same accessory,
  // different grid position, out of scope here).
  const portraitOptions = isMobile
    ? [
        ...PORTRAIT_PRESETS.slice(0, 5),
        { ...PORTRAIT_PRESETS[5], accessory: 0 },
        ...PORTRAIT_PRESETS.slice(6),
        ...PORTRAIT_PRESETS_MOBILE_EXTRA,
      ]
    : PORTRAIT_PRESETS;

  // Step 1 — founder. Two fields, per spec: name and country, nothing else.
  const [founderName, setFounderName] = React.useState('');
  const nameInputRef = React.useRef<HTMLInputElement>(null);
  const nameCaretRef = React.useRef<number | null>(null);
  const [countryQuery, setCountryQuery] = React.useState('');
  const [showAllCountries, setShowAllCountries] = React.useState(false);
  const [selectedCountryName, setSelectedCountryName] = React.useState<string | 'custom' | null>(null);
  const [customCountry, setCustomCountry] = React.useState<{ name: string } | null>(null);
  const [resultAnnouncement, setResultAnnouncement] = React.useState('');
  const tileRefs = React.useRef<Array<HTMLButtonElement | null>>([]);

  // Caret safety: the title-case transform is applied to a controlled
  // input on every keystroke, which would otherwise throw the caret to
  // the end on each render. Restore it synchronously, before paint.
  React.useLayoutEffect(() => {
    if (nameCaretRef.current !== null && nameInputRef.current) {
      nameInputRef.current.setSelectionRange(nameCaretRef.current, nameCaretRef.current);
    }
  }, [founderName]);

  function handleNameChange(e: React.ChangeEvent<HTMLInputElement>) {
    nameCaretRef.current = e.target.selectionStart;
    setFounderName(titleCase(e.target.value));
  }

  // Step 2 — portrait
  const [selectedPortraitIndex, setSelectedPortraitIndex] = React.useState(0);

  // Step 3 — idea
  const [shownIdeas, setShownIdeas] = React.useState<Idea[]>(() => pickIdeas(ideas, rng, new Set()));
  const [selectedIdeaId, setSelectedIdeaId] = React.useState<string | null>(null);

  // Step 3 — name + logo
  const [companyName, setCompanyName] = React.useState('');
  const [logoShape, setLogoShape] = React.useState<LogoShape>('triangle');

  const selectedIdea = shownIdeas.find((i) => i.id === selectedIdeaId) ?? null;
  const ideaColour = selectedIdea ? pickCompanyColour(selectedIdea.industry) : '#8B7BF0';

  // §4.4 — one list component, three view states. Typing always wins over
  // the expanded/collapsed state, so a player who has expanded the list
  // and then types isn't searching inside a different list than a player
  // who hasn't.
  const trimmedQuery = countryQuery.trim();
  const isSearching = trimmedQuery.length > 0;
  const searchResults = isSearching ? searchCountries(countries, trimmedQuery) : [];
  const visibleCountries: DisplayCountry[] = isSearching
    ? searchResults.length > 0
      ? searchResults
      : [{ code: null, name: titleCase(trimmedQuery), note: 'somewhere new', custom: true }]
    : showAllCountries
      ? countries
      : (isMobile ? POPULAR_COUNTRY_CODES.slice(0, 6) : POPULAR_COUNTRY_CODES).map((code) => countries.find((c) => c.code === code)).filter((c): c is CountryData => !!c);

  React.useEffect(() => {
    if (isSearching) {
      setResultAnnouncement(`${searchResults.length} ${searchResults.length === 1 ? 'country' : 'countries'} found`);
    }
  }, [trimmedQuery, isSearching, searchResults.length]);

  // The bar is meaningless next to search results, which are already the
  // full list filtered.
  const canExpand = !isSearching;

  const selectedRealCountry = selectedCountryName && selectedCountryName !== 'custom' ? countries.find((c) => c.name === selectedCountryName) ?? null : null;
  const selectedCountryDisplayName = selectedRealCountry?.name ?? customCountry?.name ?? null;

  const canContinueStep1 = founderName.trim().length > 1 && selectedCountryName !== null;
  const canStart = companyName.trim().length > 0;

  const rerollAd = useRewardedAd('idea-reroll');

  function handleReroll() {
    rerollAd.watch(() => {
      setShownIdeas(pickIdeas(ideas, rng, new Set(shownIdeas.map((i) => i.id))));
      setSelectedIdeaId(null);
    });
  }

  function selectCountry(c: DisplayCountry) {
    if (c.custom) {
      setSelectedCountryName('custom');
      setCustomCountry({ name: c.name });
    } else {
      setSelectedCountryName(c.name);
      setCustomCountry(null);
    }
  }

  function isCountrySelected(c: DisplayCountry): boolean {
    return c.custom ? selectedCountryName === 'custom' : selectedCountryName === c.name;
  }

  function handleTileKeyDown(e: React.KeyboardEvent, index: number) {
    let next = index;
    if (e.key === 'ArrowRight') next = index + 1;
    else if (e.key === 'ArrowLeft') next = index - 1;
    else if (e.key === 'ArrowDown') next = index + 2;
    else if (e.key === 'ArrowUp') next = index - 2;
    else return;
    e.preventDefault();
    const bounded = Math.max(0, Math.min(visibleCountries.length - 1, next));
    tileRefs.current[bounded]?.focus();
  }

  function handleStart() {
    if (!canStart || !selectedIdea) return;
    if (!selectedRealCountry && selectedCountryName !== 'custom') return;
    const age = rng.nextInt(24, 52);
    // Hidden per-run ceiling on how big this specific idea can get, drawn
    // once here (seeded) and never shown — "COULD GET: Huge" is advertised
    // potential, not a promise. See economy.ts's drawIdeaCeiling/ceilingDamp.
    const ideaCeiling = drawIdeaCeiling(selectedIdea, rng, selectedRealCountry?.marketWealth ?? 0.25);
    // Real countries hand off their code (the engine's existing lookup
    // key everywhere else reads); the hand-typed fallback (§4.7 — a
    // content gap to fix, not a feature) hands off its own name, which
    // every downstream `COUNTRIES[code]?.x ?? code` already displays as-is.
    const countryId = selectedRealCountry ? selectedRealCountry.code : customCountry!.name;
    onComplete(
      { name: founderName.trim(), age, country: countryId, gender: 'nb' },
      { name: companyName.trim(), industry: selectedIdea.industry, logoIndex: LOGO_SHAPES.indexOf(logoShape), ideaCeiling, glamour: selectedIdea.glamour ?? 0.5 },
      countryId,
      selectedIdea,
      portraitOptions[selectedPortraitIndex]
    );
  }

  return (
    <div className={`h-full flex flex-col bg-ground text-ink overflow-hidden ${isMobile ? 'mobile-shell' : ''}`}>
      <TopBar right={<StepDots steps={SETUP_STEPS} activeIndex={step} />} />

      {step === 0 && (
        <div
          className={isMobile ? 'flex-1 min-h-0 overflow-y-auto' : 'flex-1 min-h-0 flex items-center justify-center px-[var(--sp-28)] py-[var(--sp-24)]'}
          style={isMobile ? { padding: '14px', paddingBottom: `calc(${contentBottomPad}px + env(safe-area-inset-bottom))` } : undefined}
        >
          <div
            className={
              isMobile
                ? 'w-full flex flex-col gap-[14px]'
                : 'w-[760px] max-w-full rounded-[var(--r-20)] bg-panel border border-line px-[var(--sp-40)] py-[var(--sp-26)] flex flex-col gap-[var(--sp-16)]'
            }
          >
            <div className="flex flex-col gap-2">
              <Eyebrow>STEP 1 OF 4</Eyebrow>
              <h1 className={isMobile ? 'text-[26px] font-extrabold tracking-[-0.03em] leading-none' : 'text-[length:var(--fs-34)] font-extrabold tracking-[-0.03em] leading-none'}>
                First, who are you?
              </h1>
              <p className={isMobile ? 'text-[15px] text-ink4 leading-relaxed' : 'text-[length:var(--fs-14)] text-ink4 leading-relaxed'}>
                Your name and where you're based. Takes ten seconds.
              </p>
            </div>

            <Field label="Your name">
              <input
                ref={nameInputRef}
                autoFocus
                autoComplete="off"
                spellCheck={false}
                value={founderName}
                onChange={handleNameChange}
                className={
                  isMobile
                    ? 'w-full bg-field border border-lineStrong rounded-[12px] px-4 py-3 text-ink text-[17px] font-semibold focus:border-accent focus:outline-none'
                    : 'w-full bg-field border border-lineStrong rounded-[var(--r-12)] px-[var(--sp-16)] py-[var(--sp-13)] text-ink text-[length:var(--fs-19)] font-semibold focus:border-accent focus:outline-none'
                }
                style={isMobile ? { height: 48 } : undefined}
              />
            </Field>

            <div className="flex flex-col gap-2.5">
              <FieldLabel>Where you're based</FieldLabel>
              <div
                className="flex items-center gap-2.5 bg-field border border-lineStrong rounded-[var(--r-12)] px-[var(--sp-15)] focus-within:border-accent"
                style={isMobile ? { height: 48 } : undefined}
              >
                <IconSearch className="w-4 h-4 text-ink5 shrink-0" />
                <input
                  value={countryQuery}
                  onChange={(e) => setCountryQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'ArrowDown') {
                      e.preventDefault();
                      tileRefs.current[0]?.focus();
                    }
                  }}
                  placeholder="Search country"
                  className={isMobile ? 'flex-1 bg-transparent border-none text-[15px] text-ink placeholder:text-ink5 outline-none' : 'flex-1 bg-transparent border-none py-[var(--sp-13)] text-[length:var(--fs-15)] text-ink placeholder:text-ink5 outline-none'}
                />
              </div>

              <div
                role="radiogroup"
                aria-label="Where you're based"
                className={isMobile ? 'flex flex-col gap-2' : 'max-h-[186px] overflow-y-auto grid grid-cols-2 gap-2 content-start'}
              >
                {visibleCountries.map((c, i) => {
                  const selected = isCountrySelected(c);
                  const focusable = selected || (selectedCountryName === null && i === 0);
                  return (
                    <button
                      key={c.custom ? 'custom' : c.code}
                      ref={(el) => {
                        tileRefs.current[i] = el;
                      }}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      tabIndex={focusable ? 0 : -1}
                      onClick={() => selectCountry(c)}
                      onKeyDown={(e) => handleTileKeyDown(e, i)}
                      className={`rounded-[var(--r-12)] px-[var(--sp-13)] py-[var(--sp-11)] flex items-center gap-[var(--sp-11)] cursor-pointer border transition-colors text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                        selected ? 'bg-accentTint border-accent' : 'bg-field border-lineStrong hover:border-accent'
                      }`}
                      style={isMobile ? { minHeight: 56 } : undefined}
                    >
                      {c.custom || !c.code ? (
                        <div className="w-6 h-4 shrink-0 rounded-[2px] bg-[#22252F]" />
                      ) : (
                        <span className={`fi fi-${c.code} w-6 h-4 shrink-0 rounded-[2px]`} style={{ backgroundSize: 'cover', backgroundPosition: 'center' }} />
                      )}
                      <div className="flex-1 min-w-0 flex flex-col gap-0.5">
                        <div className={`text-[length:var(--fs-14)] font-bold truncate leading-tight ${selected ? 'text-white' : 'text-ink2'}`}>{c.name}</div>
                        <div className={`text-[length:var(--fs-11-5)] truncate leading-tight ${selected ? 'text-accentDim' : 'text-ink5'}`}>{c.note}</div>
                      </div>
                      {c.tier !== undefined && <TierBars tier={c.tier} />}
                      <div className={`w-[9px] h-[9px] rounded-full shrink-0 ${selected ? 'bg-accent' : 'bg-transparent'}`} />
                    </button>
                  );
                })}
              </div>

              <div aria-live="polite" className="sr-only">
                {resultAnnouncement}
              </div>

              {canExpand && (
                <button
                  type="button"
                  onClick={() => setShowAllCountries((v) => !v)}
                  className="rounded-[var(--r-12)] bg-field border border-lineStrong px-[var(--sp-12)] text-center font-mono text-[length:var(--fs-11)] tracking-[0.14em] text-ink3 hover:border-accent hover:text-ink transition-colors"
                  style={isMobile ? { height: 40, marginTop: -6 } : { padding: 'var(--sp-12)' }}
                >
                  {showAllCountries ? 'SHOW LESS' : 'SHOW MORE'}
                </button>
              )}
            </div>

            {!isMobile && (
              <StepFooter
                hint={canContinueStep1 ? 'All set — pick a portrait next.' : "Add your name and pick a place to carry on."}
                disabled={!canContinueStep1}
                onNext={() => setStep(1)}
                label="Continue"
              />
            )}
          </div>
        </div>
      )}

      {isMobile && step === 0 && (
        <MobileActionBar>
          <Button variant="primary" size="lg" disabled={!canContinueStep1} onClick={() => setStep(1)} className="w-full" style={{ minHeight: 48 }}>
            Continue →
          </Button>
        </MobileActionBar>
      )}

      {step === 1 && (
        <div
          className={isMobile ? 'flex-1 min-h-0 overflow-y-auto flex flex-col' : 'flex-1 min-h-0 flex items-center justify-center px-[var(--sp-28)] py-[var(--sp-24)]'}
          style={isMobile ? { padding: '14px', paddingBottom: `calc(${contentBottomPad}px + env(safe-area-inset-bottom))` } : undefined}
        >
          <div
            className={
              isMobile
                ? 'w-full flex flex-col gap-[14px] my-auto'
                : 'w-[760px] max-w-full rounded-[var(--r-20)] bg-panel border border-line px-[var(--sp-40)] py-[var(--sp-26)] flex flex-col gap-[var(--sp-16)]'
            }
          >
            <div className="flex flex-col gap-2">
              {isMobile ? (
                <div className="flex items-center justify-between">
                  <MobileBackLink onClick={() => setStep(0)} />
                  <Eyebrow>STEP 2 OF 4</Eyebrow>
                </div>
              ) : (
                <Eyebrow>STEP 2 OF 4</Eyebrow>
              )}
              <h1 className={isMobile ? 'text-[26px] font-extrabold tracking-[-0.03em] leading-none' : 'text-[length:var(--fs-34)] font-extrabold tracking-[-0.03em] leading-none'}>Pick a portrait</h1>
              <p className={isMobile ? 'text-[15px] text-ink4 leading-relaxed' : 'text-[length:var(--fs-14)] text-ink4 leading-relaxed'}>This is you — it'll show up on your final scorecard.</p>
            </div>

            <div role="radiogroup" aria-label="Pick a portrait" className={isMobile ? 'grid grid-cols-3 gap-2.5' : 'grid grid-cols-5 gap-[var(--sp-12)]'}>
              {portraitOptions.map((seed, i) => (
                <button
                  key={i}
                  type="button"
                  role="radio"
                  aria-checked={selectedPortraitIndex === i}
                  onClick={() => setSelectedPortraitIndex(i)}
                  className={`rounded-[var(--r-12)] flex items-center justify-center border transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                    isMobile ? '' : 'p-2.5'
                  } ${selectedPortraitIndex === i ? 'bg-accentTint border-accent' : 'bg-field border-lineStrong hover:border-accent'}`}
                  style={isMobile ? { width: 96, height: 96 } : undefined}
                >
                  <div
                    className="rounded-lg overflow-hidden shrink-0"
                    style={isMobile ? { width: 80, height: 80 } : { width: 56, height: 56 }}
                    dangerouslySetInnerHTML={{ __html: generatePortraitSVG(seed) }}
                  />
                </button>
              ))}
            </div>

            {!isMobile && <StepFooter hint="Pick whichever looks like you." disabled={false} onNext={() => setStep(2)} onBack={() => setStep(0)} label="Continue" />}
          </div>
        </div>
      )}

      {isMobile && step === 1 && (
        <MobileActionBar>
          <Button variant="primary" size="lg" onClick={() => setStep(2)} className="w-full" style={{ minHeight: 48 }}>
            Continue →
          </Button>
        </MobileActionBar>
      )}

      {step === 2 && (
        <div
          className={isMobile ? 'flex-1 min-h-0 overflow-y-auto' : 'flex-1 min-h-0 overflow-y-auto px-[var(--sp-28)] py-[var(--sp-24)] flex items-center justify-center'}
          style={isMobile ? { padding: '14px', paddingBottom: `calc(${contentBottomPad}px + env(safe-area-inset-bottom))` } : undefined}
        >
          {isMobile ? (
            <div className="w-full flex flex-col gap-[14px]">
              <div className="flex items-center justify-between">
                <MobileBackLink onClick={() => setStep(1)} />
                <Eyebrow>STEP 3 OF 4</Eyebrow>
              </div>
              <div className="flex flex-col gap-2">
                <h1 className="text-[24px] font-extrabold tracking-[-0.03em] leading-none">Pick a business to start</h1>
                <p className="text-[15px] text-ink4 leading-relaxed">
                  You're in {selectedCountryDisplayName ?? 'your country'}. Choose one. The other two go to someone else.
                </p>
              </div>

              {/* Order per spec: heading, swipe hint (rendered inside
                  IdeaGrid, directly above the carousel), carousel, dots,
                  then the reroll link below the dots. */}
              <IdeaGrid ideas={shownIdeas} selectedId={selectedIdeaId} onSelect={setSelectedIdeaId} />

              <button
                onClick={handleReroll}
                disabled={rerollAd.loading}
                className="self-center font-mono text-[13px] text-ink4 flex items-center gap-1.5 disabled:opacity-60 disabled:cursor-wait"
                style={{ height: 40 }}
              >
                <IconShuffle className={`w-3.5 h-3.5 ${rerollAd.loading ? 'animate-spin' : ''}`} />
                {rerollAd.loading ? 'Loading ad…' : 'Show me three others'} <span className="text-caution">· FREE · 30s AD</span>
              </button>
            </div>
          ) : (
            <div className="w-[1080px] max-w-full flex flex-col gap-[var(--sp-16)]">
              <div className="flex items-end justify-between gap-[var(--sp-20)]">
                <div className="flex flex-col gap-2">
                  <Eyebrow>STEP 3 OF 4</Eyebrow>
                  <h1 className="text-[length:var(--fs-32)] font-extrabold tracking-[-0.03em] leading-none">Pick a business to start</h1>
                  <p className="text-[length:var(--fs-14)] text-ink4 leading-relaxed">
                    You're in {selectedCountryDisplayName ?? 'your country'}. Choose one. The other two go to someone else.
                  </p>
                </div>
                <button
                  onClick={handleReroll}
                  disabled={rerollAd.loading}
                  className="shrink-0 border border-dashed border-lineMuted rounded-[var(--r-12)] px-[var(--sp-16)] py-[var(--sp-11)] flex items-center gap-2.5 hover:border-caution transition-colors disabled:opacity-60 disabled:cursor-wait"
                >
                  <IconShuffle className={`w-[17px] h-[17px] text-ink ${rerollAd.loading ? 'animate-spin' : ''}`} />
                  <div className="flex flex-col gap-0.5 items-start">
                    <div className="text-[length:var(--fs-13-5)] font-bold">{rerollAd.loading ? 'Loading ad…' : 'Show me three others'}</div>
                    <div className="font-mono text-[length:var(--fs-9-5)] text-caution tracking-[0.1em]">FREE · 30s AD</div>
                  </div>
                </button>
              </div>

              <IdeaGrid ideas={shownIdeas} selectedId={selectedIdeaId} onSelect={setSelectedIdeaId} />

              <StepFooter hint="" disabled={!selectedIdea} onNext={() => setStep(3)} onBack={() => setStep(1)} label="Continue" />
            </div>
          )}
        </div>
      )}

      {isMobile && step === 2 && (
        <MobileActionBar>
          <Button variant="primary" size="lg" disabled={!selectedIdea} onClick={() => setStep(3)} className="w-full" style={{ minHeight: 48 }}>
            Continue →
          </Button>
        </MobileActionBar>
      )}

      {step === 3 && (
        <div
          className={isMobile ? 'flex-1 min-h-0 overflow-y-auto' : 'flex-1 min-h-0 flex items-center justify-center px-[var(--sp-28)] py-[var(--sp-24)]'}
          style={isMobile ? { padding: '14px', paddingBottom: `calc(${contentBottomPad}px + env(safe-area-inset-bottom))` } : undefined}
        >
          <div
            className={
              isMobile
                ? 'w-full flex flex-col gap-[14px]'
                : 'w-[720px] max-w-full rounded-[var(--r-20)] bg-panel border border-line px-[var(--sp-40)] py-[var(--sp-28)] flex flex-col gap-[var(--sp-17)]'
            }
          >
            {isMobile && (
              <div className="flex items-center justify-between">
                <MobileBackLink onClick={() => setStep(2)} />
                <Eyebrow>STEP 4 OF 4</Eyebrow>
              </div>
            )}
            <div className="flex items-center gap-[var(--sp-16)]">
              <div
                className={isMobile ? 'w-14 h-14 shrink-0 rounded-[15px] flex items-center justify-center' : 'w-16 h-16 shrink-0 rounded-[17px] flex items-center justify-center'}
                style={{ backgroundColor: ideaColour + '26', color: ideaColour }}
              >
                <CompanyLogoIcon shape={logoShape} className="w-[26px] h-[26px]" />
              </div>
              <div className="flex flex-col gap-1.5">
                {!isMobile && <Eyebrow>STEP 4 OF 4</Eyebrow>}
                <h1 className={isMobile ? 'text-[26px] font-extrabold tracking-[-0.03em] leading-none' : 'text-[length:var(--fs-34)] font-extrabold tracking-[-0.03em] leading-none'}>
                  Give it a name
                </h1>
              </div>
            </div>
            <p className={isMobile ? 'text-[15px] text-ink4 leading-relaxed' : 'text-[length:var(--fs-14)] text-ink4 leading-relaxed'}>
              Anything you like — it's your company. You'll be looking at this name for the next ten years.
            </p>

            <div className="flex flex-col gap-2.5">
              <FieldLabel>Company name</FieldLabel>
              <p className="text-[length:var(--fs-12-5)] text-ink6 -mt-1">Stuck? Click one of the example names below.</p>
              <input
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                placeholder="e.g. Kestrel"
                className="w-full bg-field border border-lineStrong rounded-[var(--r-12)] px-[var(--sp-18)] text-ink text-[length:var(--fs-24)] font-extrabold tracking-[-0.02em] focus:border-accent focus:outline-none"
                style={isMobile ? { height: 48, paddingTop: 0, paddingBottom: 0 } : { paddingTop: 'var(--sp-16)', paddingBottom: 'var(--sp-16)' }}
              />
              <div className={isMobile ? 'flex items-stretch gap-1.5 mt-0.5' : 'flex flex-wrap gap-2 mt-0.5'}>
                {(isMobile ? MOBILE_COMPANY_NAME_EXAMPLES : (companyNameExamples as string[])).map((name) => (
                  <button
                    key={name}
                    onClick={() => setCompanyName(name)}
                    className={`font-medium transition-colors ${
                      isMobile
                        ? 'flex-1 min-w-0 rounded-2xl flex items-center justify-center text-center leading-tight text-[13px] px-1.5 py-2'
                        : 'rounded-full text-[length:var(--fs-14)] px-[var(--sp-14)] py-2'
                    } ${companyName === name ? 'bg-accent text-white' : 'bg-field border border-lineStrong text-ink3 hover:border-lineStrong'}`}
                  >
                    {isMobile ? <span className="w-full whitespace-normal break-words">{name}</span> : name}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-2.5">
              <FieldLabel>Pick a logo</FieldLabel>
              <div className="flex gap-2.5">
                {(isMobile ? LOGO_SHAPES.slice(0, 6) : LOGO_SHAPES).map((shape) => (
                  <button
                    key={shape}
                    onClick={() => setLogoShape(shape)}
                    className={`rounded-[14px] flex items-center justify-center border transition-colors ${
                      isMobile ? 'flex-1 aspect-square' : 'w-[50px] h-[50px] shrink-0'
                    } ${logoShape === shape ? 'bg-accentTint border-accent' : 'bg-field border-lineStrong text-ink3 hover:border-lineStrong'}`}
                    style={logoShape === shape ? { color: ideaColour } : undefined}
                  >
                    <CompanyLogoIcon shape={shape} />
                  </button>
                ))}
              </div>
            </div>

            {!isMobile && (
              <StepFooter
                hint={companyName ? `Setting up ${companyName}.` : 'Type a name, or click an example.'}
                disabled={!canStart}
                onNext={handleStart}
                onBack={() => setStep(2)}
                label="Start playing"
              />
            )}
          </div>
        </div>
      )}

      {isMobile && step === 3 && (
        <MobileActionBar>
          <Button variant="primary" size="lg" disabled={!canStart} onClick={handleStart} className="w-full" style={{ minHeight: 48 }}>
            Start playing →
          </Button>
        </MobileActionBar>
      )}
    </div>
  );
}
