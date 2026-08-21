import React from 'react';
import type { Founder, Company, GameState, EventDef, OptionDef, CharacterTemplate, CareerState, BetweenYearOption, Idea, PortraitSeed } from './engine/types';
import { RNG, generateSeed } from './engine/rng';
import { createGameState } from './engine/state';
import { initializeMacroPhase } from './engine/macro';
import { pickCompanyColour, castFoundingCrew } from './engine/cast';
import { processPlayerChoice, canExitGame, playerRetires } from './engine/game';
import { advanceYear, type TurnContext } from './engine/turn';
import {
  createCareerState,
  foundCompany,
  endCurrentCompany,
  advanceCareerYear,
  applyBetweenYearAction,
  retireCareerEarly,
  startFamily,
  handOverToHeir,
  inheritRunningCompany,
  CAREER_LENGTH_YEARS,
} from './engine/career';
import { calendarYearFor } from './engine/present';
import { countryFor, fundingGateChance, glamourOf } from './engine/economy';
import { applyFundingGateToEvent } from './engine/events';

import { SetupScreen } from './ui/screens/setup';
import { GameScreen } from './ui/screens/game';
import { BetweenYearsScreen } from './ui/screens/betweenYears';
import { FoundCompanyScreen } from './ui/screens/foundCompany';
import { ResultsScreen } from './ui/screens/results';
import { FailureScreen } from './ui/screens/failure';
import { AdBanner } from './ui/components/adBanner';
import { useIsMobile } from './ui/hooks/useIsMobile';

import countries from './content/countries.json';
import ideasContent from './content/ideas.json';
import characterTemplates from './content/characters.json';
import yearOneEvents from './content/events/year-one.json';
import everyday from './content/events/everyday.json';
import everydayVol3 from './content/events/everyday-vol3.json';
import family from './content/events/family.json';
import geopolitical from './content/events/geopolitical.json';
import economic from './content/events/economic.json';
import internal from './content/events/internal.json';
import absurd from './content/events/absurd.json';
import gambles from './content/events/gambles.json';
import quietYears from './content/events/quietyears.json';
import postIpo from './content/events/postipo.json';

import type { CountryData } from './engine/types';

const IDEAS = ideasContent as Idea[];
const COUNTRY_LIST = countries as CountryData[];
const CHARACTER_POOL = characterTemplates as CharacterTemplate[];
const YEAR_ONE_EVENT = (yearOneEvents as EventDef[])[0];
// Company 2+ of a career already answered "how much of your own money goes
// in" on the re-founding screen (foundCompany.tsx) — asking "how will you
// pay for year one" again would both re-litigate a settled decision and
// double-dip a funding round on top of the capital just committed. See
// beginCompanyTurn below.
const YEAR_ONE_REFOUNDING_EVENT = (yearOneEvents as EventDef[])[1];
const RANDOM_EVENTS: EventDef[] = [
  ...(everyday as EventDef[]),
  ...(everydayVol3 as EventDef[]),
  ...(family as EventDef[]),
  ...(geopolitical as EventDef[]),
  ...(economic as EventDef[]),
  ...(internal as EventDef[]),
  ...(absurd as EventDef[]),
  ...(gambles as EventDef[]),
];
// Fallback pool only: used when no real event is eligible for a year, so
// every year still gets a ledger row instead of being silently skipped
// (the ledger must never show a gap, e.g. 2027 -> 2029). Also the fallback
// once a public company (Pass D) exhausts its own, much smaller pool.
const QUIET_YEAR_EVENTS: EventDef[] = quietYears as EventDef[];
// A public company draws from this pool INSTEAD of RANDOM_EVENTS — see
// turn.ts's advanceYear step 5. A company doesn't see Series A events or
// "the office floods" once it's public; it sees activist investors.
const POST_IPO_EVENTS: EventDef[] = postIpo as EventDef[];
const TURN_CONTEXT: TurnContext = { allEvents: RANDOM_EVENTS, quietEvents: QUIET_YEAR_EVENTS, postIpoEvents: POST_IPO_EVENTS, characterPool: CHARACTER_POOL };

// 'playing' is "a company's turn loop is active" (gameState/currentEvent are
// live); 'betweenYears' and 'foundCompany' only ever happen while
// careerState.current is null. See engine/career.ts's own module comment
// for the two-clock model this phase machine is built on.
type Phase = 'setup' | 'playing' | 'betweenYears' | 'foundCompany' | 'results' | 'failure';

