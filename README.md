# Raise - Project Setup Complete

## Architecture Established

### Three-Layer Structure ✓
- **`src/content/`** - JSON only data files (no code, no imports)
- **`src/engine/`** - Pure game logic (no React, no DOM)
- **`src/ui/`** - React components (renders state, emits choices)

### Content Layer
```
src/content/
  events/
    - everyday.json
    - family.json
    - geopolitical.json
    - economic.json
    - internal.json
    - absurd.json
    - gambles.json
  - ideas.json
  - characters.json
  - firms.json
  - countries.json
  - titles.json
  - awards.json
```

### Engine Layer (Modules to be implemented)
- `types.ts` - TypeScript interfaces
- `rng.ts` - Seeded PRNG (mulberry32)
- `state.ts` - State management
- `cast.ts` - Character selection & portraits
- `economy.ts` - Financial calculations
- `events.ts` - Event selection & effects
- `macro.ts` - Macro cycle management
- `endings.ts` - Game endings
- `portraits.ts` - SVG portrait generation
- `simulate.ts` - Headless game runner

### UI Layer (To be implemented)
- `screens/` - Setup, gameplay, results
- `components/` - Reusable React components

## Build Setup
- Vite for bundling
- React 18
- TypeScript 5.1
- Tailwind CSS 3.3
- PostCSS with autoprefixer

## Notes for Phase 2
- npm install may need cache cleanup: `npm cache clean --force`
- Simpler approach: Install in VS Code's integrated terminal
- All placeholders ready for implementation
