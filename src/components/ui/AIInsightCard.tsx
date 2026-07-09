import React from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { MaterialCommunityIcons } from '@expo/vector-icons'
import { Card } from './Card'
import { colors, fonts, radii, spacing, typography } from '../../theme/tokens'

interface AIInsightCardProps {
  message: string
  title?: string
}

// Matches the Figma prototype's "AI INSIGHT" callout — a purple-tinted card
// distinct from data cards, reused on Dashboard, Course Detail, and Planner.
export function AIInsightCard({ message, title = 'AI Insight' }: AIInsightCardProps): React.JSX.Element {
  return (
    <Card style={styles.card}>
      <View style={styles.iconBadge}>
        <MaterialCommunityIcons name="brain" size={16} color={colors.primary} />
      </View>
      <View style={styles.content}>
        <Text style={styles.label}>{title.toUpperCase()}</Text>
        <Text style={styles.message}>{message}</Text>
      </View>
    </Card>
  )
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    gap: spacing.sm,
    backgroundColor: 'rgba(127, 34, 254, 0.08)',
    borderColor: 'rgba(127, 34, 254, 0.2)',
  },
  iconBadge: {
    width: 32,
    height: 32,
    borderRadius: radii.sm,
    backgroundColor: colors.primaryDim,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  content: { flex: 1, gap: 4 },
  label: {
    ...typography.label,
    fontFamily: fonts.bold,
    color: colors.primary,
  },
  message: { ...typography.body, color: colors.text, lineHeight: 20 },
})
