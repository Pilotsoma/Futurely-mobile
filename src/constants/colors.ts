// Futurely brand design tokens
export const colors = {
  // Brand primaries
  cyan:     '#00E5FF',
  blue:     '#2979FF',
  purple:   '#7C3AED',
  teal:     '#00BCD4',
  lavender: '#A855F7',

  // Semantic aliases — used throughout the app
  primary:     '#2979FF',
  primaryDark: '#1B4DB0',

  // Backgrounds
  background: '#050B18',
  surface:    '#0D1627',
  surface2:   '#111C35',

  // Borders
  border:      '#1A2744',
  borderHover: '#243357',

  // Text
  textPrimary:   '#E8EEFF',
  textSecondary: '#7B8DB0',
  textMuted:     '#3D4F72',

  // Status
  success: '#10B981',
  warning: '#F59E0B',
  orange:  '#F97316',
  error:   '#EF4444',
  info:    '#00E5FF',
} as const

export type Color = (typeof colors)[keyof typeof colors]
