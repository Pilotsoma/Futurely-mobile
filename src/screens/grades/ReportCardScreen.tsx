// ReportCardScreen — official grades by reporting period.
//
// Endpoint: GET /integrations/grades/report-card (HAC only, 6h cache)
// Response: { reportingPeriods, currentPeriod, semesters }
//
// Supports optional period query param to browse past periods.
// HAC only — PowerSchool gets UNSUPPORTED message.

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
import { useFocusEffect } from '@react-navigation/native'
import { useTheme } from '../../theme/ThemeContext'
import { useAuth } from '../../context/AuthContext'
import { getReportCard } from '../../api/gradesApi'
import type { ReportCardResponse, ReportCardCourse } from '../../api/gradesApi'
import { ApiRequestError } from '../../api/client'

function extractMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiRequestError) return err.message
  if (err instanceof Error) return err.message
  return fallback
}

function gradeColor(
  grade: string | null | undefined,
  colors: { gradeA: string; gradeB: string; gradeC: string; gradeD: string; gradeF: string; textMuted: string },
): string {
  if (!grade) return colors.textMuted
  const n = parseFloat(grade)
  if (!isNaN(n)) {
    if (n >= 90) return colors.gradeA
    if (n >= 80) return colors.gradeB
    if (n >= 70) return colors.gradeC
    if (n >= 60) return colors.gradeD
    return colors.gradeF
  }
  const u = grade.trim().toUpperCase()
  if (u.startsWith('A')) return colors.gradeA
  if (u.startsWith('B')) return colors.gradeB
  if (u.startsWith('C')) return colors.gradeC
  if (u.startsWith('D')) return colors.gradeD
  if (u === 'F') return colors.gradeF
  return colors.textMuted
}

