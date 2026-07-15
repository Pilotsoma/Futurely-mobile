import React, { useCallback, useMemo, useState } from 'react'
import {
  ActivityIndicator,
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
import { sendChatMessage } from '../api/aiApi'
import { ApiRequestError } from '../api/client'
import { Screen } from '../components/ui/Screen'
import { LoadingSkeleton } from '../components/ui/LoadingSkeleton'
import { ErrorRetryBlock } from '../components/ui/ErrorRetryBlock'
import type { StudentMe } from '../types/student'
import type { Assignment } from '../types/assignments'
import type { CurrentGradeCourse, GpaSummary } from '../types/grades'
import type { MainTabParamList } from '../navigation/MainNavigator'
import { useDisplayPreferences } from '../preferences/displayPreferences'
import { colors, elevation, fonts } from '../theme/tokens'

type Nav = BottomTabNavigationProp<MainTabParamList>
type FeatherName = React.ComponentProps<typeof Feather>['name']

interface StatTileProps {
  label: string
  value: number
  icon: FeatherName
  iconColor: string
  iconBackground: string
  onPress: () => void
  reduceMotion: boolean
}

function getTimeOfDay(): string {
  const hour = new Date().getHours()
  return hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening'
}

function formatDate(): string {
  return new Date().toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
}

function toFiniteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function dateKey(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function assignmentIsDueToday(
  assignment: Assignment,
  today: Date,
): boolean {
  if (assignment.completed || !assignment.dueDate) return false

  const rawDueDate = String(assignment.dueDate)
  const dateOnlyMatch = rawDueDate.match(/^\d{4}-\d{2}-\d{2}/)

  if (dateOnlyMatch && rawDueDate.length <= 10) {
    return dateOnlyMatch[0] === dateKey(today)
  }

  const parsedDueDate = new Date(rawDueDate)
  if (Number.isNaN(parsedDueDate.getTime())) return false

  return dateKey(parsedDueDate) === dateKey(today)
}

function StatTile({
  label,
  value,
  icon,
  iconColor,
  iconBackground,
  onPress,
  reduceMotion,
}: StatTileProps): React.JSX.Element {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.statTile,
        pressed &&
          (reduceMotion
            ? styles.pressedReducedMotion
            : styles.pressed),
      ]}
      accessibilityRole="button"
      accessibilityLabel={`${value} ${label}`}
    >
      <View
        style={[
          styles.statIconWrap,
          { backgroundColor: iconBackground },
        ]}
      >
        <Feather name={icon} size={19} color={iconColor} />
      </View>

      <Text allowFontScaling={false} style={styles.statValue}>
        {value}
      </Text>

      <Text
        allowFontScaling={false}
        style={styles.statLabel}
        numberOfLines={1}
      >
        {label}
      </Text>
    </Pressable>
  )
}

