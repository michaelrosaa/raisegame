/**
 * Results Screen — the shareable scorecard, built around a whole career.
 * Single column: header row, founder strip, a proportional career timeline
 * (one segment per company), a pull-quote, a stat row, earned-award pills,
 * footer. Beneath it: Play again / Share.
 */

import type { CareerState, CompanyRecord, GameState } from '../../engine/types';
import { formatMoney } from '../../engine/format';
import { careerTitle, careerSubtitle, summarizeCareer, handoverNeedsAd, CAREER_LENGTH_YEARS } from '../../engine/career';
import { computeCareerAwards } from '../../engine/awards';
import { getMostDramaticHeadline } from '../../engine/endings';
import { generatePortraitSVG } from '../../engine/portraits';
import { COUNTRIES } from '../../engine/state';
import React from 'react';
import { Button, Chip, MobileActionBar, useMobileContentBottomPadPx } from '../components/ui';
import { IconCheck } from '../components/icons';
import { useRewardedAd } from '../../ads/useRewardedAd';
import { useIsMobile } from '../hooks/useIsMobile';
import awardsContent from '../../content/awards.json';

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];

// ============================================================================
// Career timeline — one segment per company, width proportional to years
// active as a % of the full CAREER_LENGTH_YEARS (not just years lived), so
// a career that ended early visibly stops short of filling the bar.
// ============================================================================

type OutcomeKind = 'failed' | 'sold' | 'running' | 'ipo';

const OUTCOME_STYLE: Record<OutcomeKind, { bg: string; rule: string; text: string }> = {
  failed: { bg: '#3D1E1A', rule: '#C4553A', text: '#E8A08E' },
  sold: { bg: '#3D3218', rule: '#C9A03E', text: '#FFD97A' },
  running: { bg: '#1A2B3D', rule: '#4A8FD4', text: '#8FC4F0' },
  ipo: { bg: '#2E1F52', rule: '#7F6BD4', text: '#BCA6F0' },
};

interface SegmentDisplay {
  isGap: boolean;
  widthPct: number;
  name?: string;
  figure?: string | null;
  cause?: string;          // failed single companies only — shown as a third line where widthPct allows
  bg?: string;
  rule?: string;
  text?: string;
}

// Below this, a segment already truncates name+figure to fit — a third
// line would just clip unreadably, so it's left off rather than shown badly.
const MIN_WIDTH_FOR_CAUSE_LINE = 16;

function outcomeKindFor(outcome: CompanyRecord['outcome']): OutcomeKind {
  if (outcome === 'failed') return 'failed';
  if (outcome === 'ipo') return 'ipo';
  return 'sold'; // 'sold' and 'retired' (a solo wind-down cash-out) read the same — both a clean exit
}

// A failed company that never had any of the founder's own money in it
// still reads as "$0" via formatMoney — indistinguishable from a genuine
// rendering bug. Years survived is the honest figure to show instead.
function failureFigure(capitalLost: number, years: number): string {
  if (capitalLost > 0) return formatMoney(-capitalLost);
  return `${years} year${years === 1 ? '' : 's'}`;
}

function figureFor(c: CompanyRecord, years: number): string {
  if (c.outcome === 'failed') return failureFigure(c.capitalPutIn, years);
  if (c.outcome === 'ipo') return `public · ${formatMoney(c.proceeds)}`;
  if (c.outcome === 'sold') return `sold · ${formatMoney(c.proceeds)}`;
  return `retired · ${formatMoney(c.proceeds)}`;
}

// Four short red stubs in a row ("Coilst...", "Fernw...", "Coi...", "Coi...")
// told a worse story than one block would — a run of two or more consecutive
// failures collapses into a single "N failed" segment instead.
interface FailureRun {
  kind: 'run';
  yearFounded: number;
  yearEnded: number;
  count: number;
  capitalLost: number;
}
type CompanyUnit = { kind: 'single'; record: CompanyRecord } | FailureRun;

function groupConsecutiveFailures(companies: CompanyRecord[]): CompanyUnit[] {
  const units: CompanyUnit[] = [];
  let i = 0;
  while (i < companies.length) {
    if (companies[i].outcome === 'failed') {
      let j = i;
      while (j < companies.length && companies[j].outcome === 'failed') j++;
      const run = companies.slice(i, j);
      if (run.length >= 2) {
        units.push({
          kind: 'run',
          yearFounded: run[0].yearFounded,
          yearEnded: run[run.length - 1].yearEnded,
          count: run.length,
          capitalLost: run.reduce((s, c) => s + c.capitalPutIn, 0),
        });
      } else {
        units.push({ kind: 'single', record: run[0] });
      }
      i = j;
    } else {
      units.push({ kind: 'single', record: companies[i] });
      i++;
    }
  }
  return units;
}

// No segment can be labelled below ~9% width, so once a career has enough
// companies to squeeze everyone under that floor, the long segments give up
// the difference — the bar still sums to the same total (years actually
// accounted for out of the full 50), just redistributed.
const MIN_SEGMENT_PCT = 9;

