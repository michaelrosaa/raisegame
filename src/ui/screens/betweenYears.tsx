/**
 * Between Years — shown whenever CareerState.current is null: no company
 * is running, but the career clock still moves one year at a time (design
 * doc: "the clock never skips"). Only two real decisions once a company has
 * ended — rest, or start the next one immediately — plus, once at least one
 * exit has happened, retiring the career early and banking everything.
 * (engine/career.ts's BETWEEN_YEAR_OPTIONS still carries the full original
 * set — invest/angel/job/search — for the simulation harness's "random"
 * play style; this screen just no longer offers those to a real player.)
 */

import type React from 'react';
import type { CareerState, BetweenYearOption } from '../../engine/types';
import { BETWEEN_YEAR_OPTIONS, canRetireCareer, CAREER_LENGTH_YEARS } from '../../engine/career';
import { calendarYearFor } from '../../engine/present';
import { formatMoney } from '../../engine/format';
import { Chip, TopBar, useMobilePageBottomPadPx } from '../components/ui';
import { IconCoins, IconHourglass, IconFlag } from '../components/icons';
import { useIsMobile } from '../hooks/useIsMobile';

const SHOWN_OPTION_IDS = new Set(['rest', 'found']);
const OPTION_ICON: Record<'rest' | 'found', React.ComponentType<{ className?: string }>> = {
  rest: IconHourglass,
  found: IconCoins,
};

export interface BetweenYearsScreenProps {
  career: CareerState;
  onChooseAction: (id: BetweenYearOption['id']) => void;
  onRetireCareer: () => void;
}

