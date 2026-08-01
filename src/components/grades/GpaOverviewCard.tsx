import React, { useState } from 'react'
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { Feather } from '@expo/vector-icons'

import type { CurrentGradeCourse, GpaSummary } from '../../types/grades'
import { getGpaDisplayValues, formatGpa } from '../../features/grades/academicSummary'
import { Card } from '../ui/Card'
import { elevation, fonts } from '../../theme/tokens'

interface GpaOverviewCardProps {
  summary: GpaSummary | null
  courses: CurrentGradeCourse[]
  loading?: boolean
  error?: string | null
  syncing?: boolean
  hidden?: boolean
  onPress?: () => void
  onSync?: () => void
  testID?: string
}

export function GpaOverviewCard({
  summary,
  courses,
  loading = false,
  error = null,
  syncing = false,
  hidden = false,
  onPress,
  onSync,
  testID = 'gpa-overview-card',
}: GpaOverviewCardProps): React.JSX.Element {
  const [focused, setFocused] = useState(false)
  const [hovered, setHovered] = useState(false)
  const values = getGpaDisplayValues(summary, courses)
  const hasGpa = values.unweighted !== null || values.weighted !== null

  const stateLabel = loading
    ? 'Loading GPA'
    : error
      ? error
      : hasGpa
        ? `Unweighted GPA ${formatGpa(values.unweighted)}, weighted GPA ${formatGpa(values.weighted)}`
        : 'No GPA data available'

  return (
    <View style={styles.shell}>
      <Pressable
      testID={testID}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel="GPA overview"
      accessibilityHint={onPress ? 'Opens the GPA simulator' : undefined}
      accessibilityValue={{ text: stateLabel }}
      disabled={!onPress}
      onPress={onPress}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      style={({ pressed }) => [
        styles.pressable,
        hovered && onPress && styles.hovered,
        focused && onPress && styles.focused,
        pressed && onPress && styles.pressed,
      ]}
    >
      <Card
        variant="gradient"
        gradientColors={['#6430F1', '#493DEB']}
        radius={24}
        style={styles.gpaContent}
      >
        <View pointerEvents="none" style={styles.gpaStripeLarge} />
        <View pointerEvents="none" style={styles.gpaStripeSmall} />
        <View pointerEvents="none" style={styles.gpaGlow} />

        <View style={styles.gpaTopRow}>
          <View style={styles.gpaHeading} pointerEvents="none">
            <Text style={styles.gpaEyebrow}>GPA OVERVIEW</Text>
            <Text style={styles.gpaTitle}>Academic standing</Text>
          </View>

          <View style={[styles.gpaTopActions, onSync && styles.gpaTopActionsWithSync]}>
            <View style={styles.portalPill} pointerEvents="none">
              <View style={styles.portalDot} />
              <Text style={styles.portalPillText}>
                {summary?.systemType ?? 'Portal'}
              </Text>
            </View>

          </View>
        </View>

        {loading ? (
          <View style={styles.stateRow} testID={`${testID}-loading`}>
            <ActivityIndicator size="small" color="#FFFFFF" />
            <Text style={styles.stateText}>Loading GPA…</Text>
          </View>
        ) : error ? (
          <View style={styles.stateRow} testID={`${testID}-error`}>
            <Feather name="alert-circle" size={18} color="#FFD4D5" />
            <Text style={styles.stateText}>{error}</Text>
          </View>
        ) : !hasGpa ? (
          <View style={styles.stateRow} testID={`${testID}-empty`}>
            <Feather name="minus-circle" size={18} color="rgba(255,255,255,0.76)" />
            <Text style={styles.stateText}>No GPA data is available yet.</Text>
          </View>
        ) : (
          <View style={styles.gpaMetricsRow} pointerEvents="none">
            <View style={styles.gpaMetric}>
              <Text style={styles.gpaNumber} testID={`${testID}-unweighted`}>
                {formatGpa(values.unweighted, hidden)}
              </Text>
              <Text style={styles.gpaMetricLabel}>Unweighted</Text>
            </View>

            <View style={styles.gpaDivider} />

            <View style={styles.gpaMetric}>
              <Text style={styles.gpaNumber} testID={`${testID}-weighted`}>
                {formatGpa(values.weighted, hidden)}
              </Text>
              <Text style={styles.gpaMetricLabel}>Weighted</Text>
            </View>
          </View>
        )}

        <View style={styles.gpaFooter} pointerEvents="none">
          <View style={styles.heroStat}>
            <Feather name="book-open" size={14} color="rgba(255,255,255,0.82)" />
            <Text style={styles.heroStatText}>
              {values.courseCount} {values.courseCount === 1 ? 'course' : 'courses'}
            </Text>
          </View>

          <View style={styles.heroStatDivider} />

          <View style={styles.heroStat}>
            <Feather name="activity" size={14} color="rgba(255,255,255,0.82)" />
            <Text style={styles.heroStatText}>
              {values.averageGrade === null
                ? 'No average yet'
                : `${values.averageGrade.toFixed(1)}% average`}
            </Text>
          </View>
        </View>
      </Card>
      </Pressable>

      {onSync ? (
        <Pressable
          testID={`${testID}-sync`}
          disabled={syncing}
          onPress={onSync}
          style={({ pressed }) => [
            styles.gpaSyncButton,
            styles.gpaSyncButtonOverlay,
            pressed && !syncing && styles.gpaSyncButtonPressed,
            syncing && styles.disabled,
          ]}
          accessibilityRole="button"
          accessibilityLabel="Re-sync grades"
          accessibilityState={{ disabled: syncing, busy: syncing }}
        >
          {syncing ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <Feather name="refresh-cw" size={13} color="#FFFFFF" />
          )}
          <Text style={styles.gpaSyncButtonText}>
            {syncing ? 'Syncing' : 'Re-sync'}
          </Text>
        </Pressable>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  shell: {
    position: 'relative',
    minHeight: 220,
    borderRadius: 24,
    ...elevation.md,
  },
  pressable: {
    minHeight: 220,
    borderRadius: 24,
  },
  hovered: {
    opacity: 0.98,
  },
  focused: {
    borderWidth: 2,
    borderColor: '#D7CCFF',
  },
  pressed: {
    opacity: 0.9,
  },
  gpaContent: {
    position: 'relative',
    minHeight: 220,
    overflow: 'hidden',
    borderRadius: 24,
    padding: 18,
    justifyContent: 'space-between',
  },
  gpaStripeLarge: {
    position: 'absolute',
    top: -105,
    left: 72,
    width: 94,
    height: 430,
    backgroundColor: 'rgba(255,255,255,0.045)',
    transform: [{ rotate: '25deg' }],
  },
  gpaStripeSmall: {
    position: 'absolute',
    top: -94,
    left: 188,
    width: 42,
    height: 410,
    backgroundColor: 'rgba(255,255,255,0.032)',
    transform: [{ rotate: '25deg' }],
  },
  gpaGlow: {
    position: 'absolute',
    width: 190,
    height: 190,
    borderRadius: 95,
    backgroundColor: 'rgba(255,255,255,0.08)',
    top: -125,
    right: -75,
  },
  gpaTopRow: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
  },
  gpaHeading: {
    flex: 1,
    minWidth: 0,
  },
  gpaEyebrow: {
    color: 'rgba(255,255,255,0.72)',
    fontFamily: fonts.semiBold,
    fontSize: 9,
    fontWeight: '600',
    letterSpacing: 1.2,
  },
  gpaTitle: {
    color: '#FFFFFF',
    fontFamily: fonts.bold,
    fontSize: 20,
    lineHeight: 25,
    fontWeight: '700',
    marginTop: 2,
  },
  gpaTopActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  gpaTopActionsWithSync: {
    marginRight: 88,
  },
  portalPill: {
    minHeight: 30,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 9,
    borderRadius: 999,
    backgroundColor: 'rgba(19,16,66,0.24)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  portalDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#65E6C1',
  },
  portalPillText: {
    color: 'rgba(255,255,255,0.82)',
    fontFamily: fonts.semiBold,
    fontSize: 9.5,
    fontWeight: '600',
  },
  gpaMetricsRow: {
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
  },
  gpaMetric: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 0,
  },
  gpaNumber: {
    color: '#FFFFFF',
    fontFamily: fonts.bold,
    fontSize: 33,
    lineHeight: 39,
    fontWeight: '700',
    letterSpacing: -1.1,
  },
  gpaMetricLabel: {
    color: 'rgba(255,255,255,0.70)',
    fontFamily: fonts.medium,
    fontSize: 11,
    fontWeight: '500',
    marginTop: 1,
  },
  gpaDivider: {
    width: 1,
    height: 54,
    backgroundColor: 'rgba(255,255,255,0.20)',
  },
  stateRow: {
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    paddingHorizontal: 12,
  },
  stateText: {
    flexShrink: 1,
    color: '#FFFFFF',
    fontFamily: fonts.medium,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '500',
    textAlign: 'center',
  },
  gpaFooter: {
    minHeight: 39,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 11,
    borderRadius: 13,
    backgroundColor: 'rgba(19,16,66,0.22)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.13)',
  },
  heroStat: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  heroStatText: {
    color: 'rgba(255,255,255,0.80)',
    fontFamily: fonts.medium,
    fontSize: 9.5,
    fontWeight: '500',
  },
  heroStatDivider: {
    width: 1,
    height: 17,
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  gpaSyncButton: {
    minHeight: 30,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingHorizontal: 10,
    borderRadius: 10,
    backgroundColor: 'rgba(19,16,66,0.30)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  gpaSyncButtonOverlay: {
    position: 'absolute',
    zIndex: 2,
    top: 18,
    right: 18,
  },
  gpaSyncButtonPressed: {
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  gpaSyncButtonText: {
    color: '#FFFFFF',
    fontFamily: fonts.semiBold,
    fontSize: 10,
    fontWeight: '600',
  },
  disabled: {
    opacity: 0.55,
  },
})
