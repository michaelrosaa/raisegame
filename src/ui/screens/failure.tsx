/**
 * The failure screen — the one screen in the game that inverts. A compact,
 * bordered notice card centred on the ground, not a full-bleed page — it
 * should read as an event that happened, not a state the app got stuck in.
 * Reached only through App.tsx's 'failure' phase (between the last decision
 * that ended a company and whatever comes next) and left only by its own
 * button — never a modal, never skippable by accident.
 *
 * Reads from CompanyRecord.failure, which engine/failure.ts's
 * buildFailureDetail computed once, at the moment the company actually
 * ended, while the full year-by-year history it's mined from still existed.
 */

import type { CompanyRecord } from '../../engine/types';
import { formatMoney } from '../../engine/format';
import { DEATH_CAUSE_COPY, standingLine } from '../../engine/failure';
import { calendarYearFor } from '../../engine/present';
import { Button, MobileActionBar, useMobileContentBottomPadPx } from '../components/ui';
import { useIsMobile } from '../hooks/useIsMobile';

const CARD_BG = '#16090A';
const CARD_BORDER = '#3D1E1C';
const TOP_RULE = '#C4553A';
const TILE_BG = '#2A1614';
const NAME_TEXT = '#F0DEDA';
const CAUSE_TEXT = '#E8785F';
const BODY_TEXT = '#B89A94';
const LABEL_TEXT = '#96685F';
const KICKER_TEXT = '#7A4F48';
const QUOTE_BG = '#200F0E';
const QUOTE_BORDER = '#6E3A32';

// The engine has no month-level granularity (state.year is the only clock)
// — this is pure flavour, deterministically derived so the same company
// always shows the same month rather than a fresh random one every render.
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export interface FailureScreenProps {
  record: CompanyRecord;
  personalCash: number;
  foundedCalendarYear: number; // CareerState.foundedCalendarYear — anchor for record.yearFounded/yearEnded
  careerYearsLeft: number;
  companiesSoFar: number;
  isLastCompany: boolean;
  onContinue: () => void;
}

