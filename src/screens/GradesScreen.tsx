// GradesScreen — hub for the Grades section.
//
// Displays the student's current GPA (weighted/unweighted) and a grid of
// navigation cards to each sub-page. Matches the web app's grades/page.tsx
// card layout, adapted for React Native.
//
// Data:
//   - getCurrentGrades: for per-course grade display
//   - getGpa: for the headline GPA numbers
//
// Navigation: all sub-pages are pushed onto the GradesNavigator stack.

import React, { useCallback, useState } from 'react'
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useNavigation, useFocusEffect } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { useTheme } from '../theme/ThemeContext'
import { useAuth } from '../context/AuthContext'
import { getCurrentGrades, getGpa } from '../api/gradesApi'
import type { CurrentGradesResponse, GpaResponse } from '../api/gradesApi'
import { ApiRequestError } from '../api/client'
import type { GradesStackParamList } from '../navigation/GradesNavigator'

// ── Helpers ────────────────────────────────────────────────────────────────────

function extractMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiRequestError) return err.message
  if (err instanceof Error) return err.message
  return fallback
}

function getGradeColor(
  average: string | null | undefined,
  colors: { gradeA: string; gradeB: string; gradeC: string; gradeD: string; gradeF: string; textMuted: string },
): string {
  if (!average) return colors.textMuted
  const num = parseFloat(average)
  if (isNaN(num)) {
    const upper = average.trim().toUpperCase()
    if (upper.startsWith('A')) return colors.gradeA
    if (upper.startsWith('B')) return colors.gradeB
    if (upper.startsWith('C')) return colors.gradeC
    if (upper.startsWith('D')) return colors.gradeD
    if (upper === 'F') return colors.gradeF
    return colors.textMuted
  }
  if (num >= 90) return colors.gradeA
  if (num >= 80) return colors.gradeB
  if (num >= 70) return colors.gradeC
  if (num >= 60) return colors.gradeD
  return colors.gradeF
}

function formatAverage(average: string | null | undefined): string {
  if (!average) return '—'
  const num = parseFloat(average)
  if (!isNaN(num)) return `${Math.round(num)}`
  return average
}

// ── Nav cards config ────────────────────────────────────────────────────────────

interface NavCard {
  route: keyof GradesStackParamList
  title: string
  desc: string
  emoji: string
}

const NAV_CARDS: NavCard[] = [
  { route: 'Classwork',       title: 'Classwork',         desc: 'Assignments & averages',          emoji: '📊' },
  { route: 'ReportCard',      title: 'Report Card',       desc: 'Grades by reporting period',       emoji: '📋' },
  { route: 'Schedule',        title: 'Class Schedule',    desc: 'Your class periods',               emoji: '🕐' },
  { route: 'GpaSimulator',    title: 'What-If Calculator',desc: 'Simulate GPA changes',             emoji: '🧮' },
  { route: 'ContactTeachers', title: 'Contact Teachers',  desc: 'Email your teachers',              emoji: '✉️' },
  { route: 'ProgressReport',  title: 'Progress Report',   desc: 'Interim grades by date',           emoji: '📈' },
  { route: 'Transcript',      title: 'Transcript',        desc: 'Credits & GPA history',            emoji: '📄' },
  { route: 'Attendance',      title: 'Attendance',        desc: 'Absences & tardies',               emoji: '📅' },
]

// ── Component ──────────────────────────────────────────────────────────────────

type GradesNavProp = NativeStackNavigationProp<GradesStackParamList>

