/**
 * SVG Portrait Generation
 * Builds flat SVG portraits from 6 deterministic layers (see cast.ts's
 * generatePortraitSeed — background/skin/hairShape/hairColour/clothing/
 * accessory, all drawn from a hash of the character's full name).
 *
 * Canvas is 100×100, rx=14 rounded square, no outlines, no gradients, flat
 * fills only (accessories are the one deliberate exception — glasses read
 * as glasses only with a stroked lens, not a filled one).
 *
 * Draw order: background, shoulders, neck, head, hair, accessory — except
 * afro (hairShape 3), which draws behind the head by design, and headscarf
 * (accessory 6), which REPLACES the hair layer rather than composing with
 * it (you can't see hair under a headscarf).
 */

import type { PortraitSeed } from './types';
import { BACKGROUND_PALETTE, SKIN_PALETTE, HAIR_COLOUR_PALETTE, CLOTHING_PALETTE } from './cast';

const CANVAS = 100;

// ============================================================================
// Base construction — shoulders, neck, head. Same for every character;
// only the fill colours (skin/clothing) vary.
// ============================================================================

function shouldersSVG(colour: string): string {
  return `<path d="M 14,100 C 14,74 32,64 50,64 C 68,64 86,74 86,100 Z" fill="${colour}"/>`;
}

function neckSVG(colour: string): string {
  return `<rect x="42" y="52" width="16" height="16" fill="${colour}"/>`;
}

function headSVG(colour: string): string {
  return `<circle cx="50" cy="40" r="21" fill="${colour}"/>`;
}

// ============================================================================
// Hair — 12 shapes, indices match cast.ts's HAIR_SHAPES exactly.
// ============================================================================

/** The base "short crop" cap most other shapes build on: an arc over the
 * top of the head from x=29 to x=71, its lower edge mostly straight at
 * y=32 but dipping to y=34 at centre. */
function shortCropCap(colour: string): string {
  return `<path d="M 29,32 A 21 21 0 0 1 71,32 Q 50,34 29,32 Z" fill="${colour}"/>`;
}

function generateHairSVG(shapeIndex: number, colour: string): string {
  switch (shapeIndex) {
    case 0: // short crop
      return shortCropCap(colour);

    case 1: // long straight — cap plus two straight side panels
      return [
        shortCropCap(colour),
        `<rect x="27" y="30" width="8" height="42" rx="4" fill="${colour}"/>`,
        `<rect x="65" y="30" width="8" height="42" rx="4" fill="${colour}"/>`,
      ].join('');

    case 2: { // curly volume — 7 overlapping circles arced from (30,30) to (70,30), peak at (50,22)
      const xs = [30, 36.67, 43.33, 50, 56.67, 63.33, 70];
      const circles = xs
        .map((x) => {
          const t = (x - 50) / 20;
          const y = 30 - 8 * (1 - t * t);
          return `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="11" fill="${colour}"/>`;
        })
        .join('');
      return circles;
    }

    case 3: // afro — drawn behind the head by generatePortraitSVG, not here
      return `<circle cx="50" cy="33" r="29" fill="${colour}"/>`;

    case 4: // bun — cap plus a circle on top
      return [shortCropCap(colour), `<circle cx="50" cy="14" r="10" fill="${colour}"/>`].join('');

    case 5: // shaved — a thin band following the head's upper edge, 60% opacity
      return `<path d="M 29,40 A 21 21 0 0 1 71,40" fill="none" stroke="${colour}" stroke-width="4" opacity="0.6"/>`;

    case 6: // receding — narrower cap (33 to 67) with a shallow M-notch at the brow
      return `<path d="M 33,32 A 19 19 0 0 1 67,32 Q 58,40 50,34 Q 42,40 33,32 Z" fill="${colour}"/>`;

    case 7: // bob — cap plus two rounded side panels ending at jaw height
      return [
        shortCropCap(colour),
        `<rect x="26" y="30" width="9" height="26" rx="4" fill="${colour}"/>`,
        `<rect x="65" y="30" width="9" height="26" rx="4" fill="${colour}"/>`,
      ].join('');

    case 8: { // long wavy — cap plus two wave-path strands
      const left = `<path d="M 27,30 Q 22,50 30,62 Q 24,72 29,80 L 37,80 Q 32,72 38,62 Q 30,50 35,30 Z" fill="${colour}"/>`;
      const right = `<path d="M 73,30 Q 78,50 70,62 Q 76,72 71,80 L 63,80 Q 68,72 62,62 Q 70,50 65,30 Z" fill="${colour}"/>`;
      return shortCropCap(colour) + left + right;
    }

    case 9: { // braids — cap plus two columns of 3 stacked circles
      const ys = [44, 58, 72];
      const dots = [28, 72].flatMap((x) => ys.map((y) => `<circle cx="${x}" cy="${y}" r="5" fill="${colour}"/>`)).join('');
      return shortCropCap(colour) + dots;
    }

    case 10: // side-part — asymmetric cap, full coverage left of a diagonal parting
      return `<path d="M 29,32 A 21 21 0 0 1 68,34 L 58,20 Q 40,18 29,32 Z" fill="${colour}"/>`;

    case 11: // bald with fringe — thin crescent across the brow only, no cap
      return `<path d="M 32,32 Q 50,27 68,32 Q 50,37 32,32 Z" fill="${colour}"/>`;

    default:
      return shortCropCap(colour);
  }
}

// ============================================================================
// Accessories — 8 types, indices match cast.ts's ACCESSORY_TYPES exactly.
// ============================================================================

const LENS_STROKE = '#1A1A1A';