export default function ReportCardScreen(): React.JSX.Element {
  const { theme } = useTheme()
  const { accessToken } = useAuth()

  const [data, setData]               = useState<ReportCardResponse | null>(null)
  const [loading, setLoading]         = useState(true)
  const [error, setError]             = useState<string | null>(null)
  const [unsupported, setUnsupported] = useState(false)
  const [selectedPeriod, setSelectedPeriod] = useState<string | undefined>(undefined)

  const c  = theme.colors
  const sp = theme.spacing
  const r  = theme.radius
  const ty = theme.typography

  const load = useCallback(async (period?: string): Promise<void> => {
    if (!accessToken) return
    setLoading(true)
    setError(null)
    setUnsupported(false)
    try {
      const result = await getReportCard(accessToken, period)
      setData(result)
      if (!period && result.currentPeriod) {
        setSelectedPeriod(result.currentPeriod)
      }
    } catch (err: unknown) {
      if (err instanceof ApiRequestError && err.code === 'UNSUPPORTED') {
        setUnsupported(true)
      } else {
        setError(extractMessage(err, 'Could not load report card. Please try again.'))
      }
    } finally {
      setLoading(false)
    }
  }, [accessToken])

  useFocusEffect(
    useCallback(() => { void load() }, [load]),
  )

  function handlePeriodSelect(period: string): void {
    setSelectedPeriod(period)
    void load(period)
  }

  function renderCourse(course: ReportCardCourse, i: number): React.JSX.Element {
    const grades = course.grades ?? {}
    const periodKeys = Object.keys(grades)

    return (
      <View
        key={i}
        style={[styles.courseCard, { backgroundColor: c.surface, borderColor: c.border, borderRadius: r.lg, marginBottom: sp.lg }]}
      >
        <View style={styles.courseHeader}>
          <View style={styles.courseNameBlock}>
            <Text style={[styles.courseName, { color: c.text, fontSize: ty.fontSizeBase }]} numberOfLines={2}>
              {course.name ?? 'Unknown'}
            </Text>
            {course.teacher ? (
              <Text style={[styles.courseTeacher, { color: c.textMuted, fontSize: ty.fontSizeSm }]}>
                {course.teacher}
              </Text>
            ) : null}
          </View>
          {course.period ? (
            <View style={[styles.periodPill, { backgroundColor: c.primaryDim, borderRadius: r.sm }]}>
              <Text style={[{ color: c.primary, fontSize: ty.fontSizeSm, fontWeight: '600' }]}>
                P{course.period}
              </Text>
            </View>
          ) : null}
        </View>

        {periodKeys.length > 0 && (
          <View style={[styles.gradesRow, { borderTopColor: c.border }]}>
            {periodKeys.map(pk => {
              const g = grades[pk]
              const gc = gradeColor(g, c)
              return (
                <View key={pk} style={styles.gradeCell}>
                  <Text style={[styles.gradePeriodLabel, { color: c.textMuted, fontSize: ty.fontSizeXs }]}>
                    {pk}
                  </Text>
                  <Text style={[styles.gradeValue, { color: gc, fontSize: ty.fontSizeMd }]}>
                    {g ?? '—'}
                  </Text>
                </View>
              )
            })}
          </View>
        )}
      </View>
    )
  }

  function renderPeriodTabs(): React.JSX.Element | null {
    if (!data?.reportingPeriods || data.reportingPeriods.length <= 1) return null
    return (
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ marginBottom: sp.xl3 }}
        contentContainerStyle={{ gap: 8, paddingHorizontal: 0 }}
      >
        {data.reportingPeriods.map(p => {
          const active = p === selectedPeriod
          return (
            <TouchableOpacity
              key={p}
              style={[
                styles.periodTab,
                {
                  backgroundColor: active ? c.primary : c.surface,
                  borderColor: active ? c.primary : c.border,
                  borderRadius: r.sm,
                },
              ]}
              onPress={() => handlePeriodSelect(p)}
              accessibilityRole="button"
              accessibilityLabel={`Reporting period ${p}`}
              accessibilityState={{ selected: active }}
            >
              <Text style={[styles.periodTabText, { color: active ? '#FFFFFF' : c.textSecondary, fontSize: ty.fontSizeSm }]}>
                {p}
              </Text>
            </TouchableOpacity>
          )
        })}
      </ScrollView>
    )
  }

  const allCourses: ReportCardCourse[] = data?.semesters?.flatMap(s => s.courses) ?? []

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.bg }]} edges={['left', 'right', 'bottom']}>
      <ScrollView
        style={styles.flex}
        contentContainerStyle={[styles.content, { paddingHorizontal: sp.screenPaddingH, paddingBottom: sp.xl8 }]}
        showsVerticalScrollIndicator={false}
      >
        {loading && (
          <View style={styles.centerState}>
            <ActivityIndicator color={c.primary} size="large" />
            <Text style={[styles.stateText, { color: c.textMuted, fontSize: ty.fontSizeBase, marginTop: sp.xl }]}>
              Loading report card…
            </Text>
          </View>
        )}

        {!loading && unsupported && (
          <View style={[styles.infoBox, { backgroundColor: c.surface, borderColor: c.border, borderRadius: r.lg }]}>
            <Text style={[{ fontSize: 36, marginBottom: sp.lg, textAlign: 'center' }]}>🏫</Text>
            <Text style={[styles.infoTitle, { color: c.text, fontSize: ty.fontSizeXl }]}>
              Not Available for PowerSchool
            </Text>
            <Text style={[styles.infoBody, { color: c.textSecondary, fontSize: ty.fontSizeBase }]}>
              Report card data is only available for Home Access Center (HAC) districts.
            </Text>
          </View>
        )}

        {!loading && error !== null && (
          <View style={[styles.errorBox, { backgroundColor: `${c.error}14`, borderColor: `${c.error}33`, borderRadius: r.md }]}>
            <Text style={[styles.errorText, { color: c.error, fontSize: ty.fontSizeBase }]}>{error}</Text>
            <TouchableOpacity
              style={[styles.retryBtn, { backgroundColor: c.primary, borderRadius: r.sm, marginTop: sp.xl }]}
              onPress={() => { void load() }}
              accessibilityRole="button"
              accessibilityLabel="Retry loading report card"
            >
              <Text style={[styles.retryBtnText, { color: '#FFFFFF', fontSize: ty.fontSizeBase }]}>Retry</Text>
            </TouchableOpacity>
          </View>
        )}

        {!loading && error === null && !unsupported && data !== null && (
          <>
            {renderPeriodTabs()}
            {allCourses.length === 0 ? (
              <View style={styles.centerState}>
                <Text style={[{ fontSize: 40, marginBottom: sp.lg, textAlign: 'center' }]}>📋</Text>
                <Text style={[styles.stateText, { color: c.textMuted, fontSize: ty.fontSizeBase }]}>
                  No report card data found.
                </Text>
              </View>
            ) : (
              allCourses.map((course, i) => renderCourse(course, i))
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe:    { flex: 1 },
  flex:    { flex: 1 },
  content: { flexGrow: 1, paddingTop: 16 },

  periodTab:      { paddingHorizontal: 14, paddingVertical: 8, borderWidth: 1, minHeight: 36 },
  periodTabText:  { fontWeight: '600' },

  courseCard:     { borderWidth: 1 },
  courseHeader:   { flexDirection: 'row', alignItems: 'flex-start', padding: 14, gap: 10 },
  courseNameBlock:{ flex: 1, minWidth: 0 },
  courseName:     { fontWeight: '600', lineHeight: 22 },
  courseTeacher:  { marginTop: 3, lineHeight: 16 },
  periodPill:     { paddingHorizontal: 10, paddingVertical: 5, alignSelf: 'flex-start', flexShrink: 0 },
  gradesRow:      { flexDirection: 'row', flexWrap: 'wrap', borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: 14, paddingVertical: 10, gap: 12 },
  gradeCell:      { alignItems: 'center', minWidth: 48 },
  gradePeriodLabel:{ fontWeight: '500', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 4 },
  gradeValue:     { fontWeight: '700' },

  centerState:    { alignItems: 'center', paddingVertical: 64 },
  stateText:      { textAlign: 'center', lineHeight: 22 },

  infoBox:        { alignItems: 'center', padding: 32, borderWidth: 1, marginTop: 24 },
  infoTitle:      { fontWeight: '700', marginBottom: 12, textAlign: 'center' },
  infoBody:       { textAlign: 'center', lineHeight: 22 },

  errorBox:       { padding: 16, borderWidth: 1, marginTop: 24 },
  errorText:      { lineHeight: 22 },
  retryBtn:       { alignSelf: 'flex-start', paddingHorizontal: 20, paddingVertical: 10, minHeight: 44 },
  retryBtnText:   { fontWeight: '600' },
})
