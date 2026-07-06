// ClassworkScreen — current assignments and class averages.
//
// Endpoint: GET /integrations/grades/classwork (HAC only, 2h cache)
// Response: { classes, availablePeriods, currentPeriod }
//
// Each class shows its average + assignments list. HAC only — PowerSchool
// users see a clear UNSUPPORTED message.

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
import { getClasswork } from '../../api/gradesApi'
import type { ClassworkResponse, ClassworkClass } from '../../api/gradesApi'
import { ApiRequestError } from '../../api/client'

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
  if (isNaN(num)) return colors.textMuted
  if (num >= 90) return colors.gradeA
  if (num >= 80) return colors.gradeB
  if (num >= 70) return colors.gradeC
  if (num >= 60) return colors.gradeD
  return colors.gradeF
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function ClassworkScreen(): React.JSX.Element {
  const { theme } = useTheme()
  const { accessToken } = useAuth()

  const [data, setData]         = useState<ClassworkResponse | null>(null)
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState<string | null>(null)
  const [unsupported, setUnsupported] = useState(false)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

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
      const result = await getClasswork(accessToken)
      setData(result)
    } catch (err: unknown) {
      if (err instanceof ApiRequestError && err.code === 'UNSUPPORTED') {
        setUnsupported(true)
      } else {
        setError(extractMessage(err, 'Could not load classwork. Please try again.'))
      }
    } finally {
      setLoading(false)
    }
  }, [accessToken])

  useFocusEffect(
    useCallback(() => { void load() }, [load]),
  )

  function toggleClass(name: string): void {
    setExpanded(prev => ({ ...prev, [name]: !prev[name] }))
  }

  // ── Sub-renders ────────────────────────────────────────────────────────────

  function renderClass(cls: ClassworkClass, i: number): React.JSX.Element {
    const gradeColor = getGradeColor(cls.average, c)
    const isOpen     = expanded[cls.name] ?? false
    const avgNum     = parseFloat(cls.average ?? '')

    return (
      <View
        key={i}
        style={[styles.classCard, { backgroundColor: c.surface, borderColor: c.border, borderRadius: r.lg, marginBottom: sp.lg }]}
      >
        <TouchableOpacity
          style={styles.classHeader}
          onPress={() => toggleClass(cls.name)}
          accessibilityRole="button"
          accessibilityLabel={`${cls.name}, average ${cls.average ?? 'unknown'}. Tap to ${isOpen ? 'collapse' : 'expand'}`}
          accessibilityState={{ expanded: isOpen }}
        >
          <View style={styles.classHeaderLeft}>
            <Text style={[styles.className, { color: c.text, fontSize: ty.fontSizeBase }]} numberOfLines={2}>
              {cls.name}
            </Text>
            {cls.teacher ? (
              <Text style={[styles.classTeacher, { color: c.textMuted, fontSize: ty.fontSizeSm }]}>
                {cls.teacher}
              </Text>
            ) : null}
          </View>
          <View style={styles.classHeaderRight}>
            <View style={[styles.avgBadge, { backgroundColor: `${gradeColor}22`, borderColor: `${gradeColor}44` }]}>
              <Text style={[styles.avgText, { color: gradeColor, fontSize: ty.fontSizeXl }]}>
                {!isNaN(avgNum) ? Math.round(avgNum).toString() : (cls.average ?? '—')}
              </Text>
            </View>
            <Text style={[styles.chevron, { color: c.textMuted }]}>
              {isOpen ? '˄' : '˅'}
            </Text>
          </View>
        </TouchableOpacity>

        {isOpen && cls.assignments && cls.assignments.length > 0 && (
          <View style={[styles.assignmentList, { borderTopColor: c.border }]}>
            {cls.assignments.map((a, ai) => (
              <View
                key={ai}
                style={[styles.assignmentRow, { borderBottomColor: c.border }]}
              >
                <View style={styles.assignmentInfo}>
                  <Text style={[styles.assignmentName, { color: c.text, fontSize: ty.fontSizeMd }]} numberOfLines={2}>
                    {a.name ?? 'Untitled'}
                  </Text>
                  {a.category ? (
                    <Text style={[styles.assignmentCat, { color: c.textMuted, fontSize: ty.fontSizeXs }]}>
                      {a.category}{a.dateDue ? ` · Due ${a.dateDue}` : ''}
                    </Text>
                  ) : null}
                </View>
                <Text style={[styles.assignmentScore, { color: c.textSecondary, fontSize: ty.fontSizeMd }]}>
                  {a.score != null ? a.score : '—'}
                  {a.totalPoints ? `/${a.totalPoints}` : ''}
                </Text>
              </View>
            ))}
          </View>
        )}

        {isOpen && (!cls.assignments || cls.assignments.length === 0) && (
          <View style={[styles.emptyAssignments, { borderTopColor: c.border }]}>
            <Text style={[styles.emptyAssText, { color: c.textMuted, fontSize: ty.fontSizeSm }]}>
              No assignments found for this class.
            </Text>
          </View>
        )}
      </View>
    )
  }

  // ── Main render ────────────────────────────────────────────────────────────

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
              Loading classwork…
            </Text>
          </View>
        )}

        {!loading && unsupported && (
          <View style={[styles.unsupportedBox, { backgroundColor: c.surface, borderColor: c.border, borderRadius: r.lg }]}>
            <Text style={[styles.unsupportedIcon, { fontSize: 36, marginBottom: sp.lg }]}>🏫</Text>
            <Text style={[styles.unsupportedTitle, { color: c.text, fontSize: ty.fontSizeXl }]}>
              Not Available
            </Text>
            <Text style={[styles.unsupportedBody, { color: c.textSecondary, fontSize: ty.fontSizeBase }]}>
              Classwork details are only available for Home Access Center (HAC) districts. PowerSchool does not support this feature.
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
              accessibilityLabel="Retry loading classwork"
            >
              <Text style={[styles.retryBtnText, { color: '#FFFFFF', fontSize: ty.fontSizeBase }]}>
                Retry
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {!loading && error === null && !unsupported && data !== null && (
          <>
            {data.classes.length === 0 ? (
              <View style={styles.centerState}>
                <Text style={[styles.emptyIcon, { fontSize: 40, marginBottom: sp.lg }]}>📚</Text>
                <Text style={[styles.stateText, { color: c.textMuted, fontSize: ty.fontSizeBase }]}>
                  No classwork data found.
                </Text>
              </View>
            ) : (
              <>
                {data.currentPeriod ? (
                  <Text style={[styles.periodLabel, { color: c.textMuted, fontSize: ty.fontSizeSm, marginBottom: sp.xl3 }]}>
                    Reporting Period: {data.currentPeriod}
                  </Text>
                ) : null}
                {data.classes.map((cls, i) => renderClass(cls, i))}
              </>
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

  classCard:       { borderWidth: 1 },
  classHeader:     { flexDirection: 'row', alignItems: 'center', padding: 16, gap: 12, minHeight: 64 },
  classHeaderLeft: { flex: 1, minWidth: 0 },
  classHeaderRight:{ flexDirection: 'row', alignItems: 'center', gap: 10 },
  className:       { fontWeight: '600', lineHeight: 22 },
  classTeacher:    { marginTop: 3, lineHeight: 16 },
  avgBadge:        { borderWidth: 1, borderRadius: 8, minWidth: 52, minHeight: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  avgText:         { fontWeight: '800' },
  chevron:         { fontSize: 18, fontWeight: '400', minWidth: 20, textAlign: 'center' },

  assignmentList:   { borderTopWidth: 1 },
  assignmentRow:    { flexDirection: 'row', alignItems: 'flex-start', padding: 12, paddingHorizontal: 16, borderBottomWidth: StyleSheet.hairlineWidth, gap: 10 },
  assignmentInfo:   { flex: 1, minWidth: 0 },
  assignmentName:   { fontWeight: '500', lineHeight: 20 },
  assignmentCat:    { marginTop: 3, lineHeight: 15 },
  assignmentScore:  { fontWeight: '600', flexShrink: 0 },

  emptyAssignments: { borderTopWidth: 1, padding: 14, paddingHorizontal: 16 },
  emptyAssText:     { lineHeight: 18 },

  periodLabel:  { fontWeight: '500' },

  centerState: { alignItems: 'center', paddingVertical: 64 },
  stateText:   { textAlign: 'center', lineHeight: 22 },
  emptyIcon:   { textAlign: 'center' },

  unsupportedBox:  { alignItems: 'center', padding: 32, borderWidth: 1, marginTop: 24 },
  unsupportedIcon: { textAlign: 'center' },
  unsupportedTitle:{ fontWeight: '700', marginBottom: 12 },
  unsupportedBody: { textAlign: 'center', lineHeight: 22 },

  errorBox:      { padding: 16, borderWidth: 1, marginTop: 24 },
  errorText:     { lineHeight: 22 },
  retryBtn:      { alignSelf: 'flex-start', paddingHorizontal: 20, paddingVertical: 10, minHeight: 44 },
  retryBtnText:  { fontWeight: '600' },
})