function generateAccessorySVG(accessoryIndex: number, hairColour: string, clothingColour: string, seed: PortraitSeed): string {
  switch (accessoryIndex) {
    case 1: // glasses — two rounded rects with a bridge between
      return [
        `<rect x="30" y="38" width="16" height="12" rx="3" fill="none" stroke="${LENS_STROKE}" stroke-width="2" stroke-opacity="0.7"/>`,
        `<rect x="54" y="38" width="16" height="12" rx="3" fill="none" stroke="${LENS_STROKE}" stroke-width="2" stroke-opacity="0.7"/>`,
        `<line x1="46" y1="44" x2="54" y2="44" stroke="${LENS_STROKE}" stroke-width="4" stroke-opacity="0.7"/>`,
      ].join('');

    case 2: // round glasses — two circles with a bridge between
      return [
        `<circle cx="38" cy="44" r="8" fill="none" stroke="${LENS_STROKE}" stroke-width="2" stroke-opacity="0.7"/>`,
        `<circle cx="62" cy="44" r="8" fill="none" stroke="${LENS_STROKE}" stroke-width="2" stroke-opacity="0.7"/>`,
        `<line x1="46" y1="44" x2="54" y2="44" stroke="${LENS_STROKE}" stroke-width="2" stroke-opacity="0.7"/>`,
      ].join('');

    case 3: // beard — hugs the lower head circle, extends below the chin
      return `<path d="M 30,44 A 22 22 0 0 0 70,44 Q 70,60 50,69 Q 30,60 30,44 Z" fill="${hairColour}"/>`;

    case 4: // moustache
      return `<rect x="41" y="50" width="18" height="5" rx="2.5" fill="${hairColour}"/>`;

    case 5: // earrings
      return `<circle cx="28" cy="46" r="3" fill="#D9A34E"/><circle cx="72" cy="46" r="3" fill="#D9A34E"/>`;

    case 7: { // cap — half-disc over the top, clipped at y=32, plus a peak
      return [
        `<path d="M 27,32 A 23 23 0 0 1 73,32 Z" fill="${clothingColour}"/>`,
        `<rect x="50" y="28" width="26" height="5" rx="2.5" fill="${clothingColour}"/>`,
      ].join('');
    }

    // case 6 (headscarf) is handled by generatePortraitSVG directly, since it
    // replaces the hair layer rather than composing after it — see there.
    default:
      void seed;
      return '';
  }
}

/** Headscarf's own colour is drawn from the clothing palette at a fixed
 * offset from the character's actual clothing colour, so it reads as
 * fabric rather than matching (or clashing arbitrarily with) their outfit. */
function headscarfColour(seed: PortraitSeed): string {
  return CLOTHING_PALETTE[(seed.clothing + 4) % CLOTHING_PALETTE.length];
}

function headscarfSVG(seed: PortraitSeed): string {
  const colour = headscarfColour(seed);
  return `<path d="M 30,46 Q 30,20 50,18 Q 70,20 70,46 Q 74,52 70,58 L 30,58 Q 26,52 30,46 Z" fill="${colour}"/>`;
}

// ============================================================================
// Assembly
// ============================================================================

const HEADSCARF_ACCESSORY = 6;
const AFRO_HAIR_SHAPE = 3;

/**
 * Generate SVG for a portrait. Returns the complete <svg> element as a
 * string, on a 100×100 canvas.
 */
export function generatePortraitSVG(seed: PortraitSeed): string {
  const bgColor = BACKGROUND_PALETTE[seed.background];
  const skinColor = SKIN_PALETTE[seed.skin];
  const hairColor = HAIR_COLOUR_PALETTE[seed.hairColour];
  const clothingColor = CLOTHING_PALETTE[seed.clothing];

  const isHeadscarf = seed.accessory === HEADSCARF_ACCESSORY;
  const hairLayer = isHeadscarf ? '' : generateHairSVG(seed.hairShape, hairColor);
  const accessoryLayer = isHeadscarf ? headscarfSVG(seed) : generateAccessorySVG(seed.accessory, hairColor, clothingColor, seed);

  // Afro draws behind the head (the head circle paints over its lower
  // edge); every other hair shape draws after it, on top.
  const hairBehindHead = !isHeadscarf && seed.hairShape === AFRO_HAIR_SHAPE ? hairLayer : '';
  const hairAfterHead = !isHeadscarf && seed.hairShape !== AFRO_HAIR_SHAPE ? hairLayer : '';

  // width/height MUST be percentage, not the literal canvas size — every
  // caller places this inside a fixed-size container (32px, 64px, ...) via
  // dangerouslySetInnerHTML with no surrounding CSS to rescale a raw pixel
  // SVG, so a literal "100" here rendered at 100×100 CSS px and got clipped
  // to that container's top-left corner instead of scaling down to fit.
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CANVAS} ${CANVAS}" width="100%" height="100%">
      <rect width="${CANVAS}" height="${CANVAS}" rx="14" fill="${bgColor}"/>
      ${shouldersSVG(clothingColor)}
      ${neckSVG(skinColor)}
      ${hairBehindHead}
      ${headSVG(skinColor)}
      ${hairAfterHead}
      ${accessoryLayer}
    </svg>
  `;

  return svg.trim();
}

// ============================================================================
// Image Export
// ============================================================================

/**
 * Convert SVG string to data URL
 */
export function portraitToDataURL(seed: PortraitSeed): string {
  const svg = generatePortraitSVG(seed);
  const encoded = encodeURIComponent(svg);
  return `data:image/svg+xml;charset=utf-8,${encoded}`;
}

// Rasterizing a portrait to a <canvas> PNG requires `document`/`Image`, which
// makes it a ui/ concern, not an engine/ one (engine/ must run in Node with
// no browser — see architecture rule). That belongs with the Phase 7 sharing
// / results-card export work, not here.
