export const colors = {
  primary: '#7B61FF',
  primaryDark: '#5B3FDB',
  background: '#07080F',
  surface: '#0D0E1C',
  border: '#1C1F3C',
  textPrimary: '#EDEEFF',
  textSecondary: '#8B8FB5',
  textMuted: '#40435E',
  success: '#34D399',
  warning: '#FBBF24',
  orange: '#FB923C',
  error: '#F87171',
  info: '#38BDF8',
} as const

export type Color = (typeof colors)[keyof typeof colors]
