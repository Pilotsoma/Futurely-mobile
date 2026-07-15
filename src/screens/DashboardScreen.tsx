import React, { useCallback, useMemo, useState } from 'react'
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native'
import { useFocusEffect, useNavigation } from '@react-navigation/native'
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs'
import { Feather } from '@expo/vector-icons'
import { useAuth } from '../context/AuthContext'
import * as studentsApi from '../api/studentsApi'
import * as gradesApi from '../api/gradesApi'
import { ApiRequestError } from '../api/client'
import { Screen } from '../components/ui/Screen'
import { Card } from '../components/ui/Card'
import { LoadingSkeleton } from '../components/ui/LoadingSkeleton'
import { ErrorRetryBlock } from '../components/ui/ErrorRetryBlock'
import { useCountUp, useCountUpFloat } from '../hooks/useCountUp'
import type { StudentMe } from '../types/student'
import type { Assignment } from '../types/assignments'
import type { GpaSummary } from '../types/grades'
import type { MainTabParamList } from '../navigation/MainNavigator'
import { colors, fonts, spacing, typography } from '../theme/tokens'

type Nav = BottomTabNavigationProp<MainTabParamList>

interface QuickLink {
  label: string
  icon: React.ComponentProps<typeof Feather>['name']
  accent: string
  accentSoft: string
  route: keyof MainTabParamList
}

const QUICK_LINKS: QuickLink[] = [
  {
    label: 'Grades',
    icon: 'bar-chart-2',
    accent: '#26D6A4',
    accentSoft: 'rgba(38, 214, 164, 0.14)',
    route: 'Grades',
  },
  {
    label: 'AI Chat',
    icon: 'message-circle',
    accent: '#A083FF',
    accentSoft: 'rgba(160, 131, 255, 0.15)',
    route: 'AIChat',
  },
  {
    label: 'Planner',
    icon: 'calendar',
    accent: '#FFB52E',
    accentSoft: 'rgba(255, 181, 46, 0.14)',
    route: 'Planner',
  },
  {
    label: 'Colleges',
    icon: 'bookmark',
    accent: '#61A5FF',
    accentSoft: 'rgba(97, 165, 255, 0.14)',
    route: 'Colleges',
  },
]

function getTimeOfDay(): string {
  const hour = new Date().getHours()
  return hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening'
}

function formatDate(): string {
  return new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })
}

