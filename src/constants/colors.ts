export const colors = {
  primary: '#00C896',
  primaryDark: '#00A87E',
  background: '#0D1117',
  surface: '#161B22',
  border: '#30363D',
  textPrimary: '#E6EDF3',
  textSecondary: '#8B949E',
  textMuted: '#484F58',
  success: '#3FB950',
  warning: '#D29922',
  orange: '#F0883E',
  error: '#F85149',
  info: '#58A6FF',
} as const

export type Color = (typeof colors)[keyof typeof colors]
