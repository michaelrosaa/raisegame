/**
 * Phase 5 standalone verification harness.
 * Not a real game screen — a throwaway page for visually confirming the
 * portrait system meets its acceptance test before Phase 6 (Screens) starts
 * wiring it into actual gameplay. Portraits have failed three times in the
 * prototype; the spec explicitly calls for visual verification, not just a
 * code read.
 */

import type { Character, CharacterTemplate, PortraitSeed } from '../../engine/types';
import { createCharacterFromTemplate, portraitsAreIdentical, validateCastDiversity, HAIR_SHAPES, ACCESSORY_TYPES } from '../../engine/cast';
import { generatePortraitSVG } from '../../engine/portraits';
import { PortraitDisplay, Card } from '../components/ui';
import characterTemplates from '../../content/characters.json';

// Pad the 10 shipped characters to 12 with two synthetic ones so the
// acceptance test ("render 12 portraits side by side") is literal, not
// approximate.
const EXTRA_TEMPLATES: CharacterTemplate[] = [
  { id: 'char-extra-1', fullName: 'Naledi Mokoena', gender: 'f', role: 'staff', history: 'first engineering hire', sentiment: 65 },
  { id: 'char-extra-2', fullName: 'Teodor Vance', gender: 'nb', role: 'staff', history: 'runs support solo', sentiment: 55 },
];

function buildCast(templates: CharacterTemplate[]): Character[] {
  let cast: Character[] = [];
  for (const t of templates) {
    cast = [...cast, createCharacterFromTemplate(t, cast)];
  }
  return cast;
}

function findDuplicatePortraitPairs(cast: Character[]): [Character, Character][] {
  const pairs: [Character, Character][] = [];
  for (let i = 0; i < cast.length; i++) {
    for (let j = i + 1; j < cast.length; j++) {
      if (portraitsAreIdentical(cast[i], cast[j])) {
        pairs.push([cast[i], cast[j]]);
      }
    }
  }
  return pairs;
}

const BASE_SEED: PortraitSeed = { background: 0, skin: 4, hairShape: 0, hairColour: 0, clothing: 3, accessory: 0 };

export function PortraitGalleryScreen() {
  // Only 14 background colours exist (BACKGROUND_PALETTE) and buildCast
  // throws once they're exhausted — content has grown well past 14
  // characters since this screen was written, so cap the sample at 10 (+2
  // synthetic) to keep the literal "12 portraits" acceptance test literal.
  const cast = buildCast([...(characterTemplates as CharacterTemplate[]).slice(0, 10), ...EXTRA_TEMPLATES]);
  const diversity = validateCastDiversity(cast);
  const duplicates = findDuplicatePortraitPairs(cast);

  return (
    <div className="min-h-screen bg-neutral-900 text-white p-8">
      <div className="max-w-5xl mx-auto flex flex-col gap-10">
        <div>
          <h1 className="text-3xl font-bold mb-1">Phase 5 — Portrait Verification</h1>
          <p className="text-gray-400 text-sm">
            {cast.length} characters, deterministic SVG portraits, one background colour per run.
          </p>
        </div>

        {/* Automated checks */}
        <Card className={diversity.valid && duplicates.length === 0 ? 'border-green-700' : 'border-red-700'}>
          <div className="font-mono text-sm space-y-1">
            <div>
              Background diversity: {diversity.valid ? '✓ all unique' : `✗ ${diversity.error}`}
            </div>
            <div>
              Duplicate portraits: {duplicates.length === 0 ? '✓ none' : `✗ ${duplicates.length} pair(s)`}
            </div>
          </div>
        </Card>

        {/* Acceptance test: 12 portraits at 32px, side by side */}
        <div>
          <h2 className="text-sm font-mono uppercase tracking-widest text-gray-400 mb-4">
            Acceptance test — 32px, side by side
          </h2>
          <div className="flex flex-wrap gap-4 bg-neutral-950 p-6 rounded-lg">
            {cast.map((c) => (
              <PortraitDisplay key={c.id} portraitSVG={generatePortraitSVG(c.portrait)} name="" size="xs" />
            ))}
          </div>
        </div>

        {/* Detail view for manual inspection */}
        <div>
          <h2 className="text-sm font-mono uppercase tracking-widest text-gray-400 mb-4">Detail view</h2>
          <div className="grid grid-cols-4 sm:grid-cols-6 gap-6">
            {cast.map((c) => (
              <div key={c.id} className="flex flex-col items-center gap-2">
                <PortraitDisplay portraitSVG={generatePortraitSVG(c.portrait)} name={c.fullName} size="lg" />
                <div className="text-xs text-gray-500 font-mono">bg {c.portrait.background}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Isolated hair-shape grid — every shape on the same skin/hair/clothing/bg */}
        <div>
          <h2 className="text-sm font-mono uppercase tracking-widest text-gray-400 mb-4">Hair shapes, isolated (accessory none)</h2>
          <div className="grid grid-cols-4 sm:grid-cols-6 gap-6">
            {HAIR_SHAPES.map((name, i) => (
              <div key={name} className="flex flex-col items-center gap-2">
                <PortraitDisplay portraitSVG={generatePortraitSVG({ ...BASE_SEED, hairShape: i })} name={name} size="lg" />
                <div className="text-xs text-gray-500 font-mono">{i} {name}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Isolated accessory grid — every accessory on the same hair/skin/clothing/bg */}
        <div>
          <h2 className="text-sm font-mono uppercase tracking-widest text-gray-400 mb-4">Accessories, isolated (short-crop hair)</h2>
          <div className="grid grid-cols-4 sm:grid-cols-6 gap-6">
            {ACCESSORY_TYPES.map((name, i) => (
              <div key={name} className="flex flex-col items-center gap-2">
                <PortraitDisplay portraitSVG={generatePortraitSVG({ ...BASE_SEED, accessory: i })} name={name} size="lg" />
                <div className="text-xs text-gray-500 font-mono">{i} {name}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
