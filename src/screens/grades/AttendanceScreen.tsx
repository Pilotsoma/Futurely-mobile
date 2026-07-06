// AttendanceScreen — absences, tardies, and excused events calendar view.
//
// Endpoint: GET /integrations/grades/attendance?monthOffset=N (HAC only, 4h cache)
// Response: { events?: AttendanceEvent[], summary?: { absences, excused, tardies } }
//
// HAC only — PowerSchool gets UNSUPPORTED message.
// Supports month navigation via monthOffset query param.

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
import { getAttendance } from '../../api/gradesApi'
import type { AttendanceResponse, AttendanceEvent } from '../../api/gradesApi'
import { ApiRequestError } from '../../api/client'

function extractMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiRequestError) return err.message
  if (err instanceof Error) return err.message
  return fallback
}

function absenceTypeColor(
  absenceType: string | null | undefined,
  colors: { error: string; warning: string; success: string; textMuted: string },
): string {
  if (!absenceType) return colors.textMuted
  const t = absenceType.toLowerCase()
  if (t.includes('unexcused') || t.includes('absent')) return colors.error
  if (t.includes('excused')) return colors.warning
  if (t.includes('tardy') || t.includes('late')) return colors.warning
  return colors.textMuted
}

const MONTH_NAMES = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
]

