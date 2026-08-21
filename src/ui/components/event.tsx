/**
 * Event Display Components
 * Option cards — kicker + icon + name, a named person row when the option
 * has one, odds rows on genuine gambles, two chips pinned to the bottom.
 * Cards size to their content; there is no equal-height constraint.
 */

import type { OptionDef, GameState, CharacterTemplate, Character } from '../../engine/types';
import { formatMoney, formatPercent } from '../../engine/format';
import { computeFundingOffer } from '../../engine/economy';
import { createCharacterFromTemplate } from '../../engine/cast';
import { getFounderShare } from '../../engine/state';
import { generatePortraitSVG } from '../../engine/portraits';
import { renderEventText } from '../../engine/text';
import { PortraitDisplay, ValueChip } from './ui';
import { IconUsers, IconGraduationCap, IconWallet, IconCoins, IconPhone } from './icons';

// ============================================================================
// Preview resolution — safe to call before a choice is committed: it's the
// exact same computeFundingOffer() the engine uses to apply the choice, run
// against the same not-yet-mutated state, so the number never drifts
// between what's shown and what happens.
// ============================================================================

interface FundingPreview {
  kind: 'funding';
  lead: Character;
  amount: number;
  investorPct: number;
}
interface PlainPreview {
  kind: 'plain';
}
type OptionPreview = FundingPreview | PlainPreview;

function resolveCharacterPreview(characterId: string, state: GameState, pool: CharacterTemplate[]): Character | undefined {
  const existing = state.cast.find((c) => c.id === characterId);
  if (existing) return existing;
  const template = pool.find((t) => t.id === characterId);
  if (!template) return undefined;
  return createCharacterFromTemplate(template, state.cast);
}

export function previewOption(option: OptionDef, state: GameState, characterPool: CharacterTemplate[]): OptionPreview {
  const fundingEffect = option.effects.find((e) => e.type === 'funding' && e.characterId && e.fundingStage);
  if (fundingEffect?.characterId && fundingEffect.fundingStage) {
    const lead = resolveCharacterPreview(fundingEffect.characterId, state, characterPool);
    if (lead) {
      const offer = computeFundingOffer(state, fundingEffect.fundingStage, lead, fundingEffect.targetDilutionPct);
      return { kind: 'funding', lead, amount: offer.amount, investorPct: (offer.amount / offer.postMoneyValuation) * 100 };
    }
  }
  return { kind: 'plain' };
}

/** For any option that ISN'T a funding round: what it actually does to cash
 * and founder equity, read directly off its own effects instead of always
 * assuming "no cash, keep what you already have." That assumption was
 * wrong (and visibly self-contradicting against the option's own detail
 * text) for anything authored with a direct cash cost or an equity-moving
 * effect — growEquityCofounder, grantNewEquity, cofounderExit (when it
 * doesn't keep equity), sellShares, takePrivate. Approximate on purpose:
 * this only needs to match what the SAME effects list actually produces
 * once chosen, not model every effect type that exists. */
export function previewCashAndEquity(option: OptionDef, state: GameState): { cashDelta: number; founderShareAfter: number } {
  const founderShare = getFounderShare(state.capTable);
  let share = founderShare;
  let cashDelta = 0;

  for (const effect of option.effects) {
    if (effect.type === 'cash' && (effect.unit === undefined || effect.unit === 'absolute')) {
      cashDelta += effect.value ?? 0;
    } else if (effect.type === 'growEquityCofounder' || effect.type === 'grantNewEquity') {
      share = Math.max(0, share - (effect.value ?? 0));
    } else if (effect.type === 'cofounderExit' && effect.keepsEquity === false) {
      const cofounder = state.cast.find((c) => c.role === 'cofounder');
      const stake = cofounder ? (state.capTable.find((e) => e.holder === cofounder.fullName)?.percentage ?? 0) : 0;
      share = Math.min(100, share + stake);
    } else if (effect.type === 'sellShares') {
      share = Math.max(0, share - (effect.value ?? 0));
    } else if (effect.type === 'takePrivate') {
      share = 100;
    }
  }

  return { cashDelta, founderShareAfter: share };
}

export function categoryLabel(icon: OptionDef['icon']): string {
  switch (icon) {
    case 'investor':
      return 'Take money from';
    case 'mentor':
      return 'Join';
    case 'solo':
      return 'Take no money';
    default:
      return 'Choose';
  }
}

export function CategoryIcon({ icon, colour }: { icon: OptionDef['icon']; colour: string }) {
  const cls = 'w-[19px] h-[19px] shrink-0';
  const glyph =
    icon === 'investor' ? <IconUsers className={cls} /> : icon === 'mentor' ? <IconGraduationCap className={cls} /> : icon === 'solo' ? <IconWallet className={cls} /> : <IconCoins className={cls} />;
  return <span style={{ color: colour }}>{glyph}</span>;
}

// ============================================================================
// Pre-choice option card
// ============================================================================

