import React from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { Feather } from '@expo/vector-icons'
import { colors, radii, spacing, typography } from '../../theme/tokens'

interface UnsupportedPortalBlockProps {
  /** e.g. "Schedule", "Report Card", "Progress Report" */
  feature: string
}

// Renders when the backend returns error.code === 'UNSUPPORTED' — the 6 HAC-only
// grades endpoints (schedule/info/classwork/report-card/progress-report/attendance/
// contact-teachers) return this for PowerSchool-connected users.
export function UnsupportedPortalBlock({ feature }: UnsupportedPortalBlockProps): React.JSX.Element {
  return (
    <View style={styles.container}>
      <Feather name="info" size={28} color={colors.info} />
      <Text style={styles.title}>Not available for PowerSchool</Text>
      <Text style={styles.message}>
        {feature} is only available for HAC-connected schools. Your district uses PowerSchool,
        which doesn&apos;t expose this data.
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.xl,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  title: { ...typography.h3, color: colors.text },
  message: { fontSize: typography.body.fontSize, color: colors.textSecondary, textAlign: 'center' },
})
