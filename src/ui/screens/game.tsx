/**
 * The career screen — one decision per year, the core loop.
 * Two columns: company summary + decision panel (left), the year-by-year
 * ledger (right). Fills the viewport exactly; only the middle/decision
 * panels scroll internally.
 */

import React from 'react';
import type { GameState, EventDef, OptionDef, CharacterTemplate, Climate, EventCategory, YearRecord } from '../../engine/types';
import { formatMoney, formatRunway, formatPercent, truncateAtWord } from '../../engine/format';
import { getClimateChip, getClimateFlavorText } from '../../engine/macro';
import { getFounderShare, COUNTRIES } from '../../engine/state';
import { marketCapFor, founderWorthOnPaper, cashLastsMonths } from '../../engine/economy';
import { companyStatusTag, calendarYear, calendarYearFor, cashLastsTone } from '../../engine/present';
import { dangerState, classifyDeathCause, DEATH_CAUSE_COPY } from '../../engine/failure';
import { renderEventText } from '../../engine/text';
import { Button, Chip, TopBar, StepDots, ValueChip, useMobilePageBottomPadPx } from '../components/ui';
import {
  OptionCard,
  ChosenOptionCard,
  NotTakenRow,
  MentorHint,
  previewOption,
  previewCashAndEquity,
  CategoryIcon,
  type MetricDelta,
} from '../components/event';
import { IconTrendUp, IconPieChart, IconCoins, IconHourglass, IconFlag, IconShuffle, IconPhone } from '../components/icons';
import { CompanyLogoIcon, LOGO_SHAPES } from '../components/icons';
import { useRewardedAd } from '../../ads/useRewardedAd';
import { mixHex, PANEL_HEX, CARD_HEX, EVENT_CATEGORY_COLOUR, eventCategoryOf } from '../theme/colour';
import { useIsMobile } from '../hooks/useIsMobile';
import yearOneEventsForLedger from '../../content/events/year-one.json';
import everydayForLedger from '../../content/events/everyday.json';
import everydayVol3ForLedger from '../../content/events/everyday-vol3.json';
import familyForLedger from '../../content/events/family.json';
import geopoliticalForLedger from '../../content/events/geopolitical.json';
import economicForLedger from '../../content/events/economic.json';
import internalForLedger from '../../content/events/internal.json';
import absurdForLedger from '../../content/events/absurd.json';
import gamblesForLedger from '../../content/events/gambles.json';
import quietYearsForLedger from '../../content/events/quietyears.json';
import postIpoForLedger from '../../content/events/postipo.json';

// Mobile ledger only — YearRecord stores just eventId, not the event's
// category, so a past year's category (for the row's left-edge colour) has
// to be looked up by id. Built once from every content pack a played year
// could possibly have drawn from (mirrors App.tsx's own RANDOM_EVENTS/
// QUIET_YEAR_EVENTS/POST_IPO_EVENTS/YEAR_ONE_* combination), rather than
// threading the whole pool down as a prop just for this lookup.
const EVENT_CATEGORY_BY_ID: Record<string, EventCategory> = {};
for (const e of [
  ...(yearOneEventsForLedger as EventDef[]),
  ...(everydayForLedger as EventDef[]),
  ...(everydayVol3ForLedger as EventDef[]),
  ...(familyForLedger as EventDef[]),
  ...(geopoliticalForLedger as EventDef[]),
  ...(economicForLedger as EventDef[]),
  ...(internalForLedger as EventDef[]),
  ...(absurdForLedger as EventDef[]),
  ...(gamblesForLedger as EventDef[]),
  ...(quietYearsForLedger as EventDef[]),
  ...(postIpoForLedger as EventDef[]),
]) {
  EVENT_CATEGORY_BY_ID[e.id] = eventCategoryOf(e);
}

// The macro chip keeps its own colour treatment, independent of industry —
// gold on frothy (hot money), blue on frozen, green on recovering, neutral
// on cooling (the base climate, nothing notable to flag).
const CLIMATE_CHIP_VARIANT: Record<Climate, 'gold' | 'info' | 'success' | 'default'> = {
  frothy: 'gold',
  frozen: 'info',
  recovering: 'success',
  cooling: 'default',
};

// Page background only — panels/cards keep their own values so contrast is
// preserved. cooling === the plain --bg base; the others shift warm/cold/
// green around it as the macro cycle turns.
const CLIMATE_BG: Record<Climate, string> = {
  frothy: '#14110A',
  cooling: '#0D0F14',
  frozen: '#0A0E16',
  recovering: '#0C1410',
};

// Critical cash danger overrides the climate tint entirely — the same
// "faint colour cast on the whole page" machinery, just red instead of
// whatever the macro cycle would otherwise show. See engine/failure.ts's
// dangerState; this is deliberately independent of Climate so a founder in
// trouble feels it regardless of what the market is doing.
const CRITICAL_BG = '#160B0B';

// The year-transition beat's one line under the year number, shown only
// when the climate actually changed this year (game.tsx's startAdvance).
const CLIMATE_CHANGE_LINE: Record<Climate, string> = {
  frothy: 'Money is flowing again.',
  cooling: 'The market is cooling.',
  frozen: 'Money is freezing.',
  recovering: 'Green shoots are showing.',
};

const DONE_TITLES = ['Sorted for now', 'That is signed', 'Decision made', 'Done and dated', 'The year is set', 'Committed', 'That is that', 'Locked in', 'On the record'];
const DONE_BLURBS = [
  'The other doors closed behind you.',
  'Nobody will ever know what the others were worth.',
  'Whatever the others would have done, they will not do it now.',
  'It looked obvious. It usually does, afterwards.',
  'You will find out whether that was clever in a year or two.',
  'Signed, filed, and impossible to take back.',
  'The year is spent. What happens next is already moving.',
];

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** Counts a displayed number smoothly from its old value to a new one over
 * `durationMs` (climbs, falls, or holds — whichever the actual change is)
 * instead of snapping instantly, the same way REVENUE now behaves on
 * advance. Never animates the first value a target is seen at (a fresh
 * company's starting figure just shows, it doesn't count up from nothing),
 * and respects prefers-reduced-motion by snapping straight to the target. */
function useAnimatedNumber(target: number, durationMs: number): number {
  const [displayed, setDisplayed] = React.useState(target);
  const fromRef = React.useRef(target);
  const rafRef = React.useRef<number | null>(null);

  React.useEffect(() => {
    if (target === fromRef.current) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      fromRef.current = target;
      setDisplayed(target);
      return;
    }
    const from = fromRef.current;
    let start: number | null = null;
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);

    function step(ts: number) {
      if (start === null) start = ts;
      const t = Math.min(1, (ts - start) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplayed(Math.round(from + (target - from) * eased));
      if (t < 1) {
        rafRef.current = requestAnimationFrame(step);
      } else {
        fromRef.current = target;
        rafRef.current = null;
      }
    }
    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [target, durationMs]);

  return displayed;
}

export interface GameScreenProps {
  state: GameState;
  previousState: GameState | null; // state before the pending choice, for computing deltas
  event: EventDef;
  chosenOptionId: string | null;
  gambleResult?: 'won' | 'lost';
  characterPool: CharacterTemplate[];
  onChoose: (optionId: string) => void;
  onAdvance: () => void;
  onLuckyPick: () => void;
  advanceLabel: string;
  canRetire: boolean;
  onRetire: () => void;
}

function computeDeltas(before: GameState, after: GameState): MetricDelta[] {
  const deltas: MetricDelta[] = [];

  const revenueDelta = after.annualRevenue - before.annualRevenue;
  if (revenueDelta !== 0) {
    deltas.push({ label: 'Revenue', value: `${revenueDelta > 0 ? '+' : ''}${formatMoney(revenueDelta)}`, tone: revenueDelta > 0 ? 'positive' : 'negative' });
  }

  const beforeRunway = before.monthlyBurn <= 0 ? Infinity : before.cash / before.monthlyBurn;
  const afterRunway = after.monthlyBurn <= 0 ? Infinity : after.cash / after.monthlyBurn;
  if (isFinite(beforeRunway) && isFinite(afterRunway)) {
    const monthsDelta = Math.round(afterRunway - beforeRunway);
    if (monthsDelta !== 0) deltas.push({ label: 'Cash lasts', value: `${monthsDelta > 0 ? '+' : ''}${monthsDelta} mo`, tone: monthsDelta > 0 ? 'positive' : 'negative' });
  } else if (!isFinite(afterRunway) && isFinite(beforeRunway)) {
    deltas.push({ label: 'Cash lasts', value: 'profitable', tone: 'positive' });
  }

  const shareBefore = getFounderShare(before.capTable);
  const shareAfter = getFounderShare(after.capTable);
  const shareDelta = shareAfter - shareBefore;
  deltas.push({
    label: 'Your share',
    value: Math.abs(shareDelta) < 0.05 ? 'unchanged' : formatPercent(shareAfter, 0),
    tone: Math.abs(shareDelta) < 0.05 ? 'neutral' : shareDelta < 0 ? 'negative' : 'positive',
  });

  return deltas;
}