export function BetweenYearsScreen({ career, onChooseAction, onRetireCareer }: BetweenYearsScreenProps) {
  const isMobile = useIsMobile();
  const pageBottomPad = useMobilePageBottomPadPx();
  const canRetire = canRetireCareer(career);
  const yearsLeft = CAREER_LENGTH_YEARS - career.careerYear + 1;
  // Acknowledged once, quietly, in the dateline — never again once the
  // clock has actually moved past the year that company ended in (a
  // 'rest' action bumps careerYear, so this naturally stops matching on
  // any later return to this screen). See ui/screens/failure.tsx for the
  // full beat this is a quiet follow-up to.
  const lastCompany = career.companies[career.companies.length - 1];
  const justFailed = lastCompany?.outcome === 'failed' && lastCompany.yearEnded === career.careerYear;

  return (
    <div className={`h-full flex flex-col bg-ground text-ink overflow-hidden ${isMobile ? 'mobile-shell' : ''}`}>
      <TopBar
        right={
          <div className="flex items-center gap-2.5">
            <Chip label={`YEAR ${career.careerYear} OF ${CAREER_LENGTH_YEARS}`} variant="accent" />
            {!isMobile && career.companies.length > 0 && (
              <Chip label={`${career.companies.length} ${career.companies.length === 1 ? 'COMPANY' : 'COMPANIES'} SO FAR`} />
            )}
          </div>
        }
      />

      {/* my-auto on the inner block (not justify-center here) centres it when
          short, same reasoning as the ledger's scroll fix — justify-content:
          center leaves the scroll position ambiguous once content is tall
          enough to need it, silently cutting off the top instead of scrolling
          cleanly. */}
      <div
        className={isMobile ? 'flex-1 min-h-0 overflow-y-auto flex flex-col' : 'flex-1 min-h-0 overflow-y-auto px-[var(--sp-28)] py-[var(--sp-24)] flex flex-col items-center'}
        style={isMobile ? { padding: '14px', paddingBottom: `calc(${pageBottomPad}px + env(safe-area-inset-bottom))` } : undefined}
      >
        <div className={isMobile ? 'w-full flex flex-col gap-[14px]' : 'w-[1100px] max-w-full flex flex-col gap-[var(--sp-16)] my-auto'}>
          {isMobile ? (
            <div className="flex flex-col gap-1.5">
              <div className="font-mono text-[10px] tracking-[0.16em] text-accentDim">
                {calendarYearFor(career.foundedCalendarYear, career.careerYear)}
                {justFailed && ` · After ${lastCompany.name}`}
              </div>
              <div className="flex items-center justify-between gap-3">
                <h1 className="flex-1 min-w-0 text-[20px] font-extrabold tracking-[-0.03em] leading-tight break-words">What will you do this year?</h1>
                <StatChip label="CASH" value={formatMoney(career.personalCash)} compact />
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <div className="font-mono text-[length:var(--fs-10)] tracking-[0.16em] text-accentDim">
                {calendarYearFor(career.foundedCalendarYear, career.careerYear)}
                {justFailed && ` · After ${lastCompany.name}`}
              </div>
              <div className="flex items-center justify-between gap-[var(--sp-20)]">
                <h1 className="text-[length:var(--fs-32)] font-extrabold tracking-[-0.03em] leading-none">What will you do this year?</h1>
                <div className="flex gap-2 shrink-0">
                  <StatChip label="PERSONAL CASH" value={formatMoney(career.personalCash)} />
                </div>
              </div>
              <p className="text-[length:var(--fs-14)] text-ink4 leading-relaxed">
                {yearsLeft > 1 ? `${yearsLeft} years left in this career.` : 'The last year of this career.'}
              </p>
            </div>
          )}

          <div className={isMobile ? 'flex flex-col gap-2' : 'grid grid-cols-3 gap-[var(--sp-16)]'}>
            {BETWEEN_YEAR_OPTIONS.filter((option) => SHOWN_OPTION_IDS.has(option.id)).map((option) => {
              const Icon = OPTION_ICON[option.id as 'rest' | 'found'];
              return isMobile ? (
                <div
                  key={option.id}
                  onClick={() => onChooseAction(option.id)}
                  className="rounded-2xl bg-field border border-lineStrong active:border-accent transition-colors px-3 py-3 flex flex-col gap-1.5 cursor-pointer"
                >
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 shrink-0 rounded-[8px] bg-accentTint text-accentLight flex items-center justify-center">
                      <Icon className="w-[15px] h-[15px]" />
                    </div>
                    <div className="text-[16px] font-extrabold tracking-[-0.02em] leading-tight">{option.label}</div>
                  </div>
                  <p className="text-[13px] text-ink4 leading-[1.4] overflow-hidden text-ellipsis whitespace-nowrap">{option.detail(career)}</p>
                </div>
              ) : (
                <div
                  key={option.id}
                  onClick={() => onChooseAction(option.id)}
                  className="rounded-[var(--r-16)] bg-panel border border-line hover:border-accent transition-colors px-[var(--sp-16)] pt-[var(--sp-16)] pb-[var(--sp-15)] flex flex-col gap-2.5 cursor-pointer"
                >
                  <div className="w-9 h-9 rounded-[10px] bg-accentTint text-accentLight flex items-center justify-center">
                    <Icon className="w-[18px] h-[18px]" />
                  </div>
                  <div className="text-[length:var(--fs-17)] font-extrabold tracking-[-0.02em] leading-tight">{option.label}</div>
                  <p className="text-[length:var(--fs-12-5)] text-ink4 leading-[1.5] min-h-[38px]">{option.detail(career)}</p>
                </div>
              );
            })}

            {canRetire &&
              (isMobile ? (
                <div
                  onClick={onRetireCareer}
                  className="rounded-2xl bg-field border border-lineStrong active:border-caution transition-colors px-3 py-3 flex flex-col gap-1.5 cursor-pointer"
                >
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 shrink-0 rounded-[8px] bg-goldBg text-goldLabel flex items-center justify-center">
                      <IconFlag className="w-[15px] h-[15px]" />
                    </div>
                    <div className="text-[16px] font-extrabold tracking-[-0.02em] leading-tight">Retire early</div>
                  </div>
                  <p className="text-[13px] text-ink4 leading-[1.4] overflow-hidden text-ellipsis whitespace-nowrap">
                    Keep exactly what you have: {formatMoney(career.personalCash)}.
                  </p>
                </div>
              ) : (
                <div
                  onClick={onRetireCareer}
                  className="rounded-[var(--r-16)] bg-panel border border-line hover:border-caution transition-colors px-[var(--sp-16)] pt-[var(--sp-16)] pb-[var(--sp-15)] flex flex-col gap-2.5 cursor-pointer"
                >
                  <div className="w-9 h-9 rounded-[10px] bg-goldBg text-goldLabel flex items-center justify-center">
                    <IconFlag className="w-[18px] h-[18px]" />
                  </div>
                  <div className="text-[length:var(--fs-17)] font-extrabold tracking-[-0.02em] leading-tight">Retire early</div>
                  <p className="text-[length:var(--fs-12-5)] text-ink4 leading-[1.5] min-h-[38px]">
                    End the career here{yearsLeft > 1 ? `, ${yearsLeft - 1} years early, ` : ' '}and keep exactly what you have: {formatMoney(career.personalCash)}.
                  </p>
                </div>
              ))}
          </div>

          {/* Fills what used to be dead space below the cards, and gives the
              pause a reason to exist beyond "pick one of three" — a quick
              look back at the career instead of a blank pause screen. */}
          <div className={isMobile ? '' : 'mt-2'}>
            <div className="font-mono text-[length:var(--fs-10)] tracking-[0.14em] text-ink6 mb-2">THE CAREER SO FAR</div>
            <div className={isMobile ? 'grid grid-cols-3 gap-1.5' : 'grid grid-cols-4 gap-[var(--sp-12)]'}>
              <MiniStat label="COMPANIES" value={String(career.companies.length)} bg="#161A23" valueColor="#FFFFFF" labelColor="#6E7A8E" compact={isMobile} />
              <MiniStat label="EXITS" value={String(career.exits)} bg="#1A3D2C" valueColor="#7FD9A8" labelColor="#5FA882" compact={isMobile} />
              {/* AWARDS dropped on mobile only — desktop keeps all four. */}
              {!isMobile && <MiniStat label="AWARDS" value={String(career.awards.length)} bg="#3D3218" valueColor="#FFD97A" labelColor="#C9A03E" />}
              <MiniStat label="YEARS IN" value={String(career.careerYear - 1)} bg="#161A23" valueColor="#FFFFFF" labelColor="#6E7A8E" compact={isMobile} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatChip({ label, value, full, compact }: { label: string; value: string; full?: boolean; compact?: boolean }) {
  return (
    <div
      className={`bg-panel border border-line rounded-[var(--r-12)] shrink-0 ${full ? 'text-left w-full' : 'text-center'} ${compact ? 'min-w-0 px-2.5 py-1.5' : 'min-w-[110px] px-[var(--sp-14)] py-2'}`}
    >
      <div className={compact ? 'text-[15px] font-extrabold leading-none whitespace-nowrap' : 'text-[length:var(--fs-18)] font-extrabold leading-none'}>{value}</div>
      <div className="font-mono text-[length:var(--fs-8-5)] tracking-[0.1em] text-ink5 mt-1">{label}</div>
    </div>
  );
}

function MiniStat({
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
    <div className="rounded-[var(--r-12)] text-center" style={{ background: bg, padding: compact ? '8px 6px' : '10px 12px', height: compact ? 56 : undefined }}>
      <div className={compact ? 'font-mono text-[15px] leading-none' : 'font-mono text-[length:var(--fs-19)] leading-none'} style={{ color: valueColor }}>
        {value}
      </div>
      <div className="font-mono text-[length:var(--fs-8-5)] tracking-[0.1em] mt-1" style={{ color: labelColor }}>
        {label}
      </div>
    </div>
  );
}