export default function App() {
  const isMobile = useIsMobile();
  const [phase, setPhase] = React.useState<Phase>('setup');
  const [rng] = React.useState(() => new RNG(generateSeed()));
  const [seed] = React.useState(() => rng.getSeed());

  const [careerState, setCareerState] = React.useState<CareerState | null>(null);

  const [gameState, setGameState] = React.useState<GameState | null>(null);
  const [previousState, setPreviousState] = React.useState<GameState | null>(null);
  const [currentEvent, setCurrentEvent] = React.useState<EventDef | null>(null);
  const [chosenOptionId, setChosenOptionId] = React.useState<string | null>(null);
  const [gambleResult, setGambleResult] = React.useState<'won' | 'lost' | undefined>(undefined);
  // Set only while phase === 'failure' — the phase finishCompanyAndRoute
  // would have gone straight to, had this company's end not been a
  // failure. handleFailureContinue reads it once and clears it; this is
  // what makes the failure screen a real, non-skippable beat rather than
  // a value baked into a route the player could otherwise bypass.
  const [pendingPhaseAfterFailure, setPendingPhaseAfterFailure] = React.useState<Phase | null>(null);

  /** The shared tail of every path that ends a company's run — sale, IPO,
   * failure, insolvency, the event pool running dry, or the player's own
   * "retire now" button all leave `endedState.status === 'ended'` before
   * reaching here. Books the company, then routes to results if the whole
   * career just ended too (year 25, or a career-level retire), otherwise
   * to the between-years prompt. */
  function finishCompanyAndRoute(endedState: GameState, career: CareerState) {
    const nextCareer = endCurrentCompany(career, endedState);
    setCareerState(nextCareer);
    setGameState(null);
    setPreviousState(null);
    setCurrentEvent(null);
    setChosenOptionId(null);
    setGambleResult(undefined);
    const nextPhase: Phase = nextCareer.status === 'ended' ? 'results' : 'betweenYears';
    const lastRecord = nextCareer.companies[nextCareer.companies.length - 1];
    // A failure gets its own full-screen beat first (ui/screens/failure.tsx)
    // — the route this would otherwise have taken is stashed, not lost, and
    // only applied once the player presses that screen's own button.
    if (lastRecord?.outcome === 'failed') {
      setPendingPhaseAfterFailure(nextPhase);
      setPhase('failure');
      return;
    }
    setPhase(nextPhase);
  }

  function handleFailureContinue() {
    setPhase(pendingPhaseAfterFailure ?? 'betweenYears');
    setPendingPhaseAfterFailure(null);
  }

  function beginCompanyTurn(career: CareerState) {
    const state = career.current!;
    // True for any company that went through FoundCompanyScreen — a
    // same-generation re-founding (companies.length > 0) or a successor's
    // very first company (generation > 1, fresh CareerState so
    // companies.length is 0) — both already asked "how much of your own
    // money goes in" there, unlike generation 1's own first-ever company.
    const isRefounding = career.companies.length > 0 || career.generation > 1;
    // Even a re-founding (or successor) shows the real funding-source
    // choice, not the no-funding-needed refounding event, when the
    // founder's own committed capital didn't clear what the idea itself
    // needs — see career.ts's foundCompany/startedWithLittleCapital.
    const needsFundingChoice = !isRefounding || state.startedWithLittleCapital;
    const yearOneEvent = needsFundingChoice
      ? applyFundingGateToEvent(YEAR_ONE_EVENT, rng.next() < fundingGateChance(countryFor(state.founder.country), state.climate, state.founderReputation, glamourOf(state)))
      : YEAR_ONE_REFOUNDING_EVENT;
    setCareerState(career);
    setGameState(state);
    setCurrentEvent(yearOneEvent);
    setPhase('playing');
  }

  function handleSetupComplete(
    founderPartial: Omit<Founder, 'portrait'>,
    companyPartial: Omit<Company, 'colour'>,
    countryId: string,
    idea: Idea,
    portrait: PortraitSeed
  ) {
    const founder: Founder = { ...founderPartial, portrait };
    const company: Company = { ...companyPartial, colour: pickCompanyColour(companyPartial.industry) };

    // The very first company of a career skips engine/career.ts's
    // foundCompany entirely — there's no personal cash yet to choose an
    // amount from, so it goes straight through createGameState exactly as
    // it always has (country startingCash, reputation neutral).
    let state = createGameState(seed, founder, company, countryId, { moneyNeeded: idea.moneyNeeded, industry: idea.industry });
    state = { ...state, status: 'running' };
    state = initializeMacroPhase(state, rng);
    state = castFoundingCrew(state, rng, CHARACTER_POOL);

    let career = createCareerState(seed, founder);
    career = { ...career, current: state, currentCapitalPutIn: 0 };

    beginCompanyTurn(career);
  }

  function handleLuckyPick() {
    if (!currentEvent) return;
    const randomOption = rng.pick(currentEvent.options);
    handleChoose(randomOption.id);
  }

  function handleChoose(optionId: string) {
    if (!gameState || !currentEvent || !careerState) return;
    const option = currentEvent.options.find((o: OptionDef) => o.id === optionId);
    if (!option) return;

    const { state: newState, gambleResult: result } = processPlayerChoice(gameState, currentEvent, option, rng, CHARACTER_POOL);
    setPreviousState(gameState);
    setGameState(newState);
    setChosenOptionId(optionId);
    setGambleResult(result);

    // The family event's 'startFamily' effect only flips a boolean on the
    // currently-running company's GameState — the heir itself (name/trait/
    // portrait) is generated here, at the career layer, the moment that
    // transition is observed. See career.ts's startFamily.
    if (newState.founderHasFamily && !careerState.hasFamily) {
      setCareerState(startFamily(careerState, rng));
    }
  }

  function handleAdvance() {
    if (!gameState || !careerState) return;

    // The choice just made (handleChoose) already ended this company within
    // the year that was already current — no new year was consumed, so the
    // career clock doesn't move here. See career.ts's advanceCareerYear doc.
    if (gameState.status === 'ended') {
      finishCompanyAndRoute(gameState, careerState);
      return;
    }

    const step = advanceYear(gameState, rng, TURN_CONTEXT);
    // turn.ts's advanceYear always increments state.year at the top,
    // regardless of what it returns — so the career clock always moves
    // here, exactly once, whatever happens next.
    const advancedCareer = advanceCareerYear(careerState);

    if (step.hasEnded || !step.event) {
      finishCompanyAndRoute(step.state, advancedCareer);
      return;
    }

    // The clock just passed CAREER_LENGTH_YEARS while this company was
    // still healthy and mid-play (step.hasEnded/!step.event already ruled
    // out the company ending on its own this same turn, above). Rather
    // than force-liquidating it, keep it running exactly as it stands —
    // the results screen offers "continue with a successor" the choice to
    // inherit it directly (engine/career.ts's inheritRunningCompany) or
    // cash out and start fresh instead. See handleHandOver.
    if (advancedCareer.status === 'ended') {
      setCareerState({ ...advancedCareer, current: step.state });
      setGameState(step.state);
      setCurrentEvent(step.event);
      setPreviousState(null);
      setChosenOptionId(null);
      setGambleResult(undefined);
      setPhase('results');
      return;
    }

    setCareerState(advancedCareer);
    setGameState(step.state);
    setCurrentEvent(step.event);
    setPreviousState(null);
    setChosenOptionId(null);
    setGambleResult(undefined);
  }

  function handleRetireCompany() {
    if (!gameState || !careerState) return;
    finishCompanyAndRoute(playerRetires(gameState), careerState);
  }

  function handleBetweenYearAction(optionId: BetweenYearOption['id']) {
    if (!careerState) return;
    if (optionId === 'found') {
      // Founding claims the current year's slot rather than consuming a
      // year on its own — see career.ts's applyBetweenYearAction.
      setPhase('foundCompany');
      return;
    }
    const nextCareer = applyBetweenYearAction(careerState, optionId, rng);
    setCareerState(nextCareer);
    setPhase(nextCareer.status === 'ended' ? 'results' : 'betweenYears');
  }

  function handleRetireCareer() {
    if (!careerState) return;
    setCareerState(retireCareerEarly(careerState));
    setPhase('results');
  }

  function handleFoundCompany(company: Omit<Company, 'colour'>, idea: Idea, capitalPutIn: number) {
    if (!careerState) return;
    const fullCompany: Company = { ...company, colour: pickCompanyColour(company.industry) };
    const career = foundCompany(careerState, fullCompany, careerState.founder.country, idea, capitalPutIn, rng, CHARACTER_POOL);
    beginCompanyTurn(career);
  }

  function handleHandOver(keepCompanyRunning: boolean) {
    if (!careerState) return;

    // Only reachable when a company survived all the way to the end of
    // the career (see handleAdvance) — the successor can step straight
    // into it, uninterrupted, instead of starting from nothing.
    if (keepCompanyRunning && careerState.current) {
      const newCareer = handOverToHeir(careerState, rng);
      const inheritedState = inheritRunningCompany(careerState.current, newCareer);
      setCareerState({ ...newCareer, current: inheritedState });
      setGameState(inheritedState);
      // currentEvent/chosenOptionId/previousState are already exactly
      // right — untouched since the moment the career ended mid-play — so
      // the successor's first decision picks up right where the outgoing
      // founder's would have.
      setPhase('playing');
      return;
    }

    // Otherwise: cash out whatever's still running first (same liquidation
    // path any other retirement takes), then the successor starts fresh.
    const career = careerState.current ? endCurrentCompany(careerState, playerRetires(careerState.current)) : careerState;
    setCareerState(handOverToHeir(career, rng));
    setGameState(null);
    setPreviousState(null);
    setCurrentEvent(null);
    setChosenOptionId(null);
    setGambleResult(undefined);
    setPhase('foundCompany');
  }

  function handlePlayAgain() {
    setPhase('setup');
    setCareerState(null);
    setGameState(null);
    setPreviousState(null);
    setCurrentEvent(null);
    setChosenOptionId(null);
    setGambleResult(undefined);
  }

  function runUrl(): string {
    if (!careerState) return window.location.origin;
    return `${window.location.origin}/r/${careerState.seed}`;
  }

  function handleShare() {
    if (!careerState) return;
    const url = runUrl();
    const title = `${careerState.founder.name}'s career on Raise`;
    if (navigator.share) {
      navigator.share({ title, url }).catch(() => {});
      return;
    }
    if (navigator.clipboard) {
      navigator.clipboard.writeText(url).catch(() => {});
    }
  }

  let screen: React.ReactNode = null;

  if (phase === 'setup') {
    screen = <SetupScreen countries={COUNTRY_LIST} ideas={IDEAS} rng={rng} onComplete={handleSetupComplete} />;
  } else if (phase === 'playing' && gameState && currentEvent) {
    const advanceLabel =
      gameState.status === 'ended' ? 'See how it ended' : `Advance to ${calendarYearFor(gameState.foundedCalendarYear, gameState.year + 1)}`;
    screen = (
      <GameScreen
        state={gameState}
        previousState={previousState}
        event={currentEvent}
        chosenOptionId={chosenOptionId}
        gambleResult={gambleResult}
        characterPool={CHARACTER_POOL}
        onChoose={handleChoose}
        onAdvance={handleAdvance}
        onLuckyPick={handleLuckyPick}
        advanceLabel={advanceLabel}
        canRetire={!chosenOptionId && canExitGame(gameState)}
        onRetire={handleRetireCompany}
      />
    );
  } else if (phase === 'failure' && careerState && careerState.companies.length > 0) {
    const record = careerState.companies[careerState.companies.length - 1];
    screen = (
      <FailureScreen
        record={record}
        personalCash={careerState.personalCash}
        foundedCalendarYear={careerState.foundedCalendarYear}
        careerYearsLeft={Math.max(0, CAREER_LENGTH_YEARS - careerState.careerYear)}
        companiesSoFar={careerState.companies.length}
        isLastCompany={pendingPhaseAfterFailure === 'results'}
        onContinue={handleFailureContinue}
      />
    );
  } else if (phase === 'betweenYears' && careerState) {
    screen = <BetweenYearsScreen career={careerState} onChooseAction={handleBetweenYearAction} onRetireCareer={handleRetireCareer} />;
  } else if (phase === 'foundCompany' && careerState) {
    screen = <FoundCompanyScreen career={careerState} ideas={IDEAS} rng={rng} onComplete={handleFoundCompany} />;
  } else if (phase === 'results' && careerState) {
    screen = <ResultsScreen career={careerState} onPlayAgain={handlePlayAgain} onHandOver={handleHandOver} onShare={handleShare} />;
  }

  // Desktop only — AdBanner renders null on mobile (see its own comment).
  // Every screen sizes to the space above it (h-full inside this flex-1
  // wrapper, not h-screen) so it never covers content.
  return (
    <div
      className={isMobile ? 'w-screen flex flex-col overflow-hidden' : 'h-screen w-screen flex flex-col overflow-hidden'}
      style={isMobile ? { height: '100dvh' } : undefined}
    >
      <div className="flex-1 min-h-0">{screen}</div>
      <AdBanner />
    </div>
  );
}
