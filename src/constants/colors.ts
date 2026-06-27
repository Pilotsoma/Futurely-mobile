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
  background: '#0D1829',
  surface:    '#162235',
  surface2:   '#1C2D47',

  // Borders
  border:      '#273D5E',
  borderHover: '#2F4970',

  // Text
  textPrimary:   '#E8EEFF',
  textSecondary: '#96AACC',
  textMuted:     '#52698A',

  // Status
  success: '#10B981',
  warning: '#F59E0B',
  orange:  '#F97316',
  error:   '#EF4444',
  info:    '#00E5FF',
} as const

export type Color = (typeof colors)[keyof typeof colors]
