// TranscriptScreen — full academic transcript with GPA, class rank, and semester history.
//
// Endpoint: GET /integrations/grades/transcript (HAC + PowerSchool, 24h cache)
// Response: { systemType, transcript: { weightedGPA, unweightedGPA, classRank, totalCredits, semesters } }
//
// Available for both HAC and PowerSchool.

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
import { getTranscript } from '../../api/gradesApi'
import type { TranscriptResponse, TranscriptSemesterCourse } from '../../api/gradesApi'
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

export default function TranscriptScreen(): React.JSX.Element {
  const { theme } = useTheme()
  const { accessToken } = useAuth()

  const [data, setData]         = useState<TranscriptResponse | null>(null)
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState<string | null>(null)

  const c  = theme.colors
  const sp = theme.spacing
  const r  = theme.radius
  const ty = theme.typography

  const load = useCallback(async (): Promise<void> => {
    if (!accessToken) return
    setLoading(true)
    setError(null)
    try {
      const result = await getTranscript(accessToken)
      setData(result)
    } catch (err: unknown) {
      setError(extractMessage(err, 'Could not load transcript. Please try again.'))
    } finally {
      setLoading(false)
    }
  }, [accessToken])

  useFocusEffect(
    useCallback(() => { void load() }, [load]),
  )

  function renderStatPill(label: string, value: string, valueColor: string): React.JSX.Element {
    return (
      <View style={[styles.statPill, { backgroundColor: c.surface, borderColor: c.border, borderRadius: r.lg }]}>
        <Text style={[styles.statLabel, { color: c.textMuted, fontSize: ty.fontSizeXs }]}>
          {label}
        </Text>
        <Text style={[styles.statValue, { color: valueColor, fontSize: 28 }]}>
          {value}
        </Text>
      </View>
    )
  }

  function renderCourse(course: TranscriptSemesterCourse, i: number): React.JSX.Element {
    const gc = gradeColor(course.grade, c)
    return (
      <View
        key={i}
        style={[styles.courseRow, { borderBottomColor: c.border }]}
      >
        <View style={styles.courseNameBlock}>
          <Text style={[styles.courseName, { color: c.text, fontSize: ty.fontSizeMd }]} numberOfLines={2}>
            {course.name ?? 'Unknown'}
          </Text>
          {course.credits ? (
            <Text style={[styles.courseCredits, { color: c.textMuted, fontSize: ty.fontSizeXs }]}>
              {course.credits} credits
            </Text>
          ) : null}
        </View>
        <Text style={[styles.courseGrade, { color: gc, fontSize: ty.fontSizeBase }]}>
          {course.grade ?? '—'}
        </Text>
      </View>
    )
  }

  const t = data?.transcript

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
              Loading transcript…
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
              accessibilityLabel="Retry loading transcript"
            >
              <Text style={[styles.retryBtnText, { color: '#FFFFFF', fontSize: ty.fontSizeBase }]}>Retry</Text>
            </TouchableOpacity>
          </View>
        )}

        {!loading && error === null && t !== null && t !== undefined && (
          <>
            {/* GPA & stats pills */}
            <View style={[styles.statsRow, { marginBottom: sp.xl3 }]}>
              {t.weightedGPA   ? renderStatPill('WEIGHTED GPA',   t.weightedGPA,   c.primary) : null}
              {t.unweightedGPA ? renderStatPill('UNWEIGHTED GPA', t.unweightedGPA, c.success) : null}
              {t.classRank     ? renderStatPill('CLASS RANK',     t.classRank,     c.info)    : null}
              {t.totalCredits  ? renderStatPill('CREDITS',        t.totalCredits,  c.warning) : null}
            </View>

            {/* Semesters */}
            {t.semesters && t.semesters.length > 0 ? (
              t.semesters.map((sem, si) => (
                <View
                  key={si}
                  style={[styles.semesterCard, { backgroundColor: c.surface, borderColor: c.border, borderRadius: r.lg, marginBottom: sp.xl }]}
                >
                  <View style={[styles.semesterHeader, { borderBottomColor: c.border }]}>
                    <Text style={[styles.semesterTitle, { color: c.text, fontSize: ty.fontSizeBase }]}>
                      {sem.period ?? `Semester ${si + 1}`}
                    </Text>
                    <Text style={[styles.semesterCount, { color: c.textMuted, fontSize: ty.fontSizeSm }]}>
                      {sem.courses?.length ?? 0} courses
                    </Text>
                  </View>
                  {sem.courses?.map((course, ci) => renderCourse(course, ci))}
                </View>
              ))
            ) : (
              <View style={styles.centerState}>
                <Text style={[{ fontSize: 40, marginBottom: sp.lg, textAlign: 'center' }]}>📄</Text>
                <Text style={[styles.stateText, { color: c.textMuted, fontSize: ty.fontSizeBase }]}>
                  No semester history found.
                </Text>
              </View>
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

  statsRow:       { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  statPill:       { borderWidth: 1, padding: 14, alignItems: 'flex-start', minWidth: 100, flex: 1 },
  statLabel:      { fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 },
  statValue:      { fontWeight: '800', letterSpacing: -0.5, lineHeight: 32 },

  semesterCard:   { borderWidth: 1, overflow: 'hidden' },
  semesterHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  semesterTitle:  { fontWeight: '700' },
  semesterCount:  { fontWeight: '400' },

  courseRow:      { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 14, borderBottomWidth: StyleSheet.hairlineWidth, gap: 10 },
  courseNameBlock:{ flex: 1, minWidth: 0 },
  courseName:     { fontWeight: '500', lineHeight: 20 },
  courseCredits:  { marginTop: 2, lineHeight: 15 },
  courseGrade:    { fontWeight: '700', flexShrink: 0 },

  centerState:    { alignItems: 'center', paddingVertical: 64 },
  stateText:      { textAlign: 'center', lineHeight: 22 },

  errorBox:       { padding: 16, borderWidth: 1, marginTop: 24 },
  errorText:      { lineHeight: 22 },
  retryBtn:       { alignSelf: 'flex-start', paddingHorizontal: 20, paddingVertical: 10, minHeight: 44 },
  retryBtnText:   { fontWeight: '600' },
})
