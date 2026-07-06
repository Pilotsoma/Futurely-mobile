// ScheduleScreen — class schedule for HAC users.
//
// Endpoint: GET /integrations/grades/schedule (HAC only, 7d cache)
// Response: { schedule: { courses: [...] } }
//
// PowerSchool users see a clear UNSUPPORTED message — the backend returns
// HTTP 400 with code: 'UNSUPPORTED' for non-HAC sessions.

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
import { getSchedule } from '../../api/gradesApi'
import type { ScheduleResponse, SchedulePeriod } from '../../api/gradesApi'
import { ApiRequestError } from '../../api/client'

// ── Helpers ────────────────────────────────────────────────────────────────────

function extractMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiRequestError) return err.message
  if (err instanceof Error) return err.message
  return fallback
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function ScheduleScreen(): React.JSX.Element {
  const { theme } = useTheme()
  const { accessToken } = useAuth()

  const [data, setData]               = useState<ScheduleResponse | null>(null)
  const [loading, setLoading]         = useState(true)
  const [error, setError]             = useState<string | null>(null)
  const [unsupported, setUnsupported] = useState(false)

  const c  = theme.colors
  const sp = theme.spacing
  const r  = theme.radius
  const ty = theme.typography

  const load = useCallback(async (): Promise<void> => {
    if (!accessToken) return
    setLoading(true)
    setError(null)
    setUnsupported(false)
    try {
      const result = await getSchedule(accessToken)
      setData(result)
    } catch (err: unknown) {
      if (err instanceof ApiRequestError && err.code === 'UNSUPPORTED') {
        setUnsupported(true)
      } else {
        setError(extractMessage(err, 'Could not load schedule. Please try again.'))
      }
    } finally {
      setLoading(false)
    }
  }, [accessToken])

  useFocusEffect(
    useCallback(() => { void load() }, [load]),
  )

  function renderCourse(course: SchedulePeriod, i: number): React.JSX.Element {
    const periodLabel = course.period ?? `Period ${i + 1}`
    return (
      <View
        key={i}
        style={[styles.courseCard, { backgroundColor: c.surface, borderColor: c.border, borderRadius: r.lg, marginBottom: sp.lg }]}
      >
        <View
          style={[styles.periodTag, { backgroundColor: c.primaryDim, borderRadius: r.sm }]}
        >
          <Text style={[styles.periodText, { color: c.primary, fontSize: ty.fontSizeSm }]}>
            {periodLabel}
          </Text>
        </View>
        <View style={styles.courseDetails}>
          <Text style={[styles.courseName, { color: c.text, fontSize: ty.fontSizeBase }]} numberOfLines={2}>
            {course.courseName ?? 'Unknown Course'}
          </Text>
          {course.courseCode ? (
            <Text style={[styles.courseCode, { color: c.textMuted, fontSize: ty.fontSizeXs }]}>
              {course.courseCode}
            </Text>
          ) : null}
          <View style={styles.courseMeta}>
            {course.teacher ? (
              <Text style={[styles.metaText, { color: c.textSecondary, fontSize: ty.fontSizeSm }]}>
                {course.teacher}
              </Text>
            ) : null}
            {course.room ? (
              <Text style={[styles.metaText, { color: c.textMuted, fontSize: ty.fontSizeSm }]}>
                · Room {course.room}
              </Text>
            ) : null}
            {course.days ? (
              <Text style={[styles.metaText, { color: c.textMuted, fontSize: ty.fontSizeSm }]}>
                · {course.days}
              </Text>
            ) : null}
          </View>
        </View>
      </View>
    )
  }

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
              Loading schedule…
            </Text>
          </View>
        )}

        {!loading && unsupported && (
          <View style={[styles.infoBox, { backgroundColor: c.surface, borderColor: c.border, borderRadius: r.lg }]}>
            <Text style={[styles.infoIcon, { fontSize: 36, marginBottom: sp.lg }]}>🏫</Text>
            <Text style={[styles.infoTitle, { color: c.text, fontSize: ty.fontSizeXl }]}>
              Not Available for PowerSchool
            </Text>
            <Text style={[styles.infoBody, { color: c.textSecondary, fontSize: ty.fontSizeBase }]}>
              Class schedule is only available for Home Access Center (HAC) districts. Your school uses PowerSchool, which does not support this feature.
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
              accessibilityLabel="Retry loading schedule"
            >
              <Text style={[styles.retryBtnText, { color: '#FFFFFF', fontSize: ty.fontSizeBase }]}>
                Retry
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {!loading && error === null && !unsupported && data !== null && (
          <>
            {(!data.schedule?.courses || data.schedule.courses.length === 0) ? (
              <View style={styles.centerState}>
                <Text style={[{ fontSize: 40, marginBottom: sp.lg, textAlign: 'center' }]}>🕐</Text>
                <Text style={[styles.stateText, { color: c.textMuted, fontSize: ty.fontSizeBase }]}>
                  No schedule data available.
                </Text>
              </View>
            ) : (
              data.schedule.courses.map((course, i) => renderCourse(course, i))
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

  courseCard:    { borderWidth: 1, padding: 16, flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  periodTag:     { paddingHorizontal: 10, paddingVertical: 6, alignSelf: 'flex-start', minWidth: 64, alignItems: 'center' },
  periodText:    { fontWeight: '700' },
  courseDetails: { flex: 1, minWidth: 0 },
  courseName:    { fontWeight: '600', lineHeight: 22, marginBottom: 2 },
  courseCode:    { fontWeight: '400', marginBottom: 6 },
  courseMeta:    { flexDirection: 'row', flexWrap: 'wrap', gap: 2 },
  metaText:      { lineHeight: 18 },

  centerState:   { alignItems: 'center', paddingVertical: 64 },
  stateText:     { textAlign: 'center', lineHeight: 22 },

  infoBox:       { alignItems: 'center', padding: 32, borderWidth: 1, marginTop: 24 },
  infoIcon:      { textAlign: 'center' },
  infoTitle:     { fontWeight: '700', marginBottom: 12, textAlign: 'center' },
  infoBody:      { textAlign: 'center', lineHeight: 22 },

  errorBox:      { padding: 16, borderWidth: 1, marginTop: 24 },
  errorText:     { lineHeight: 22 },
  retryBtn:      { alignSelf: 'flex-start', paddingHorizontal: 20, paddingVertical: 10, minHeight: 44 },
  retryBtnText:  { fontWeight: '600' },
})