export default function DashboardScreen(): React.JSX.Element {
  const navigation = useNavigation<Nav>()
  const { user } = useAuth()
  const { height } = useWindowDimensions()

  const compact = height < 810
  const veryCompact = height < 735

  const { hideGpa, reduceMotion } = useDisplayPreferences()
  const pressedStyle = reduceMotion
    ? styles.pressedReducedMotion
    : styles.pressed

  const [student, setStudent] = useState<StudentMe | null>(null)
  const [gpa, setGpa] = useState<GpaSummary | null>(null)
  const [courses, setCourses] = useState<CurrentGradeCourse[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)

  const [aiPrompt, setAiPrompt] = useState('')
  const [aiReply, setAiReply] = useState<string | null>(null)
  const [aiSending, setAiSending] = useState(false)

  const load = useCallback(async () => {
    setError(null)

    try {
      const [studentResult, gpaResult, currentGradesResult] =
        await Promise.all([
          studentsApi.getMe(),
          gradesApi.getGpa().catch(() => null),
          gradesApi.getCurrentGrades().catch(() => null),
        ])

      setStudent(studentResult)
      setGpa(gpaResult)
      setCourses(currentGradesResult?.grades ?? [])
    } catch (err) {
      setError(
        err instanceof ApiRequestError
          ? err.message
          : 'Could not load your dashboard.',
      )
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
    setError(null)

    try {
      await gradesApi.syncProfile()
      await load()
    } catch (err) {
      setError(
        err instanceof ApiRequestError
          ? err.message
          : 'Sync failed. Please try again.',
      )
    } finally {
      setSyncing(false)
    }
  }

  async function handleAskAI(promptOverride?: string): Promise<void> {
    const prompt = (promptOverride ?? aiPrompt).trim()

    if (!prompt) {
      navigation.navigate('AIChat')
      return
    }

    setAiPrompt(prompt)
    setAiReply(null)
    setAiSending(true)
    setError(null)

    try {
      const result = await sendChatMessage(prompt)
      setAiReply(result.reply)
    } catch (err) {
      setError(
        err instanceof ApiRequestError
          ? err.message
          : 'myFuturely AI could not respond. Please try again.',
      )
    } finally {
      setAiSending(false)
    }
  }

  const profile = student?.profile

  const unweightedGpa =
    toFiniteNumber(gpa?.unweightedGpa) ??
    toFiniteNumber(gpa?.gpa) ??
    toFiniteNumber(profile?.unweightedGpa) ??
    0

  const weightedGpa =
    toFiniteNumber(gpa?.weightedGpa) ??
    toFiniteNumber(gpa?.gpa) ??
    toFiniteNumber(profile?.weightedGpa) ??
    0

  const displayUnweighted = hideGpa
    ? '••••'
    : unweightedGpa.toFixed(3)

  const displayWeighted = hideGpa
    ? '••••'
    : weightedGpa.toFixed(3)

  const dueToday = useMemo(() => {
    if (!student) return [] as Assignment[]

    const today = new Date()
    return student.assignments.filter((assignment) =>
      assignmentIsDueToday(assignment, today),
    )
  }, [student])

  const courseCount = Math.max(
    0,
    Math.round(
      toFiniteNumber(gpa?.courseCount) ??
        (courses.length > 0
          ? courses.length
          : student?.stats.totalCourses ?? 0),
    ),
  )

  const pendingCount = Math.max(
    0,
    student?.stats.pendingAssignments ?? 0,
  )

  const displayName = (
    student?.name ??
    user?.name ??
    'Student'
  ).split(' ')[0]

  const firstDueAssignment = dueToday[0]

  if (loading) {
    return (
      <Screen edges={['top', 'left', 'right']}>
        <LoadingSkeleton rows={4} />
      </Screen>
    )
  }

  if (error && !student) {
    return (
      <Screen edges={['top', 'left', 'right']}>
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

  return (
    <Screen edges={['top', 'left', 'right']}>
      <View
        style={[
          styles.page,
          compact && styles.pageCompact,
          veryCompact && styles.pageVeryCompact,
        ]}
      >
        <View style={styles.header}>
          <View style={styles.headerCopy}>
            <Text allowFontScaling={false} style={styles.greeting}>
              Good {getTimeOfDay()},
            </Text>
            <Text allowFontScaling={false} style={styles.studentName}>
              {displayName}
            </Text>
          </View>

          <View style={styles.headerActions}>
            <View style={styles.datePill}>
              <Feather name="calendar" size={13} color="#83BAFF" />
              <Text allowFontScaling={false} style={styles.datePillText}>
                {formatDate()}
              </Text>
            </View>

            <Pressable
              style={({ pressed }) => [
                styles.notificationButton,
                pressed && pressedStyle,
              ]}
              accessibilityRole="button"
              accessibilityLabel="Notifications"
            >
              <Feather name="bell" size={17} color="#D5DDF0" />
            </Pressable>
          </View>
        </View>

        <View
          style={[
            styles.gpaCard,
            compact && styles.gpaCardCompact,
          ]}
        >
          <View pointerEvents="none" style={styles.gpaStripeOne} />
          <View pointerEvents="none" style={styles.gpaStripeTwo} />
          <View pointerEvents="none" style={styles.gpaBottomShade} />

          <View style={styles.gpaHeader}>
            <View style={styles.gpaHeaderCopy}>
              <Text allowFontScaling={false} style={styles.gpaEyebrow}>
                ACADEMIC OVERVIEW
              </Text>
              <Text allowFontScaling={false} style={styles.gpaTitle}>
                Your GPA
              </Text>
            </View>

            <Pressable
              onPress={() => navigation.navigate('Grades')}
              style={({ pressed }) => [
                styles.gpaViewButton,
                pressed && pressedStyle,
              ]}
              accessibilityRole="button"
              accessibilityLabel="Open grades"
            >
              <Feather name="eye" size={18} color="#FFFFFF" />
            </Pressable>
          </View>

          <Pressable
            onPress={() => navigation.navigate('Grades')}
            style={({ pressed }) => [
              styles.gpaMetricsRow,
              pressed && pressedStyle,
            ]}
            accessibilityRole="button"
            accessibilityLabel={
              hideGpa
                ? 'GPA hidden by display preference'
                : `Unweighted GPA ${displayUnweighted}, weighted GPA ${displayWeighted}`
            }
          >
            <View style={styles.gpaMetric}>
              <Text
                allowFontScaling={false}
                style={[
                  styles.gpaNumber,
                  hideGpa && styles.gpaNumberHidden,
                ]}
              >
                {displayUnweighted}
              </Text>
              <Text
                allowFontScaling={false}
                style={styles.gpaMetricLabel}
              >
                Unweighted
              </Text>
            </View>

            <View style={styles.gpaDivider} />

            <View style={styles.gpaMetric}>
              <Text
                allowFontScaling={false}
                style={[
                  styles.gpaNumber,
                  hideGpa && styles.gpaNumberHidden,
                ]}
              >
                {displayWeighted}
              </Text>
              <Text
                allowFontScaling={false}
                style={styles.gpaMetricLabel}
              >
                Weighted
              </Text>
            </View>
          </Pressable>

          <Pressable
            disabled={syncing}
            onPress={() => void handleResync()}
            style={({ pressed }) => [
              styles.syncButton,
              pressed && !syncing && styles.syncButtonPressed,
              syncing && styles.disabled,
            ]}
            accessibilityRole="button"
            accessibilityLabel="Re-sync grades"
          >
            {syncing ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Feather name="refresh-cw" size={16} color="#FFFFFF" />
            )}

            <Text allowFontScaling={false} style={styles.syncButtonText}>
              {syncing ? 'Re-syncing grades' : 'Re-sync grades'}
            </Text>
          </Pressable>
        </View>

        <View
          style={[
            styles.todayCard,
            compact && styles.todayCardCompact,
          ]}
        >
          <View style={styles.todayHeader}>
            <View>
              <Text allowFontScaling={false} style={styles.sectionEyebrow}>
                TODAY
              </Text>
              <Text allowFontScaling={false} style={styles.sectionTitle}>
                Due today
              </Text>
            </View>

            <Pressable
              onPress={() => navigation.navigate('Planner')}
              style={({ pressed }) => [
                styles.todayCalendarButton,
                pressed && pressedStyle,
              ]}
              accessibilityRole="button"
              accessibilityLabel="Open Planner"
            >
              <Feather name="calendar" size={17} color="#69AEFF" />
            </Pressable>
          </View>

          <Pressable
            onPress={() => navigation.navigate('Planner')}
            style={({ pressed }) => [
              styles.assignmentCard,
              dueToday.length > 0 && styles.assignmentCardActive,
              pressed && pressedStyle,
            ]}
            accessibilityRole="button"
            accessibilityLabel={
              dueToday.length === 0
                ? 'No assignments due today'
                : `${dueToday.length} assignments due today`
            }
          >
            <View
              style={[
                styles.assignmentDot,
                dueToday.length === 0 &&
                  styles.assignmentDotComplete,
              ]}
            />

            <View style={styles.assignmentCopy}>
              <Text
                allowFontScaling={false}
                style={[
                  styles.assignmentTitle,
                  dueToday.length === 0 &&
                    styles.assignmentTitleComplete,
                ]}
                numberOfLines={1}
              >
                {dueToday.length === 0
                  ? 'All clear for today'
                  : firstDueAssignment?.title}
              </Text>

              <Text
                allowFontScaling={false}
                style={styles.assignmentSubtitle}
                numberOfLines={1}
              >
                {dueToday.length === 0
                  ? 'You are fully caught up.'
                  : `${firstDueAssignment?.subject ?? 'Assignment'}${
                      dueToday.length > 1
                        ? `  •  +${dueToday.length - 1} more`
                        : ''
                    }`}
              </Text>
            </View>

            <Feather name="chevron-right" size={18} color="#7690B5" />
          </Pressable>
        </View>

        <View style={styles.statsRow}>
          <StatTile
            label="Courses"
            value={courseCount}
            icon="book-open"
            iconColor="#70B9FF"
            iconBackground="rgba(59,130,246,0.16)"
            onPress={() => navigation.navigate('Grades')}
            reduceMotion={reduceMotion}
          />

          <StatTile
            label="Due today"
            value={dueToday.length}
            icon="clock"
            iconColor="#BEA5FF"
            iconBackground="rgba(130,91,255,0.17)"
            onPress={() => navigation.navigate('Planner')}
            reduceMotion={reduceMotion}
          />

          <StatTile
            label="Pending"
            value={pendingCount}
            icon="inbox"
            iconColor="#FFC44C"
            iconBackground="rgba(245,158,11,0.16)"
            onPress={() => navigation.navigate('Planner')}
            reduceMotion={reduceMotion}
          />
        </View>

        <View
          style={[
            styles.aiCard,
            compact && styles.aiCardCompact,
          ]}
        >
          <View style={styles.aiHeader}>
            <View style={styles.aiTitleRow}>
              <View style={styles.aiIcon}>
                <Feather name="zap" size={16} color="#C9B8FF" />
              </View>

              <View style={styles.aiHeaderCopy}>
                <Text allowFontScaling={false} style={styles.aiEyebrow}>
                  MYFUTURELY AI
                </Text>
                <Text allowFontScaling={false} style={styles.aiTitle}>
                  Ask your academic copilot
                </Text>
              </View>
            </View>

            <Pressable
              onPress={() => navigation.navigate('AIChat')}
              style={({ pressed }) => [
                styles.openAiButton,
                pressed && pressedStyle,
              ]}
              accessibilityRole="button"
              accessibilityLabel="Open full AI chat"
            >
              <Text allowFontScaling={false} style={styles.openAiText}>
                Open chat
              </Text>
              <Feather
                name="arrow-up-right"
                size={14}
                color="#C8B8FF"
              />
            </Pressable>
          </View>

          {aiReply ? (
            <Pressable
              onPress={() => navigation.navigate('AIChat')}
              style={({ pressed }) => [
                styles.aiReplyCard,
                pressed && pressedStyle,
              ]}
              accessibilityRole="button"
              accessibilityLabel="Open full AI conversation"
            >
              <View style={styles.aiReplyIcon}>
                <Feather
                  name="message-circle"
                  size={15}
                  color="#BBA7FF"
                />
              </View>

              <Text
                style={styles.aiReplyText}
                numberOfLines={veryCompact ? 1 : 2}
              >
                {aiReply}
              </Text>

              <Feather name="chevron-right" size={16} color="#7E90AC" />
            </Pressable>
          ) : (
            <View style={styles.aiPromptRow}>
              <Pressable
                onPress={() =>
                  void handleAskAI(
                    'Help me plan my school week based on my current assignments.',
                  )
                }
                style={({ pressed }) => [
                  styles.aiPromptChip,
                  pressed && pressedStyle,
                ]}
              >
                <Feather name="calendar" size={13} color="#78B5FF" />
                <Text
                  allowFontScaling={false}
                  style={styles.aiPromptChipText}
                >
                  Plan my week
                </Text>
              </Pressable>

              <Pressable
                onPress={() =>
                  void handleAskAI(
                    'What should I focus on first to improve my GPA?',
                  )
                }
                style={({ pressed }) => [
                  styles.aiPromptChip,
                  pressed && pressedStyle,
                ]}
              >
                <Feather
                  name="trending-up"
                  size={13}
                  color="#62D9B5"
                />
                <Text
                  allowFontScaling={false}
                  style={styles.aiPromptChipText}
                >
                  Raise my GPA
                </Text>
              </Pressable>
            </View>
          )}

          <View style={styles.aiComposer}>
            <View style={styles.aiComposerIcon}>
              <Feather name="message-circle" size={18} color="#FFFFFF" />
            </View>

            <TextInput
              value={aiPrompt}
              onChangeText={setAiPrompt}
              placeholder="Ask myFuturely AI anything..."
              placeholderTextColor="#74859F"
              style={styles.aiInput}
              returnKeyType="send"
              onSubmitEditing={() => void handleAskAI()}
            />

            <Pressable
              disabled={aiSending}
              onPress={() => void handleAskAI()}
              style={({ pressed }) => [
                styles.aiSendButton,
                pressed && !aiSending && pressedStyle,
                aiSending && styles.disabled,
              ]}
              accessibilityRole="button"
              accessibilityLabel="Ask myFuturely AI"
            >
              {aiSending ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Feather name="send" size={17} color="#FFFFFF" />
              )}
            </Pressable>
          </View>
        </View>

        {error ? (
          <Text style={styles.inlineError}>{error}</Text>
        ) : null}
      </View>
    </Screen>
  )
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    width: '100%',
    paddingTop: 7,
    paddingBottom: 6,
    gap: 9,
  },
  pageCompact: {
    paddingTop: 4,
    gap: 7,
  },
  pageVeryCompact: {
    gap: 5,
  },

  header: {
    minHeight: 74,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  headerCopy: {
    flex: 1,
    minWidth: 0,
  },
  greeting: {
    color: '#87B5F3',
    fontFamily: fonts.medium,
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '500',
  },
  studentName: {
    marginTop: 2,
    color: '#F8FAFF',
    fontFamily: fonts.bold,
    fontSize: 30,
    lineHeight: 34,
    fontWeight: '700',
    letterSpacing: -0.8,
  },
  headerActions: {
    alignItems: 'flex-end',
    gap: 6,
  },
  datePill: {
    minHeight: 32,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 11,
    borderRadius: 999,
    backgroundColor: '#10233F',
    borderWidth: 1,
    borderColor: 'rgba(80,148,238,0.45)',
  },
  datePillText: {
    color: '#83BAFF',
    fontFamily: fonts.semiBold,
    fontSize: 10,
    fontWeight: '600',
  },
  notificationButton: {
    width: 35,
    height: 35,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    backgroundColor: '#101B2B',
    borderWidth: 1,
    borderColor: 'rgba(104,129,166,0.24)',
  },

  gpaCard: {
    position: 'relative',
    width: '100%',
    minHeight: 224,
    overflow: 'hidden',
    borderRadius: 24,
    backgroundColor: '#7136F4',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.24)',
    ...elevation.md,
  },
  gpaCardCompact: {
    minHeight: 211,
  },
  gpaStripeOne: {
    position: 'absolute',
    top: -65,
    left: 108,
    width: 70,
    height: 360,
    backgroundColor: 'rgba(255,255,255,0.055)',
    transform: [{ rotate: '24deg' }],
  },
  gpaStripeTwo: {
    position: 'absolute',
    top: -65,
    right: 76,
    width: 38,
    height: 340,
    backgroundColor: 'rgba(255,255,255,0.032)',
    transform: [{ rotate: '24deg' }],
  },
  gpaBottomShade: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 49,
    backgroundColor: 'rgba(31,19,92,0.24)',
  },
  gpaHeader: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 15,
  },
  gpaHeaderCopy: {
    flex: 1,
    minWidth: 0,
  },
  gpaEyebrow: {
    color: 'rgba(255,255,255,0.69)',
    fontFamily: fonts.semiBold,
    fontSize: 9.5,
    fontWeight: '600',
    letterSpacing: 1.1,
  },
  gpaTitle: {
    marginTop: 2,
    color: '#FFFFFF',
    fontFamily: fonts.bold,
    fontSize: 21,
    lineHeight: 25,
    fontWeight: '700',
  },
  gpaViewButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 13,
    backgroundColor: 'rgba(40,25,102,0.27)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.20)',
  },
  gpaMetricsRow: {
    minHeight: 91,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
  },
  gpaMetric: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gpaNumber: {
    color: '#FFFFFF',
    fontFamily: fonts.bold,
    fontSize: 35,
    lineHeight: 40,
    fontWeight: '700',
    letterSpacing: -1.2,
  },
  gpaNumberHidden: {
    fontSize: 25,
    letterSpacing: 2.6,
  },
  gpaMetricLabel: {
    marginTop: 2,
    color: 'rgba(255,255,255,0.72)',
    fontFamily: fonts.medium,
    fontSize: 11,
    fontWeight: '500',
  },
  gpaDivider: {
    width: 1,
    height: 57,
    backgroundColor: 'rgba(255,255,255,0.24)',
  },
  syncButton: {
    minHeight: 45,
    marginHorizontal: 16,
    marginBottom: 13,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 14,
    backgroundColor: 'rgba(27,20,80,0.28)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  syncButtonPressed: {
    backgroundColor: 'rgba(255,255,255,0.17)',
  },
  syncButtonText: {
    color: '#FFFFFF',
    fontFamily: fonts.bold,
    fontSize: 12.5,
    fontWeight: '700',
  },

  todayCard: {
    width: '100%',
    minHeight: 143,
    padding: 14,
    borderRadius: 22,
    backgroundColor: '#102039',
    borderWidth: 1,
    borderColor: '#284567',
    ...elevation.sm,
  },
  todayCardCompact: {
    minHeight: 132,
    paddingVertical: 12,
  },
  todayHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionEyebrow: {
    color: '#7191BD',
    fontFamily: fonts.bold,
    fontSize: 8.5,
    lineHeight: 11,
    fontWeight: '700',
    letterSpacing: 1.1,
  },
  sectionTitle: {
    marginTop: 2,
    color: '#F5F7FF',
    fontFamily: fonts.bold,
    fontSize: 20,
    lineHeight: 24,
    fontWeight: '700',
    letterSpacing: -0.25,
  },
  todayCalendarButton: {
    width: 39,
    height: 39,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 13,
    backgroundColor: '#0E2746',
    borderWidth: 1,
    borderColor: 'rgba(80,151,244,0.34)',
  },
  assignmentCard: {
    minHeight: 59,
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 13,
    borderRadius: 16,
    backgroundColor: '#071F22',
    borderWidth: 1,
    borderColor: 'rgba(41,210,162,0.20)',
  },
  assignmentCardActive: {
    backgroundColor: '#1A2030',
    borderColor: 'rgba(246,180,58,0.24)',
  },
  assignmentDot: {
    width: 10,
    height: 10,
    flexShrink: 0,
    borderRadius: 5,
    backgroundColor: '#FFB83F',
  },
  assignmentDotComplete: {
    backgroundColor: '#38D6A8',
  },
  assignmentCopy: {
    flex: 1,
    minWidth: 0,
  },
  assignmentTitle: {
    color: '#F8FAFF',
    fontFamily: fonts.bold,
    fontSize: 12.5,
    lineHeight: 17,
    fontWeight: '700',
  },
  assignmentTitleComplete: {
    color: '#72E0BF',
  },
  assignmentSubtitle: {
    marginTop: 2,
    color: '#8598B4',
    fontFamily: fonts.regular,
    fontSize: 9.5,
    lineHeight: 13,
  },

  statsRow: {
    width: '100%',
    minHeight: 104,
    flexDirection: 'row',
    gap: 10,
  },
  statTile: {
    flex: 1,
    minWidth: 0,
    minHeight: 104,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingHorizontal: 5,
    paddingVertical: 10,
    borderRadius: 19,
    backgroundColor: '#12233C',
    borderWidth: 1,
    borderColor: '#2C4A70',
    ...elevation.sm,
  },
  statIconWrap: {
    width: 41,
    height: 41,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 13,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.055)',
  },
  statValue: {
    color: '#F9FBFF',
    fontFamily: fonts.bold,
    fontSize: 24,
    lineHeight: 27,
    fontWeight: '700',
  },
  statLabel: {
    color: '#A0B1C9',
    fontFamily: fonts.medium,
    fontSize: 10,
    lineHeight: 13,
    fontWeight: '500',
    textAlign: 'center',
  },

  aiCard: {
    width: '100%',
    minHeight: 151,
    marginTop: 'auto',
    gap: 10,
    padding: 13,
    borderRadius: 21,
    backgroundColor: '#0E182A',
    borderWidth: 1,
    borderColor: '#293F5E',
    ...elevation.sm,
  },
  aiCardCompact: {
    minHeight: 139,
    gap: 8,
    paddingVertical: 11,
  },
  aiHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  aiTitleRow: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  aiIcon: {
    width: 35,
    height: 35,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    backgroundColor: '#24175B',
    borderWidth: 1,
    borderColor: 'rgba(167,139,250,0.32)',
  },
  aiHeaderCopy: {
    flex: 1,
    minWidth: 0,
  },
  aiEyebrow: {
    color: '#8A79D6',
    fontFamily: fonts.bold,
    fontSize: 8,
    lineHeight: 10,
    fontWeight: '700',
    letterSpacing: 0.9,
  },
  aiTitle: {
    marginTop: 2,
    color: '#F2F5FF',
    fontFamily: fonts.bold,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '700',
  },
  openAiButton: {
    minHeight: 32,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 9,
    borderRadius: 10,
    backgroundColor: '#1A173D',
    borderWidth: 1,
    borderColor: 'rgba(167,139,250,0.28)',
  },
  openAiText: {
    color: '#C8B8FF',
    fontFamily: fonts.bold,
    fontSize: 8.5,
    fontWeight: '700',
  },
  aiPromptRow: {
    flexDirection: 'row',
    gap: 8,
  },
  aiPromptChip: {
    flex: 1,
    minWidth: 0,
    minHeight: 31,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingHorizontal: 7,
    borderRadius: 10,
    backgroundColor: '#14243A',
    borderWidth: 1,
    borderColor: '#294260',
  },
  aiPromptChipText: {
    color: '#A9B7CA',
    fontFamily: fonts.semiBold,
    fontSize: 8.7,
    fontWeight: '600',
  },
  aiReplyCard: {
    minHeight: 39,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 9,
    borderRadius: 12,
    backgroundColor: '#141F34',
    borderWidth: 1,
    borderColor: '#293E5D',
  },
  aiReplyIcon: {
    width: 29,
    height: 29,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 9,
    backgroundColor: '#211750',
  },
  aiReplyText: {
    flex: 1,
    minWidth: 0,
    color: '#AEBBD0',
    fontFamily: fonts.regular,
    fontSize: 9.2,
    lineHeight: 13,
  },
  aiComposer: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 5,
    borderRadius: 15,
    backgroundColor: '#142A47',
    borderWidth: 1,
    borderColor: 'rgba(91,143,214,0.44)',
  },
  aiComposerIcon: {
    width: 36,
    height: 36,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 11,
    backgroundColor: '#6647F4',
  },
  aiInput: {
    flex: 1,
    minWidth: 0,
    height: 38,
    paddingHorizontal: 1,
    paddingVertical: 0,
    color: '#F4F7FF',
    fontFamily: fonts.regular,
    fontSize: 11.5,
  },
  aiSendButton: {
    width: 36,
    height: 36,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 11,
    backgroundColor: '#2E67BF',
  },

  pressed: {
    opacity: 0.84,
    transform: [{ scale: 0.985 }],
  },
  pressedReducedMotion: {
    opacity: 0.84,
  },
  disabled: {
    opacity: 0.6,
  },
  inlineError: {
    color: colors.error,
    fontFamily: fonts.regular,
    fontSize: 9.5,
    lineHeight: 12,
    textAlign: 'center',
  },
})