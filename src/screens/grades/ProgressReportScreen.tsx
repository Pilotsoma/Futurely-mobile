// ProgressReportScreen — interim grades by date.
//
// Endpoint: GET /integrations/grades/progress-report (HAC only, 4h cache)
// Response shape is loosely typed — the backend passes through HAC's raw
// progress report structure, which can vary. We render whatever we get.
//
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
import { getProgressReport } from '../../api/gradesApi'
import type { ProgressReportResponse } from '../../api/gradesApi'
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

// ── Generic recursive data renderer ──────────────────────────────────────────
// The progress report backend response shape can vary, so we render it as
// key-value pairs rather than hardcoding field names.

function renderValue(
  value: unknown,
  colors: { text: string; textSecondary: string; textMuted: string; gradeA: string; gradeB: string; gradeC: string; gradeD: string; gradeF: string },
  depth: number = 0,
): React.ReactNode {
  if (value === null || value === undefined) return null

  if (typeof value === 'string' || typeof value === 'number') {
    const str = String(value)
    const gc = gradeColor(str, colors)
    // For numeric-looking values at depth 0 treat as grade
    const isGrade = typeof value === 'string' && /^\d+(\.\d+)?$/.test(str.trim())
    return (
      <Text style={{ color: isGrade ? gc : colors.textSecondary, fontWeight: isGrade ? '700' : '400', fontSize: 14, lineHeight: 20 }}>
        {str}
      </Text>
    )
  }

  if (Array.isArray(value)) {
    return (
      <View style={{ gap: 4 }}>
        {value.map((item, i) => (
          <View key={i}>{renderValue(item, colors, depth + 1)}</View>
        ))}
      </View>
    )
  }

  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>
    return (
      <View style={{ gap: 6, paddingLeft: depth > 0 ? 8 : 0 }}>
        {Object.entries(obj).map(([k, v]) => (
          <View key={k} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'flex-start' }}>
            <Text style={{ color: colors.textMuted, fontSize: 12, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.4, flexShrink: 0 }}>
              {k}:
            </Text>
            <View style={{ flex: 1 }}>{renderValue(v, colors, depth + 1)}</View>
          </View>
        ))}
      </View>
    )
  }

  return null
}

export default function ProgressReportScreen(): React.JSX.Element {
  const { theme } = useTheme()
  const { accessToken } = useAuth()

  const [data, setData]               = useState<ProgressReportResponse | null>(null)
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
      const result = await getProgressReport(accessToken)
      setData(result)
    } catch (err: unknown) {
      if (err instanceof ApiRequestError && err.code === 'UNSUPPORTED') {
        setUnsupported(true)
      } else {
        setError(extractMessage(err, 'Could not load progress report. Please try again.'))
      }
    } finally {
      setLoading(false)
    }
  }, [accessToken])

  useFocusEffect(
    useCallback(() => { void load() }, [load]),
  )

  // Check if we have any meaningful data
  const hasData = data !== null && Object.keys(data).length > 0

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
              Loading progress report…
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
              Progress reports are only available for Home Access Center (HAC) districts.
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
              accessibilityLabel="Retry loading progress report"
            >
              <Text style={[styles.retryBtnText, { color: '#FFFFFF', fontSize: ty.fontSizeBase }]}>Retry</Text>
            </TouchableOpacity>
          </View>
        )}

        {!loading && error === null && !unsupported && !hasData && data !== null && (
          <View style={styles.centerState}>
            <Text style={[{ fontSize: 40, marginBottom: sp.lg, textAlign: 'center' }]}>📈</Text>
            <Text style={[styles.stateText, { color: c.textMuted, fontSize: ty.fontSizeBase }]}>
              No progress report data available.
            </Text>
          </View>
        )}

        {!loading && error === null && !unsupported && hasData && data !== null && (
          <View
            style={[styles.dataCard, { backgroundColor: c.surface, borderColor: c.border, borderRadius: r.lg }]}
          >
            {renderValue(data, c)}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe:         { flex: 1 },
  flex:         { flex: 1 },
  content:      { flexGrow: 1, paddingTop: 16 },

  dataCard:     { borderWidth: 1, padding: 16 },

  centerState:  { alignItems: 'center', paddingVertical: 64 },
  stateText:    { textAlign: 'center', lineHeight: 22 },

  infoBox:      { alignItems: 'center', padding: 32, borderWidth: 1, marginTop: 24 },
  infoTitle:    { fontWeight: '700', marginBottom: 12, textAlign: 'center' },
  infoBody:     { textAlign: 'center', lineHeight: 22 },

  errorBox:     { padding: 16, borderWidth: 1, marginTop: 24 },
  errorText:    { lineHeight: 22 },
  retryBtn:     { alignSelf: 'flex-start', paddingHorizontal: 20, paddingVertical: 10, minHeight: 44 },
  retryBtnText: { fontWeight: '600' },
})