interface OptionCardProps {
  option: OptionDef;
  state: GameState;
  characterPool: CharacterTemplate[];
  industryColour: string;
  onChoose: () => void;
  disabled?: boolean;
  /** Resolved mentor-hint text, already run through renderEventText — shown
   * inline on this card once the player has called the mentor. Only ever
   * set on the specific card option.mentorHint was authored for, so the
   * insight reads as attached to that choice rather than as a popup
   * floating below the whole list. */
  mentorHint?: string;
}

export function OptionCard({ option, state, characterPool, industryColour, onChoose, disabled, mentorHint }: OptionCardProps) {
  const preview = previewOption(option, state, characterPool);
  const founderShare = getFounderShare(state.capTable);
  const cashEquity = preview.kind === 'plain' ? previewCashAndEquity(option, state) : null;
  const equityChanged = cashEquity !== null && Math.abs(cashEquity.founderShareAfter - founderShare) >= 0.5;

  return (
    <div
      onClick={disabled ? undefined : onChoose}
      className="rounded-[var(--r-16)] bg-field border border-lineStrong hover:border-accent transition-colors px-[var(--sp-13)] py-[var(--sp-14)] flex flex-col gap-2.5 cursor-pointer"
    >
      <div className="flex flex-col gap-1.5">
        <div className="font-mono text-[length:var(--fs-9)] tracking-[0.14em] text-ink5">{categoryLabel(option.icon)}</div>
        <div className="flex items-center gap-2 min-w-0">
          <CategoryIcon icon={option.icon} colour={industryColour} />
          <div className="text-[length:var(--fs-18)] font-extrabold leading-tight min-w-0 break-words">
            {preview.kind === 'funding' ? preview.lead.firm ?? preview.lead.fullName : renderEventText(option.label, state)}
          </div>
        </div>
      </div>

      {preview.kind === 'funding' && (
        <div className="flex items-center gap-2 bg-inset rounded-[9px] px-2.5 py-1.5">
          <PortraitDisplay portraitSVG={generatePortraitSVG(preview.lead.portrait)} name="" size="sm" />
          <div className="min-w-0">
            <div className="text-[length:var(--fs-12-5)] font-bold text-ink truncate" title={preview.lead.fullName}>
              {preview.lead.fullName}
            </div>
            <div className="font-mono text-[length:var(--fs-9)] text-ink5 truncate uppercase tracking-wide" title={preview.lead.history}>
              {preview.lead.history}
            </div>
          </div>
        </div>
      )}

      <p className="text-[length:var(--fs-12-5)] text-ink4 leading-[1.5] break-words" style={{ maxWidth: '34ch' }}>
        {renderEventText(option.detail, state)}
      </p>

      {option.gamble && (
        <div className="flex flex-col gap-1.5">
          <OddsRow pct={option.gamble.winPct} text={renderEventText(option.gamble.winText, state)} tone="positive" />
          <OddsRow pct={option.gamble.losePct} text={renderEventText(option.gamble.loseText, state)} tone="negative" />
        </div>
      )}

      {mentorHint && (
        <div className="flex items-start gap-2 bg-cautionBg border border-cautionBorder rounded-[9px] px-2.5 py-2">
          <IconPhone className="w-3.5 h-3.5 text-caution shrink-0 mt-[1px]" />
          <p className="text-[length:var(--fs-11-5)] text-ink2 leading-[1.4]">{mentorHint}</p>
        </div>
      )}

      <div className="flex gap-1.5 pt-[var(--sp-12)] mt-auto border-t border-line">
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

function OddsRow({ pct, text, tone }: { pct: number; text: string; tone: 'positive' | 'negative' }) {
  const toneClass = tone === 'positive' ? 'bg-positiveBg border-positiveBorder text-positive' : 'bg-negativeBg border-negativeBorder text-negative';
  return (
    <div className={`flex items-center gap-2.5 border rounded-[7px] px-2.5 py-1.5 ${toneClass}`}>
      <div className="font-mono text-[length:var(--fs-13)] font-bold shrink-0">{pct}%</div>
      <div className="text-[length:var(--fs-11-5)] text-ink2 leading-[1.3]">{text}</div>
    </div>
  );
}

// ============================================================================
// Expanded (chosen) option — outcome text + metric deltas
// ============================================================================

export interface MetricDelta {
  label: string;
  value: string;
  tone: 'positive' | 'negative' | 'neutral';
}

export function ChosenOptionCard({
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
  // Reuse the same preview the player chose from — option.label already
  // spells out the full sentence ("Take money from Alder Lane Partners"),
  // which would otherwise repeat the kicker verbatim right next to it.
  const preview = previewOption(option, state, characterPool);
  const name = preview.kind === 'funding' ? preview.lead.firm ?? preview.lead.fullName : renderEventText(option.label, state);

  return (
    <div className="rounded-[var(--r-16)] bg-cardRaised border border-accent px-[var(--sp-13)] py-[var(--sp-14)] flex flex-col gap-2.5">
      <div className="flex flex-col gap-1.5">
        <div className="font-mono text-[length:var(--fs-9)] tracking-[0.14em] text-ink5">{categoryLabel(option.icon)}</div>
        <div className="flex items-center gap-2 min-w-0">
          <CategoryIcon icon={option.icon} colour={industryColour} />
          <div className="text-[length:var(--fs-18)] font-extrabold leading-tight min-w-0 break-words">{name}</div>
        </div>
      </div>
      <p className="text-[length:var(--fs-12-5)] text-ink4 leading-[1.5] break-words" style={{ maxWidth: '34ch' }}>
        {renderEventText(option.detail, state)}
      </p>

      {gambleResult && (
        <div className={`font-mono text-[length:var(--fs-11)] font-bold tracking-[0.14em] ${gambleResult === 'won' ? 'text-positive' : 'text-negative'}`}>
          {gambleResult === 'won' ? 'THE BET PAID' : 'THE BET MISSED'}
        </div>
      )}

      <div className="pt-[var(--sp-12)] mt-auto border-t border-line flex items-center gap-[var(--sp-16)] min-w-0">
        <p className="flex-1 min-w-0 text-[length:var(--fs-13)] text-ink2 leading-[1.5] break-words" style={{ maxWidth: '60ch' }}>
          {outcomeText}
        </p>
        <div className="shrink-0 grid grid-cols-2 gap-1.5">
          {deltas.map((d) => (
            <div key={d.label} className="bg-fieldRaised rounded-[7px] px-2.5 py-1.5 flex items-center gap-1.5">
              <span className="font-mono text-[length:var(--fs-9-5)] tracking-[0.1em] text-ink5">{d.label.toUpperCase()}</span>
              <span
                className={`font-mono text-[length:var(--fs-12-5)] font-bold ${
                  d.tone === 'positive' ? 'text-positive' : d.tone === 'negative' ? 'text-negative' : 'text-ink3'
                }`}
              >
                {d.value}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** A muted single line for an option that wasn't taken — ~40px tall, opacity .45. */
export function NotTakenRow({ label }: { label: string }) {
  return (
    <div className="h-10 flex items-center justify-between px-[var(--sp-12)] rounded-[10px] bg-panel border border-line opacity-45">
      <span className="text-[length:var(--fs-13-5)] font-semibold text-ink4 truncate">{label}</span>
      <span className="font-mono text-[length:var(--fs-10)] text-ink6 tracking-[0.1em] shrink-0 ml-2">NOT TAKEN</span>
    </div>
  );
}

// ============================================================================
// Mentor hint row ("Call {mentor}" rewarded-ad hint)
// ============================================================================

/**
 * The trigger for the mentor's hidden-cost hint — the hint text itself is
 * never rendered here. It's withheld until watched, and even then it shows
 * up attached to the option card(s) it's actually about (see OptionCard's
 * mentorHint prop), not as a block floating below the option list — seeing
 * it on the card is what makes it read as insight into that choice rather
 * than a popup. This component only ever shows the call-to-action, a
 * loading state while the ad plays, and — once spent — a greyed, disabled
 * row so it's unambiguous the year's call has already been used.
 */
export function MentorHint({
  mentor,
  revealed,
  loading,
  onCall,
}: {
  mentor: Character;
  revealed: boolean;
  loading: boolean;
  onCall?: () => void;
}) {
  const portrait = (
    <div className="w-[34px] h-[34px] rounded-[9px] overflow-hidden shrink-0" dangerouslySetInnerHTML={{ __html: generatePortraitSVG(mentor.portrait) }} />
  );

  if (revealed) {
    return (
      <div className="w-full flex items-center gap-2.5 border border-line rounded-[var(--r-16)] px-[var(--sp-14)] py-2.5 text-left opacity-50 grayscale">
        {portrait}
        <div className="flex-1 min-w-0 flex items-center gap-2.5">
          <IconPhone className="w-4 h-4 text-ink6 shrink-0" />
          <div className="min-w-0">
            <div className="font-semibold text-[length:var(--fs-14-5)] truncate text-ink5">Called {mentor.fullName}</div>
            <div className="text-[length:var(--fs-12)] text-ink6 truncate">Used for this year — see the option it's about.</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <button
      onClick={onCall}
      disabled={loading}
      className="w-full flex items-center gap-2.5 border border-dashed border-lineMuted rounded-[var(--r-16)] px-[var(--sp-14)] py-2.5 text-left hover:border-caution transition-colors disabled:opacity-70 disabled:cursor-wait"
    >
      {portrait}
      <div className="flex-1 min-w-0 flex items-center gap-2.5">
        <IconPhone className="w-4 h-4 text-ink5 shrink-0" />
        <div className="min-w-0">
          <div className="font-semibold text-[length:var(--fs-14-5)] truncate">{loading ? 'Calling…' : `Call ${mentor.fullName}`}</div>
          <div className="text-[length:var(--fs-12)] text-ink4 truncate">
            {loading ? 'One moment.' : `${mentor.fullName} will tell you what these actually cost.`}
          </div>
        </div>
      </div>
      <span className="font-mono text-[length:var(--fs-10-5)] text-caution bg-cautionBg border border-cautionBorder px-2.5 py-1.5 rounded-[6px] whitespace-nowrap shrink-0">
        FREE · 30s AD
      </span>
    </button>
  );
}
