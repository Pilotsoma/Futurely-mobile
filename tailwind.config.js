// NativeWind / Tailwind config.
//
// Strategy: color tokens are owned by ThemeContext (JS objects) and applied
// via StyleSheet or inline style props. NativeWind is used for LAYOUT UTILITIES
// only (flex, padding, margin, gap) rather than color classes — this avoids
// the dual-source-of-truth problem where Tailwind classes and JS tokens would
// need to stay in sync manually.
//
// The token names below match tokens.ts so classes like `bg-surface` are
// available if needed, but runtime theming (light/dark) should go through
// useTheme() → theme.colors.* — not through Tailwind dark: variants.
//
// darkMode: 'class' is set here for completeness (NativeWind v4 default);
// we drive dark mode via ThemeProvider + OS colorScheme, not class toggling.

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './App.{js,jsx,ts,tsx}',
    './index.{js,jsx,ts,tsx}',
    './src/**/*.{js,jsx,ts,tsx}',
  ],
  presets: [require('nativewind/preset')],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // ── Dark (default) tokens — match darkTheme in tokens.ts ──────────────
        bg:             '#0D1829',
        surface:        '#162235',
        'surface-2':    '#1C2D47',
        'surface-3':    '#233456',
        border:         '#273D5E',
        'border-hover': '#2F4970',
        primary:        '#2979FF',
        'primary-dark': '#1B4DB0',
        'accent-blue':  '#00E5FF',
        text:           '#E8EEFF',
        'text-secondary': '#96AACC',
        'text-muted':   '#52698A',
        success:        '#10B981',
        warning:        '#F59E0B',
        orange:         '#F97316',
        error:          '#EF4444',
        info:           '#00E5FF',
        purple:         '#7C3AED',
        // Grade colors
        'grade-a':      '#10B981',
        'grade-b':      '#2979FF',
        'grade-c':      '#F59E0B',
        'grade-d':      '#F97316',
        'grade-f':      '#EF4444',
      },
      borderRadius: {
        sm:   '8px',
        md:   '10px',
        lg:   '12px',
        xl:   '16px',
        full: '9999px',
      },
      spacing: {
        'screen-x':   '20px',
        'card-pad':   '16px',
        'section-gap':'24px',
        'touch':      '44px',
      },
    },
  },
  plugins: [],
}