function enforceMinWidths(segments: SegmentDisplay[]): void {
  const real = segments.filter((s) => !s.isGap);
  if (real.length === 0) return;

  let deficit = 0;
  for (const seg of real) {
    if (seg.widthPct < MIN_SEGMENT_PCT) {
      deficit += MIN_SEGMENT_PCT - seg.widthPct;
      seg.widthPct = MIN_SEGMENT_PCT;
    }
  }
  if (deficit <= 0) return;

  // Shrink whatever's still above the floor, proportional to its own
  // surplus, repeating in case a donor gets shrunk down to the floor
  // itself and the remaining deficit needs to move to the others.
  let remaining = deficit;
  let donors = real.filter((s) => s.widthPct > MIN_SEGMENT_PCT);
  while (remaining > 0.01 && donors.length > 0) {
    const donorSurplus = donors.reduce((s, seg) => s + (seg.widthPct - MIN_SEGMENT_PCT), 0);
    if (donorSurplus <= 0) break;
    let leftover = 0;
    for (const seg of donors) {
      const share = ((seg.widthPct - MIN_SEGMENT_PCT) / donorSurplus) * remaining;
      const next = seg.widthPct - share;
      if (next < MIN_SEGMENT_PCT) {
        leftover += MIN_SEGMENT_PCT - next;
        seg.widthPct = MIN_SEGMENT_PCT;
      } else {
        seg.widthPct = next;
      }
    }
    remaining = leftover;
    donors = real.filter((s) => s.widthPct > MIN_SEGMENT_PCT);
  }
}

function buildSegments(career: CareerState): SegmentDisplay[] {
  const segments: SegmentDisplay[] = [];
  let cursor = 1;

  function pushGap(years: number) {
    if (years > 0) segments.push({ isGap: true, widthPct: (years / CAREER_LENGTH_YEARS) * 100 });
  }

  for (const unit of groupConsecutiveFailures(career.companies)) {
    if (unit.kind === 'run') {
      pushGap(unit.yearFounded - cursor);
      const years = Math.max(1, unit.yearEnded - unit.yearFounded + 1);
      const style = OUTCOME_STYLE.failed;
      segments.push({
        isGap: false,
        widthPct: (years / CAREER_LENGTH_YEARS) * 100,
        name: `${unit.count} failed`,
        figure: failureFigure(unit.capitalLost, years),
        ...style,
      });
      cursor = unit.yearEnded + 1;
    } else {
      const c = unit.record;
      pushGap(c.yearFounded - cursor);
      const years = Math.max(1, c.yearEnded - c.yearFounded + 1);
      const style = OUTCOME_STYLE[outcomeKindFor(c.outcome)];
      segments.push({
        isGap: false,
        widthPct: (years / CAREER_LENGTH_YEARS) * 100,
        name: c.name,
        figure: figureFor(c, years),
        cause: c.failure?.causeStatement,
        ...style,
      });
      cursor = c.yearEnded + 1;
    }
  }

  if (career.current) {
    const state: GameState = career.current;
    pushGap(state.foundedCareerYear - cursor);
    // Same overshoot career.ts's endCurrentCompany has to correct for —
    // career.careerYear can read one past CAREER_LENGTH_YEARS here.
    const cappedCareerYear = Math.min(career.careerYear, CAREER_LENGTH_YEARS);
    const years = Math.max(1, cappedCareerYear - state.foundedCareerYear + 1);
    segments.push({
      isGap: false,
      widthPct: (years / CAREER_LENGTH_YEARS) * 100,
      name: state.company.name,
      figure: `running · ${formatMoney(state.annualRevenue)}`,
      ...OUTCOME_STYLE.running,
    });
  }

  enforceMinWidths(segments);
  return segments;
}

/** Mobile-only timeline — every company gets its own segment (no
 * consecutive-failure grouping into "N failed"), and there are no gap
 * segments for years without a company: widths are normalised across just
 * the real companies so the bar always spans its full width completely
 * full, whatever the career's actual length. Desktop's buildSegments above
 * (proportional to the full 50-year career, gaps included, failures
 * grouped) is untouched — this is a deliberately different read of the
 * same CareerState, not a shared helper. */
function buildMobileSegments(career: CareerState): SegmentDisplay[] {
  const units: { name: string; years: number; figure: string | null; style: (typeof OUTCOME_STYLE)[OutcomeKind] }[] = [];
  for (const c of career.companies) {
    const years = Math.max(1, c.yearEnded - c.yearFounded + 1);
    units.push({ name: c.name, years, figure: figureFor(c, years), style: OUTCOME_STYLE[outcomeKindFor(c.outcome)] });
  }
  if (career.current) {
    const state = career.current;
    const cappedCareerYear = Math.min(career.careerYear, CAREER_LENGTH_YEARS);
    const years = Math.max(1, cappedCareerYear - state.foundedCareerYear + 1);
    units.push({ name: state.company.name, years, figure: `running · ${formatMoney(state.annualRevenue)}`, style: OUTCOME_STYLE.running });
  }
  if (units.length === 0) return [];
  const totalYears = units.reduce((s, u) => s + u.years, 0) || 1;
  return units.map((u) => ({
    isGap: false,
    widthPct: (u.years / totalYears) * 100,
    name: u.name,
    figure: u.figure,
    bg: u.style.bg,
    rule: u.style.rule,
    text: u.style.text,
  }));
}

// ============================================================================
// Pull-quote — the run's most dramatic story headline. Prefers a gamble
// outcome (matching endings.ts's own per-company preference), checking the
// live company first, then the most recent ended company that had one;
// falls back to whichever company was most consequential.
// ============================================================================

interface PullQuote {
  headline: string;
  colour: string;
  dateline: string;
}

interface MobileAwardDisplay {
  id: string;
  label: string;
  description: string;
  tier: 'rare' | 'common';
  earned: boolean;
}

