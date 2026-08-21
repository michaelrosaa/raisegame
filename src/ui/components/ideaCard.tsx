/**
 * The idea-selection grid — shared by SetupScreen (first company of a
 * career) and FoundCompanyScreen (re-founding, company 2+), since both
 * need to present a drawn set of ideas identically.
 */

import React from 'react';
import type { Idea } from '../../engine/types';
import { pickCompanyColour } from '../../engine/cast';
import { moneyBand, salesTimeline, upsideBand, glamourBadge, ideaHeat, heatForDraw } from '../../engine/ideas';
import { CompanyLogoIcon, LOGO_SHAPES } from './icons';
import { StatCell } from './ui';
import { useIsMobile } from '../hooks/useIsMobile';

export function IdeaGrid({ ideas, selectedId, onSelect }: { ideas: Idea[]; selectedId: string | null; onSelect: (id: string) => void }) {
  const isMobile = useIsMobile();
  const heatFlags = heatForDraw(ideas);

  if (isMobile) {
    return <MobileIdeaCarousel ideas={ideas} selectedId={selectedId} onSelect={onSelect} />;
  }

  return (
    <div className="grid grid-cols-3 gap-[var(--sp-16)]">
      {ideas.map((idea, i) => {
        const colour = pickCompanyColour(idea.industry);
        const heat = ideaHeat(idea);
        const showHeat = heatFlags[i];
        const upside = upsideBand(idea.upside);
        const selected = selectedId === idea.id;
        const glamour = glamourBadge(idea);
        return (
          <div
            key={idea.id}
            onClick={() => onSelect(idea.id)}
            style={{ borderTopColor: colour }}
            className={`rounded-[var(--r-16)] bg-panel border border-t-[3px] px-[var(--sp-16)] pt-[var(--sp-15)] pb-[var(--sp-13)] flex flex-col gap-2.5 cursor-pointer transition-colors ${
              selected ? 'border-accent' : 'border-line hover:border-accent'
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <CompanyLogoIcon shape={LOGO_SHAPES[idea.name.length % LOGO_SHAPES.length]} className="w-5 h-5 shrink-0" />
              <div className="flex items-center gap-1.5 min-w-0">
                {glamour && (
                  <span
                    className={`font-mono text-[length:var(--fs-8-5)] tracking-[0.1em] px-1.5 py-[3px] rounded-md truncate ${
                      glamour.tone === 'accent' ? 'bg-accentTint text-accentLight' : 'bg-fieldRaised text-ink5'
                    }`}
                    title={glamour.tone === 'accent' ? 'Draws more funding and attention — and more risk with it.' : 'Steady and unglamorous — reliable, with a lower ceiling.'}
                  >
                    {glamour.label.toUpperCase()}
                  </span>
                )}
                {selected && <span className="w-[9px] h-[9px] rounded-full bg-accent shrink-0" />}
              </div>
            </div>
            <div className="text-[length:var(--fs-19)] font-extrabold tracking-[-0.02em] leading-[1.1]">{idea.name}</div>
            <p className="text-[length:var(--fs-12-5)] text-ink4 leading-[1.45] min-h-[36px]" style={{ maxWidth: '34ch' }}>
              {idea.description}
            </p>
            <div className="h-px bg-line mt-1" />
            <div className="flex gap-2">
              <StatCell label="Money needed" value={moneyBand(idea.moneyNeeded)} />
              <StatCell label="First sales" value={salesTimeline(idea.monthsToFirstSales)} />
              <StatCell label="Could get" value={upside.label} tone={upside.tone === 'huge' ? 'positive' : 'default'} />
            </div>
            {showHeat && (
              <div
                className={`self-start font-mono text-[length:var(--fs-9)] tracking-[0.12em] px-2 py-1 rounded-md ${
                  heat.variant === 'success' ? 'bg-positiveBg text-positive' : heat.variant === 'warning' ? 'bg-cautionBg text-caution' : 'bg-negativeBg text-negative'
                }`}
              >
                {heat.label.toUpperCase()}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ============================================================================
// Mobile idea carousel — three stacked cards ran past 1000px of scroll, so
// mobile shows one full card at a time (380px tall) in a horizontal,
// scroll-snapped strip with dots beneath instead. The centred card IS the
// selection: swiping (or tapping a dot) moves the snap position, and
// onScroll reads back which card that landed on — there's no separate tap-
// to-select step the way the desktop grid has one. Selection starts on the
// first idea on mount/reroll (selectedId null) so Continue is meaningful
// from the first frame, before the player has swiped at all.
// ============================================================================

const NUMBER_WORDS: Record<number, string> = { 1: 'ONE', 2: 'TWO', 3: 'THREE', 4: 'FOUR', 5: 'FIVE' };

function MobileIdeaCarousel({ ideas, selectedId, onSelect }: { ideas: Idea[]; selectedId: string | null; onSelect: (id: string) => void }) {
  const trackRef = React.useRef<HTMLDivElement>(null);
  const index = Math.max(0, ideas.findIndex((i) => i.id === selectedId));
  const othersCount = Math.max(0, ideas.length - 1);
  const othersLabel = NUMBER_WORDS[othersCount] ?? String(othersCount);

  React.useEffect(() => {
    if (ideas.length > 0 && !ideas.some((i) => i.id === selectedId)) onSelect(ideas[0].id);
  }, [ideas, selectedId, onSelect]);

  function handleScroll() {
    const el = trackRef.current;
    if (!el || el.clientWidth === 0) return;
    const nearest = Math.round(el.scrollLeft / el.clientWidth);
    const clamped = Math.max(0, Math.min(ideas.length - 1, nearest));
    const idea = ideas[clamped];
    if (idea && idea.id !== selectedId) onSelect(idea.id);
  }

  function scrollToIndex(i: number) {
    const el = trackRef.current;
    if (!el) return;
    el.scrollTo({ left: i * el.clientWidth, behavior: 'smooth' });
  }

  return (
    <div className="flex flex-col gap-2.5">
      {othersCount > 0 && (
        <div className="font-mono text-[10px] tracking-[0.14em] text-ink6 text-center">SWIPE TO SEE THE OTHER {othersLabel}</div>
      )}
      <div
        ref={trackRef}
        onScroll={handleScroll}
        className="flex overflow-x-auto hide-scrollbar"
        style={{ scrollSnapType: 'x mandatory', WebkitOverflowScrolling: 'touch' }}
      >
        {ideas.map((idea) => (
          <div key={idea.id} className="w-full shrink-0" style={{ scrollSnapAlign: 'center' }}>
            <MobileIdeaCard idea={idea} />
          </div>
        ))}
      </div>
      {ideas.length > 1 && (
        <div className="flex items-center justify-center gap-2">
          {ideas.map((idea, i) => (
            <button
              key={idea.id}
              onClick={() => scrollToIndex(i)}
              aria-label={`Idea ${i + 1} of ${ideas.length}`}
              className="rounded-full"
              style={{ width: i === index ? 8 : 6, height: i === index ? 8 : 6, background: i === index ? '#FFFFFF' : '#3A4456' }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** One card of the mobile carousel, ~380px tall — the top rule, icon,
 * glamour badge, title, description, and the same three stat cells the
 * desktop card shows, minus the heat flag (no room left in the budget for
 * a fourth line of chrome). `minHeight` (not a hard `height`) plus a
 * trailing flexible spacer after the stat row — not `flex-1` on the
 * description — so the description only ever takes its own natural
 * height and the stat cells sit directly beneath it; any leftover space
 * collects below the stats instead of opening a hole between them. */
function MobileIdeaCard({ idea }: { idea: Idea }) {
  const colour = pickCompanyColour(idea.industry);
  const upside = upsideBand(idea.upside);
  const glamour = glamourBadge(idea);
  return (
    <div
      style={{ borderTopColor: colour, minHeight: 380 }}
      className="rounded-[16px] bg-panel border border-line border-t-[3px] px-4 pt-4 pb-4 flex flex-col gap-3"
    >
      <div className="flex items-center justify-between gap-2">
        <CompanyLogoIcon shape={LOGO_SHAPES[idea.name.length % LOGO_SHAPES.length]} className="w-6 h-6 shrink-0" />
        {glamour && (
          <span
            className={`font-mono text-[10px] tracking-[0.1em] px-1.5 py-[3px] rounded-md truncate ${
              glamour.tone === 'accent' ? 'bg-accentTint text-accentLight' : 'bg-fieldRaised text-ink5'
            }`}
          >
            {glamour.label.toUpperCase()}
          </span>
        )}
      </div>
      <div className="text-[22px] font-extrabold tracking-[-0.02em] leading-[1.1]">{idea.name}</div>
      <p
        className="text-[14px] text-ink4 leading-[1.5]"
        style={{ display: '-webkit-box', WebkitLineClamp: 4, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
      >
        {idea.description}
      </p>
      <div className="h-px bg-line" />
      <div className="flex gap-2">
        <StatCell label="Money needed" value={moneyBand(idea.moneyNeeded)} />
        <StatCell label="First sales" value={salesTimeline(idea.monthsToFirstSales)} />
        <StatCell label="Could get" value={upside.label} tone={upside.tone === 'huge' ? 'positive' : 'default'} />
      </div>
      <div className="flex-1" />
    </div>
  );
}
