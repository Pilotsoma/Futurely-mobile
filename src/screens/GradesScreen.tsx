import React, { useCallback, useState } from 'react'
import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { useFocusEffect, useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { Feather } from '@expo/vector-icons'

import * as gradesApi from '../api/gradesApi'
import { ApiRequestError } from '../api/client'
import { Screen } from '../components/ui/Screen'
import { LoadingSkeleton } from '../components/ui/LoadingSkeleton'
import { ActionTile } from '../components/ui/ActionTile'
import { GpaOverviewCard } from '../components/grades/GpaOverviewCard'
import type { CurrentGradeCourse, GpaSummary } from '../types/grades'
import type { GradesStackParamList } from '../navigation/GradesNavigator'
import {
  colors,
  fonts,
  radii,
  spacing,
} from '../theme/tokens'

type Nav = NativeStackNavigationProp<GradesStackParamList>
type FeatherName = React.ComponentProps<typeof Feather>['name']

interface AcademicTool {
  label: string
  description: string
  route: keyof GradesStackParamList
  icon: FeatherName
  color: string
  iconBackground: string
}

const ACADEMIC_TOOLS: AcademicTool[] = [
  {
    label: 'Classwork',
    description: 'Assignments and current averages',
    route: 'Classwork',
    icon: 'bar-chart-2',
    color: '#36D5A5',
    iconBackground: 'rgba(16,185,129,0.14)',
  },
  {
    label: 'Report Card',
    description: 'Official grades by reporting period',
    route: 'ReportCard',
    icon: 'clipboard',
    color: '#6CB6FF',
    iconBackground: 'rgba(59,130,246,0.16)',
  },
  {
    label: 'Schedule',
    description: 'Your classes and periods',
    route: 'Schedule',
    icon: 'clock',
    color: '#FFC547',
    iconBackground: 'rgba(245,158,11,0.15)',
  },
  {
    label: 'What-If',
    description: 'Simulate grade and GPA changes',
    route: 'GpaSimulator',
    icon: 'percent',
    color: '#B49AFF',
    iconBackground: 'rgba(127,34,254,0.18)',
  },
  {
    label: 'Teachers',
    description: 'Quickly contact your teachers',
    route: 'ContactTeachers',
    icon: 'mail',
    color: '#FF9A56',
    iconBackground: 'rgba(249,115,22,0.15)',
  },
  {
    label: 'Progress',
    description: 'Review interim grade reports',
    route: 'ProgressReport',
    icon: 'trending-up',
    color: '#C0A7FF',
    iconBackground: 'rgba(167,139,250,0.16)',
  },
  {
    label: 'Transcript',
    description: 'Credits and GPA history',
    route: 'Transcript',
    icon: 'file-text',
    color: '#8794FF',
    iconBackground: 'rgba(99,102,241,0.16)',
  },
  {
    label: 'Attendance',
    description: 'Absences, tardies and calendar',
    route: 'Attendance',
    icon: 'calendar',
    color: '#FF777A',
    iconBackground: 'rgba(239,68,68,0.15)',
  },
  {
    label: 'Roadmap',
    description: 'Graduation progress and milestones',
    route: 'Roadmap',
    icon: 'flag',
    color: '#5FD0C4',
    iconBackground: 'rgba(16,185,129,0.14)',
  },
]

const ACADEMIC_TOOL_ROWS: AcademicTool[][] = Array.from(
  { length: Math.ceil(ACADEMIC_TOOLS.length / 2) },
  (_, index) => ACADEMIC_TOOLS.slice(index * 2, index * 2 + 2),
)

function resultMessage(error: unknown, fallback: string): string {
  return error instanceof ApiRequestError ? error.message : fallback
}

export default function GradesScreen(): React.JSX.Element {
  const navigation = useNavigation<Nav>()

  const [courses, setCourses] = useState<CurrentGradeCourse[]>([])
  const [gpa, setGpa] = useState<GpaSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [inlineError, setInlineError] = useState<string | null>(null)
  const [gpaError, setGpaError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setInlineError(null)
    setGpaError(null)

    const [currentResult, gpaResult] = await Promise.allSettled([
      gradesApi.getCurrentGrades(),
      gradesApi.getGpa(),
    ])

    if (currentResult.status === 'fulfilled') {
      setCourses(currentResult.value.grades)
    }

    if (gpaResult.status === 'fulfilled') {
      setGpa(gpaResult.value)
    } else {
      setGpa(null)
    }

    if (currentResult.status === 'rejected') {
      setInlineError(
        resultMessage(currentResult.reason, 'Your course list could not be loaded.'),
      )
    }
    if (gpaResult.status === 'rejected') {
      setGpaError(resultMessage(gpaResult.reason, 'Your GPA could not be loaded.'))
    }

    setLoading(false)
  }, [])

  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load]),
  )

  const handleRefresh = useCallback(async () => {
    setRefreshing(true)
    try {
      await load()
    } finally {
      setRefreshing(false)
    }
  }, [load])

  const handleSync = useCallback(async () => {
    setSyncing(true)
    setInlineError(null)

    try {
      await gradesApi.syncProfile()
      await load()
    } catch (error) {
      setGpaError(resultMessage(error, 'Grade sync failed. Please try again.'))
    } finally {
      setSyncing(false)
    }
  }, [load])

  if (loading) {
    return (
      <Screen edges={['top', 'left', 'right']}>
        <LoadingSkeleton rows={5} />
      </Screen>
    )
  }

  return (
    <Screen edges={['top', 'left', 'right']}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void handleRefresh()}
            tintColor={colors.primary}
            colors={[colors.primary]}
            progressBackgroundColor={colors.surface2}
          />
        }
      >
        <View style={styles.header}>
          <View style={styles.headerCopy}>
            <Text allowFontScaling={false} style={styles.eyebrow}>
              ACADEMIC CENTER
            </Text>
            <Text allowFontScaling={false} style={styles.pageTitle}>
              Grades
            </Text>
            <Text allowFontScaling={false} style={styles.pageSubtitle}>
              Your GPA, classes and academic progress in one place.
            </Text>
          </View>
        </View>

        <GpaOverviewCard
          summary={gpa}
          courses={courses}
          error={gpaError}
          syncing={syncing}
          onPress={() => navigation.navigate('GpaSimulator')}
          onSync={() => void handleSync()}
          testID="grades-gpa-card"
        />

        <View style={styles.sectionHeader}>
          <View style={styles.sectionHeaderCopy}>
            <Text allowFontScaling={false} style={styles.sectionEyebrow}>
              ACADEMIC TOOLS
            </Text>
            <Text allowFontScaling={false} style={styles.sectionTitle}>
              Everything you need
            </Text>
            <Text allowFontScaling={false} style={styles.sectionSubtitle}>
              Open your gradebook, reports, schedule and planning tools.
            </Text>
          </View>

          <View style={styles.toolsCountBadge}>
            <Feather name="grid" size={14} color="#A990FF" />
            <Text allowFontScaling={false} style={styles.toolsCountText}>
              {ACADEMIC_TOOLS.length}
            </Text>
          </View>
        </View>

        <View style={styles.toolsGrid}>
          {ACADEMIC_TOOL_ROWS.map((row, rowIndex) => (
            <View key={`academic-tool-row-${rowIndex}`} style={styles.toolRow}>
              {row.map((item) => (
                <ActionTile
                  key={item.route}
                  title={item.label}
                  subtitle={item.description}
                  icon={item.icon}
                  color={item.color}
                  iconBackground={item.iconBackground}
                  onPress={() => navigation.navigate(item.route)}
                  accessibilityHint={`Open ${item.description.toLowerCase()}`}
                  testID={`grades-tile-${item.route}`}
                />
              ))}
            </View>
          ))}
        </View>

        {inlineError ? (
          <View style={styles.inlineErrorCard}>
            <Feather name="alert-circle" size={15} color={colors.error} />
            <Text style={styles.inlineErrorText}>{inlineError}</Text>
          </View>
        ) : null}
      </ScrollView>
    </Screen>
  )
}