function selectPullQuote(career: CareerState): PullQuote | null {
  if (career.current) {
    const state = career.current;
    if (state.history.some((h) => h.gambleResult)) {
      return { headline: getMostDramaticHeadline(state), colour: state.company.colour, dateline: `${state.company.name.toUpperCase()} · YEAR ${state.foundedCareerYear}–NOW` };
    }
  }

  const gambleCompany = [...career.companies].reverse().find((c) => c.hadGamble);
  if (gambleCompany) {
    return {
      headline: gambleCompany.dramaticHeadline,
      colour: gambleCompany.colour,
      dateline: `${gambleCompany.name.toUpperCase()} · YEAR ${gambleCompany.yearFounded}–${gambleCompany.yearEnded}`,
    };
  }

  if (career.current) {
    const state = career.current;
    return { headline: getMostDramaticHeadline(state), colour: state.company.colour, dateline: `${state.company.name.toUpperCase()} · YEAR ${state.foundedCareerYear}–NOW` };
  }

  if (career.companies.length === 0) return null;
  const biggest = [...career.companies].sort((a, b) => Math.abs(b.proceeds) - Math.abs(a.proceeds))[0];
  return { headline: biggest.dramaticHeadline, colour: biggest.colour, dateline: `${biggest.name.toUpperCase()} · YEAR ${biggest.yearFounded}–${biggest.yearEnded}` };
}

export interface ResultsScreenProps {
  career: CareerState;
  onPlayAgain: () => void;
  onHandOver: (keepCompanyRunning: boolean) => void;
  onShare: () => void;
}