export default function AttendanceScreen(): React.JSX.Element {
  const { theme } = useTheme()
  const { accessToken } = useAuth()

  const [data, setData]               = useState<AttendanceResponse | null>(null)
  const [loading, setLoading]         = useState(true)
  const [error, setError]             = useState<string | null>(null)
  const [unsupported, setUnsupported] = useState(false)
  const [monthOffset, setMonthOffset] = useState(0)

  const c  = theme.colors
  const sp = theme.spacing
  const r  = theme.radius
  const ty = theme.typography

  const load = useCallback(async (offset: number): Promise<void> => {
    if (!accessToken) return
    setLoading(true)
    setError(null)
    setUnsupported(false)
    try {
      const result = await getAttendance(accessToken, offset)
      setData(result)
    } catch (err: unknown) {
      if (err instanceof ApiRequestError && err.code === 'UNSUPPORTED') {
        setUnsupported(true)
      } else {
        setError(extractMessage(err, 'Could not load attendance. Please try again.'))
      }
    } finally {
      setLoading(false)
    }
  }, [accessToken])

  useFocusEffect(
    useCallback(() => { void load(monthOffset) }, [load, monthOffset]),
  )

  function changeMonth(delta: number): void {
    const next = monthOffset + delta
    setMonthOffset(next)
    void load(next)
  }

  // Derive displayed month name from offset
  const now     = new Date()
  const target  = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1)
  const monthLabel = `${MONTH_NAMES[target.getMonth()]} ${target.getFullYear()}`

  const summary = data?.summary
  const events  = data?.events ?? []

  function renderSummaryBar(): React.JSX.Element | null {
    if (!summary) return null
    const stats: Array<{ label: string; value: number | null; color: string }> = [
      { label: 'Absences', value: summary.absences, color: c.error },
      { label: 'Excused',  value: summary.excused,  color: c.warning },
      { label: 'Tardies',  value: summary.tardies,  color: c.orange },
    ]
    return (
      <View style={[styles.summaryRow, { marginBottom: sp.xl3 }]}>
        {stats.map(s => (
          <View
            key={s.label}
            style={[styles.summaryCard, { backgroundColor: c.surface, borderColor: c.border, borderRadius: r.lg }]}
          >
            <Text style={[styles.summaryValue, { color: s.color, fontSize: 28 }]}>
              {s.value ?? 0}
            </Text>
            <Text style={[styles.summaryLabel, { color: c.textMuted, fontSize: ty.fontSizeXs }]}>
              {s.label.toUpperCase()}
            </Text>
          </View>
        ))}
      </View>
    )
  }

  function renderEvent(event: AttendanceEvent, i: number): React.JSX.Element {
    const typeColor = absenceTypeColor(event.absenceType, c)
    return (
      <View
        key={i}
        style={[styles.eventRow, { backgroundColor: c.surface, borderColor: c.border, borderRadius: r.md, marginBottom: sp.md }]}
      >
        <View style={[styles.typeBadge, { backgroundColor: `${typeColor}22`, borderRadius: r.sm }]}>
          <Text style={[styles.typeText, { color: typeColor, fontSize: ty.fontSizeXs }]}>
            {event.absenceType ?? 'Absence'}
          </Text>
        </View>
        <View style={styles.eventInfo}>
          <Text style={[styles.eventDate, { color: c.text, fontSize: ty.fontSizeMd }]}>
            {event.date ?? '—'}
            {event.period ? ` · Period ${event.period}` : ''}
          </Text>
          {event.courseName ? (
            <Text style={[styles.eventCourse, { color: c.textSecondary, fontSize: ty.fontSizeSm }]}>
              {event.courseName}
            </Text>
          ) : null}
          {event.reason ? (
            <Text style={[styles.eventReason, { color: c.textMuted, fontSize: ty.fontSizeXs }]}>
              {event.reason}
            </Text>
          ) : null}
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
              Loading attendance…
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
              Attendance records are only available for Home Access Center (HAC) districts.
            </Text>
          </View>
        )}

        {!loading && error !== null && (
          <View style={[styles.errorBox, { backgroundColor: `${c.error}14`, borderColor: `${c.error}33`, borderRadius: r.md }]}>
            <Text style={[styles.errorText, { color: c.error, fontSize: ty.fontSizeBase }]}>{error}</Text>
            <TouchableOpacity
              style={[styles.retryBtn, { backgroundColor: c.primary, borderRadius: r.sm, marginTop: sp.xl }]}
              onPress={() => { void load(monthOffset) }}
              accessibilityRole="button"
              accessibilityLabel="Retry loading attendance"
            >
              <Text style={[styles.retryBtnText, { color: '#FFFFFF', fontSize: ty.fontSizeBase }]}>Retry</Text>
            </TouchableOpacity>
          </View>
        )}

        {!loading && error === null && !unsupported && data !== null && (
          <>
            {renderSummaryBar()}

            {/* Month navigator */}
            <View style={[styles.monthNav, { marginBottom: sp.xl3 }]}>
              <TouchableOpacity
                style={[styles.monthBtn, { backgroundColor: c.surface, borderColor: c.border, borderRadius: r.sm, minWidth: 44, minHeight: 44 }]}
                onPress={() => changeMonth(-1)}
                accessibilityRole="button"
                accessibilityLabel="Previous month"
              >
                <Text style={[styles.monthBtnText, { color: c.textSecondary, fontSize: ty.fontSizeLg }]}>‹</Text>
              </TouchableOpacity>
              <Text style={[styles.monthLabel, { color: c.text, fontSize: ty.fontSizeBase }]}>
                {monthLabel}
              </Text>
              <TouchableOpacity
                style={[
                  styles.monthBtn,
                  {
                    backgroundColor: c.surface,
                    borderColor: c.border,
                    borderRadius: r.sm,
                    minWidth: 44,
                    minHeight: 44,
                    opacity: monthOffset >= 0 ? 0.4 : 1,
                  },
                ]}
                onPress={() => { if (monthOffset < 0) changeMonth(1) }}
                disabled={monthOffset >= 0}
                accessibilityRole="button"
                accessibilityLabel="Next month"
              >
                <Text style={[styles.monthBtnText, { color: c.textSecondary, fontSize: ty.fontSizeLg }]}>›</Text>
              </TouchableOpacity>
            </View>

            {events.length === 0 ? (
              <View style={styles.centerState}>
                <Text style={[{ fontSize: 40, marginBottom: sp.lg, textAlign: 'center' }]}>✅</Text>
                <Text style={[styles.stateText, { color: c.textMuted, fontSize: ty.fontSizeBase }]}>
                  No attendance events for this month.
                </Text>
              </View>
            ) : (
              events.map((ev, i) => renderEvent(ev, i))
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

  summaryRow:    { flexDirection: 'row', gap: 10 },
  summaryCard:   { flex: 1, borderWidth: 1, padding: 14, alignItems: 'center' },
  summaryValue:  { fontWeight: '800', letterSpacing: -0.5, lineHeight: 32 },
  summaryLabel:  { fontWeight: '600', letterSpacing: 0.5, marginTop: 4 },

  monthNav:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  monthBtn:      { borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  monthBtnText:  { fontWeight: '600' },
  monthLabel:    { fontWeight: '700', textAlign: 'center', flex: 1 },

  eventRow:      { flexDirection: 'row', alignItems: 'flex-start', borderWidth: 1, padding: 12, gap: 10 },
  typeBadge:     { paddingHorizontal: 8, paddingVertical: 5, flexShrink: 0, alignSelf: 'flex-start' },
  typeText:      { fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4 },
  eventInfo:     { flex: 1, minWidth: 0 },
  eventDate:     { fontWeight: '600', lineHeight: 20 },
  eventCourse:   { marginTop: 2, lineHeight: 18 },
  eventReason:   { marginTop: 2, lineHeight: 15 },

  centerState:   { alignItems: 'center', paddingVertical: 48 },
  stateText:     { textAlign: 'center', lineHeight: 22 },

  infoBox:       { alignItems: 'center', padding: 32, borderWidth: 1, marginTop: 24 },
  infoTitle:     { fontWeight: '700', marginBottom: 12, textAlign: 'center' },
  infoBody:      { textAlign: 'center', lineHeight: 22 },

  errorBox:      { padding: 16, borderWidth: 1, marginTop: 24 },
  errorText:     { lineHeight: 22 },
  retryBtn:      { alignSelf: 'flex-start', paddingHorizontal: 20, paddingVertical: 10, minHeight: 44 },
  retryBtnText:  { fontWeight: '600' },
})