const styles = StyleSheet.create({
  scrollContent: {
    paddingTop: 10,
    paddingBottom: 118,
    gap: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 16,
  },
  headerCopy: {
    flex: 1,
    minWidth: 0,
  },
  eyebrow: {
    color: '#7896C2',
    fontFamily: fonts.semiBold,
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 1.35,
  },
  pageTitle: {
    color: '#F7F9FF',
    fontFamily: fonts.bold,
    fontSize: 31,
    lineHeight: 36,
    fontWeight: '700',
    letterSpacing: -0.8,
    marginTop: 2,
  },
  pageSubtitle: {
    color: '#77859A',
    fontFamily: fonts.regular,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 3,
    maxWidth: 270,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    marginTop: 4,
  },
  sectionHeaderCopy: {
    flex: 1,
    minWidth: 0,
  },
  sectionEyebrow: {
    color: '#6E91C0',
    fontFamily: fonts.semiBold,
    fontSize: 9.5,
    fontWeight: '600',
    letterSpacing: 1.25,
  },
  sectionTitle: {
    color: colors.text,
    fontFamily: fonts.bold,
    fontSize: 19,
    lineHeight: 24,
    fontWeight: '700',
    marginTop: 2,
  },
  sectionSubtitle: {
    color: '#708098',
    fontFamily: fonts.regular,
    fontSize: 10.5,
    lineHeight: 15,
    marginTop: 2,
    maxWidth: 265,
  },
  toolsCountBadge: {
    minWidth: 48,
    height: 31,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 10,
    borderRadius: 11,
    backgroundColor: '#121729',
    borderWidth: 1,
    borderColor: 'rgba(151,119,255,0.24)',
  },
  toolsCountText: {
    color: '#C5B5FF',
    fontFamily: fonts.bold,
    fontSize: 11,
    fontWeight: '700',
  },
  toolsGrid: {
    width: '100%',
    alignSelf: 'stretch',
    gap: 11,
  },
  toolRow: {
    width: '100%',
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 11,
  },
  inlineErrorCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    padding: spacing.ms,
    borderRadius: radii.md,
    backgroundColor: 'rgba(255,100,103,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,100,103,0.18)',
  },
  inlineErrorText: {
    flex: 1,
    color: colors.error,
    fontFamily: fonts.regular,
    fontSize: 11,
    lineHeight: 16,
  },
})