export function ResultsScreen({ career, onPlayAgain, onHandOver, onShare }: ResultsScreenProps) {
  const isMobile = useIsMobile();
  const summary = summarizeCareer(career);
  const title = careerTitle(career, summary);
  const subtitle = careerSubtitle(career, summary);
  const countryName = COUNTRIES[career.founder.country]?.name ?? career.founder.country;

  const hasRunningCompany = career.current !== null;
  // founder.age is live (see types.ts's Founder.age) — already the end age
  // by results time, so the starting age is back-computed by subtracting
  // the years actually lived (careerYear - 1) rather than stored separately.
  const endAge = summary.ageAtEnd;
  const startAge = endAge - (career.careerYear - 1);
  const ranFullTerm = career.careerYear > CAREER_LENGTH_YEARS;

  const needsAd = handoverNeedsAd(career);
  const handOverAd = useRewardedAd('dynasty-generation');
  const handleHandOverClick = (keepCompanyRunning: boolean) => {
    if (needsAd) handOverAd.watch(() => onHandOver(keepCompanyRunning));
    else onHandOver(keepCompanyRunning);
  };
  const successorName = career.hasFamily && career.heir ? career.heir.name : null;
  const handOverLabel = successorName ? `Hand it down to ${successorName} →` : 'Continue with a successor →';
  const keepRunningLabel = successorName ? `${successorName} keeps it running →` : 'Successor keeps it running →';
  const startFreshLabel = successorName ? `Cash out — ${successorName} starts fresh →` : 'Cash out — successor starts fresh →';

  const segments = buildSegments(career);
  const quote = selectPullQuote(career);

  const allAwards = awardsContent as { id: string; label: string; description: string; tier: 'rare' | 'common' }[];
  const earnedIds = new Set(computeCareerAwards(career));
  const earnedAwards = allAwards.filter((a) => earnedIds.has(a.id));
  // Rare earned awards are the more interesting story, so they win the six
  // display slots first; anything past that — earned or not — folds into
  // one plain count instead of turning the row into a wall of gold.
  const sortedEarned = [...earnedAwards].sort((a, b) => (a.tier === b.tier ? 0 : a.tier === 'rare' ? -1 : 1));
  const shownAwards = sortedEarned.slice(0, 6);
  const foldedCount = allAwards.length - shownAwards.length;

  if (isMobile) {
    // Every company gets its own segment, spanning the bar's full width —
    // see buildMobileSegments's own comment for why this reads the career
    // differently than desktop's gap-and-grouping timeline does.
    const mobileSegments = buildMobileSegments(career);
    // Fixed 32px per spec's timeline budget — the cause-line third row
    // (desktop-only territory) doesn't fit that budget, so it's dropped on
    // mobile rather than pushing the bar taller.
    const rowHeight = 32;
    const minRealPct = mobileSegments.reduce((m, s) => Math.min(m, s.widthPct), 100);
    const lastLivedYear = Math.min(Math.max(1, career.careerYear - 1), CAREER_LENGTH_YEARS);

    // The single largest exit across the whole career — more likely to vary
    // between runs than a "years building" figure the header already states
    // (career length is fixed at CAREER_LENGTH_YEARS regardless of outcome).
    const peakExit = Math.max(0, ...career.companies.map((c) => c.proceeds));

    // Always exactly three award pills so the row never reads as broken —
    // earned ones (rarest first) fill first; any slots left over take the
    // closest unearned awards (common tier is the reasonable proxy for
    // "nearly there" — the engine doesn't track partial progress toward a
    // rare one) in a visibly muted, not-yet-earned treatment.
    const mobileEarnedSorted = [...allAwards].filter((a) => earnedIds.has(a.id)).sort((a, b) => (a.tier === b.tier ? 0 : a.tier === 'rare' ? -1 : 1));
    const mobileUnearnedSorted = allAwards.filter((a) => !earnedIds.has(a.id)).sort((a, b) => (a.tier === b.tier ? 0 : a.tier === 'common' ? -1 : 1));
    const mobileShownEarned = mobileEarnedSorted.slice(0, 3);
    const mobileShownUnearned = mobileUnearnedSorted.slice(0, Math.max(0, 3 - mobileShownEarned.length));
    const mobileShownAwards = [
      ...mobileShownEarned.map((a) => ({ ...a, earned: true })),
      ...mobileShownUnearned.map((a) => ({ ...a, earned: false })),
    ];
    const mobileFoldedCount = allAwards.length - mobileShownAwards.length;

    return (
      <MobileResultsScorecard
        title={title}
        subtitle={subtitle}
        career={career}
        countryName={countryName}
        startAge={startAge}
        endAge={endAge}
        mobileSegments={mobileSegments}
        minRealPct={minRealPct}
        rowHeight={rowHeight}
        lastLivedYear={lastLivedYear}
        quote={quote}
        summary={summary}
        peakExit={peakExit}
        mobileShownAwards={mobileShownAwards}
        mobileFoldedCount={mobileFoldedCount}
        hasRunningCompany={hasRunningCompany}
        handOverAd={handOverAd}
        needsAd={needsAd}
        keepRunningLabel={keepRunningLabel}
        startFreshLabel={startFreshLabel}
        handOverLabel={handOverLabel}
        onPlayAgain={onPlayAgain}
        onShare={onShare}
        handleHandOverClick={handleHandOverClick}
      />
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-ground text-ink flex flex-col items-center justify-center gap-[var(--sp-14)] px-[var(--sp-28)] py-[var(--sp-20)]">
      <div className="w-[880px] max-w-full bg-card border border-cardBorder rounded-[var(--r-16)] px-[var(--sp-24)] pt-[var(--sp-20)] pb-[var(--sp-16)] box-border flex flex-col gap-[10px]">
        {/* Header row */}
        <div className="flex items-start justify-between gap-[var(--sp-16)]">
          <div className="min-w-0">
            <div className="text-[length:var(--fs-34)] font-medium text-white leading-none tracking-[-0.02em] break-words">{title}</div>
            <p className="text-[length:var(--fs-14)] text-ink3 mt-2 leading-[1.45] break-words" style={{ maxWidth: '46ch' }}>
              {subtitle}
            </p>
          </div>
          <div
            className="shrink-0 rounded-[10px] text-right"
            style={
              career.personalCash > 0
                ? { background: '#3D3218', border: '1px solid #C9A03E', padding: '10px 18px' }
                : { background: '#161A23', border: '1px solid #3A4456', padding: '10px 18px' }
            }
          >
            <div className="font-mono text-[length:var(--fs-9)] tracking-[0.14em]" style={{ color: career.personalCash > 0 ? '#E0B85E' : '#6E7A8E' }}>
              YOU HAVE
            </div>
            <div className="font-mono text-[length:var(--fs-30)] leading-none mt-1" style={{ color: career.personalCash > 0 ? '#FFD97A' : '#FFFFFF' }}>
              {formatMoney(career.personalCash)}
            </div>
          </div>
        </div>

        {/* Founder strip */}
        <div className="rounded-[10px] flex items-center justify-between gap-[var(--sp-12)]" style={{ background: '#161A23', padding: '7px 12px' }}>
          <div className="flex items-center gap-[var(--sp-12)] min-w-0">
            <div className="shrink-0 rounded-md overflow-hidden" style={{ width: 32, height: 32 }} dangerouslySetInnerHTML={{ __html: generatePortraitSVG(career.founder.portrait) }} />
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 min-w-0">
                <div className="text-[length:var(--fs-15)] font-semibold text-white truncate">{career.founder.name}</div>
                {career.generation > 1 && <Chip label={`GEN ${ROMAN[career.generation] ?? career.generation}`} variant="accent" />}
              </div>
              <div className="font-mono text-[length:var(--fs-10)] tracking-[0.1em] text-ink6 mt-0.5">
                {countryName.toUpperCase()} · STARTED AT {startAge} · RETIRED AT {endAge}
              </div>
            </div>
          </div>
          <div className="text-right shrink-0">
            <div className="font-mono text-[length:var(--fs-9)] tracking-[0.14em] text-ink6">{ranFullTerm ? 'RAN THE FULL TERM' : 'RETIRED EARLY'}</div>
            <div className="font-mono text-[length:var(--fs-13)] text-ink2 mt-0.5">{CAREER_LENGTH_YEARS} YEARS</div>
          </div>
        </div>

        {/* Career timeline */}
        <div>
          <div className="font-mono text-[length:var(--fs-9)] tracking-[0.14em] text-ink6 mb-1.5">THE CAREER</div>
          {segments.length === 0 ? (
            <p className="text-[length:var(--fs-14)] text-ink5 py-[var(--sp-12)]">No company founded this career.</p>
          ) : (
            <>
              {(() => {
                const showsCauseLine = segments.some((s) => !s.isGap && s.cause && s.widthPct >= MIN_WIDTH_FOR_CAUSE_LINE);
                const rowHeight = showsCauseLine ? 48 : 36;
                return (
                  <div className="flex" style={{ gap: 3, height: rowHeight }}>
                    {segments.map((s, i) =>
                      s.isGap ? (
                        <div key={i} style={{ width: `${s.widthPct}%` }} />
                      ) : (
                        <div
                          key={i}
                          className="min-w-0 flex flex-col justify-end px-2 pb-1 overflow-hidden"
                          style={{ width: `${s.widthPct}%`, background: s.bg, borderTop: `3px solid ${s.rule}`, borderRadius: '0 0 4px 4px' }}
                        >
                          <div className="text-[length:var(--fs-11)] font-medium text-white truncate">{s.name}</div>
                          {s.figure && (
                            <div className="font-mono text-[length:var(--fs-10)] truncate" style={{ color: s.text }}>
                              {s.figure}
                            </div>
                          )}
                          {s.cause && s.widthPct >= MIN_WIDTH_FOR_CAUSE_LINE && (
                            <div className="text-[length:var(--fs-9)] truncate opacity-80" style={{ color: s.text }}>
                              {s.cause}
                            </div>
                          )}
                        </div>
                      )
                    )}
                  </div>
                );
              })()}
              <div className="flex justify-between font-mono text-[length:var(--fs-9)] mt-1" style={{ color: '#4E5A6E' }}>
                <span>YEAR 1</span>
                <span>YEAR {Math.round(CAREER_LENGTH_YEARS / 2)}</span>
                <span>YEAR {CAREER_LENGTH_YEARS}</span>
              </div>
            </>
          )}
        </div>

        {/* Pull-quote — full width, sized to its own content. A 2×2 stat
            grid squeezed beside it forced this to stretch to match; a
            single row beneath it lets both size independently. */}
        {quote && (
          <div style={{ borderLeft: `3px solid ${quote.colour}`, background: '#141C28', borderRadius: '0 8px 8px 0', padding: '8px 14px' }}>
            <div className="text-[length:var(--fs-14)] font-medium text-white break-words">{quote.headline}</div>
            <div className="font-mono text-[length:var(--fs-9)] text-ink6 mt-1">{quote.dateline}</div>
          </div>
        )}

        {/* Stat row */}
        <div className="grid grid-cols-4 gap-1.5">
          <StatTile label="COMPANIES" value={String(summary.companiesFounded)} bg="#161A23" valueColor="#FFFFFF" labelColor="#6E7A8E" />
          <StatTile label="SOLD" value={String(summary.companiesSold + summary.companiesIPOd)} bg="#1A3D2C" valueColor="#7FD9A8" labelColor="#5FA882" />
          <StatTile label="FAILED" value={String(summary.companiesFailed)} bg="#3D1E1A" valueColor="#E8A08E" labelColor="#A06858" />
          <StatTile label="YEARS BUILDING" value={String(summary.yearsSpentBuilding)} bg="#161A23" valueColor="#FFFFFF" labelColor="#6E7A8E" />
        </div>

        {/* Awards — earned, rarest first, capped at six; everything past
            that (earned or not) folds into one plain count. Rare awards
            read gold; common ones are muted so the two don't look alike. */}
        <div className="flex flex-wrap items-center gap-2">
          {shownAwards.map((a) =>
            a.tier === 'rare' ? (
              <div
                key={a.id}
                title={a.description}
                className="inline-flex items-center gap-1.5 rounded-full"
                style={{ background: '#3D3218', border: '1px solid #8A6E2E', padding: '5px 12px 5px 6px' }}
              >
                <span className="w-5 h-5 rounded-full flex items-center justify-center shrink-0" style={{ background: '#C9A03E' }}>
                  <IconCheck className="w-3 h-3 text-[#2A2010]" />
                </span>
                <span className="font-mono text-[length:var(--fs-10)] tracking-[0.08em]" style={{ color: '#E0B85E' }}>
                  {a.label}
                </span>
              </div>
            ) : (
              <div
                key={a.id}
                title={a.description}
                className="inline-flex items-center gap-1.5 rounded-full"
                style={{ background: '#1E242F', border: '1px solid #3A4456', padding: '5px 12px 5px 6px' }}
              >
                <span className="w-5 h-5 rounded-full flex items-center justify-center shrink-0" style={{ background: '#5A6577' }}>
                  <IconCheck className="w-3 h-3 text-[#1E242F]" />
                </span>
                <span className="font-mono text-[length:var(--fs-10)] tracking-[0.08em] text-ink3">{a.label}</span>
              </div>
            )
          )}
          {foldedCount > 0 && (
            <span className="font-mono text-[length:var(--fs-10)]" style={{ color: '#4E5A6E' }}>
              +{foldedCount} LOCKED
            </span>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between pt-2" style={{ borderTop: '2px solid #2A3242' }}>
          <span className="text-[length:var(--fs-15)] font-medium text-white">raise.game</span>
          <span className="font-mono text-[length:var(--fs-10)] text-ink6">raise.game/r/{career.seed}</span>
        </div>
      </div>

      <div className="w-[880px] max-w-full flex gap-2">
        {hasRunningCompany ? (
          <>
            <Button
              variant="primary"
              size="lg"
              className="flex-[1.3] text-[length:var(--fs-15)] flex-col gap-0.5"
              disabled={handOverAd.loading}
              onClick={() => handleHandOverClick(true)}
            >
              <span>{handOverAd.loading ? 'Loading ad…' : keepRunningLabel}</span>
              {needsAd && !handOverAd.loading && <span className="font-mono text-[length:var(--fs-9)] tracking-[0.1em] text-ground/60 normal-case">FREE · 30s AD</span>}
            </Button>
            <Button
              variant="secondary"
              size="lg"
              className="flex-[1.3] text-[length:var(--fs-15)] flex-col gap-0.5"
              disabled={handOverAd.loading}
              onClick={() => handleHandOverClick(false)}
            >
              <span>{handOverAd.loading ? 'Loading ad…' : startFreshLabel}</span>
              {needsAd && !handOverAd.loading && <span className="font-mono text-[length:var(--fs-9)] tracking-[0.1em] text-ink6 normal-case">FREE · 30s AD</span>}
            </Button>
          </>
        ) : (
          <Button
            variant="primary"
            size="lg"
            className="flex-[1.6] text-[length:var(--fs-15)] flex-col gap-0.5"
            disabled={handOverAd.loading}
            onClick={() => handleHandOverClick(false)}
          >
            <span>{handOverAd.loading ? 'Loading ad…' : handOverLabel}</span>
            {needsAd && !handOverAd.loading && <span className="font-mono text-[length:var(--fs-9)] tracking-[0.1em] text-ground/60 normal-case">FREE · 30s AD</span>}
          </Button>
        )}
        <Button variant="secondary" size="lg" className="flex-1 text-[length:var(--fs-15)]" onClick={onPlayAgain}>
          Play again
        </Button>
        <Button variant="secondary" size="lg" className="flex-1 text-[length:var(--fs-15)]" onClick={onShare}>
          Share
        </Button>
      </div>
    </div>
  );
}

// ============================================================================
// Mobile scorecard — a separate component (not a branch inline in
// ResultsScreen) because it needs its own hook (useElementWidth, to measure
// the timeline's real rendered width) that the desktop path never calls;
// keeping conditionally-called hooks out of the shared function body avoids
// a hook-count mismatch between the two render paths.
// ============================================================================

/** 60px per spec's "minimum segment width 60px" — below this the timeline
 * renders at a wider, measured px width and scrolls instead of shrinking
 * any real segment out of legibility. */
const MOBILE_MIN_SEGMENT_PX = 60;

function useElementWidth(): [React.RefObject<HTMLDivElement>, number] {
  const ref = React.useRef<HTMLDivElement>(null);
  const [width, setWidth] = React.useState(0);
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w !== undefined) setWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

function MobileResultsScorecard({
  title,
  subtitle,
  career,
  countryName,
  startAge,
  endAge,
  mobileSegments,
  minRealPct,
  rowHeight,
  lastLivedYear,
  quote,
  summary,
  peakExit,
  mobileShownAwards,
  mobileFoldedCount,
  hasRunningCompany,
  handOverAd,
  needsAd,
  keepRunningLabel,
  startFreshLabel,
  handOverLabel,
  onPlayAgain,
  onShare,
  handleHandOverClick,
}: {
  title: string;
  subtitle: string;
  career: CareerState;
  countryName: string;
  startAge: number;
  endAge: number;
  mobileSegments: SegmentDisplay[];
  minRealPct: number;
  rowHeight: number;
  lastLivedYear: number;
  quote: PullQuote | null;
  summary: ReturnType<typeof summarizeCareer>;
  peakExit: number;
  mobileShownAwards: MobileAwardDisplay[];
  mobileFoldedCount: number;
  hasRunningCompany: boolean;
  handOverAd: ReturnType<typeof useRewardedAd>;
  needsAd: boolean;
  keepRunningLabel: string;
  startFreshLabel: string;
  handOverLabel: string;
  onPlayAgain: () => void;
  onShare: () => void;
  handleHandOverClick: (keepCompanyRunning: boolean) => void;
}) {
  const [timelineRef, timelineWidth] = useElementWidth();
  const naturalMinPx = timelineWidth * (minRealPct / 100);
  const needsScroll = timelineWidth > 0 && minRealPct > 0 && naturalMinPx < MOBILE_MIN_SEGMENT_PX;
  const scaledWidthPx = needsScroll ? Math.ceil((MOBILE_MIN_SEGMENT_PX * 100) / minRealPct) : undefined;
  const contentBottomPad = useMobileContentBottomPadPx();
  const [successorSheetOpen, setSuccessorSheetOpen] = React.useState(false);

  return (
    <div className="mobile-shell h-full flex flex-col text-ink overflow-hidden">
      <div
        className="flex-1 min-h-0 overflow-y-auto bg-ground flex flex-col"
        style={{ gap: 12, padding: 14, paddingBottom: `calc(${contentBottomPad}px + env(safe-area-inset-bottom))` }}
      >
        {/* The shareable card region — title through footer, nothing else.
            A single wrapper so a future export can capture exactly this
            node at 1080x1350, same as the existing (desktop) export.
            Purple top rule, always — one of the frame's fixed elements,
            identical on every card regardless of how the run went. */}
        <div
          id="scorecard-card"
          className="w-full bg-card border border-cardBorder rounded-[16px] px-4 pt-3.5 pb-4 box-border flex flex-col"
          style={{ gap: 12, borderTop: '3px solid #8B7FE8', borderRadius: '0 0 16px 16px' }}
        >
          {/* Eyebrow — brand mark + career length/generation/seed, the same
              three facts on every card, in the same order, above the title
              every time. */}
          <div
            className="flex items-center justify-between font-mono text-[8.5px] tracking-[0.18em]"
            style={{ color: '#6E7A8E', borderBottom: '1px solid #262D3A', paddingBottom: 8 }}
          >
            <span style={{ color: '#A89BD4' }}>RAISE</span>
            <span>
              {CAREER_LENGTH_YEARS} YEARS · GEN {ROMAN[career.generation] ?? career.generation} · {career.seed}
            </span>
          </div>

          {/* Title + subtitle — ~70px */}
          <div>
            <div className="text-[24px] font-medium text-white leading-tight tracking-[-0.02em] break-words">{title}</div>
            <p className="text-[14px] text-ink3 mt-1.5 leading-[1.4] break-words">{subtitle}</p>
          </div>

          {/* YOU WALK AWAY WITH — always gold, full width, ~80px. $0 in
              gold reads as a real result; $0 in grey used to read as a
              missing value instead, which was the single biggest cause of
              this card going flat exactly when the story was most dramatic. */}
          <div className="rounded-[10px]" style={{ background: '#3D3218', border: '1px solid #C9A03E', padding: '12px 16px' }}>
            <div className="font-mono text-[10px] tracking-[0.14em]" style={{ color: '#E0B85E' }}>
              YOU WALK AWAY WITH
            </div>
            <div className="font-mono text-[28px] leading-none mt-1" style={{ color: '#FFD97A' }}>
              {formatMoney(career.personalCash)}
            </div>
          </div>

          {/* Founder strip — name/country/age on the left, a generation
              seal always on the right (not just from generation 2 on) —
              one of the frame's fixed elements, same position every card. */}
          <div className="rounded-[10px] flex items-center justify-between gap-3" style={{ background: '#161A23', padding: '9px 12px', height: 56 }}>
            <div className="flex items-center gap-3 min-w-0">
              <div className="shrink-0 rounded-md overflow-hidden" style={{ width: 32, height: 32 }} dangerouslySetInnerHTML={{ __html: generatePortraitSVG(career.founder.portrait) }} />
              <div className="min-w-0 flex flex-col gap-0.5">
                <div className="text-[15px] font-semibold text-white truncate">{career.founder.name}</div>
                <div className="font-mono text-[10px] tracking-[0.1em] text-ink6 truncate">
                  {countryName.toUpperCase()} · {startAge} → {endAge}
                </div>
              </div>
            </div>
            <div className="shrink-0 rounded-full flex flex-col items-center justify-center" style={{ width: 34, height: 34, border: '1.5px solid #4A5468' }}>
              <div className="font-mono text-[12px] leading-none" style={{ color: '#A8B2C4' }}>
                {ROMAN[career.generation] ?? career.generation}
              </div>
              <div className="font-mono text-[6px] tracking-[0.08em]" style={{ color: '#5A6478' }}>
                GEN
              </div>
            </div>
          </div>

          {/* Career timeline — 32px bar + 16px axis, full width and
              proportional by default; only switches to a measured,
              horizontally-scrollable px width if a real segment would
              otherwise render under 60px. */}
          <div>
            {mobileSegments.length === 0 ? (
              <p className="text-[15px] text-ink5 py-3">No company founded this career.</p>
            ) : (
              <>
                <div ref={timelineRef} className={needsScroll ? 'overflow-x-auto -mx-4 px-4 hide-scrollbar' : 'w-full'}>
                  <div className="flex" style={{ gap: 3, height: rowHeight, width: needsScroll ? scaledWidthPx : '100%' }}>
                    {mobileSegments.map((s, i) =>
                      s.isGap ? (
                        <div key={i} style={{ width: `${s.widthPct}%`, flexShrink: 0 }} />
                      ) : (
                        <div
                          key={i}
                          className="min-w-0 flex flex-col justify-end px-2 pb-1 overflow-hidden"
                          style={{ width: `${s.widthPct}%`, flexShrink: 0, background: s.bg, borderTop: `3px solid ${s.rule}`, borderRadius: '0 0 4px 4px' }}
                        >
                          <div className="text-[11px] font-medium text-white truncate">{s.name}</div>
                        </div>
                      )
                    )}
                  </div>
                </div>
                <div className="flex justify-between font-mono text-[9px] mt-1" style={{ color: '#4E5A6E' }}>
                  <span>YEAR 1</span>
                  <span>YEAR {lastLivedYear}</span>
                </div>
              </>
            )}
          </div>

          {/* Pull-quote — clamped to two lines */}
          {quote && (
            <div style={{ borderLeft: `3px solid ${quote.colour}`, background: '#141C28', borderRadius: '0 8px 8px 0', padding: '9px 14px' }}>
              <div
                className="text-[15px] font-medium text-white break-words"
                style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
              >
                {quote.headline}
              </div>
              <div className="font-mono text-[10px] text-ink6 mt-1">{quote.dateline}</div>
            </div>
          )}

          {/* Stat tiles — one row of four, 58px. PEAK EXIT replaces the old
              YEARS BUILDING tile: career length is fixed and already stated
              in the eyebrow above, so it barely varies between cards —
              the single biggest exit does. */}
          <div className="grid grid-cols-4 gap-1.5" style={{ height: 58 }}>
            <StatTile label="COMPANIES" value={String(summary.companiesFounded)} bg="#161A23" valueColor="#FFFFFF" labelColor="#6E7A8E" compact />
            <StatTile label="SOLD" value={String(summary.companiesSold + summary.companiesIPOd)} bg="#1A3D2C" valueColor="#7FD9A8" labelColor="#5FA882" compact />
            <StatTile label="FAILED" value={String(summary.companiesFailed)} bg="#3D1E1A" valueColor="#E8A08E" labelColor="#A06858" compact />
            <StatTile label="PEAK EXIT" value={formatMoney(peakExit)} bg="#161A23" valueColor="#FFFFFF" labelColor="#6E7A8E" compact />
          </div>

          {/* Awards — always exactly three pills (earned first, rarest of
              those first; unearned fills in a muted "not yet" treatment)
              so the row never reads as broken/empty the way zero pills did. */}
          <div className="flex flex-wrap items-center gap-1.5">
            {mobileShownAwards.map((a) =>
              a.earned ? (
                <div
                  key={a.id}
                  title={a.description}
                  className="inline-flex items-center gap-1.5 rounded-full"
                  style={
                    a.tier === 'rare'
                      ? { background: '#3D3218', border: '1px solid #8A6E2E', padding: '4px 10px 4px 4px' }
                      : { background: '#1E242F', border: '1px solid #3A4456', padding: '4px 10px 4px 4px' }
                  }
                >
                  <span
                    className="w-[14px] h-[14px] rounded-full flex items-center justify-center shrink-0"
                    style={{ background: a.tier === 'rare' ? '#C9A03E' : '#5A6577' }}
                  >
                    <IconCheck className={a.tier === 'rare' ? 'w-2.5 h-2.5 text-[#2A2210]' : 'w-2.5 h-2.5 text-[#1E242F]'} />
                  </span>
                  <span className="font-mono text-[8px] tracking-[0.06em]" style={{ color: a.tier === 'rare' ? '#E0B85E' : '#8E98A8' }}>
                    {a.label}
                  </span>
                </div>
              ) : (
                <div
                  key={a.id}
                  title={a.description}
                  className="inline-flex items-center gap-1.5 rounded-full"
                  style={{ background: '#161A23', border: '1px dashed #3A4456', padding: '4px 10px 4px 4px' }}
                >
                  <span className="w-[14px] h-[14px] rounded-full shrink-0" style={{ border: '1.5px solid #3A4456' }} />
                  <span className="font-mono text-[8px] tracking-[0.06em] text-ink6">{a.label}</span>
                </div>
              )
            )}
            {mobileFoldedCount > 0 && <span className="font-mono text-[8px] text-ink6">+{mobileFoldedCount} LOCKED</span>}
          </div>

          {/* Footer — one line. Purple bottom rule, always — the frame's
              other fixed rule, mirroring the one at the top of the card. */}
          <div className="flex items-center justify-between pt-2" style={{ borderTop: '2px solid #8B7FE8' }}>
            <span className="text-[15px] font-medium text-white">raise.game</span>
            <span className="font-mono text-[10px] text-ink6">raise.game/r/{career.seed}</span>
          </div>
        </div>

        {/* Successor link — outside the capturable card region, above the
            action bar. Replaces what used to be one or two full-width
            buttons in the main view; tapping it opens a small sheet with
            the actual choice(s), so the feature survives without eating
            main-view space. */}
        <button
          onClick={() => setSuccessorSheetOpen(true)}
          className="w-full text-center font-mono text-[13px] text-ink4 underline underline-offset-4"
          style={{ minHeight: 40 }}
        >
          Hand it to a successor →
        </button>
      </div>

      <MobileActionBar>
        <div className="flex gap-2 w-full">
          <Button variant="primary" size="lg" className="flex-1 text-[15px]" style={{ minHeight: 48 }} onClick={onPlayAgain}>
            Play again
          </Button>
          <Button variant="secondary" size="lg" className="flex-1 text-[15px]" style={{ minHeight: 48 }} onClick={onShare}>
            Share
          </Button>
        </div>
      </MobileActionBar>

      {successorSheetOpen && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end" onClick={() => setSuccessorSheetOpen(false)}>
          <div className="absolute inset-0" style={{ background: 'rgba(0,0,0,0.6)' }} />
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative bg-panel border-t border-line rounded-t-2xl p-4 flex flex-col gap-2"
            style={{ paddingBottom: `calc(20px + env(safe-area-inset-bottom))` }}
          >
            <div className="text-[15px] font-bold text-white mb-1">Hand it to a successor</div>
            {hasRunningCompany ? (
              <>
                <button
                  onClick={() => {
                    setSuccessorSheetOpen(false);
                    handleHandOverClick(true);
                  }}
                  disabled={handOverAd.loading}
                  className="w-full text-left rounded-xl bg-field border border-lineStrong px-4 py-3 text-[14px] text-ink flex items-center justify-between gap-2"
                  style={{ minHeight: 48 }}
                >
                  <span>{handOverAd.loading ? 'Loading ad…' : keepRunningLabel}</span>
                  {needsAd && !handOverAd.loading && <span className="font-mono text-[10px] tracking-[0.1em] text-ink6 normal-case shrink-0">FREE · 30s AD</span>}
                </button>
                <button
                  onClick={() => {
                    setSuccessorSheetOpen(false);
                    handleHandOverClick(false);
                  }}
                  disabled={handOverAd.loading}
                  className="w-full text-left rounded-xl bg-field border border-lineStrong px-4 py-3 text-[14px] text-ink flex items-center justify-between gap-2"
                  style={{ minHeight: 48 }}
                >
                  <span>{handOverAd.loading ? 'Loading ad…' : startFreshLabel}</span>
                  {needsAd && !handOverAd.loading && <span className="font-mono text-[10px] tracking-[0.1em] text-ink6 normal-case shrink-0">FREE · 30s AD</span>}
                </button>
              </>
            ) : (
              <button
                onClick={() => {
                  setSuccessorSheetOpen(false);
                  handleHandOverClick(false);
                }}
                disabled={handOverAd.loading}
                className="w-full text-left rounded-xl bg-field border border-lineStrong px-4 py-3 text-[14px] text-ink flex items-center justify-between gap-2"
                style={{ minHeight: 48 }}
              >
                <span>{handOverAd.loading ? 'Loading ad…' : handOverLabel}</span>
                {needsAd && !handOverAd.loading && <span className="font-mono text-[10px] tracking-[0.1em] text-ink6 normal-case shrink-0">FREE · 30s AD</span>}
              </button>
            )}
            <button onClick={() => setSuccessorSheetOpen(false)} className="w-full text-center font-mono text-[13px] text-ink5 mt-1" style={{ minHeight: 40 }}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function StatTile({
  label,
  value,
  bg,
  valueColor,
  labelColor,
  compact,
}: {
  label: string;
  value: string;
  bg: string;
  valueColor: string;
  labelColor: string;
  compact?: boolean;
}) {
  return (
    <div className={compact ? 'rounded-lg text-center flex flex-col items-center justify-center h-full' : 'rounded-lg text-center'} style={{ background: bg, padding: compact ? '4px 6px' : '9px 11px' }}>
      <div className={compact ? 'font-mono text-[15px] leading-none' : 'font-mono text-[length:var(--fs-19)] leading-none'} style={{ color: valueColor }}>
        {value}
      </div>
      <div className="font-mono text-[length:var(--fs-8-5)] tracking-[0.1em] mt-1" style={{ color: labelColor }}>
        {label}
      </div>
    </div>
  );
}
