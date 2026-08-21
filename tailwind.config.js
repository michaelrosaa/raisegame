/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Exact palette from the Raise desktop design reference — every
        // screen reads these tokens, never a raw hex, so the palette can't
        // drift between components.

        // Surfaces — warmed off pure neutral, widened so each step reads as
        // a distinct plane instead of the whole app sitting in one dark band.
        ground: '#0D0F14',      // app background
        panel: '#161A23',       // cards, decision panel, rail tiles
        panel2: '#161A23',      // information panel (deeper)
        card: '#12151C',        // results card ground — darker than panel so the
                                 // scorecard reads as a distinct object, not a
                                 // plane that bleeds into the page
        cardBorder: '#232A38',  // results card edge
        field: '#1E242F',       // inputs, option cards, stat cells
        fieldRaised: '#262D3A', // chips, delta pills
        cardRaised: '#262D3A',  // chosen/active cards
        inset: '#161A23',       // portrait rows
        hairline: '#2A3242',    // top bar border
        line: '#2A3242',        // panel borders
        lineStrong: '#3A4456',  // input / option borders
        lineMuted: '#323B4C',   // dashed strips, secondary buttons

        // Text
        ink: '#FFFFFF',    // primary body/heading text
        ink2: '#C7CEDB',   // outcome prose
        ink3: '#A8B2C4',   // tertiary labels
        ink4: '#93A0B5',   // blurbs, notes
        ink5: '#7E8CA3',   // mono labels
        ink6: '#6E7A8E',   // hints, meta
        ink7: '#57637A',   // disabled button text
        ink8: '#454F63',   // unearned badge labels

        // Brand
        accent: '#8B7BF0',
        accentLight: '#B29CF5',
        accentDeep: '#7C6BE8',
        accentDim: '#8A7BC4',   // eyebrows, step captions
        accentTint: '#241F3E',

        // Semantic (fixed, never industry-tinted)
        positive: '#5FC08A',
        positiveBg: '#16291F',
        positiveBorder: '#2E6B45',

        caution: '#E9A13B',
        cautionBg: '#2A2010',
        cautionBorder: '#5A4520',

        negative: '#E36B6B',
        negativeBg: '#2A1616',
        negativeBorder: '#7A3038',

        gold: '#FFD97A',
        goldLabel: '#E0B85E',
        goldBg: '#3D3116',
        goldBorder: '#4A3A12',

        info: '#7FB2E8',
        infoBg: '#16222E',
        infoBorder: '#2E4A6B',
      },
      fontFamily: {
        sans: ['Archivo', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Courier New', 'monospace'],
      },
      keyframes: {
        raiseIn: {
          from: { opacity: 0, transform: 'translateY(-14px)' },
          to: { opacity: 1, transform: 'none' },
        },
        ledgerRowIn: {
          from: { opacity: 0, transform: 'translateX(24px)' },
          to: { opacity: 1, transform: 'none' },
        },
        yearBeatIn: {
          '0%': { opacity: 0.25 },
          '60%': { opacity: 1 },
          '100%': { opacity: 1 },
        },
      },
      animation: {
        raiseIn: 'raiseIn 420ms cubic-bezier(.2,.8,.3,1) both',
        ledgerRowIn: 'ledgerRowIn 420ms cubic-bezier(.2,.8,.3,1) both',
        yearBeatIn: 'yearBeatIn 500ms ease-out both',
      },
    },
  },
  plugins: [],
}