function outcomeText(option: OptionDef, gambleResult: 'won' | 'lost' | undefined, state: GameState): string {
  const raw = gambleResult && option.gamble ? (gambleResult === 'won' ? option.gamble.winText : option.gamble.loseText) : option.storyHeadline;
  return renderEventText(raw, state);
}

export function GameScreen({
  state,
  previousState,
  event,
  chosenOptionId,
  gambleResult,
  characterPool,
  onChoose,
  onAdvance,
  onLuckyPick,
  advanceLabel,
  canRetire,
  onRetire,
}: GameScreenProps) {
  const isMobile = useIsMobile();
  const pageBottomPad = useMobilePageBottomPadPx();
  const mentorHintAd = useRewardedAd('mentor-hint');
  const [mentorHintRevealed, setMentorHintRevealed] = React.useState(false);
  // A new year's mentor hint is a new rewarded placement — watching last
  // year's ad doesn't pre-unlock this year's.
  React.useEffect(() => {
    setMentorHintRevealed(false);
  }, [event.id]);

  // Mobile only: which of the two panels (decision vs ledger) is showing —
  // desktop shows both side by side and never reads this. Defaults back to
  // the decision every new year, same reasoning as mentorHintRevealed
  // above — "default view is the decision, never the ledger."
  const [mobileTab, setMobileTab] = React.useState<'decision' | 'ledger'>('decision');
  React.useEffect(() => {
    setMobileTab('decision');
  }, [event.id]);
  const mobileScrollRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (chosenOptionId && mobileScrollRef.current) mobileScrollRef.current.scrollTo({ top: 0, behavior: 'smooth' });
  }, [chosenOptionId]);

  // Year-transition beat: fade out (200ms) → year number held (~500ms,
  // background/ledger already reflect the new year underneath) → fade in
  // (250ms). onAdvance() itself fires at the fadeOut→beat boundary, so the
  // ledger's new row and the header's new metrics are already the new
  // state by the time the year number appears — see startAdvance below.
  const [transitionPhase, setTransitionPhase] = React.useState<'idle' | 'fadeOut' | 'beat' | 'fadeIn'>('idle');
  const fromClimateRef = React.useRef<Climate | null>(null);
  const advancedRef = React.useRef(false);
  const timersRef = React.useRef<number[]>([]);

  // The ledger reads newest-at-bottom (chronological), so the current year
  // is what's in view by default — scrolling up reveals past years —
  // instead of making the player scroll down to find where they are.
  const ledgerRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const el = ledgerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [state.year, state.history.length]);

  React.useEffect(() => {
    return () => {
      timersRef.current.forEach((t) => window.clearTimeout(t));
    };
  }, []);

  function skipTransition() {
    if (transitionPhase === 'idle') return;
    timersRef.current.forEach((t) => window.clearTimeout(t));
    timersRef.current = [];
    if (!advancedRef.current) {
      onAdvance();
      advancedRef.current = true;
    }
    setTransitionPhase('idle');
  }

  // Any click or keypress during the transition jumps straight to the new
  // content — returning players will want this. Attached only while
  // transitioning, and only takes effect on the next tick (via the effect
  // below), so the click that started the transition can't self-cancel it.
  React.useEffect(() => {
    if (transitionPhase === 'idle') return;
    window.addEventListener('click', skipTransition);
    window.addEventListener('keydown', skipTransition);
    return () => {
      window.removeEventListener('click', skipTransition);
      window.removeEventListener('keydown', skipTransition);
    };
  }, [transitionPhase]);

  // Desktop-only timing — mobile never calls startAdvance any more (see the
  // layout effect below), so these numbers only ever apply there.
  const fadeOutMs = 200;
  const beatMs = 500;
  const fadeInMs = 250;

  function startAdvance(e?: React.SyntheticEvent) {
    // Stops here so this same click can't bubble to the window-level skip
    // listener the effect above is about to attach — without this, the
    // click that starts the transition immediately cancels it.
    e?.stopPropagation();
    if (transitionPhase !== 'idle') return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      onAdvance();
      return;
    }
    fromClimateRef.current = state.climate;
    advancedRef.current = false;
    setTransitionPhase('fadeOut');
    const t1 = window.setTimeout(() => {
      onAdvance();
      advancedRef.current = true;
      setTransitionPhase('beat');
      const t2 = window.setTimeout(() => {
        setTransitionPhase('fadeIn');
        const t3 = window.setTimeout(() => setTransitionPhase('idle'), fadeInMs);
        timersRef.current.push(t3);
      }, beatMs);
      timersRef.current.push(t2);
    }, fadeOutMs);
    timersRef.current.push(t1);
  }

  // Mobile only — tapping an option advances the underlying state right
  // away (so the header's revenue/cash tiles start ticking toward the new
  // year's numbers immediately), but the event CARD stays frozen on the
  // year just played — the choice just made, highlighted, options that
  // weren't taken greyed out — via this snapshot rather than the live
  // event/chosenOptionId props (which flip to the new year the instant
  // onAdvance runs). Only once the revenue tween (800ms, useAnimatedNumber
  // below) has had time to finish rising or falling does a brief
  // full-screen year stamp cut to black; the snapshot is dropped once that
  // clears, revealing the new year's fresh event underneath — never a
  // moment where the new year's options are visible without either the
  // still frame or the black screen in front of them. Independent of
  // desktop's startAdvance/transitionPhase machinery, which this never
  // touches.
  const [frozenMobile, setFrozenMobile] = React.useState<{
    event: EventDef;
    chosenOptionId: string;
    previousState: GameState | null;
    postChoiceState: GameState;
  } | null>(null);
  const [mobileBeatVisible, setMobileBeatVisible] = React.useState(false);

  React.useLayoutEffect(() => {
    if (!isMobile || !chosenOptionId) return;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!reducedMotion) setFrozenMobile({ event, chosenOptionId, previousState, postChoiceState: state });
    onAdvance();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMobile, chosenOptionId]);

  React.useEffect(() => {
    if (!frozenMobile) return;
    // 800ms for the revenue tween (useAnimatedNumber above) to finish
    // rising or falling, plus a beat of dwell time on the settled number
    // before cutting to black — not the exact instant it stops.
    const t = window.setTimeout(() => setMobileBeatVisible(true), 1200);
    return () => window.clearTimeout(t);
  }, [frozenMobile]);

  React.useEffect(() => {
    if (!mobileBeatVisible) return;
    const t = window.setTimeout(() => {
      setMobileBeatVisible(false);
      setFrozenMobile(null);
    }, 900);
    return () => window.clearTimeout(t);
  }, [mobileBeatVisible]);

  const mobileEvent = frozenMobile ? frozenMobile.event : event;
  const mobileChosenOptionId = frozenMobile ? frozenMobile.chosenOptionId : chosenOptionId;
  const mobilePreviousState = frozenMobile ? frozenMobile.previousState : previousState;
  const mobilePostChoiceState = frozenMobile ? frozenMobile.postChoiceState : state;
  const mobileChosenOption = mobileChosenOptionId ? mobileEvent.options.find((o) => o.id === mobileChosenOptionId) ?? null : null;

  const chosenOption = chosenOptionId ? event.options.find((o) => o.id === chosenOptionId) ?? null : null;
  const mentor = state.cast.find((c) => c.role === 'mentor');
  // The button only appears on events an author actually wrote a hidden
  // cost for — a mentor who always resolves to a generic line isn't
  // insight, it's decoration. No authored hints this year means no button.
  const hasMentorHints = event.options.some((o) => o.mentorHint);
  const colour = state.company.colour;
  const danger = dangerState(state);
  const headerTint = mixHex(PANEL_HEX, colour, 0.12);
  const logoTint = mixHex(PANEL_HEX, colour, 0.4);
  const climateVariant = CLIMATE_CHIP_VARIANT[state.climate];
  const eventCategory = eventCategoryOf(event);
  const categoryColour = EVENT_CATEGORY_COLOUR[eventCategory];
  const categoryTint = mixHex(CARD_HEX, categoryColour, 0.12);
  const displayedRevenue = useAnimatedNumber(state.annualRevenue, 800);

  const mobileEventCategory = eventCategoryOf(mobileEvent);
  const mobileCategoryColour = EVENT_CATEGORY_COLOUR[mobileEventCategory];

  const doneSeed = hashString(`${event.id}-${chosenOptionId ?? ''}`);
  const doneTitle = DONE_TITLES[doneSeed % DONE_TITLES.length];
  const doneBlurb = DONE_BLURBS[doneSeed % DONE_BLURBS.length];

  const mobileDoneSeed = hashString(`${mobileEvent.id}-${mobileChosenOptionId ?? ''}`);
  const mobileDoneTitle = DONE_TITLES[mobileDoneSeed % DONE_TITLES.length];
  const mobileDoneBlurb = DONE_BLURBS[mobileDoneSeed % DONE_BLURBS.length];

  const optionCols = event.options.length === 2 ? 'grid-cols-2' : event.options.length >= 3 ? 'grid-cols-3' : 'grid-cols-1';

  const contentStyle: React.CSSProperties =
    transitionPhase === 'fadeOut'
      ? { opacity: 0, transition: `opacity ${fadeOutMs}ms ease` }
      : transitionPhase === 'beat'
        ? { opacity: 0 }
        : transitionPhase === 'fadeIn'
          ? { opacity: 1, transition: `opacity ${fadeInMs}ms ease` }
          : { opacity: 1 };
  const climateChangedThisBeat = transitionPhase === 'beat' && fromClimateRef.current !== null && state.climate !== fromClimateRef.current;

  if (isMobile) {
    const bgColor = danger === 'critical' ? CRITICAL_BG : CLIMATE_BG[state.climate];
    const metrics = state.publicCompany ? (
      <>
        <MobileMetricTile label="MARKET CAP" value={formatMoney(marketCapFor(state.publicCompany))} tileTone="blue" />
        <MobileMetricTile label="REVENUE" value={formatMoney(displayedRevenue)} tileTone="blue" />
        <MobileMetricTile label="SHARE" value={formatPercent(getFounderShare(state.capTable), 0)} tileTone="green" />
        <MobileMetricTile label="ON PAPER" value={formatMoney(founderWorthOnPaper(state))} tileTone="gold" />
      </>
    ) : (
      <>
        <MobileMetricTile label="RAISED" value={formatMoney(state.history.reduce((s, h) => s + (h.funding?.amount ?? 0), 0))} tileTone="violet" />
        <MobileMetricTile label="REVENUE" value={formatMoney(displayedRevenue)} tileTone="blue" />
        <MobileMetricTile
          label="CASH LASTS"
          value={`${formatRunway(state.cash, state.monthlyBurn)}`}
          tileTone={cashLastsTone(state) === 'negative' ? 'red' : cashLastsTone(state) === 'warning' ? 'amber' : 'green'}
          valueWarn={cashLastsTone(state) === 'negative' || cashLastsTone(state) === 'warning'}
          pulse={danger === 'critical'}
        />
        <MobileMetricTile label="SHARE" value={formatPercent(getFounderShare(state.capTable), 0)} tileTone="green" />
      </>
    );

    return (
      <div className="mobile-shell h-full flex flex-col text-ink overflow-hidden" style={{ backgroundColor: bgColor }}>
        <TopBar
          right={
            <Chip label={String(calendarYear(state))} variant="accent">
              · YEAR {state.foundedCareerYear + state.year - 1}
            </Chip>
          }
        />

        {/* Fixed header, ~144px: row1 logo/name/climate (48px), row2 tags —
            horizontally scrollable, never wraps (30px), row3 metrics as one
            row of four, not 2x2 (64px). No FOUNDED BY tag on mobile — the
            founder's name already appears on the scorecard and the failure
            screen; three tags fit this row comfortably where four didn't. */}
        <div className="shrink-0" style={{ backgroundColor: headerTint, borderTop: `3px solid ${colour}` }}>
          <div className="h-12 px-3 flex items-center gap-2.5">
            <div className="w-9 h-9 shrink-0 rounded-[10px] flex items-center justify-center" style={{ backgroundColor: logoTint, color: colour }}>
              <CompanyLogoIcon shape={LOGO_SHAPES[state.company.logoIndex] ?? 'circle'} className="w-[18px] h-[18px]" />
            </div>
            <div className="flex-1 min-w-0 text-[16px] font-extrabold tracking-[-0.02em] leading-tight truncate text-white">{state.company.name}</div>
            <Chip label={getClimateChip(state.climate)} variant={climateVariant} />
          </div>
          <div className="h-[30px] px-3 flex items-center gap-1.5 overflow-x-auto hide-scrollbar">
            <Chip label={(COUNTRIES[state.founder.country]?.name ?? state.founder.country).toUpperCase()} variant="info" />
            <Chip label={state.company.industry.toUpperCase()} variant="accent" style={{ backgroundColor: colour + '20', color: colour }} />
            <Chip label={companyStatusTag(state)} variant={danger === 'serious' || danger === 'critical' ? 'error' : 'success'} />
          </div>
          <div className={`grid gap-1.5 px-3 ${state.publicCompany ? 'grid-cols-4' : 'grid-cols-[1fr_1fr_1.4fr_1fr]'}`} style={{ height: 64, paddingBottom: 8 }}>
            {metrics}
          </div>
        </div>

        {/* Segmented control — decision vs ledger, default decision, 40px */}
        <div className="shrink-0 flex border-b border-hairline">
          {(['decision', 'ledger'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setMobileTab(tab)}
              className="flex-1 h-10 text-center font-mono text-[11px] tracking-[0.12em]"
              style={{
                color: mobileTab === tab ? '#FFFFFF' : '#6E7A8E',
                borderBottom: mobileTab === tab ? `2px solid ${colour}` : '2px solid transparent',
              }}
            >
              {tab === 'decision' ? 'DECISION' : 'LEDGER'}
            </button>
          ))}
        </div>

        {/* Below the fixed header/tabs: the ledger tab gets its own sticky
            summary (never scrolls) above an independently-scrolling year
            list; the decision tab is a single scrolling "story feed". No
            fixed action bar on the decision tab any more — choosing an
            option advances straight to the next year on its own (the
            layout effect above), so there's nothing here to tap through. */}
        {mobileTab === 'ledger' ? (
          <div
            className="flex-1 min-h-0 flex flex-col px-3"
            style={{ paddingTop: 12, paddingBottom: `calc(${pageBottomPad}px + env(safe-area-inset-bottom))` }}
          >
            <MobileLedgerSummary state={state} />
            <div className="flex-1 min-h-0 overflow-y-auto">
              <MobileLedgerRows state={state} />
            </div>
          </div>
        ) : (
          <div
            ref={mobileScrollRef}
            className="flex-1 min-h-0 overflow-y-auto px-3"
            style={{
              paddingTop: 12,
              paddingBottom: `calc(${pageBottomPad}px + env(safe-area-inset-bottom))`,
            }}
          >
            <div style={contentStyle}>
              {danger === 'critical' && (
                <div
                  className="mb-2.5 px-3 py-2 font-mono text-[12px] font-bold"
                  style={{ backgroundColor: 'rgba(192,57,43,0.16)', border: '1px solid rgba(192,57,43,0.5)', borderRadius: 10, color: '#E67E73' }}
                >
                  {Math.max(0, Math.floor(cashLastsMonths(state)))} months of cash left.
                </div>
              )}
              <div className="font-mono text-[10px] font-bold tracking-[0.12em] mb-1.5" style={{ color: mobileCategoryColour }}>
                {mobileEventCategory.toUpperCase()}
              </div>
              <div className="text-[20px] font-extrabold tracking-[-0.02em] leading-tight break-words mb-1.5">
                {mobileChosenOption ? mobileDoneTitle : renderEventText(mobileEvent.headline, state)}
              </div>
              <p className="text-[15px] text-ink4 leading-[1.45] break-words mb-3">
                {mobileChosenOption ? mobileDoneBlurb : renderEventText(mobileEvent.body, state)}
                {!mobileChosenOption && <span className="text-ink6"> {getClimateFlavorText(state.climate)}</span>}
              </p>

              {!mobileChosenOption ? (
                <div className="flex flex-col gap-2">
                  {mobileEvent.options.map((option) => (
                    <MobileOptionCard
                      key={option.id}
                      option={option}
                      state={mobilePreviousState ?? state}
                      characterPool={characterPool}
                      industryColour={colour}
                      onChoose={() => onChoose(option.id)}
                      mentorHint={mentorHintRevealed && option.mentorHint ? renderEventText(option.mentorHint, state) : undefined}
                    />
                  ))}
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {mobileEvent.options.map((option) =>
                    option.id === mobileChosenOption.id ? (
                      <MobileChosenOptionCard
                        key={option.id}
                        option={option}
                        state={mobilePostChoiceState}
                        characterPool={characterPool}
                        industryColour={colour}
                        outcomeText={outcomeText(option, gambleResult, mobilePostChoiceState)}
                        deltas={mobilePreviousState ? computeDeltas(mobilePreviousState, mobilePostChoiceState) : []}
                        gambleResult={gambleResult}
                      />
                    ) : null
                  )}
                  {mobileEvent.options
                    .filter((o) => o.id !== mobileChosenOption.id)
                    .map((o) => (
                      <NotTakenRow key={o.id} label={renderEventText(o.label, mobilePostChoiceState)} />
                    ))}
                </div>
              )}

              {!mobileChosenOption && mobileEvent.options.length > 1 && (
                <div className="mt-3 flex justify-center">
                  <button onClick={onLuckyPick} className="text-[13px] font-mono text-ink6 flex items-center gap-1.5" style={{ minHeight: 44 }}>
                    <IconShuffle className="w-3.5 h-3.5" />
                    I'm feeling lucky — pick for me
                  </button>
                </div>
              )}

              {mentor && hasMentorHints && !mobileChosenOption && (
                <div className="mt-3">
                  <MentorHint
                    mentor={mentor}
                    revealed={mentorHintRevealed}
                    loading={mentorHintAd.loading}
                    onCall={() => mentorHintAd.watch(() => setMentorHintRevealed(true))}
                  />
                </div>
              )}

              {canRetire && !mobileChosenOption && (
                <div className="mt-4 flex justify-center">
                  <button onClick={onRetire} className="text-[13px] font-mono text-ink6 underline underline-offset-4" style={{ minHeight: 44 }}>
                    Retire now and cash out
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {mobileBeatVisible && (
          <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 px-10 animate-yearBeatIn" style={{ backgroundColor: bgColor }}>
            <div className="text-white font-mono font-extrabold leading-none" style={{ fontSize: 64 }}>
              {calendarYear(state)}
            </div>
            <div className="text-[15px] text-ink3 text-center leading-snug max-w-[280px]">{renderEventText(event.headline, state)}</div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col climate-bg text-ink overflow-hidden" style={{ backgroundColor: danger === 'critical' ? CRITICAL_BG : CLIMATE_BG[state.climate] }}>
      <TopBar right={<StepDots steps={['FOUNDER', 'PORTRAIT', 'IDEA', 'NAME', 'FUND']} activeIndex={4} />} />

      <div className="flex-1 min-h-0 grid grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] gap-[var(--sp-14)] px-[var(--sp-24)] pt-[var(--sp-14)] pb-[var(--sp-16)] items-start">
        {/* Left column: company summary + decision panel */}
        <div className="flex flex-col gap-[var(--sp-12)] min-h-0 max-h-full">
          {(danger === 'serious' || danger === 'critical') && (
            <div className="shrink-0 h-[2px] rounded-full" style={{ backgroundColor: '#C0392B' }} />
          )}
          <div
            className="shrink-0 border border-line overflow-hidden"
            style={{ borderTopWidth: 3, borderTopColor: colour, backgroundColor: headerTint, borderRadius: '0 0 12px 12px' }}
          >
            <div className="px-[var(--sp-16)] pt-[var(--sp-13)] pb-[var(--sp-11)] flex items-center gap-[var(--sp-14)]">
              <div className="w-12 h-12 shrink-0 rounded-[13px] flex items-center justify-center" style={{ backgroundColor: logoTint, color: colour }}>
                <CompanyLogoIcon shape={LOGO_SHAPES[state.company.logoIndex] ?? 'circle'} className="w-[22px] h-[22px]" />
              </div>
              <div className="flex-1 min-w-0 flex flex-col gap-1.5">
                <div className="text-[length:var(--fs-22)] font-extrabold tracking-[-0.03em] leading-none truncate text-white">{state.company.name}</div>
                <div className="flex gap-1.5 flex-wrap">
                  <Chip label={(COUNTRIES[state.founder.country]?.name ?? state.founder.country).toUpperCase()} variant="info" />
                  <Chip label={state.company.industry.toUpperCase()} variant="accent" style={{ backgroundColor: colour + '20', color: colour }} />
                  <Chip label={companyStatusTag(state)} variant={danger === 'serious' || danger === 'critical' ? 'error' : 'success'} />
                  <Chip label={`FOUNDED BY ${state.founder.name.toUpperCase()}`} />
                </div>
              </div>
              <div className="shrink-0 flex flex-col items-end gap-2">
                <Chip label={getClimateChip(state.climate)} variant={climateVariant} />
                <div className="text-[length:var(--fs-23)] font-extrabold leading-none font-mono" style={{ color: colour }}>{calendarYear(state)}</div>
              </div>
            </div>
            <div className="grid grid-cols-4 gap-2 px-[var(--sp-12)] pb-[var(--sp-12)] pt-1">
              {state.publicCompany ? (
                <>
                  <MetricCell icon={<IconCoins className="w-3.5 h-3.5" />} label="MARKET CAP" value={formatMoney(marketCapFor(state.publicCompany))} tileTone="blue" />
                  <MetricCell icon={<IconTrendUp className="w-3.5 h-3.5" />} label="REVENUE" value={formatMoney(displayedRevenue)} tileTone="blue" />
                  <MetricCell icon={<IconPieChart className="w-3.5 h-3.5" />} label="YOUR SHARE" value={formatPercent(getFounderShare(state.capTable), 0)} tileTone="green" />
                  <MetricCell icon={<IconHourglass className="w-3.5 h-3.5" />} label="WORTH ON PAPER" value={formatMoney(founderWorthOnPaper(state))} tileTone="gold" />
                </>
              ) : (
                <>
                  <MetricCell icon={<IconCoins className="w-3.5 h-3.5" />} label="RAISED" value={formatMoney(state.history.reduce((s, h) => s + (h.funding?.amount ?? 0), 0))} tileTone="violet" />
                  <MetricCell icon={<IconTrendUp className="w-3.5 h-3.5" />} label="REVENUE" value={formatMoney(displayedRevenue)} tileTone="blue" />
                  <MetricCell
                    icon={<IconHourglass className="w-3.5 h-3.5" />}
                    label="CASH LASTS"
                    value={`${formatRunway(state.cash, state.monthlyBurn)}`}
                    tileTone={cashLastsTone(state) === 'negative' ? 'red' : cashLastsTone(state) === 'warning' ? 'amber' : 'green'}
                    valueWarn={cashLastsTone(state) === 'negative' || cashLastsTone(state) === 'warning'}
                    pulse={danger === 'critical'}
                  />
                  <MetricCell icon={<IconPieChart className="w-3.5 h-3.5" />} label="YOUR SHARE" value={formatPercent(getFounderShare(state.capTable), 0)} tileTone="green" />
                </>
              )}
            </div>
          </div>

          {danger === 'critical' && (
            <div
              className="shrink-0 px-[var(--sp-14)] py-[var(--sp-9)] font-mono text-[length:var(--fs-12)] font-bold tracking-[0.02em]"
              style={{ backgroundColor: 'rgba(192,57,43,0.16)', border: '1px solid rgba(192,57,43,0.5)', borderRadius: 'var(--r-12)', color: '#E67E73' }}
            >
              {Math.max(0, Math.floor(cashLastsMonths(state)))} months of cash left.
            </div>
          )}

          <div
            className="relative min-h-[320px] max-h-full border border-line p-[var(--sp-16)] flex flex-col"
            style={{
              borderLeftWidth: 3,
              borderLeftColor: categoryColour,
              borderRadius: '0 12px 12px 0',
              backgroundColor: categoryTint,
            }}
          >
            <div className="min-h-0 flex flex-col" style={contentStyle}>
            <div
              className="font-mono text-[length:var(--fs-9)] font-bold tracking-[0.12em] mb-1.5"
              style={{ color: categoryColour }}
            >
              {eventCategory.toUpperCase()}
            </div>
            <div className="text-[length:var(--fs-22)] font-extrabold tracking-[-0.02em] leading-tight break-words">
              {chosenOption ? doneTitle : renderEventText(event.headline, state)}
            </div>
            <p className="text-[length:var(--fs-13)] text-ink4 leading-[1.45] mt-1 break-words" style={{ maxWidth: '60ch' }}>
              {chosenOption ? doneBlurb : renderEventText(event.body, state)}
              {!chosenOption && <span className="text-ink6"> {getClimateFlavorText(state.climate)}</span>}
            </p>

            <div className="flex-1 min-h-0 overflow-y-auto mt-2.5">
              {!chosenOption ? (
                <div className={`grid gap-2.5 ${optionCols}`}>
                  {event.options.map((option) => (
                    <OptionCard
                      key={option.id}
                      option={option}
                      state={previousState ?? state}
                      characterPool={characterPool}
                      industryColour={colour}
                      onChoose={() => onChoose(option.id)}
                      mentorHint={mentorHintRevealed && option.mentorHint ? renderEventText(option.mentorHint, state) : undefined}
                    />
                  ))}
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {event.options.map((option) =>
                    option.id === chosenOption.id ? (
                      <ChosenOptionCard
                        key={option.id}
                        option={option}
                        state={state}
                        characterPool={characterPool}
                        industryColour={colour}
                        outcomeText={outcomeText(option, gambleResult, state)}
                        deltas={previousState ? computeDeltas(previousState, state) : []}
                        gambleResult={gambleResult}
                      />
                    ) : null
                  )}
                  {event.options
                    .filter((o) => o.id !== chosenOption.id)
                    .map((o) => (
                      <NotTakenRow key={o.id} label={renderEventText(o.label, state)} />
                    ))}
                </div>
              )}
            </div>

            {!chosenOption && event.options.length > 1 && (
              <div className="shrink-0 mt-2 flex justify-center">
                <button
                  onClick={onLuckyPick}
                  className="text-[length:var(--fs-12)] font-mono text-ink6 hover:text-ink3 transition-colors flex items-center gap-1.5"
                >
                  <IconShuffle className="w-3.5 h-3.5" />
                  I'm feeling lucky — pick for me
                </button>
              </div>
            )}

            {mentor && hasMentorHints && !chosenOption && (
              <div className="shrink-0 mt-2.5">
                <MentorHint
                  mentor={mentor}
                  revealed={mentorHintRevealed}
                  loading={mentorHintAd.loading}
                  onCall={() => mentorHintAd.watch(() => setMentorHintRevealed(true))}
                />
              </div>
            )}

            {chosenOption && (
              <div className="shrink-0 mt-2.5">
                <Button variant="primary" size="lg" onClick={startAdvance} className="w-full text-[length:var(--fs-16)]">
                  {advanceLabel} →
                </Button>
              </div>
            )}
            </div>

            {transitionPhase === 'beat' && (
              <div className="absolute inset-0 flex flex-col items-center justify-center animate-yearBeatIn">
                <div className="text-white font-mono font-extrabold leading-none" style={{ fontSize: 96 }}>
                  {calendarYear(state)}
                </div>
                {climateChangedThisBeat && <div className="mt-[var(--sp-12)] text-[length:var(--fs-14)] text-ink3">{CLIMATE_CHANGE_LINE[state.climate]}</div>}
              </div>
            )}
          </div>
        </div>

        {/* Middle column: information panel */}
        <div className="min-h-[320px] max-h-full rounded-[var(--r-16)] bg-panel2 border border-line overflow-hidden flex flex-col">
          {/* Pinned above the scroll area — "Every year so far" and the column
              labels stay visible no matter how far down the rows are scrolled. */}
          <LedgerHeader state={state} />
          <div ref={ledgerRef} className="flex-1 min-h-0 overflow-y-auto px-[var(--sp-18)] pb-[var(--sp-18)] flex flex-col">
            {/* my-auto centres this block when it's shorter than the panel; once
                it's taller, auto margins resolve to 0 and it just scrolls normally
                — unlike justify-center, which leaves the scroll position ambiguous
                once content overflows. */}
            <div className="w-full my-auto">
              <LedgerRows state={state} />
            </div>
          </div>
        </div>
      </div>

      {canRetire && (
        <div className="fixed bottom-4 right-6">
          <button onClick={onRetire} className="text-[length:var(--fs-12)] font-mono text-ink6 hover:text-ink3 underline underline-offset-4">
            Retire now and cash out
          </button>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Middle-panel tab
// ============================================================================

/** Small colour-coded sign showing whether revenue moved vs the previous
 * row — green up, red down, grey unchanged (or nothing before it). This is
 * the per-row confirmation that REVENUE is a snapshot of that year, not a
 * repeated running total: a flat column of identical signs would mean the
 * bug is back. */
function RevenueDelta({ current, previous }: { current: number; previous: number | null }) {
  if (previous === null) return null;
  const delta = current - previous;
  if (Math.abs(delta) < 1) return <span className="text-ink6">·</span>;
  return <span className={delta > 0 ? 'text-positive' : 'text-negative'}>{delta > 0 ? '▲' : '▼'}</span>;
}

function LedgerHeader({ state }: { state: GameState }) {
  return (
    <div className="shrink-0 px-[var(--sp-18)] pt-[var(--sp-18)]">
      <div className="flex items-center justify-between mb-[var(--sp-12)]">
        <h3 className="font-extrabold text-[length:var(--fs-19)]">Every year so far</h3>
        <span className="font-mono text-[length:var(--fs-11)] tracking-[0.1em] text-ink5">YEAR {state.foundedCareerYear + state.year - 1}</span>
      </div>
      <div className="grid grid-cols-[minmax(36px,0.5fr)_3fr_minmax(0,0.75fr)_minmax(0,0.85fr)_minmax(0,0.65fr)] gap-x-2 px-1 py-1.5 font-mono text-[length:var(--fs-10)] tracking-[0.13em] text-ink6 border-t border-line">
        <div className="truncate">YEAR</div>
        <div className="truncate">WHAT HAPPENED</div>
        <div className="text-right truncate">RAISED</div>
        <div className="text-right truncate">REVENUE</div>
        <div className="text-right truncate">GAVE UP</div>
      </div>
    </div>
  );
}

function LedgerRows({ state }: { state: GameState }) {
  const totalRaised = state.history.reduce((s, h) => s + (h.funding?.amount ?? 0), 0);
  return (
    <div>
      {state.history.length === 0 ? (
        <p className="text-[length:var(--fs-14)] text-ink5 py-[var(--sp-16)]">The ledger fills in as the years pass.</p>
      ) : (
        <div className="flex flex-col">
          {state.history.map((h, i) => {
            // The death year gets its own red row reading the cause — only
            // ever the last row, and only once the company has actually
            // ended this way (h.endingType is set by game.ts's
            // processPlayerChoice at the moment insolvency actually lands).
            const isDeathRow = i === state.history.length - 1 && state.status === 'ended' && h.endingType === 'failure';
            const cause = isDeathRow ? classifyDeathCause(state) : null;
            return (
            <div
              key={`${h.year}-${h.eventId}`}
              className="grid grid-cols-[minmax(36px,0.5fr)_3fr_minmax(0,0.75fr)_minmax(0,0.85fr)_minmax(0,0.65fr)] gap-x-2 items-center px-1 py-2.5 border-b border-[#14161C] animate-ledgerRowIn"
              style={isDeathRow ? { backgroundColor: 'rgba(192,57,43,0.1)' } : undefined}
            >
              <div
                className={`min-w-[38px] text-center rounded-lg font-extrabold text-[length:var(--fs-14)] py-1.5 ${isDeathRow ? '' : 'bg-field text-ink3'}`}
                style={isDeathRow ? { backgroundColor: 'rgba(192,57,43,0.22)', color: '#E67E73' } : undefined}
              >
                {calendarYearFor(state.foundedCalendarYear, h.year)}
              </div>
              <div className="flex items-center gap-2.5 pl-2.5 min-w-0">
                {h.funding ? <IconTrendUp className="w-[15px] h-[15px] text-ink4 shrink-0" /> : <IconFlag className="w-[15px] h-[15px] text-ink6 shrink-0" />}
                <div className="min-w-0">
                  <div className={`font-bold text-[length:var(--fs-14)] truncate ${isDeathRow ? 'text-[#E67E73]' : ''}`}>{h.optionLabel}</div>
                  <div className="font-mono text-[length:var(--fs-9)] tracking-[0.08em] truncate" style={{ color: isDeathRow ? '#B5665F' : undefined }}>
                    {cause ? DEATH_CAUSE_COPY[cause].statement(state) : (h.tag ?? '—')}
                  </div>
                </div>
              </div>
              <div className="text-right font-mono text-[length:var(--fs-12)] text-ink3">{h.funding ? formatMoney(h.funding.amount) : '—'}</div>
              <div className="text-right font-mono text-[length:var(--fs-12)] text-ink3 flex items-center justify-end gap-1.5">
                <RevenueDelta current={h.annualRevenue} previous={i > 0 ? state.history[i - 1].annualRevenue : null} />
                {formatMoney(h.annualRevenue)}
              </div>
              <div className={`text-right font-mono text-[length:var(--fs-12)] ${h.funding ? 'text-negative' : 'text-ink3'}`}>
                {h.funding ? `-${Math.max(0, h.funding.founderShareBefore - h.funding.founderShareAfter).toFixed(0)}%` : '—'}
              </div>
            </div>
            );
          })}
          <div className="flex items-center justify-between pt-[var(--sp-12)] mt-1 border-t border-line">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-[10px] bg-field flex items-center justify-center">
                <IconFlag className="w-4 h-4 text-ink3" />
              </div>
              <span className="font-bold text-[length:var(--fs-15)] text-ink3">Total so far</span>
            </div>
            <div className="flex gap-[var(--sp-16)] font-mono text-[length:var(--fs-12)] text-ink3">
              <span>RAISED {formatMoney(totalRaised)}</span>
              <span>REVENUE {formatMoney(state.annualRevenue)}</span>
              <span>YOURS {formatPercent(getFounderShare(state.capTable), 0)}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Mobile-only option cards — compact enough (~100px, per spec's decision-
// screen budget) to stack full width instead of sitting in the 2/3-column
// desktop grid. Reuses the exact same preview/pricing helpers OptionCard/
// ChosenOptionCard use (event.tsx's previewOption/previewCashAndEquity/
// CategoryIcon) so the numbers shown here can never drift from what
// choosing the option actually does — only the JSX chrome around them
// differs. Drops the kicker row, the named-investor portrait row, and
// gamble odds rows the desktop card shows; the detail text is a single
// ellipsized line that expands in place on tap (its own tap target, so it
// doesn't fire onChoose — choosing the option is any other tap on the card).
// ============================================================================

// One line at 13px in a ~350px-wide card comfortably holds about this many
// characters — used to truncate at a word boundary (never mid-word) rather
// than relying on CSS text-overflow:ellipsis, which clips by pixel width
// wherever a glyph happens to land.
const MOBILE_OPTION_DETAIL_CHAR_BUDGET = 46;

function MobileOptionCard({
  option,
  state,
  characterPool,
  industryColour,
  onChoose,
  mentorHint,
}: {
  option: OptionDef;
  state: GameState;
  characterPool: CharacterTemplate[];
  industryColour: string;
  onChoose: () => void;
  mentorHint?: string;
}) {
  const preview = previewOption(option, state, characterPool);
  const founderShare = getFounderShare(state.capTable);
  const cashEquity = preview.kind === 'plain' ? previewCashAndEquity(option, state) : null;
  const equityChanged = cashEquity !== null && Math.abs(cashEquity.founderShareAfter - founderShare) >= 0.5;
  const title = preview.kind === 'funding' ? (preview.lead.firm ?? preview.lead.fullName) : renderEventText(option.label, state);
  const [expanded, setExpanded] = React.useState(false);
  const detail = renderEventText(option.detail, state);
  const truncatedDetail = truncateAtWord(detail, MOBILE_OPTION_DETAIL_CHAR_BUDGET);
  const canExpand = truncatedDetail !== detail;

  return (
    <div
      onClick={onChoose}
      className="rounded-2xl bg-field border border-lineStrong active:border-accent transition-colors px-3 py-3 flex flex-col gap-1.5 cursor-pointer"
    >
      <div className="flex items-center gap-2 min-w-0">
        <CategoryIcon icon={option.icon} colour={industryColour} />
        <div className="flex-1 min-w-0 text-[16px] font-extrabold leading-tight break-words">{title}</div>
      </div>
      {/* The card itself always chooses the option on tap — that's the
          ~25x/run primary action. Expanding the truncated description is a
          separate, small tap target (the chevron) so reaching for the text
          never accidentally eats the tap meant to choose. Truncation
          breaks at the last full word (truncateAtWord), never mid-word. */}
      <div className="flex items-start gap-1.5 min-w-0">
        <p className="flex-1 min-w-0 text-[13px] text-ink4 leading-[1.4] break-words">{expanded ? detail : truncatedDetail}</p>
        {canExpand && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setExpanded((v) => !v);
            }}
            aria-label={expanded ? 'Show less' : 'Show more'}
            className="shrink-0 text-ink5"
            style={{ width: 20, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ transform: expanded ? 'rotate(180deg)' : undefined }}>
              <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}
      </div>
      {mentorHint && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="flex items-start gap-2 bg-cautionBg border border-cautionBorder rounded-[9px] px-2.5 py-2"
        >
          <IconPhone className="w-3.5 h-3.5 text-caution shrink-0 mt-[1px]" />
          <p className="text-[12px] text-ink2 leading-[1.4]">{mentorHint}</p>
        </div>
      )}
      <div className="flex gap-1.5 flex-wrap pt-0.5">
        {preview.kind === 'funding' ? (
          <>
            <ValueChip label={`+${formatMoney(preview.amount)}`} tone="warning" />
            <ValueChip label={`you give ${formatPercent(preview.investorPct, 0)}`} tone="positive" />
          </>
        ) : (
          <>
            <ValueChip
              label={cashEquity && cashEquity.cashDelta !== 0 ? `${cashEquity.cashDelta > 0 ? '+' : '-'}${formatMoney(Math.abs(cashEquity.cashDelta))}` : 'no cash'}
              tone={cashEquity && cashEquity.cashDelta < 0 ? 'warning' : 'default'}
            />
            {equityChanged && cashEquity ? (
              <ValueChip
                label={`${cashEquity.founderShareAfter < founderShare ? 'give up' : 'gain'} ${formatPercent(Math.abs(cashEquity.founderShareAfter - founderShare), 0)}`}
                tone={cashEquity.founderShareAfter < founderShare ? 'negative' : 'positive'}
              />
            ) : (
              <ValueChip label={`keep ${formatPercent(founderShare, 0)}`} tone="positive" />
            )}
          </>
        )}
      </div>
    </div>
  );
}

function MobileChosenOptionCard({
  option,
  state,
  characterPool,
  industryColour,
  outcomeText,
  deltas,
  gambleResult,
}: {
  option: OptionDef;
  state: GameState;
  characterPool: CharacterTemplate[];
  industryColour: string;
  outcomeText: string;
  deltas: MetricDelta[];
  gambleResult?: 'won' | 'lost';
}) {
  const preview = previewOption(option, state, characterPool);
  const name = preview.kind === 'funding' ? (preview.lead.firm ?? preview.lead.fullName) : renderEventText(option.label, state);

  return (
    <div className="rounded-2xl bg-cardRaised border border-accent px-3 py-3 flex flex-col gap-2">
      <div className="flex items-center gap-2 min-w-0">
        <CategoryIcon icon={option.icon} colour={industryColour} />
        <div className="flex-1 min-w-0 text-[17px] font-extrabold leading-tight break-words">{name}</div>
      </div>
      {gambleResult && (
        <div className={`font-mono text-[11px] font-bold tracking-[0.14em] ${gambleResult === 'won' ? 'text-positive' : 'text-negative'}`}>
          {gambleResult === 'won' ? 'THE BET PAID' : 'THE BET MISSED'}
        </div>
      )}
      <p className="text-[14px] text-ink2 leading-[1.5] break-words border-t border-line pt-2">{outcomeText}</p>
      <div className="flex flex-wrap gap-1.5">
        {deltas.map((d) => (
          <div key={d.label} className="bg-fieldRaised rounded-[7px] px-2.5 py-1.5 flex items-center gap-1.5">
            <span className="font-mono text-[10px] tracking-[0.1em] text-ink5">{d.label.toUpperCase()}</span>
            <span className={`font-mono text-[13px] font-bold ${d.tone === 'positive' ? 'text-positive' : d.tone === 'negative' ? 'text-negative' : 'text-ink3'}`}>{d.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================================
// Mobile-only ledger — the desktop ledger's 5-column grid
// (minmax(36px,0.5fr)_3fr_...) can't work at 390px. A sticky summary block
// sits above an independently-scrolling year list, newest year first so the
// latest entry is always visible without scrolling.
//
// The summary leads with a revenue sparkline — the one chart in the whole
// product — so the trajectory (slow start, acceleration, the bad year) is
// visible at a glance, something a table of numbers can't do. Below it,
// REVENUE / YOUR SHARE / PEAK replace the old RAISED/GAVE UP totals, which
// read $0/0% forever on a bootstrapped run; RAISED only reappears once it's
// actually nonzero.
//
// Rows are single-line (40px, not the old three-line 104px) and read the
// event's own headline, not the option chosen — h.optionLabel used to sit
// where the question belongs, which is meaningless out of context ("Yes"
// answers what?). Tapping a row expands it to reveal the option actually
// chosen plus that year's metric deltas. A category-coloured left edge
// (looked up via EVENT_CATEGORY_BY_ID, since YearRecord only stores
// eventId) gives the list rhythm; notable years (the death row, a sharp
// staff cut, a steep revenue drop) get a tinted background so they're
// findable while scrolling back through a long career. The right-hand
// figure isn't always revenue — funding raised or a staff swing can be the
// more informative number for that particular year.
// ============================================================================

const SPARKLINE_W = 330;
const SPARKLINE_H = 52;
const SPARKLINE_TOP_PAD = 5;
const SPARKLINE_BOTTOM_PAD = 4;

function sparklinePoints(values: number[]): { x: number; y: number }[] {
  if (values.length === 0) return [];
  const max = Math.max(...values);
  const min = Math.min(0, ...values);
  const range = Math.max(max - min, 1);
  const plotH = SPARKLINE_H - SPARKLINE_TOP_PAD - SPARKLINE_BOTTOM_PAD;
  return values.map((v, i) => ({
    x: values.length > 1 ? (i / (values.length - 1)) * SPARKLINE_W : SPARKLINE_W / 2,
    y: SPARKLINE_TOP_PAD + plotH - ((v - min) / range) * plotH,
  }));
}

/** The single most notable year in the run so far, for the sparkline's
 * dashed marker — the death year if the company failed, otherwise whichever
 * is sharper: the worst one-year staff cut or the worst one-year revenue
 * drop. Returns null for a run with nothing bad in it yet — an unbroken
 * climb doesn't need a manufactured low point. */
function findNotableYear(history: YearRecord[], state: GameState): { index: number; label: string } | null {
  if (history.length === 0) return null;
  const isDeathRun = state.status === 'ended' && history[history.length - 1]?.endingType === 'failure';
  if (isDeathRun) return { index: history.length - 1, label: 'FAILED' };

  let worstStaffCut = { index: -1, delta: 0 };
  let worstRevenueDrop = { index: -1, delta: 0 };
  for (let i = 1; i < history.length; i++) {
    const staffDelta = history[i].staff - history[i - 1].staff;
    if (staffDelta < worstStaffCut.delta) worstStaffCut = { index: i, delta: staffDelta };
    const revenueDelta = history[i].annualRevenue - history[i - 1].annualRevenue;
    if (revenueDelta < worstRevenueDrop.delta) worstRevenueDrop = { index: i, delta: revenueDelta };
  }
  if (worstStaffCut.index >= 0 && worstStaffCut.delta <= -3) {
    return { index: worstStaffCut.index, label: `CUT ${Math.abs(worstStaffCut.delta)} STAFF` };
  }
  if (worstRevenueDrop.index >= 0 && worstRevenueDrop.delta < 0) {
    return { index: worstRevenueDrop.index, label: 'REVENUE DROP' };
  }
  return null;
}

/** Evenly spaced indices into a `length`-long array for x-axis tick labels
 * — always includes the first and last point, up to `maxCount` total, so a
 * long career gets real orientation markers along the way instead of just
 * the two endpoints. */
function pickAxisTicks(length: number, maxCount: number): number[] {
  if (length <= maxCount) return Array.from({ length }, (_, i) => i);
  const ticks = new Set<number>();
  for (let k = 0; k < maxCount; k++) {
    ticks.add(Math.round((k / (maxCount - 1)) * (length - 1)));
  }
  return Array.from(ticks).sort((a, b) => a - b);
}

function MobileLedgerSummary({ state }: { state: GameState }) {
  const displayedRevenue = useAnimatedNumber(state.annualRevenue, 800);
  const totalRaised = state.history.reduce((s, h) => s + (h.funding?.amount ?? 0), 0);
  const peak = Math.max(state.annualRevenue, ...state.history.map((h) => h.annualRevenue));
  const revenues = state.history.map((h) => h.annualRevenue);
  const points = sparklinePoints(revenues);
  const notable = findNotableYear(state.history, state);
  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const fillPath = points.length > 0 ? `${linePath} L${points[points.length - 1].x.toFixed(1)},${SPARKLINE_H} L${points[0].x.toFixed(1)},${SPARKLINE_H} Z` : '';
  const last = points[points.length - 1];
  const notablePoint = notable ? points[notable.index] : null;
  const axisTicks = pickAxisTicks(points.length, 5);

  // Touch-or-click scrubbing — a pointer down/drag anywhere over the chart
  // finds the nearest year by x position and pins the tooltip + guide line
  // there; it stays put after release (rather than vanishing) so a plain
  // tap reads just as well as a drag. touchAction:'none' stops the
  // enclosing scroll list from hijacking the drag as a page scroll.
  const chartWrapRef = React.useRef<HTMLDivElement>(null);
  const isPointerDownRef = React.useRef(false);
  const [hoverIndex, setHoverIndex] = React.useState<number | null>(null);

  function updateHoverFromClientX(clientX: number) {
    const wrap = chartWrapRef.current;
    if (!wrap || points.length === 0) return;
    const rect = wrap.getBoundingClientRect();
    const frac = rect.width > 0 ? Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)) : 0;
    const targetX = frac * SPARKLINE_W;
    let nearest = 0;
    let best = Infinity;
    points.forEach((p, i) => {
      const d = Math.abs(p.x - targetX);
      if (d < best) {
        best = d;
        nearest = i;
      }
    });
    setHoverIndex(nearest);
  }

  const hoverPoint = hoverIndex !== null ? points[hoverIndex] : null;
  const hoverRecord = hoverIndex !== null ? state.history[hoverIndex] : null;
  const hoverPct = hoverPoint ? Math.min(94, Math.max(6, (hoverPoint.x / SPARKLINE_W) * 100)) : 0;

  return (
    <div className="shrink-0 pb-3 mb-2 border-b border-line">
      <div className="flex items-center justify-between mb-1">
        <h3 className="font-mono text-[9px] tracking-[0.16em] text-ink6">EVERY YEAR SO FAR</h3>
        <span className="font-mono text-[9px] tracking-[0.1em] text-ink6">{state.history.length} YEARS</span>
      </div>

      {points.length >= 2 ? (
        <>
          <div
            ref={chartWrapRef}
            className="relative mt-6"
            style={{ touchAction: 'none' }}
            onPointerDown={(e) => {
              isPointerDownRef.current = true;
              updateHoverFromClientX(e.clientX);
            }}
            onPointerMove={(e) => {
              if (isPointerDownRef.current) updateHoverFromClientX(e.clientX);
            }}
            onPointerUp={() => {
              isPointerDownRef.current = false;
            }}
            onPointerCancel={() => {
              isPointerDownRef.current = false;
            }}
          >
            {!hoverPoint && (
              <span className="absolute left-0 font-mono text-[8px] text-ink7" style={{ top: -13 }}>
                PEAK {formatMoney(peak)}
              </span>
            )}
            <span className="absolute right-0 font-mono text-[8px] text-ink7" style={{ bottom: -1 }}>
              $0
            </span>

            <svg viewBox={`0 0 ${SPARKLINE_W} ${SPARKLINE_H}`} className="w-full block" style={{ height: 52 }} role="img" aria-label="Revenue over the run so far — touch or click to read a point">
              <defs>
                <linearGradient id="mobileLedgerSparkFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor="#3AA88A" stopOpacity="0.3" />
                  <stop offset="1" stopColor="#3AA88A" stopOpacity="0" />
                </linearGradient>
              </defs>
              <line x1="0" y1={SPARKLINE_TOP_PAD} x2={SPARKLINE_W} y2={SPARKLINE_TOP_PAD} stroke="#2A3242" strokeWidth="1" strokeDasharray="1.5 3" />
              <line x1="0" y1={SPARKLINE_H - SPARKLINE_BOTTOM_PAD} x2={SPARKLINE_W} y2={SPARKLINE_H - SPARKLINE_BOTTOM_PAD} stroke="#2A3242" strokeWidth="1" strokeDasharray="1.5 3" />
              <path d={fillPath} fill="url(#mobileLedgerSparkFill)" />
              <path d={linePath} fill="none" stroke="#3AA88A" strokeWidth="1.75" strokeLinejoin="round" />
              {notablePoint && <line x1={notablePoint.x} y1="0" x2={notablePoint.x} y2={SPARKLINE_H} stroke="#C4553A" strokeWidth="1" strokeDasharray="2 3" opacity="0.7" />}
              {hoverPoint && <line x1={hoverPoint.x} y1="0" x2={hoverPoint.x} y2={SPARKLINE_H} stroke="#DDE3EC" strokeWidth="1" opacity="0.5" />}
              {last && <circle cx={last.x} cy={last.y} r="3.5" fill="#7FD9A8" />}
              {hoverPoint && <circle cx={hoverPoint.x} cy={hoverPoint.y} r="4" fill="#0D0F14" stroke="#7FD9A8" strokeWidth="2" />}
            </svg>

            {hoverPoint && hoverRecord && (
              <div className="absolute pointer-events-none" style={{ left: `${hoverPct}%`, bottom: 'calc(100% + 4px)', transform: 'translateX(-50%)' }}>
                <div
                  className="rounded-[5px] px-2 py-1 font-mono text-[10px] whitespace-nowrap"
                  style={{ backgroundColor: '#1E2430', border: '1px solid #2A3242', color: '#FFFFFF' }}
                >
                  {calendarYearFor(state.foundedCalendarYear, hoverRecord.year)} · {formatMoney(hoverRecord.annualRevenue)}
                </div>
              </div>
            )}
          </div>

          <div className="relative h-[11px] mt-1">
            {axisTicks.map((i, k) => {
              const pct = (points[i].x / SPARKLINE_W) * 100;
              const transform = k === 0 ? 'translateX(0)' : k === axisTicks.length - 1 ? 'translateX(-100%)' : 'translateX(-50%)';
              return (
                <span key={i} className="absolute font-mono text-[8px] text-ink7" style={{ left: `${pct}%`, transform }}>
                  {calendarYearFor(state.foundedCalendarYear, state.history[i].year)}
                </span>
              );
            })}
          </div>
          {notable && notablePoint && (
            <div className="relative h-[11px]">
              <span
                className="absolute font-mono text-[8px]"
                style={{
                  left: `${Math.min(88, Math.max(0, (notablePoint.x / SPARKLINE_W) * 100))}%`,
                  transform: notablePoint.x / SPARKLINE_W > 0.85 ? 'translateX(-100%)' : notablePoint.x === 0 ? 'translateX(0)' : 'translateX(-50%)',
                  color: '#A85D4E',
                }}
              >
                {notable.label} · {calendarYearFor(state.foundedCalendarYear, state.history[notable.index].year)}
              </span>
            </div>
          )}
        </>
      ) : (
        <div className="h-[52px] flex items-center justify-center font-mono text-[11px] text-ink6 mt-2">The sparkline fills in from year two.</div>
      )}

      <div className={`grid gap-1.5 mt-2.5 ${totalRaised > 0 ? 'grid-cols-4' : 'grid-cols-3'}`}>
        {totalRaised > 0 && (
          <div className="rounded-[6px] px-2.5 py-1.5 min-w-0" style={{ backgroundColor: '#241C3D' }}>
            <div className="font-mono text-[7.5px] tracking-[0.1em] truncate" style={{ color: '#A89BD4' }}>
              RAISED
            </div>
            <div className="font-mono text-[14px] text-white truncate mt-0.5">{formatMoney(totalRaised)}</div>
          </div>
        )}
        <div className="rounded-[6px] px-2.5 py-1.5 min-w-0" style={{ backgroundColor: '#1A2B3D' }}>
          <div className="font-mono text-[7.5px] tracking-[0.1em] truncate" style={{ color: '#7FA8D0' }}>
            REVENUE
          </div>
          <div className="font-mono text-[14px] text-white truncate mt-0.5">{formatMoney(displayedRevenue)}</div>
        </div>
        <div className="rounded-[6px] px-2.5 py-1.5 min-w-0" style={{ backgroundColor: '#1A3D2C' }}>
          <div className="font-mono text-[7.5px] tracking-[0.1em] truncate" style={{ color: '#5FA882' }}>
            YOUR SHARE
          </div>
          <div className="font-mono text-[14px] truncate mt-0.5" style={{ color: '#7FD9A8' }}>
            {formatPercent(getFounderShare(state.capTable), 0)}
          </div>
        </div>
        <div className="rounded-[6px] px-2.5 py-1.5 min-w-0" style={{ backgroundColor: '#161A23' }}>
          <div className="font-mono text-[7.5px] tracking-[0.1em] truncate text-ink6">PEAK</div>
          <div className="font-mono text-[14px] text-white truncate mt-0.5">{formatMoney(peak)}</div>
        </div>
      </div>
    </div>
  );
}

/** Whichever single metric moved most notably this year — a funding round
 * or a staff swing tells more of the story than that year's revenue figure
 * would, so either takes priority over the default revenue+delta pairing. */
function mobileLedgerRowMetric(h: YearRecord, previous: YearRecord | null): { text: string; colour: string } {
  if (h.funding) return { text: `+${formatMoney(h.funding.amount)}`, colour: '#7FD9A8' };
  const staffDelta = previous ? h.staff - previous.staff : 0;
  if (staffDelta !== 0) return { text: `${staffDelta > 0 ? '+' : ''}${staffDelta} staff`, colour: staffDelta > 0 ? '#7FD9A8' : '#E8A08E' };
  return { text: formatMoney(h.annualRevenue), colour: '#8E98A8' };
}

function mobileLedgerRowIsNotable(h: YearRecord, previous: YearRecord | null, isDeathRow: boolean): boolean {
  if (isDeathRow) return true;
  if (!previous) return false;
  const staffDelta = h.staff - previous.staff;
  if (staffDelta <= -3) return true;
  const revenueDelta = h.annualRevenue - previous.annualRevenue;
  return revenueDelta < 0 && previous.annualRevenue > 0 && Math.abs(revenueDelta) / previous.annualRevenue >= 0.25;
}

function mobileLedgerRowDeltas(h: YearRecord, previous: YearRecord | null): MetricDelta[] {
  const deltas: MetricDelta[] = [];
  if (previous) {
    const revenueDelta = h.annualRevenue - previous.annualRevenue;
    if (revenueDelta !== 0) {
      deltas.push({ label: 'Revenue', value: `${revenueDelta > 0 ? '+' : ''}${formatMoney(revenueDelta)}`, tone: revenueDelta > 0 ? 'positive' : 'negative' });
    }
    const staffDelta = h.staff - previous.staff;
    if (staffDelta !== 0) {
      deltas.push({ label: 'Staff', value: `${staffDelta > 0 ? '+' : ''}${staffDelta}`, tone: staffDelta > 0 ? 'positive' : 'negative' });
    }
  }
  if (h.funding) {
    const equityGiven = Math.max(0, h.funding.founderShareBefore - h.funding.founderShareAfter);
    deltas.push({ label: 'Raised', value: formatMoney(h.funding.amount), tone: 'positive' });
    if (equityGiven > 0) deltas.push({ label: 'Gave up', value: `${equityGiven.toFixed(0)}%`, tone: 'negative' });
  }
  return deltas;
}

function MobileLedgerRows({ state }: { state: GameState }) {
  const [expandedKey, setExpandedKey] = React.useState<string | null>(null);

  if (state.history.length === 0) {
    return <p className="text-[15px] text-ink5 py-3">The ledger fills in as the years pass.</p>;
  }
  return (
    <div className="flex flex-col">
      {state.history
        .map((h, i) => ({ h, i }))
        .reverse()
        .map(({ h, i }) => {
          const key = `${h.year}-${h.eventId}`;
          const isDeathRow = i === state.history.length - 1 && state.status === 'ended' && h.endingType === 'failure';
          const cause = isDeathRow ? classifyDeathCause(state) : null;
          const previous = i > 0 ? state.history[i - 1] : null;
          const isNotable = mobileLedgerRowIsNotable(h, previous, isDeathRow);
          const metric = mobileLedgerRowMetric(h, previous);
          const categoryColour = EVENT_CATEGORY_COLOUR[EVENT_CATEGORY_BY_ID[h.eventId] ?? 'neutral'];
          const isExpanded = expandedKey === key;
          const deltas = mobileLedgerRowDeltas(h, previous);
          return (
            <div key={key} style={{ borderLeft: `3px solid ${categoryColour}`, backgroundColor: isNotable ? 'rgba(192,57,43,0.1)' : undefined }} className="border-b border-[#14161C]">
              <button
                onClick={() => setExpandedKey(isExpanded ? null : key)}
                className="w-full flex items-center gap-2 text-left"
                style={{ minHeight: 40, padding: '0 12px 0 11px' }}
              >
                <span className="font-mono text-[11px] shrink-0" style={{ width: 30, color: isDeathRow ? '#E67E73' : '#6E7A8E' }}>
                  {calendarYearFor(state.foundedCalendarYear, h.year)}
                </span>
                <span className={`flex-1 min-w-0 text-[13px] truncate ${isDeathRow ? 'text-[#E67E73]' : 'text-ink'}`}>{h.eventHeadline}</span>
                <span className="font-mono text-[11px] shrink-0" style={{ color: metric.colour }}>
                  {metric.text}
                </span>
              </button>
              {isExpanded && (
                <div className="pb-2.5" style={{ padding: '0 12px 10px 11px' }}>
                  <div className="text-[12px] text-ink4">
                    Chose: <span className="text-ink font-semibold">{h.optionLabel}</span>
                  </div>
                  <div className="font-mono text-[10px] tracking-[0.06em] mt-1" style={{ color: isDeathRow ? '#B5665F' : '#6E7A8E' }}>
                    {cause ? DEATH_CAUSE_COPY[cause].statement(state) : (h.tag ?? '—')}
                  </div>
                  {deltas.length > 0 && (
                    <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1.5">
                      {deltas.map((d) => (
                        <span key={d.label} className="font-mono text-[11px]" style={{ color: d.tone === 'positive' ? '#7FD9A8' : d.tone === 'negative' ? '#E8A08E' : '#8E98A8' }}>
                          {d.label} {d.value}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
    </div>
  );
}

// ============================================================================
// Header metric cell
// ============================================================================

// Fixed tint per metric family — exact hex the spec gives for the tile
// background, paired with the closest existing semantic "lighter shade"
// token for the label (never inventing a parallel set of light colours).
const METRIC_TILE: Record<'blue' | 'violet' | 'green' | 'amber' | 'red' | 'gold', { bg: string; label: string }> = {
  // Raised (capital in) and revenue (money earned) are different kinds of
  // number and shouldn't look alike, even when both read $0 at year one.
  violet: { bg: '#241C3D', label: '#A89BD4' },
  blue: { bg: '#1A2B3D', label: '#7FA8D0' },
  green: { bg: '#1A3D2C', label: '#5FC08A' },
  amber: { bg: '#3D3218', label: '#E9A13B' },
  red: { bg: '#3D1E1A', label: '#E36B6B' },
  gold: { bg: '#3D3116', label: '#E0B85E' },
};

/** Mobile counterpart to MetricCell — one row of four instead of a 2x2
 * grid, per the decision screen's header budget (64px total). Label-above/
 * value-below only, no icon: at ~80px of tile width across four columns,
 * an icon plus a label like "MARKET CAP" doesn't have room to also stay
 * legible, and the spec's own header layout only calls for the two text
 * lines. Desktop's MetricCell (with its icon) is untouched. */
function MobileMetricTile({
  label,
  value,
  tileTone,
  valueWarn,
  pulse,
}: {
  label: string;
  value: string;
  tileTone: keyof typeof METRIC_TILE;
  valueWarn?: boolean;
  pulse?: boolean;
}) {
  const tile = METRIC_TILE[tileTone];
  return (
    <div
      className={`h-full min-w-0 rounded-[9px] px-1 flex flex-col items-center justify-center gap-0.5 ${pulse ? 'animate-pulse' : ''}`}
      style={{ backgroundColor: tile.bg }}
    >
      <div className="w-full text-center font-mono text-[10px] tracking-[0.06em] whitespace-nowrap overflow-hidden text-ellipsis" style={{ color: tile.label }}>
        {label}
      </div>
      <div className="text-[15px] font-extrabold font-mono leading-none" style={{ color: valueWarn ? tile.label : '#FFFFFF' }}>
        {value}
      </div>
    </div>
  );
}

function MetricCell({
  icon,
  label,
  value,
  tileTone,
  valueWarn,
  pulse,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tileTone: keyof typeof METRIC_TILE;
  valueWarn?: boolean;
  pulse?: boolean;
}) {
  const tile = METRIC_TILE[tileTone];
  return (
    <div className={`rounded-[var(--r-12)] px-2.5 py-2.5 flex flex-col items-center gap-1.5 ${pulse ? 'animate-pulse' : ''}`} style={{ backgroundColor: tile.bg }}>
      <div className="flex items-center gap-1.5 font-mono text-[length:var(--fs-9-5)] tracking-[0.14em] whitespace-nowrap" style={{ color: tile.label }}>
        {icon}
        {label}
      </div>
      <div className="text-[length:var(--fs-18)] font-extrabold font-mono leading-none" style={{ color: valueWarn ? tile.label : '#FFFFFF' }}>
        {value}
      </div>
    </div>
  );
}