export default function DashboardScreen(): React.JSX.Element {
  const navigation = useNavigation<Nav>()
  const { user } = useAuth()
  const { height } = useWindowDimensions()
  const compact = height < 810
  const veryCompact = height < 710

  const [student, setStudent] = useState<StudentMe | null>(null)
  const [gpa, setGpa] = useState<GpaSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [aiPrompt, setAiPrompt] = useState('')

  const load = useCallback(async () => {
    setError(null)

    try {
      const [studentResult, gpaResult] = await Promise.all([
        studentsApi.getMe(),
        gradesApi.getGpa().catch(() => null),
      ])
      setStudent(studentResult)
      setGpa(gpaResult)
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not load your dashboard.')
    } finally {
      setLoading(false)
    }
  }, [])

  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load]),
  )

  async function handleResync(): Promise<void> {
    setSyncing(true)

    try {
      await gradesApi.syncProfile()
      await load()
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Sync failed. Please try again.')
    } finally {
      setSyncing(false)
    }
  }

  function handleAskAI(): void {
    navigation.navigate('AIChat')
  }

  const profile = student?.profile
  const weighted = gpa?.weightedGpa ?? profile?.weightedGpa ?? null
  const unweighted = gpa?.unweightedGpa ?? profile?.unweightedGpa ?? null

  // Normalize API values so the GPA never disappears when the backend returns
  // null, undefined, or a numeric string.
  const normalizedWeighted = Number(weighted ?? 0)
  const normalizedUnweighted = Number(unweighted ?? 0)
  const safeWeighted = Number.isFinite(normalizedWeighted) ? normalizedWeighted : 0
  const safeUnweighted = Number.isFinite(normalizedUnweighted) ? normalizedUnweighted : 0

  const dueToday: Assignment[] = useMemo(() => {
    if (!student) return []

    const now = new Date()
    return student.assignments.filter((assignment) => {
      if (assignment.completed) return false

      const dueDate = new Date(assignment.dueDate)
      return (
        dueDate.getFullYear() === now.getFullYear() &&
        dueDate.getMonth() === now.getMonth() &&
        dueDate.getDate() === now.getDate()
      )
    })
  }, [student])

  const animWeighted = useCountUpFloat(safeWeighted)
  const animUnweighted = useCountUpFloat(safeUnweighted)
  const animCourses = useCountUp(student?.stats.totalCourses ?? 0)
  const animDueToday = useCountUp(dueToday.length)
  const animPending = useCountUp(student?.stats.pendingAssignments ?? 0)

  const shownWeighted = Number.isFinite(animWeighted) ? animWeighted : safeWeighted
  const shownUnweighted = Number.isFinite(animUnweighted) ? animUnweighted : safeUnweighted

  if (loading) {
    return (
      <Screen edges={['top', 'left', 'right', 'bottom']}>
        <LoadingSkeleton rows={4} />
      </Screen>
    )
  }

  if (error && !student) {
    return (
      <Screen edges={['top', 'left', 'right', 'bottom']}>
        <ErrorRetryBlock
          message={error}
          onRetry={() => {
            setLoading(true)
            void load()
          }}
        />
      </Screen>
    )
  }

  const displayName = (student?.name ?? user?.name ?? 'Student').split(' ')[0]
  const firstDueAssignment = dueToday[0]

  return (
    <Screen edges={['top', 'left', 'right', 'bottom']}>
      <View pointerEvents="none" style={styles.decorativeLayer}>
        <View style={styles.glowOrbTop} />
        <View style={styles.glowOrbLeft} />
        <View style={styles.decorativeDotOne} />
        <View style={styles.decorativeDotTwo} />
      </View>

      <View
        style={[
          styles.page,
          compact && styles.pageCompact,
          veryCompact && styles.pageVeryCompact,
        ]}
      >
        <View style={styles.headerRow}>
          <View style={styles.headerCopy}>
            <Text style={styles.greetingLine}>Good {getTimeOfDay()},</Text>
            <Text style={[styles.greetingName, compact && styles.greetingNameCompact]}>
              {displayName}
            </Text>
            {!veryCompact ? (
              <Text style={styles.headerSubtitle}>Your academic command center</Text>
            ) : null}
          </View>

          <View style={styles.headerActions}>
            <View style={styles.dateChip}>
              <Feather name="calendar" size={12} color="#7AB4FF" />
              <Text style={styles.dateChipText} numberOfLines={1}>
                {formatDate()}
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Notifications"
              style={({ pressed }) => [styles.notificationButton, pressed && styles.pressed]}
            >
              <Feather name="bell" size={17} color="#B9C6DD" />
              <View style={styles.notificationDot} />
            </Pressable>
          </View>
        </View>

        <Card
          variant="gradient"
          gradientColors={['#8B35FF', '#493DEB']}
          spacing="100"
          style={[styles.gpaCard, compact && styles.gpaCardCompact]}
        >
          <View pointerEvents="none" style={styles.gpaGlowTop} />
          <View pointerEvents="none" style={styles.gpaGlowBottom} />

          <View style={styles.gpaTopRow}>
            <Pressable
              accessibilityRole="button"
              onPress={() => navigation.navigate('Grades')}
              style={({ pressed }) => [styles.gpaTitleWrap, pressed && styles.pressed]}
            >
              <Text style={styles.gpaEyebrow}>ACADEMIC OVERVIEW</Text>
              <Text style={[styles.gpaTitle, compact && styles.gpaTitleCompact]}>Your GPA</Text>
            </Pressable>

            <View style={styles.gpaEyeButton}>
              <Feather name="eye" size={17} color="rgba(255,255,255,0.86)" />
            </View>
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open grades"
            onPress={() => navigation.navigate('Grades')}
            style={({ pressed }) => [styles.gpaMetricsRow, pressed && styles.pressed]}
          >
            <View style={styles.gpaMetric}>
              <Text style={[styles.gpaValue, compact && styles.gpaValueCompact]}>
                {shownUnweighted.toFixed(3)}
              </Text>
              <Text style={styles.gpaCaption}>Unweighted</Text>
            </View>

            <View style={styles.gpaDivider} />

            <View style={styles.gpaMetric}>
              <Text
                style={[
                  styles.gpaValue,
                  styles.gpaValueSecondary,
                  compact && styles.gpaValueCompact,
                ]}
              >
                {shownWeighted.toFixed(3)}
              </Text>
              <Text style={styles.gpaCaption}>Weighted</Text>
            </View>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Re-sync grades"
            disabled={syncing}
            onPress={() => void handleResync()}
            style={({ pressed }) => [
              styles.syncButton,
              pressed && !syncing && styles.syncButtonPressed,
              syncing && styles.syncButtonDisabled,
            ]}
          >
            <Feather name={syncing ? 'loader' : 'refresh-cw'} size={14} color="#FFFFFF" />
            <Text style={styles.syncButtonText}>
              {syncing ? 'Syncing grades...' : 'Re-sync grades'}
            </Text>
          </Pressable>
        </Card>

        <Pressable
          accessibilityRole="button"
          onPress={() => navigation.navigate('Planner')}
          style={({ pressed }) => [
            styles.dueCard,
            compact && styles.dueCardCompact,
            pressed && styles.pressed,
          ]}
        >
          <View style={styles.dueHeadingRow}>
            <View>
              <Text style={styles.sectionEyebrow}>TODAY</Text>
              <Text style={[styles.cardTitle, compact && styles.cardTitleCompact]}>Due today</Text>
            </View>
            <View style={styles.calendarBadge}>
              <Feather name="calendar" size={17} color="#68A9FF" />
            </View>
          </View>

          {dueToday.length === 0 ? (
            <View style={[styles.clearState, compact && styles.clearStateCompact]}>
              <View style={styles.clearIcon}>
                <Feather name="check" size={16} color="#20D3A0" />
              </View>
              <View style={styles.clearTextWrap}>
                <Text style={styles.clearTitle}>All clear for today</Text>
                {!veryCompact ? (
                  <Text style={styles.clearSubtitle}>You are fully caught up.</Text>
                ) : null}
              </View>
            </View>
          ) : (
            <View style={[styles.assignmentState, compact && styles.assignmentStateCompact]}>
              <View style={styles.assignmentDot} />
              <View style={styles.assignmentCopy}>
                <Text style={styles.assignmentTitle} numberOfLines={1}>
                  {firstDueAssignment?.title}
                </Text>
                <Text style={styles.assignmentSubject} numberOfLines={1}>
                  {firstDueAssignment?.subject}
                  {dueToday.length > 1 ? `  •  +${dueToday.length - 1} more` : ''}
                </Text>
              </View>
              <Feather name="chevron-right" size={18} color="#667894" />
            </View>
          )}
        </Pressable>

        <View style={[styles.statsRow, compact && styles.statsRowCompact]}>
          <Pressable
            style={({ pressed }) => [
              styles.statCard,
              compact && styles.statCardCompact,
              pressed && styles.pressed,
            ]}
            onPress={() => navigation.navigate('Grades')}
          >
            <View style={[styles.statIcon, { backgroundColor: 'rgba(59, 130, 246, 0.14)' }]}>
              <Feather name="book-open" size={16} color="#65A5FF" />
            </View>
            <Text style={styles.statValue}>{animCourses}</Text>
            <Text style={styles.statLabel} numberOfLines={1}>Courses</Text>
          </Pressable>

          <Pressable
            style={({ pressed }) => [
              styles.statCard,
              compact && styles.statCardCompact,
              pressed && styles.pressed,
            ]}
            onPress={() => navigation.navigate('Planner')}
          >
            <View style={[styles.statIcon, { backgroundColor: 'rgba(139, 92, 246, 0.15)' }]}>
              <Feather name="clock" size={16} color="#9A77FF" />
            </View>
            <Text style={styles.statValue}>{animDueToday}</Text>
            <Text style={styles.statLabel} numberOfLines={1}>Due today</Text>
          </Pressable>

          <Pressable
            style={({ pressed }) => [
              styles.statCard,
              compact && styles.statCardCompact,
              pressed && styles.pressed,
            ]}
            onPress={() => navigation.navigate('Planner')}
          >
            <View style={[styles.statIcon, { backgroundColor: 'rgba(245, 158, 11, 0.14)' }]}>
              <Feather name="inbox" size={16} color="#F6AE2D" />
            </View>
            <Text style={styles.statValue}>{animPending}</Text>
            <Text style={styles.statLabel} numberOfLines={1}>Pending</Text>
          </Pressable>
        </View>

        <View style={styles.quickSection}>
          <View style={styles.sectionHeaderRow}>
            <View>
              <Text style={styles.sectionEyebrow}>SHORTCUTS</Text>
              {!veryCompact ? <Text style={styles.sectionTitle}>Quick access</Text> : null}
            </View>
            <Feather name="grid" size={17} color="#6D7D96" />
          </View>

          <View style={styles.quickRow}>
            {QUICK_LINKS.map((link) => (
              <Pressable
                key={link.route}
                accessibilityRole="button"
                onPress={() => navigation.navigate(link.route)}
                style={({ pressed }) => [
                  styles.quickButton,
                  compact && styles.quickButtonCompact,
                  pressed && styles.pressed,
                ]}
              >
                <View style={[styles.quickIcon, { backgroundColor: link.accentSoft }]}>
                  <Feather name={link.icon} size={21} color={link.accent} />
                </View>
                <Text style={styles.quickLabel} numberOfLines={1}>
                  {link.label}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        <View style={styles.aiSection}>
          {!veryCompact ? (
            <View style={styles.aiLabelRow}>
              <Text style={styles.sectionEyebrow}>YOUR AI COPILOT</Text>
              <Feather name="zap" size={14} color="#9D82FF" />
            </View>
          ) : null}

          <View style={[styles.aiComposer, compact && styles.aiComposerCompact]}>
            <View pointerEvents="none" style={styles.aiComposerGlow} />
            <View style={styles.aiAvatar}>
              <Feather name="message-circle" size={18} color="#FFFFFF" />
            </View>
            <TextInput
              value={aiPrompt}
              onChangeText={setAiPrompt}
              placeholder="Ask myFuturely AI..."
              placeholderTextColor="#71819A"
              style={styles.aiInput}
              returnKeyType="send"
              onSubmitEditing={handleAskAI}
              accessibilityLabel="Ask myFuturely AI"
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Send question to myFuturely AI"
              onPress={handleAskAI}
              style={({ pressed }) => [styles.sendButton, pressed && styles.sendButtonPressed]}
            >
              <Feather name="send" size={17} color="#FFFFFF" />
            </Pressable>
          </View>
        </View>

        {error ? <Text style={styles.inlineError}>{error}</Text> : null}
      </View>
    </Screen>
  )
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    width: '100%',
    gap: 9,
    paddingTop: 8,
    paddingBottom: 8,
  },
  pageCompact: {
    gap: 7,
    paddingTop: 5,
    paddingBottom: 5,
  },
  pageVeryCompact: {
    gap: 5,
    paddingTop: 3,
    paddingBottom: 3,
  },
  decorativeLayer: {
    ...StyleSheet.absoluteFillObject,
    overflow: 'hidden',
  },
  glowOrbTop: {
    position: 'absolute',
    width: 260,
    height: 260,
    borderRadius: 130,
    backgroundColor: 'rgba(84, 49, 255, 0.10)',
    top: -142,
    right: -118,
  },
  glowOrbLeft: {
    position: 'absolute',
    width: 190,
    height: 190,
    borderRadius: 95,
    backgroundColor: 'rgba(0, 150, 255, 0.045)',
    top: 340,
    left: -145,
  },
  decorativeDotOne: {
    position: 'absolute',
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: 'rgba(91, 138, 255, 0.46)',
    top: 104,
    right: 39,
  },
  decorativeDotTwo: {
    position: 'absolute',
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(143, 98, 255, 0.45)',
    top: 130,
    right: 76,
  },
  headerRow: {
    minHeight: 76,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  headerCopy: {
    flex: 1,
  },
  greetingLine: {
    ...typography.body,
    color: '#8FB5EA',
    fontSize: 14,
  },
  greetingName: {
    ...typography.display,
    color: '#F3F6FF',
    fontSize: 31,
    lineHeight: 36,
    letterSpacing: -0.8,
  },
  greetingNameCompact: {
    fontSize: 28,
    lineHeight: 32,
  },
  headerSubtitle: {
    ...typography.caption,
    color: '#697892',
    marginTop: 1,
    fontSize: 10,
  },
  headerActions: {
    alignItems: 'flex-end',
    gap: 6,
    maxWidth: '54%',
  },
  dateChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(19, 37, 64, 0.90)',
    borderWidth: 1,
    borderColor: 'rgba(47, 112, 203, 0.36)',
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 6,
  },
  dateChipText: {
    ...typography.caption,
    color: '#7AB4FF',
    flexShrink: 1,
    fontSize: 10,
  },
  notificationButton: {
    width: 32,
    height: 32,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(15, 27, 47, 0.84)',
    borderWidth: 1,
    borderColor: 'rgba(86, 111, 148, 0.20)',
  },
  notificationDot: {
    position: 'absolute',
    top: 6,
    right: 7,
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: '#7C5CFF',
    borderWidth: 1,
    borderColor: '#0A1220',
  },
  gpaCard: {
    minHeight: 202,
    width: '100%',
    borderRadius: 22,
    padding: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(197, 179, 255, 0.28)',
    shadowColor: '#6B39FF',
    shadowOpacity: 0.28,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 9 },
    elevation: 8,
  },
  gpaCardCompact: {
    minHeight: 184,
    padding: 13,
  },
  gpaGlowTop: {
    position: 'absolute',
    width: 180,
    height: 180,
    borderRadius: 90,
    backgroundColor: 'rgba(255,255,255,0.10)',
    top: -120,
    left: -45,
  },
  gpaGlowBottom: {
    position: 'absolute',
    width: 210,
    height: 210,
    borderRadius: 105,
    backgroundColor: 'rgba(26, 41, 183, 0.17)',
    right: -112,
    bottom: -150,
  },
  gpaTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  gpaTitleWrap: {
    flex: 1,
  },
  gpaEyebrow: {
    ...typography.label,
    color: 'rgba(244, 241, 255, 0.62)',
    letterSpacing: 1,
    fontSize: 9,
  },
  gpaTitle: {
    ...typography.h2,
    color: '#FFFFFF',
    marginTop: 1,
    fontSize: 20,
  },
  gpaTitleCompact: {
    fontSize: 18,
  },
  gpaEyeButton: {
    width: 35,
    height: 35,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.10)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
  },
  gpaMetricsRow: {
    width: '100%',
    height: 78,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 4,
  },
  gpaMetric: {
    flex: 1,
    alignItems: 'center',
  },
  gpaDivider: {
    width: 1,
    height: 46,
    backgroundColor: 'rgba(255, 255, 255, 0.22)',
  },
  gpaValue: {
    ...typography.display,
    color: '#FFFFFF',
    fontSize: 35,
    lineHeight: 41,
    letterSpacing: -1.1,
    includeFontPadding: false,
  },
  gpaValueCompact: {
    fontSize: 31,
    lineHeight: 35,
  },
  gpaValueSecondary: {
    color: '#E4E8FF',
  },
  gpaCaption: {
    ...typography.caption,
    color: 'rgba(244, 241, 255, 0.72)',
    marginTop: 1,
    fontSize: 10,
  },
  syncButton: {
    height: 38,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    borderRadius: 13,
    backgroundColor: 'rgba(255,255,255,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
  },
  syncButtonPressed: {
    backgroundColor: 'rgba(255,255,255,0.16)',
    transform: [{ scale: 0.99 }],
  },
  syncButtonDisabled: {
    opacity: 0.72,
  },
  syncButtonText: {
    ...typography.body,
    color: '#FFFFFF',
    fontFamily: fonts.bold,
    fontWeight: '700',
    fontSize: 13,
  },
  dueCard: {
    minHeight: 118,
    width: '100%',
    gap: 9,
    padding: 14,
    borderRadius: 20,
    backgroundColor: 'rgba(17, 31, 52, 0.94)',
    borderWidth: 1,
    borderColor: 'rgba(72, 100, 139, 0.30)',
    shadowColor: '#000000',
    shadowOpacity: 0.16,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  dueCardCompact: {
    minHeight: 106,
    padding: 12,
    gap: 7,
  },
  dueHeadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionEyebrow: {
    ...typography.label,
    color: '#5E79A1',
    letterSpacing: 1.05,
    fontSize: 9,
  },
  cardTitle: {
    ...typography.h2,
    color: '#EDF3FF',
    marginTop: 1,
    fontSize: 19,
  },
  cardTitleCompact: {
    fontSize: 17,
  },
  calendarBadge: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(56, 134, 255, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(77, 149, 255, 0.16)',
  },
  clearState: {
    minHeight: 57,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    paddingHorizontal: 12,
    borderRadius: 15,
    backgroundColor: 'rgba(7, 31, 36, 0.50)',
    borderWidth: 1,
    borderColor: 'rgba(21, 214, 160, 0.12)',
  },
  clearStateCompact: {
    minHeight: 48,
  },
  clearIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(21, 214, 160, 0.12)',
  },
  clearTextWrap: {
    flex: 1,
  },
  clearTitle: {
    ...typography.body,
    color: '#67E1BD',
    fontFamily: fonts.bold,
    fontWeight: '700',
    fontSize: 13,
  },
  clearSubtitle: {
    ...typography.caption,
    color: '#688083',
    marginTop: 1,
    fontSize: 10,
  },
  assignmentState: {
    minHeight: 57,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    borderRadius: 15,
    backgroundColor: 'rgba(28, 30, 48, 0.72)',
    borderWidth: 1,
    borderColor: 'rgba(246, 174, 45, 0.11)',
  },
  assignmentStateCompact: {
    minHeight: 48,
  },
  assignmentDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#F6AE2D',
  },
  assignmentCopy: {
    flex: 1,
    minWidth: 0,
  },
  assignmentTitle: {
    ...typography.body,
    color: '#EEF3FC',
    fontFamily: fonts.bold,
    fontWeight: '700',
    fontSize: 12,
  },
  assignmentSubject: {
    ...typography.caption,
    color: '#7B8BA2',
    marginTop: 1,
    fontSize: 10,
  },
  statsRow: {
    width: '100%',
    minHeight: 98,
    flexDirection: 'row',
    alignItems: 'stretch',
    justifyContent: 'space-between',
  },
  statsRowCompact: {
    minHeight: 88,
  },
  statCard: {
    width: '31.5%',
    minHeight: 98,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingHorizontal: 6,
    paddingVertical: 10,
    borderRadius: 17,
    backgroundColor: '#111F34',
    borderWidth: 1,
    borderColor: 'rgba(91, 126, 176, 0.36)',
    shadowColor: '#000000',
    shadowOpacity: 0.18,
    shadowRadius: 9,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
    overflow: 'hidden',
  },
  statCardCompact: {
    minHeight: 88,
    paddingVertical: 8,
  },
  statIcon: {
    width: 33,
    height: 33,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statValue: {
    ...typography.h2,
    color: '#F4F7FF',
    fontSize: 21,
    lineHeight: 23,
  },
  statLabel: {
    ...typography.caption,
    color: '#95A3B9',
    textAlign: 'center',
    fontSize: 10,
    lineHeight: 12,
  },
  quickSection: {
    width: '100%',
    gap: 7,
    marginBottom: 0,
  },
  sectionHeaderRow: {
    minHeight: 25,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionTitle: {
    ...typography.h3,
    color: '#EDF3FF',
    marginTop: 1,
    fontSize: 15,
  },
  quickRow: {
    width: '100%',
    minHeight: 96,
    flexDirection: 'row',
    alignItems: 'stretch',
    justifyContent: 'space-between',
  },
  quickButton: {
    width: '23.4%',
    minHeight: 96,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 4,
    paddingVertical: 10,
    borderRadius: 17,
    backgroundColor: '#111F34',
    borderWidth: 1,
    borderColor: 'rgba(82, 111, 154, 0.34)',
    shadowColor: '#000000',
    shadowOpacity: 0.14,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  quickButtonCompact: {
    minHeight: 84,
    paddingVertical: 8,
    gap: 6,
  },
  quickIcon: {
    width: 43,
    height: 43,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickLabel: {
    ...typography.caption,
    color: '#D7DFEC',
    fontFamily: fonts.bold,
    fontWeight: '700',
    fontSize: 10,
    lineHeight: 12,
    textAlign: 'center',
  },
  aiSection: {
    width: '100%',
    gap: 5,
    marginTop: 'auto',
  },
  aiLabelRow: {
    minHeight: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  aiComposer: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 7,
    borderRadius: 19,
    backgroundColor: 'rgba(20, 38, 64, 0.98)',
    borderWidth: 1,
    borderColor: 'rgba(87, 129, 189, 0.34)',
    overflow: 'hidden',
    shadowColor: '#000000',
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 5 },
    elevation: 4,
  },
  aiComposerCompact: {
    minHeight: 52,
    padding: 6,
  },
  aiComposerGlow: {
    position: 'absolute',
    width: 140,
    height: 140,
    borderRadius: 70,
    right: -82,
    top: -77,
    backgroundColor: 'rgba(91, 66, 255, 0.14)',
  },
  aiAvatar: {
    width: 39,
    height: 39,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#6347F5',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.13)',
  },
  aiInput: {
    flex: 1,
    minHeight: 40,
    color: '#F4F6FC',
    fontSize: 13,
    paddingHorizontal: 3,
    paddingVertical: 0,
  },
  sendButton: {
    width: 39,
    height: 39,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#2769CF',
    borderWidth: 1,
    borderColor: 'rgba(116, 173, 255, 0.30)',
  },
  sendButtonPressed: {
    opacity: 0.78,
    transform: [{ scale: 0.96 }],
  },
  pressed: {
    opacity: 0.80,
    transform: [{ scale: 0.987 }],
  },
  inlineError: {
    ...typography.caption,
    color: colors.error,
    textAlign: 'center',
    fontSize: 10,
  },
})