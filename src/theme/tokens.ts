// Futurely design tokens — mobile
// Source of truth: app/globals.css (CSS custom properties)
// Light = :root, Dark = html[data-theme="dark"]
// Keep in sync with globals.css any time tokens change.

export interface ColorTokens {
  // Backgrounds
  bg: string
  surface: string
  surface2: string
  surface3: string
  // Borders
  border: string
  borderHover: string
  // Interactive
  primary: string
  primaryDark: string
  primaryDim: string
  primaryGlow: string
  accentBlue: string
  // Text
  text: string
  textSecondary: string
  textMuted: string
  // Semantic
  success: string
  warning: string
  orange: string
  error: string
  info: string
  purple: string
  // Grade colors (same in both themes)
  gradeA: string
  gradeB: string
  gradeC: string
  gradeD: string
  gradeF: string
}

export interface TypographyTokens {
  // Font sizes
  fontSizeXs: number      // 11
  fontSizeSm: number      // 12.5 — use 13 on RN (no sub-integer sizing)
  fontSizeSmMd: number    // 13
  fontSizeMd: number      // 14
  fontSizeBase: number    // 15
  fontSizeLg: number      // 16
  fontSizeXl: number      // 18
  fontSize2xl: number     // 22
  fontSize3xl: number     // 24
  // Font weights (RN uses string or number, not CSS keywords)
  weightRegular: '400'
  weightMedium: '500'
  weightSemibold: '600'
  weightBold: '700'
  weightExtrabold: '800'
  // Line heights
  lineHeightBody: number    // 1.55 × base
  lineHeightHeading: number // 1.3 × heading
}

export interface SpacingTokens {
  xs: number   // 2
  sm: number   // 4
  md: number   // 8
  lg: number   // 12
  xl: number   // 16
  xl2: number  // 20
  xl3: number  // 24
  xl4: number  // 28
  xl5: number  // 32
  xl6: number  // 44
  xl7: number  // 48
  xl8: number  // 64
  // Named aliases
  screenPaddingH: number  // 20
  cardPadding: number     // 16
  sectionGap: number      // 24
  touchTarget: number     // 44 — minimum touch target per ENGINEERING_RULES
}

export interface RadiusTokens {
  sm: number   // 8
  md: number   // 10
  lg: number   // 12
  xl: number   // 16
  full: number // 9999
}

export interface Theme {
  colors: ColorTokens
  typography: TypographyTokens
  spacing: SpacingTokens
  radius: RadiusTokens
}

// ── Light theme ────────────────────────────────────────────────────────────────
const lightColors: ColorTokens = {
  bg:           '#F0F4FF',
  surface:      '#FFFFFF',
  surface2:     '#E8EEFF',
  surface3:     '#D4DBFF',
  border:       '#C0CCE8',
  borderHover:  '#A0B0D8',
  primary:      '#2979FF',
  primaryDark:  '#1B4DB0',
  primaryDim:   'rgba(41,121,255,0.07)',
  primaryGlow:  'rgba(41,121,255,0.15)',
  accentBlue:   '#00BCD4',
  text:         '#050B18',
  textSecondary:'#3D4F72',
  textMuted:    '#7B8DB0',
  success:      '#10B981',
  warning:      '#F59E0B',
  orange:       '#F97316',
  error:        '#EF4444',
  info:         '#00E5FF',
  purple:       '#7C3AED',
  gradeA:       '#10B981',
  gradeB:       '#2979FF',
  gradeC:       '#F59E0B',
  gradeD:       '#F97316',
  gradeF:       '#EF4444',
}

// ── Dark theme ─────────────────────────────────────────────────────────────────
const darkColors: ColorTokens = {
  bg:           '#0D1829',
  surface:      '#162235',
  surface2:     '#1C2D47',
  surface3:     '#233456',
  border:       '#273D5E',
  borderHover:  '#2F4970',
  primary:      '#2979FF',
  primaryDark:  '#1B4DB0',
  primaryDim:   'rgba(41,121,255,0.10)',
  primaryGlow:  'rgba(41,121,255,0.25)',
  accentBlue:   '#00E5FF',
  text:         '#E8EEFF',
  textSecondary:'#96AACC',
  textMuted:    '#52698A',
  success:      '#10B981',
  warning:      '#F59E0B',
  orange:       '#F97316',
  error:        '#EF4444',
  info:         '#00E5FF',
  purple:       '#7C3AED',
  gradeA:       '#10B981',
  gradeB:       '#2979FF',
  gradeC:       '#F59E0B',
  gradeD:       '#F97316',
  gradeF:       '#EF4444',
}

// ── Typography (shared) ────────────────────────────────────────────────────────
const typography: TypographyTokens = {
  fontSizeXs:        11,
  fontSizeSm:        13, // 12.5 rounded up — RN handles integer sizes reliably
  fontSizeSmMd:      13,
  fontSizeMd:        14,
  fontSizeBase:      15,
  fontSizeLg:        16,
  fontSizeXl:        18,
  fontSize2xl:       22,
  fontSize3xl:       24,
  weightRegular:     '400',
  weightMedium:      '500',
  weightSemibold:    '600',
  weightBold:        '700',
  weightExtrabold:   '800',
  lineHeightBody:    1.55,
  lineHeightHeading: 1.3,
}

// ── Spacing (shared) ──────────────────────────────────────────────────────────
const spacing: SpacingTokens = {
  xs:            2,
  sm:            4,
  md:            8,
  lg:            12,
  xl:            16,
  xl2:           20,
  xl3:           24,
  xl4:           28,
  xl5:           32,
  xl6:           44,
  xl7:           48,
  xl8:           64,
  screenPaddingH: 20,
  cardPadding:    16,
  sectionGap:     24,
  touchTarget:    44,
}

// ── Border radius (shared) ────────────────────────────────────────────────────
const radius: RadiusTokens = {
  sm:   8,
  md:   10,
  lg:   12,
  xl:   16,
  full: 9999,
}

export const lightTheme: Theme = {
  colors: lightColors,
  typography,
  spacing,
  radius,
}

export const darkTheme: Theme = {
  colors: darkColors,
  typography,
  spacing,
  radius,
}
