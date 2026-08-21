/**
 * Found Company — company 2+ of a career. Unlike SetupScreen (which also
 * collects founder name/country, since that's the very first company),
 * this only asks what's new: an idea, how much of the founder's own money
 * goes in, and a name/logo. The founder and country persist across the
 * whole career.
 */

import React from 'react';
import type { CareerState, Company, Idea } from '../../engine/types';
import { RNG } from '../../engine/rng';
import { pickCompanyColour } from '../../engine/cast';
import { drawIdeaCeiling } from '../../engine/economy';
import { pickIdeas, ideaOpportunityTierForProceeds } from '../../engine/ideas';
import { expectedCapitalFor, isWellFunded, recommendedCapitalFor } from '../../engine/career';
import { formatMoney } from '../../engine/format';
import { COUNTRIES } from '../../engine/state';
import { Chip, StepDots, TopBar, Eyebrow, FieldLabel, Field, StepFooter, MobileActionBar, MobileBackLink, Button, useMobileContentBottomPadPx } from '../components/ui';
import { IdeaGrid } from '../components/ideaCard';
import { CompanyLogoIcon, LOGO_SHAPES, IconShuffle, type LogoShape } from '../components/icons';
import companyNameExamples from '../../content/companyNames.json';
import { useRewardedAd } from '../../ads/useRewardedAd';
import { useIsMobile } from '../hooks/useIsMobile';

const STEPS = ['IDEA', 'MONEY', 'NAME'];

// Mobile-only: "Northbeam" doesn't fit on one line in the narrow equal-width
// chip row, so it's swapped for "Fernway" here (desktop keeps the full list).
const MOBILE_COMPANY_NAME_EXAMPLES = ['Ledgerly', 'Shiftwell', 'Mise', 'Pass', 'Fernway'];

// Below this, personalCash is real in the sense that it exists, but not in
// the sense that allocating any fraction of it means anything — see
// hasMoneyToPutIn below.
const MIN_MEANINGFUL_CAPITAL = 1_000;

export interface FoundCompanyScreenProps {
  career: CareerState;
  ideas: Idea[];
  rng: RNG;
  onComplete: (company: Omit<Company, 'colour'>, idea: Idea, capitalPutIn: number) => void;
}