export default function GradesScreen(): React.JSX.Element {
  const { theme } = useTheme()
  const { accessToken } = useAuth()
  const navigation = useNavigation<GradesNavProp>()

  const [gradesData, setGradesData]   = useState<CurrentGradesResponse | null>(null)
  const [gpaData, setGpaData]         = useState<GpaResponse | null>(null)
  const [loading, setLoading]         = useState(true)
  const [error, setError]             = useState<string | null>(null)

  const c  = theme.colors
  const sp = theme.spacing
  const r  = theme.radius
  const ty = theme.typography

  const loadData = useCallback(async (): Promise<void> => {
    if (!accessToken) return
    setLoading(true)
    setError(null)
    try {
      const [grades, gpa] = await Promise.all([
        getCurrentGrades(accessToken),
        getGpa(accessToken),
      ])
      setGradesData(grades)
      setGpaData(gpa)
    } catch (err: unknown) {
      setError(extractMessage(err, 'Could not load grades. Please try again.'))
    } finally {
      setLoading(false)
    }
  }, [accessToken])

  useFocusEffect(
    useCallback(() => {
      void loadData()
    }, [loadData]),
  )

  // ── Render helpers ─────────────────────────────────────────────────────────

  function renderGpaPanel(): React.JSX.Element {
    if (!gpaData) return <View />
    const weighted   = gpaData.weightedGpa   != null ? gpaData.weightedGpa.toFixed(3)   : '—'
    const unweighted = gpaData.unweightedGpa != null ? gpaData.unweightedGpa.toFixed(3) : '—'
    return (
      <View style={[styles.gpaRow, { marginBottom: sp.xl3 }]}>
        <View style={[styles.gpaCard, { backgroundColor: c.surface, borderColor: c.border, borderRadius: r.lg }]}>
          <Text style={[styles.gpaLabel, { color: c.textMuted, fontSize: ty.fontSizeXs }]}>
            WEIGHTED GPA
          </Text>
          <Text style={[styles.gpaValue, { color: c.primary, fontSize: 34 }]}>
            {weighted}
          </Text>
        </View>
        <View style={[styles.gpaCard, { backgroundColor: c.surface, borderColor: c.border, borderRadius: r.lg }]}>
          <Text style={[styles.gpaLabel, { color: c.textMuted, fontSize: ty.fontSizeXs }]}>
            UNWEIGHTED GPA
          </Text>
          <Text style={[styles.gpaValue, { color: c.success, fontSize: 34 }]}>
            {unweighted}
          </Text>
        </View>
      </View>
    )
  }

  function renderCourseList(): React.JSX.Element | null {
    if (!gradesData?.grades?.length) return null
    return (
      <View style={{ marginBottom: sp.xl3 }}>
        <Text style={[styles.sectionTitle, { color: c.textMuted, fontSize: ty.fontSizeSm, marginBottom: sp.md }]}>
          CURRENT COURSES
        </Text>
        {gradesData.grades.map((course, i) => {
          const name    = (course as Record<string, unknown>)['name'] as string | undefined
          const avg     = (course as Record<string, unknown>)['average'] as string | undefined
          const teacher = (course as Record<string, unknown>)['teacher'] as string | undefined
          const gradeColor = getGradeColor(avg, c)
          return (
            <View
              key={i}
              style={[
                styles.courseRow,
                {
                  backgroundColor: c.surface,
                  borderColor: c.border,
                  borderRadius: r.md,
                  marginBottom: sp.md,
                },
              ]}
            >
              <View style={styles.courseInfo}>
                <Text
                  style={[styles.courseName, { color: c.text, fontSize: ty.fontSizeBase }]}
                  numberOfLines={1}
                >
                  {name ?? 'Unknown Course'}
                </Text>
                {teacher ? (
                  <Text style={[styles.courseTeacher, { color: c.textMuted, fontSize: ty.fontSizeSm }]}>
                    {teacher}
                  </Text>
                ) : null}
              </View>
              <View
                style={[
                  styles.gradeBadge,
                  { backgroundColor: `${gradeColor}22`, borderColor: `${gradeColor}44` },
                ]}
              >
                <Text style={[styles.gradeText, { color: gradeColor, fontSize: ty.fontSizeLg }]}>
                  {formatAverage(avg)}
                </Text>
              </View>
            </View>
          )
        })}
      </View>
    )
  }

  function renderNavGrid(): React.JSX.Element {
    return (
      <View style={styles.navGrid}>
        {NAV_CARDS.map(card => (
          <TouchableOpacity
            key={card.route}
            style={[
              styles.navCard,
              {
                backgroundColor: c.surface,
                borderColor: c.border,
                borderRadius: r.lg,
              },
            ]}
            onPress={() => navigation.navigate(card.route)}
            accessibilityRole="button"
            accessibilityLabel={`${card.title} — ${card.desc}`}
            activeOpacity={0.75}
          >
            <View style={[styles.navCardIcon, { backgroundColor: c.primaryDim, borderRadius: r.md }]}>
              <Text style={{ fontSize: 22 }} accessibilityLabel="">{card.emoji}</Text>
            </View>
            <View style={styles.navCardText}>
              <Text style={[styles.navCardTitle, { color: c.text, fontSize: ty.fontSizeBase }]}>
                {card.title}
              </Text>
              <Text style={[styles.navCardDesc, { color: c.textSecondary, fontSize: ty.fontSizeSm }]}>
                {card.desc}
              </Text>
            </View>
            <Text style={[styles.chevron, { color: c.textMuted }]}>›</Text>
          </TouchableOpacity>
        ))}
      </View>
    )
  }

  // ── Main render ────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.bg }]} edges={['top', 'left', 'right']}>
      <ScrollView
        style={styles.flex}
        contentContainerStyle={[styles.content, { paddingHorizontal: sp.screenPaddingH, paddingBottom: sp.xl8 }]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={[styles.pageTitle, { color: c.text, fontSize: ty.fontSize3xl, marginTop: sp.xl3, marginBottom: sp.xl3 }]}>
          Grade Portal
        </Text>

        {loading && (
          <View style={styles.centerState}>
            <ActivityIndicator color={c.primary} size="large" />
            <Text style={[styles.stateText, { color: c.textMuted, fontSize: ty.fontSizeBase, marginTop: sp.xl }]}>
              Loading grades…
            </Text>
          </View>
        )}

        {!loading && error !== null && (
          <View style={[styles.errorBox, { backgroundColor: `${c.error}14`, borderColor: `${c.error}33`, borderRadius: r.md, marginBottom: sp.xl3 }]}>
            <Text style={[styles.errorText, { color: c.error, fontSize: ty.fontSizeBase }]}>{error}</Text>
            <TouchableOpacity
              style={[styles.retryBtn, { backgroundColor: c.primary, borderRadius: r.sm, marginTop: sp.xl }]}
              onPress={() => { void loadData() }}
              accessibilityRole="button"
              accessibilityLabel="Retry loading grades"
            >
              <Text style={[styles.retryBtnText, { color: '#FFFFFF', fontSize: ty.fontSizeBase }]}>
                Retry
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {!loading && error === null && (
          <>
            {renderGpaPanel()}
            {renderCourseList()}
          </>
        )}

        {renderNavGrid()}
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe:       { flex: 1 },
  flex:       { flex: 1 },
  content:    { flexGrow: 1 },
  pageTitle:  { fontWeight: '800', letterSpacing: -0.5 },
  sectionTitle: { fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.6 },

  gpaRow:     { flexDirection: 'row', gap: 12 },
  gpaCard:    { flex: 1, borderWidth: 1, padding: 16, alignItems: 'flex-start' },
  gpaLabel:   { fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 8 },
  gpaValue:   { fontWeight: '800', letterSpacing: -1, lineHeight: 38 },

  courseRow:  { flexDirection: 'row', alignItems: 'center', borderWidth: 1, padding: 12 },
  courseInfo: { flex: 1, marginRight: 12 },
  courseName: { fontWeight: '600', lineHeight: 20 },
  courseTeacher: { marginTop: 2, lineHeight: 16 },
  gradeBadge: {
    borderWidth: 1,
    borderRadius: 8,
    minWidth: 52,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  gradeText:  { fontWeight: '700' },

  navGrid:    { gap: 12 },
  navCard:    {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    padding: 16,
    gap: 14,
    minHeight: 72,
  },
  navCardIcon: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  navCardText: { flex: 1, minWidth: 0 },
  navCardTitle: { fontWeight: '700', marginBottom: 3 },
  navCardDesc:  { lineHeight: 17 },
  chevron:     { fontSize: 22, fontWeight: '300', flexShrink: 0 },

  centerState: { alignItems: 'center', paddingVertical: 48 },
  stateText:   { textAlign: 'center' },

  errorBox:    { padding: 16, borderWidth: 1 },
  errorText:   { lineHeight: 22 },
  retryBtn:    { alignSelf: 'flex-start', paddingHorizontal: 20, paddingVertical: 10, minHeight: 44 },
  retryBtnText:{ fontWeight: '600' },
})
