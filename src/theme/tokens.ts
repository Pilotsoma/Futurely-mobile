// Dark theme only — nextstep-mobile/app.json hardcodes "userInterfaceStyle": "dark",
// so a light theme driven by useColorScheme would never activate. Plain constants,
// no provider/context needed.

import { Platform, type ViewStyle } from 'react-native'

export const colors = {
  primary: '#2979FF',
  primaryDark: '#1B4DB0',
  primaryDim: 'rgba(41, 121, 255, 0.16)',
  primaryGlow: 'rgba(41, 121, 255, 0.4)',
  bg: '#0D1829',
  surface: '#162235',
  surface2: '#1C2D47',
  border: '#273D5E',
  borderHover: '#2F4970',
  text: '#E8EEFF',
  textSecondary: '#96AACC',
  textMuted: '#52698A',
  success: '#10B981',
  warning: '#F59E0B',
  error: '#EF4444',
  orange: '#F97316',
  info: '#00E5FF',
  purple: '#7C3AED',
  buttonSecondaryBorder: '#1A2744',
} as const

export const gradeColors = {
  A: colors.success,
  B: colors.primary,
  C: colors.warning,
  D: colors.orange,
  F: colors.error,
} as const

export const spacing = {
  xs: 4,
  sm: 8,
  ms: 12,
  md: 16,
  lg: 20,
  xl: 24,
  xxl: 32,
  xxxl: 40,
  huge: 48,
  massive: 64,
  cardPadding: 16,
  screenPadding: 20,
  sectionGap: 24,
} as const

// Progressive scale matching what the web app actually ships (app/globals.css,
// app/login/page.tsx inline styles) — DESIGN_SYSTEM.md's flatter 8/12 scale was
// stale relative to the real brand.
export const radii = {
  xs: 8,
  sm: 10,
  md: 16,
  lg: 20,
  xl: 24,
} as const

function makeShadow(opacity: number, radius: number, elevationValue: number, offsetY: number): ViewStyle {
  return Platform.select<ViewStyle>({
    android: { elevation: elevationValue },
    default: {
      shadowColor: '#000000',
      shadowOffset: { width: 0, height: offsetY },
      shadowOpacity: opacity,
      shadowRadius: radius,
    },
  }) as ViewStyle
}

// Mirrors web's --shadow-sm/--shadow-md (app/globals.css), tuned for RN's
// shadow props (dark-theme opacities carried over from the dark `html[data-theme="dark"]` block).
export const elevation = {
  sm: makeShadow(0.22, 6, 3, 1),
  md: makeShadow(0.34, 12, 6, 3),
} as const

export const typography = {
  display: { fontSize: 32, fontWeight: '700' as const },
  h1: { fontSize: 24, fontWeight: '700' as const },
  h2: { fontSize: 20, fontWeight: '600' as const },
  h3: { fontSize: 16, fontWeight: '600' as const },
  body: { fontSize: 15, fontWeight: '400' as const, lineHeight: 15 * 1.6 },
  caption: { fontSize: 12, fontWeight: '400' as const },
  label: {
    fontSize: 12,
    fontWeight: '500' as const,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.6,
  },
} as const

export const touchTarget = 44

// Mirrors web's --dur-fast/base/slow and --ease-spring/out-expo (app/globals.css).
// Reanimated's `Easing` uses bezier control points, not CSS cubic-bezier strings,
// so these are duration/spring-config pairs rather than literal easing curves.
export const animation = {
  navTransitionMs: 250,
  microInteractionMs: 150,
  durFast: 120,
  durBase: 220,
  durSlow: 380,
  spring: { damping: 14, stiffness: 180, mass: 0.9 },
} as const