export function FoundCompanyScreen({ career, ideas, rng, onComplete }: FoundCompanyScreenProps) {
  const isMobile = useIsMobile();
  const contentBottomPad = useMobileContentBottomPadPx();
  const [step, setStep] = React.useState<0 | 1 | 2>(0);
  const boosted = career.nextIdeaDrawBoost !== null;
  const lastProceeds = career.companies[career.companies.length - 1]?.proceeds ?? 0;
  const opportunityTier = ideaOpportunityTierForProceeds(lastProceeds);
  const [shownIdeas, setShownIdeas] = React.useState<Idea[]>(() => pickIdeas(ideas, rng, new Set(), boosted, opportunityTier));
  const [selectedIdeaId, setSelectedIdeaId] = React.useState<string | null>(null);
  const selectedIdea = shownIdeas.find((i) => i.id === selectedIdeaId) ?? null;

  const rerollAd = useRewardedAd('idea-reroll');
  function handleReroll() {
    rerollAd.watch(() => {
      setShownIdeas(pickIdeas(ideas, rng, new Set(shownIdeas.map((i) => i.id)), boosted, opportunityTier));
      setSelectedIdeaId(null);
    });
  }

  const [capitalInput, setCapitalInput] = React.useState<string>('0');
  const capitalPutIn = Math.max(0, Math.round(Math.min(career.personalCash, Number(capitalInput) || 0)));
  // Recommended and "that's a lot of money" both derive from the same
  // engine formula (career.ts's recommendedCapitalFor/isWellFunded) — the
  // callout is defined as a multiple of the recommendation itself, so
  // clicking Recommended can never trigger it.
  const recommendedCapital = selectedIdea ? Math.round(Math.min(career.personalCash, recommendedCapitalFor(selectedIdea, career.founder.country))) : 0;
  const overfunded = selectedIdea ? isWellFunded(capitalPutIn, selectedIdea, career.founder.country) : false;

  const [companyName, setCompanyName] = React.useState('');
  const [logoShape, setLogoShape] = React.useState<LogoShape>('triangle');

  const ideaColour = selectedIdea ? pickCompanyColour(selectedIdea.industry) : '#8B7BF0';
  const countryName = COUNTRIES[career.founder.country]?.name ?? career.founder.country;
  const canStart = companyName.trim().length > 0;
  // Effectively nothing to allocate — skip straight past "how much of your
  // own money" to naming the company. `personalCash > 0` alone wasn't
  // enough: it's rarely EXACTLY $0 in practice (a few cents or dollars of
  // residue is common), and asking someone to decide how to allocate
  // $0.10 is exactly as pointless as asking about literal $0.
  // capitalInput stays at its default '0', so capitalPutIn correctly
  // resolves to 0 either way.
  const hasMoneyToPutIn = career.personalCash >= MIN_MEANINGFUL_CAPITAL;

  function handleStart() {
    if (!canStart || !selectedIdea) return;
    const ideaCeiling = drawIdeaCeiling(selectedIdea, rng, COUNTRIES[career.founder.country]?.marketWealth ?? 0.25);
    onComplete(
      { name: companyName.trim(), industry: selectedIdea.industry, logoIndex: LOGO_SHAPES.indexOf(logoShape), ideaCeiling, glamour: selectedIdea.glamour ?? 0.5 },
      selectedIdea,
      capitalPutIn
    );
  }

  return (
    <div className={`h-full flex flex-col bg-ground text-ink overflow-hidden ${isMobile ? 'mobile-shell' : ''}`}>
      <TopBar right={<StepDots steps={STEPS} activeIndex={step} />} />

      {step === 0 && (
        <div
          className={isMobile ? 'flex-1 min-h-0 overflow-y-auto' : 'flex-1 min-h-0 overflow-y-auto px-[var(--sp-28)] py-[var(--sp-24)] flex items-center justify-center'}
          style={isMobile ? { padding: '14px', paddingBottom: `calc(${contentBottomPad}px + env(safe-area-inset-bottom))` } : undefined}
        >
          {isMobile ? (
            <div className="w-full flex flex-col gap-[14px]">
              <Eyebrow>STEP 1 OF 3</Eyebrow>
              <div className="flex flex-col gap-2">
                <h1 className="text-[24px] font-extrabold tracking-[-0.03em] leading-none">Pick the next business</h1>
                <p className="text-[15px] text-ink4 leading-relaxed">
                  Still in {countryName}.{' '}
                  {boosted
                    ? ' Five options this time — the year spent looking paid off.'
                    : opportunityTier === 'high'
                      ? " That kind of money opens doors — bigger, pricier swings than last time."
                      : opportunityTier === 'low'
                        ? ' Nothing fancy this round — modest ideas to match what you have to work with.'
                        : ' Choose one. The others go to someone else.'}
                </p>
              </div>

              <IdeaGrid ideas={shownIdeas} selectedId={selectedIdeaId} onSelect={setSelectedIdeaId} />

              <button
                onClick={handleReroll}
                disabled={rerollAd.loading}
                className="self-center font-mono text-[13px] text-ink4 flex items-center gap-1.5 disabled:opacity-60 disabled:cursor-wait"
                style={{ height: 40 }}
              >
                <IconShuffle className={`w-3.5 h-3.5 ${rerollAd.loading ? 'animate-spin' : ''}`} />
                {rerollAd.loading ? 'Loading ad…' : boosted ? 'Show me five others' : 'Show me three others'} <span className="text-caution">· FREE · 30s AD</span>
              </button>
            </div>
          ) : (
            <div className="w-[1080px] max-w-full flex flex-col gap-[var(--sp-16)]">
              <div className="flex items-end justify-between gap-[var(--sp-20)]">
                <div className="flex flex-col gap-2">
                  <Eyebrow>STEP 1 OF 3</Eyebrow>
                  <h1 className="text-[length:var(--fs-32)] font-extrabold tracking-[-0.03em] leading-none">Pick the next business</h1>
                  <p className="text-[length:var(--fs-14)] text-ink4 leading-relaxed">
                    Still in {countryName}.{' '}
                    {boosted
                      ? ' Five options this time — the year spent looking paid off.'
                      : opportunityTier === 'high'
                        ? " That kind of money opens doors — bigger, pricier swings than last time."
                        : opportunityTier === 'low'
                          ? ' Nothing fancy this round — modest ideas to match what you have to work with.'
                          : ' Choose one. The others go to someone else.'}
                  </p>
                </div>
                <button
                  onClick={handleReroll}
                  disabled={rerollAd.loading}
                  className="shrink-0 border border-dashed border-lineMuted rounded-[var(--r-12)] px-[var(--sp-16)] py-[var(--sp-11)] flex items-center gap-2.5 hover:border-caution transition-colors disabled:opacity-60 disabled:cursor-wait"
                >
                  <IconShuffle className={`w-[17px] h-[17px] text-ink ${rerollAd.loading ? 'animate-spin' : ''}`} />
                  <div className="flex flex-col gap-0.5 items-start">
                    <div className="text-[length:var(--fs-13-5)] font-bold">{rerollAd.loading ? 'Loading ad…' : boosted ? 'Show me five others' : 'Show me three others'}</div>
                    <div className="font-mono text-[length:var(--fs-9-5)] text-caution tracking-[0.1em]">FREE · 30s AD</div>
                  </div>
                </button>
              </div>

              <IdeaGrid ideas={shownIdeas} selectedId={selectedIdeaId} onSelect={setSelectedIdeaId} />

              <StepFooter hint="" disabled={!selectedIdea} onNext={() => setStep(hasMoneyToPutIn ? 1 : 2)} label="Continue" />
            </div>
          )}
        </div>
      )}

      {isMobile && step === 0 && (
        <MobileActionBar>
          <Button variant="primary" size="lg" disabled={!selectedIdea} onClick={() => setStep(hasMoneyToPutIn ? 1 : 2)} className="w-full" style={{ minHeight: 48 }}>
            Continue →
          </Button>
        </MobileActionBar>
      )}

      {step === 1 && selectedIdea && hasMoneyToPutIn && (
        <div
          className={isMobile ? 'flex-1 min-h-0 overflow-y-auto flex flex-col' : 'flex-1 min-h-0 flex items-center justify-center px-[var(--sp-28)] py-[var(--sp-24)]'}
          style={isMobile ? { padding: '14px', paddingBottom: `calc(${contentBottomPad}px + env(safe-area-inset-bottom))` } : undefined}
        >
          <div
            className={
              isMobile
                ? 'w-full flex flex-col gap-[14px]'
                : 'w-[640px] max-w-full rounded-[var(--r-20)] bg-panel border border-line px-[var(--sp-40)] py-[var(--sp-28)] flex flex-col gap-[var(--sp-17)]'
            }
          >
            <div className="flex flex-col gap-2">
              {isMobile ? (
                <div className="flex items-center justify-between">
                  <MobileBackLink onClick={() => setStep(0)} />
                  <Eyebrow>STEP 2 OF 3</Eyebrow>
                </div>
              ) : (
                <Eyebrow>STEP 2 OF 3</Eyebrow>
              )}
              <h1 className={isMobile ? 'text-[24px] font-extrabold tracking-[-0.03em] leading-none' : 'text-[length:var(--fs-32)] font-extrabold tracking-[-0.03em] leading-none'}>
                How much of your own money?
              </h1>
              <p className={isMobile ? 'text-[15px] text-ink4 leading-relaxed' : 'text-[length:var(--fs-14)] text-ink4 leading-relaxed'}>
                You have {formatMoney(career.personalCash)}. More in means longer runway and less dilution later — and more to lose.
                Typical money for {selectedIdea.name.toLowerCase()} is around {formatMoney(expectedCapitalFor(selectedIdea))}.
                Recommended for this one: {formatMoney(recommendedCapital)} — enough to actually move fast without betting everything.
              </p>
            </div>

            <Field label="Your capital in">
              <div className="flex items-center gap-2.5 bg-field border border-lineStrong rounded-[var(--r-12)] px-[var(--sp-18)] py-[var(--sp-16)] focus-within:border-accent">
                <span className="text-[length:var(--fs-24)] font-extrabold text-ink5">$</span>
                <input
                  value={capitalInput}
                  onChange={(e) => setCapitalInput(e.target.value.replace(/[^0-9]/g, ''))}
                  inputMode="numeric"
                  className="flex-1 bg-transparent border-none text-ink text-[length:var(--fs-24)] font-extrabold tracking-[-0.02em] focus:outline-none"
                />
              </div>
              <div className="flex gap-2">
                {[0, 0.25, 0.5, 1].map((frac) => (
                  <button
                    key={frac}
                    onClick={() => setCapitalInput(String(Math.round(career.personalCash * frac)))}
                    className="flex-1 rounded-lg bg-field border border-lineStrong py-2 text-[length:var(--fs-12)] font-mono text-ink4 hover:border-accent transition-colors"
                    style={isMobile ? { minHeight: 44 } : undefined}
                  >
                    {frac === 0 ? 'Nothing' : frac === 1 ? 'Everything' : `${frac * 100}%`}
                  </button>
                ))}
              </div>
              <div className="flex justify-center mt-0.5">
                <button
                  onClick={() => setCapitalInput(String(recommendedCapital))}
                  className="text-[length:var(--fs-12)] font-mono text-ink6 hover:text-ink3 transition-colors flex items-center gap-1.5"
                  style={isMobile ? { minHeight: 44 } : undefined}
                >
                  <IconShuffle className="w-3.5 h-3.5" />
                  Use the recommended amount — {formatMoney(recommendedCapital)}
                </button>
              </div>
            </Field>

            {overfunded && (
              <div className="rounded-[var(--r-12)] bg-positiveBg border border-positiveBorder px-[var(--sp-16)] py-[var(--sp-12)] text-[length:var(--fs-12-5)] text-positive leading-[1.5]">
                That's a lot more than this idea strictly needs — and it won't go to waste. More capital to deploy means hiring, marketing, and runway ahead of need: this one should come out of the gate faster.
              </div>
            )}

            {!isMobile && <StepFooter hint={`Putting in ${formatMoney(capitalPutIn)}.`} disabled={false} onNext={() => setStep(2)} onBack={() => setStep(0)} label="Continue" />}
          </div>
        </div>
      )}

      {isMobile && step === 1 && selectedIdea && hasMoneyToPutIn && (
        <MobileActionBar>
          <Button variant="primary" size="lg" onClick={() => setStep(2)} className="w-full" style={{ minHeight: 48 }}>
            Continue →
          </Button>
        </MobileActionBar>
      )}

      {step === 2 && selectedIdea && (
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
                <MobileBackLink onClick={() => setStep(hasMoneyToPutIn ? 1 : 0)} />
                <Eyebrow>STEP 3 OF 3</Eyebrow>
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
                {!isMobile && <Eyebrow>STEP 3 OF 3</Eyebrow>}
                <h1 className={isMobile ? 'text-[26px] font-extrabold tracking-[-0.03em] leading-none' : 'text-[length:var(--fs-34)] font-extrabold tracking-[-0.03em] leading-none'}>
                  Give it a name
                </h1>
              </div>
            </div>
            <div className="flex gap-1.5">
              <Chip label={`PUTTING IN ${formatMoney(capitalPutIn).toUpperCase()}`} variant="accent" />
            </div>

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
                hint={companyName ? `Founding ${companyName}.` : 'Type a name, or click an example.'}
                disabled={!canStart}
                onNext={handleStart}
                onBack={() => setStep(hasMoneyToPutIn ? 1 : 0)}
                label="Found it"
              />
            )}
          </div>
        </div>
      )}

      {isMobile && step === 2 && selectedIdea && (
        <MobileActionBar>
          <Button variant="primary" size="lg" disabled={!canStart} onClick={handleStart} className="w-full" style={{ minHeight: 48 }}>
            Found it →
          </Button>
        </MobileActionBar>
      )}
    </div>
  );
}
