// Dark theme only — nextstep-mobile/app.json hardcodes "userInterfaceStyle": "dark",
// so a light theme driven by useColorScheme would never activate. Plain constants,
// no provider/context needed.

import { Platform, type ViewStyle } from 'react-native'

// Palette + gradients below match exact computed-style values extracted live from
// the Figma prototype (https://cute-near-11852013.figma.site) via OKLCH->sRGB
// conversion — not estimated from screenshots. See melodic-wobbling-pillow.md plan.
export const colors = {
  primary: '#7F22FE',
  primaryDark: '#5B0EBF',
  primaryDim: 'rgba(127, 34, 254, 0.16)',
  primaryGlow: 'rgba(127, 34, 254, 0.4)',
  bg: '#07080F',
  surface: '#0D0E1A',
  surface2: '#13141F',
  border: 'rgba(255, 255, 255, 0.08)',
  borderHover: 'rgba(255, 255, 255, 0.14)',
  text: '#F0F1FF',
  textSecondary: '#9497AE',
  textMuted: '#565873',
  success: '#00D492',
  warning: '#F59E0B',
  error: '#FF6467',
  orange: '#F97316',
  info: '#00E5FF',
  purple: '#7C3AED',
  buttonSecondaryBorder: 'rgba(255, 255, 255, 0.1)',
} as const

// Diagonal fills used by hero/gradient cards and quick-action icon tiles —
// pass to react-native-svg's <LinearGradient> (no expo-linear-gradient dependency).
export const gradients = {
  hero: ['#7008E7', '#312C85'] as const,
  accent: ['#7F22FE', '#4F39F6'] as const,
} as const

export const gradeColors = {
  A: colors.success,
  B: '#4F8CFF',
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

// Font family names match the keys @expo-google-fonts/inter registers via useFonts
// (see App.tsx) — mirrors web's Inter typeface (app/globals.css / next/font) so the
// app no longer inherits whatever font-style setting the device happens to have.
export const fonts = {
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semiBold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
} as const

export const typography = {
  display: { fontSize: 32, fontFamily: fonts.bold, fontWeight: '700' as const },
  h1: { fontSize: 24, fontFamily: fonts.bold, fontWeight: '700' as const },
  h2: { fontSize: 20, fontFamily: fonts.semiBold, fontWeight: '600' as const },
  h3: { fontSize: 16, fontFamily: fonts.semiBold, fontWeight: '600' as const },
  body: { fontSize: 15, fontFamily: fonts.regular, fontWeight: '400' as const, lineHeight: 15 * 1.6 },
  caption: { fontSize: 12, fontFamily: fonts.regular, fontWeight: '400' as const },
  label: {
    fontSize: 12,
    fontFamily: fonts.medium,
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
