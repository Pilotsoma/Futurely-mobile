import { colors } from './colors'

export interface GradeBadgeConfig {
  text: string
  bg: string
}

export const GRADE_BADGE_CONFIG: Readonly<Record<string, GradeBadgeConfig>> = {
  A: { text: colors.success, bg: `${colors.success}26` },
  B: { text: colors.info,    bg: `${colors.info}26` },
  C: { text: colors.warning, bg: `${colors.warning}26` },
  D: { text: colors.orange,  bg: `${colors.orange}26` },
  F: { text: colors.error,   bg: `${colors.error}26` },
}

export const FALLBACK_GRADE_CONFIG: GradeBadgeConfig = {
  text: colors.textMuted,
  bg: colors.surface,
}

export function getGradeBadgeConfig(letterGrade: string): GradeBadgeConfig {
  return GRADE_BADGE_CONFIG[letterGrade.charAt(0).toUpperCase()] ?? FALLBACK_GRADE_CONFIG
}

export const COURSE_TYPE_LABELS: Partial<Record<string, string>> = {
  HONORS: 'Honors',
  AP: 'AP',
  IB: 'IB',
}