export function FailureScreen({
  record,
  personalCash,
  foundedCalendarYear,
  careerYearsLeft,
  companiesSoFar,
  isLastCompany,
  onContinue,
}: FailureScreenProps) {
  const isMobile = useIsMobile();
  const contentBottomPad = useMobileContentBottomPadPx();
  const failure = record.failure;
  if (!failure) return null;

  const cause = DEATH_CAUSE_COPY[failure.cause];
  const yearsAlive = Math.max(1, record.yearEnded - record.yearFounded + 1);
  const startCalendarYear = calendarYearFor(foundedCalendarYear, record.yearFounded);
  const endCalendarYear = calendarYearFor(foundedCalendarYear, record.yearEnded);
  const dateMonth = MONTHS[hashString(record.name + failure.finalHeadline) % 12];

  // The epitaph is whichever year's story headline was last recorded —
  // if the company died without an event firing that year (the hard-fail
  // path in turn.ts), that's an earlier year than the one on the CLOSED
  // line above, and can read as contradicting the cause (a "bails out"
  // headline for a company that still ran out of money). Rather than hide
  // the gap, the dateline calls it out — that's what turns it into context
  // instead of a bug.
  const yearsBeforeEnd = failure.finalHeadlineYearsBeforeEnd;
  const headlineCalendarYear = calendarYearFor(foundedCalendarYear, record.yearEnded - yearsBeforeEnd);
  const dateNote = yearsBeforeEnd === 0 ? 'THE NEWS' : `${yearsBeforeEnd} YEAR${yearsBeforeEnd === 1 ? '' : 'S'} BEFORE THE END`;

  // Never a bare zero on the damage tiles: PEAK REVENUE and PEOPLE LET GO
  // are preferred, but either gets swapped for whatever else the run
  // actually produced the moment it would read as $0/0 — a company that
  // never billed a dollar or never let anyone go still has a real number
  // to show (staff at peak, or years since the last time revenue grew).
  // ROUNDS REFUSED used to live in this fallback pool too, but it's a
  // fine number at zero (it just means nobody was ever turned down), so
  // it's promoted to its own always-shown tile below instead — that also
  // frees this screen from showing YEARS ALIVE a second time (the header
  // already carries it in "· N YRS", right next to the date range).
  const fallbackPool = [
    { label: 'STAFF AT PEAK', value: String(failure.staffAtPeak), meaningful: failure.staffAtPeak > 0 },
    { label: 'YEARS SINCE GROWTH', value: String(failure.yearsSinceLastGrowth), meaningful: failure.yearsSinceLastGrowth > 0 },
  ];
  const usedFallbacks = new Set<string>();
  function pickTile(label: string, value: string, meaningful: boolean): { label: string; value: string } {
    if (meaningful) return { label, value };
    const fallback = fallbackPool.find((f) => f.meaningful && !usedFallbacks.has(f.label));
    if (fallback) {
      usedFallbacks.add(fallback.label);
      return { label: fallback.label, value: fallback.value };
    }
    return { label, value }; // nothing else available — show the true figure anyway
  }
  const tileRevenue = pickTile('PEAK REVENUE', formatMoney(failure.peakRevenue), failure.peakRevenue > 0);
  const tilePeople = pickTile('PEOPLE LET GO', String(failure.peopleLetGo), failure.peopleLetGo > 0);

  if (isMobile) {
    // No app TopBar on this screen (matches desktop) and, per spec, no
    // outer card either — the red background and a full-width 3px top rule
    // stand in for the border the desktop card draws around itself.
    return (
      <div className="mobile-shell h-full flex flex-col text-ink overflow-hidden" style={{ background: CARD_BG }}>
        <div style={{ height: 3, background: TOP_RULE, flexShrink: 0 }} />
        <div
          className="flex-1 min-h-0 overflow-y-auto flex flex-col"
          style={{ padding: 14, paddingBottom: `calc(${contentBottomPad}px + env(safe-area-inset-bottom))` }}
        >
          <div className="flex flex-col" style={{ gap: 14 }}>
            {/* header — ~72px */}
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 shrink-0 rounded-lg flex items-center justify-center" style={{ background: TILE_BG, border: `1px solid ${QUOTE_BORDER}` }}>
                <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke={LABEL_TEXT} strokeWidth="1.5">
                  <path d="M10 2 L18 17 L2 17 Z" />
                </svg>
              </div>
              <div className="min-w-0">
                <div className="font-mono text-[10px] tracking-[0.18em]" style={{ color: LABEL_TEXT }}>
                  CLOSED · {startCalendarYear}—{endCalendarYear} · {yearsAlive} YR{yearsAlive === 1 ? '' : 'S'}
                </div>
                <div className="font-medium leading-[1.15] break-words text-[20px]" style={{ color: NAME_TEXT, marginTop: 1 }}>
                  {record.name}
                </div>
              </div>
            </div>

            {/* YOU STILL HAVE — full width, ~90px */}
            <div style={{ borderTop: `1px solid ${CARD_BORDER}`, paddingTop: 12 }}>
              <div className="font-mono text-[10px] tracking-[0.14em]" style={{ color: KICKER_TEXT }}>
                YOU STILL HAVE
              </div>
              <div className="font-mono leading-[1.05] text-[24px]" style={{ color: CAUSE_TEXT, marginTop: 2 }}>
                {formatMoney(Math.max(0, personalCash))}
              </div>
              <div className="text-[13px] leading-[1.4]" style={{ color: LABEL_TEXT, marginTop: 5 }}>
                {standingLine(personalCash, careerYearsLeft)}
                <br />
                {companiesSoFar} compan{companiesSoFar === 1 ? 'y' : 'ies'} so far.
              </div>
            </div>

            {/* cause headline + body — ~130px */}
            <div>
              <div className="font-medium leading-[1.2] break-words text-[19px]" style={{ color: CAUSE_TEXT }}>
                {failure.causeStatement}
              </div>
              <p className="text-[14px] leading-[1.5] break-words" style={{ color: BODY_TEXT, marginTop: 6 }}>
                {cause.body}
              </p>
            </div>

            {/* damage tiles — 2x2, ~130px */}
            <div className="grid grid-cols-2 gap-[7px]">
              <FailureTile label="YOU PUT IN" value={formatMoney(-record.capitalPutIn)} valueColor={CAUSE_TEXT} />
              <FailureTile label={tileRevenue.label} value={tileRevenue.value} />
              <FailureTile label={tilePeople.label} value={tilePeople.value} />
              <FailureTile label="ROUNDS REFUSED" value={String(failure.roundsRefused)} />
            </div>

            {/* epitaph headline block — ~70px */}
            <div style={{ borderLeft: `3px solid ${QUOTE_BORDER}`, background: QUOTE_BG, borderRadius: '0 7px 7px 0', padding: '9px 12px' }}>
              <div className="font-medium text-[13px] break-words" style={{ color: NAME_TEXT }}>
                {failure.finalHeadline}
              </div>
              <div className="font-mono text-[10px] tracking-[0.08em]" style={{ color: LABEL_TEXT, marginTop: 3 }}>
                {dateMonth} {headlineCalendarYear} · {dateNote}
              </div>
            </div>

            {/* WHERE IT TURNED — full width, ~100px */}
            <div className="text-center" style={{ borderTop: `1px solid ${CARD_BORDER}`, borderBottom: `1px solid ${CARD_BORDER}`, padding: '12px 0' }}>
              <div className="font-mono text-[10px] tracking-[0.2em]" style={{ color: KICKER_TEXT }}>
                WHERE IT TURNED
              </div>
              <div className="text-[15px] leading-[1.35] break-words" style={{ color: NAME_TEXT, marginTop: 6 }}>
                {failure.pivotPoint}
              </div>
            </div>
          </div>
        </div>

        <MobileActionBar>
          <Button variant="primary" size="lg" onClick={onContinue} className="w-full" style={{ minHeight: 48 }}>
            {isLastCompany ? 'See how it ended' : 'Carry on →'}
          </Button>
        </MobileActionBar>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto flex items-center justify-center bg-ground px-[var(--sp-20)] py-[var(--sp-20)]">
      <div
        className="w-[880px] max-w-full overflow-hidden"
        style={{
          background: CARD_BG,
          border: `1px solid ${CARD_BORDER}`,
          borderTop: `3px solid ${TOP_RULE}`,
          borderRadius: '0 0 14px 14px',
          padding: '20px 28px 22px',
        }}
      >
        {/* header: closing notice on the left, where the player stands on the right */}
        <div className="flex items-start justify-between gap-6 pb-2" style={{ borderBottom: `1px solid ${CARD_BORDER}` }}>
          <div className="flex items-center gap-[11px] min-w-0">
            <div
              className="w-10 h-10 shrink-0 rounded-lg flex items-center justify-center"
              style={{ background: TILE_BG, border: `1px solid ${QUOTE_BORDER}` }}
            >
              <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke={LABEL_TEXT} strokeWidth="1.5">
                <path d="M10 2 L18 17 L2 17 Z" />
              </svg>
            </div>
            <div className="min-w-0">
              <div className="font-mono text-[length:var(--fs-9-5)] tracking-[0.18em]" style={{ color: LABEL_TEXT }}>
                CLOSED · {startCalendarYear}—{endCalendarYear} · {yearsAlive} YR{yearsAlive === 1 ? '' : 'S'}
              </div>
              <div className="font-medium leading-[1.15] break-words text-[length:var(--fs-24)]" style={{ color: NAME_TEXT, marginTop: 1 }}>
                {record.name}
              </div>
            </div>
          </div>
          <div className="text-right shrink-0">
            <div className="font-mono text-[length:var(--fs-8-5)] tracking-[0.14em]" style={{ color: KICKER_TEXT }}>
              YOU STILL HAVE
            </div>
            <div className="font-mono leading-[1.1] text-[length:var(--fs-24)]" style={{ color: CAUSE_TEXT, marginTop: 1 }}>
              {formatMoney(Math.max(0, personalCash))}
            </div>
            <div className="text-[length:var(--fs-11-5)] leading-[1.45]" style={{ color: LABEL_TEXT, marginTop: 4 }}>
              {standingLine(personalCash, careerYearsLeft)}
              <br />
              {companiesSoFar} compan{companiesSoFar === 1 ? 'y' : 'ies'} so far.
            </div>
          </div>
        </div>

        {/* narrative on the left, the damage on the right — a fixed, narrower
            tile column (text needs width, four numbers don't), bottom-
            aligned against the narrative column via content-end so the two
            sides finish at the same height whichever one is naturally taller */}
        <div className="flex gap-[22px]" style={{ marginTop: 9 }}>
          <div className="min-w-0" style={{ flex: 1 }}>
            <div className="font-medium leading-[1.2] break-words text-[length:var(--fs-23)]" style={{ color: CAUSE_TEXT }}>
              {failure.causeStatement}
            </div>
            <p className="text-[length:var(--fs-14)] leading-[1.55] break-words" style={{ color: BODY_TEXT, marginTop: 9 }}>
              {cause.body}
            </p>
            <div style={{ borderLeft: `3px solid ${QUOTE_BORDER}`, background: QUOTE_BG, borderRadius: '0 7px 7px 0', padding: '9px 13px', marginTop: 16 }}>
              <div className="font-medium text-[length:var(--fs-13-5)] break-words" style={{ color: NAME_TEXT }}>
                {failure.finalHeadline}
              </div>
              <div className="font-mono text-[length:var(--fs-8-5)] tracking-[0.08em]" style={{ color: LABEL_TEXT, marginTop: 3 }}>
                {dateMonth} {headlineCalendarYear} · {dateNote}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-[7px] content-end min-w-0 shrink-0" style={{ width: 240 }}>
            <FailureTile label="YOU PUT IN" value={formatMoney(-record.capitalPutIn)} valueColor={CAUSE_TEXT} />
            <FailureTile label={tileRevenue.label} value={tileRevenue.value} />
            <FailureTile label={tilePeople.label} value={tilePeople.value} />
            <FailureTile label="ROUNDS REFUSED" value={String(failure.roundsRefused)} />
          </div>
        </div>

        {/* the pivot point spans full width — the last thing read before the button */}
        <div className="text-center" style={{ borderTop: `1px solid ${CARD_BORDER}`, borderBottom: `1px solid ${CARD_BORDER}`, marginTop: 14, padding: '13px 0' }}>
          <div className="font-mono text-[length:var(--fs-8-5)] tracking-[0.2em]" style={{ color: KICKER_TEXT }}>
            WHERE IT TURNED
          </div>
          <div className="text-[length:var(--fs-17)] leading-[1.4] mx-auto break-words" style={{ color: NAME_TEXT, maxWidth: '58ch', marginTop: 7 }}>
            {failure.pivotPoint}
          </div>
        </div>

        {/* small and off to the side — this screen is about the loss, not the exit */}
        <div className="flex justify-end" style={{ marginTop: 14 }}>
          <Button variant="primary" size="sm" onClick={onContinue} style={{ width: 240 }}>
            {isLastCompany ? 'See how it ended' : 'Carry on →'}
          </Button>
        </div>
      </div>
    </div>
  );
}

function FailureTile({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <div className="flex flex-col items-center justify-center text-center" style={{ background: TILE_BG, borderRadius: 7, height: 60 }}>
      <div className="font-mono leading-none text-[length:var(--fs-18)]" style={{ color: valueColor ?? NAME_TEXT }}>
        {value}
      </div>
      <div className="font-mono text-[length:var(--fs-8-5)] tracking-[0.1em] mt-1" style={{ color: LABEL_TEXT }}>
        {label}
      </div>
    </div>
  );
}
