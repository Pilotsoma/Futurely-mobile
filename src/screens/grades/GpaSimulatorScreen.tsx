// GpaSimulatorScreen — "What-If Calculator" mobile port.
//
// Mirrors the exact client-side preview math from the web app's
// app/(app)/grades/what-if/page.tsx (read directly, not modified — this is a
// display-only preview, it never calls a backend endpoint that persists or
// mutates real grades). Baseline GPA comes from GET /integrations/grades/gpa
// (the backend's real, protected calculation) — this screen only *previews*
// hypothetical additional courses layered on top of that real baseline; it
// never recomputes or overrides the backend's own GPA figure.
//
// Katy ISD weighted scale (from the web page, official and unchanged here):
//   Regular:     A=4.0 B=3.0 C=2.0 D=1.0 F=0.0
//   KAP/AP:      A=5.0 B=4.0 C=3.0 D=2.0 F=0.0 (weighted only)
//   Dual Credit: A=4.5 B=3.5 C=2.5 D=1.5 F=0.0 (weighted only)
//   Unweighted:  all courses use the Regular scale

import React, { useCallback, useState } from 'react'
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useFocusEffect } from '@react-navigation/native'
import { useTheme } from '../../theme/ThemeContext'
import { useAuth } from '../../context/AuthContext'
import { getGpa, getClasswork } from '../../api/gradesApi'
import { ApiRequestError } from '../../api/client'

type CourseLevel = 'Regular' | 'KAP' | 'AP' | 'Dual Credit'
type GpaType = 'weighted' | 'unweighted'

const LEVELS: CourseLevel[] = ['Regular', 'KAP', 'AP', 'Dual Credit']

const GRADE_POINTS: Record<CourseLevel, Record<string, number>> = {
  'Regular':     { A: 4.0, B: 3.0, C: 2.0, D: 1.0, F: 0.0 },
  'KAP':         { A: 5.0, B: 4.0, C: 3.0, D: 2.0, F: 0.0 },
  'AP':          { A: 5.0, B: 4.0, C: 3.0, D: 2.0, F: 0.0 },
  'Dual Credit': { A: 4.5, B: 3.5, C: 2.5, D: 1.5, F: 0.0 },
}

function avgToLetter(avg: number): string {
  if (avg >= 90) return 'A'
  if (avg >= 80) return 'B'
  if (avg >= 70) return 'C'
  if (avg >= 60) return 'D'
  return 'F'
}

function gradePoints(avg: number, level: CourseLevel, gpaType: GpaType): number {
  const letter = avgToLetter(avg)
  if (gpaType === 'unweighted') return GRADE_POINTS['Regular'][letter] ?? 0
  return GRADE_POINTS[level][letter] ?? 0
}

interface SimCourse {
  id: string
  level: CourseLevel
  average: number
}

function generateBlankCourses(count: number): SimCourse[] {
  return Array.from({ length: count }, (_, i) => ({ id: `sim-${i}`, level: 'Regular', average: 0 }))
}

function extractMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiRequestError) return err.message
  if (err instanceof Error) return err.message
  return fallback
}

export default function GpaSimulatorScreen(): React.JSX.Element {
  const { theme } = useTheme()
  const { accessToken } = useAuth()

  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState<string | null>(null)
  const [gpaType, setGpaType]     = useState<GpaType>('weighted')
  const [semesters, setSemesters] = useState(1)
  const [simCourses, setSimCourses] = useState<SimCourse[]>(generateBlankCourses(7))
  const [currentClasses, setCurrentClasses] = useState<{ name: string; average: number }[]>([])

  const [exactWeightedGpa, setExactWeightedGpa]     = useState<number | null>(null)
  const [exactUnweightedGpa, setExactUnweightedGpa] = useState<number | null>(null)
  const [courseCount, setCourseCount]               = useState(0)

  const c  = theme.colors
  const sp = theme.spacing
  const r  = theme.radius
  const ty = theme.typography

  const load = useCallback(async (): Promise<void> => {
    if (!accessToken) return
    setLoading(true)
    setError(null)
    try {
      const gpaRes = await getGpa(accessToken)
      if (gpaRes.unweightedGpa === null && gpaRes.weightedGpa === null) {
        setError('No GPA data found. Connect your school portal in Settings.')
        setLoading(false)
        return
      }
      setExactWeightedGpa(gpaRes.weightedGpa)
      setExactUnweightedGpa(gpaRes.unweightedGpa)
      setCourseCount(gpaRes.courseCount)

      try {
        const classwork = await getClasswork(accessToken)
        setCurrentClasses(
          classwork.classes.map(cl => ({
            name: cl.name,
            average: parseFloat(cl.average ?? '0') || 0,
          })),
        )
      } catch {
        // Reference list is non-critical — leave it empty on failure.
        setCurrentClasses([])
      }
    } catch (err: unknown) {
      setError(extractMessage(err, 'Could not load GPA data. Please try again.'))
    } finally {
      setLoading(false)
    }
  }, [accessToken])

  useFocusEffect(
    useCallback(() => { void load() }, [load]),
  )

  function handleSemesterChange(n: number): void {
    const count = n * 7
    setSemesters(n)
    setSimCourses(prev => {
      if (prev.length === count) return prev
      return Array.from({ length: count }, (_, i) => prev[i] ?? { id: `sim-${i}`, level: 'Regular' as CourseLevel, average: 0 })
    })
  }

  function updateSimAverage(id: string, text: string): void {
    const value = parseFloat(text)
    setSimCourses(prev => prev.map(sc => sc.id === id ? { ...sc, average: isNaN(value) ? 0 : Math.max(0, Math.min(100, value)) } : sc))
  }

  function updateSimLevel(id: string, level: CourseLevel): void {
    setSimCourses(prev => prev.map(sc => sc.id === id ? { ...sc, level } : sc))
  }

  function clearAll(): void {
    setSimCourses(prev => prev.map(sc => ({ ...sc, average: 0 })))
  }

  function calcSimulatedGpa(type: GpaType): number {
    const base = type === 'weighted' ? exactWeightedGpa : exactUnweightedGpa
    if (base === null || courseCount === 0) return 0
    let simPts = 0
    let simCount = 0
    for (const sc of simCourses) {
      if (sc.average > 0) {
        simPts += gradePoints(sc.average, sc.level, type)
        simCount++
      }
    }
    if (simCount === 0) return base
    const totalPts = base * courseCount + simPts
    return Math.round((totalPts / (courseCount + simCount)) * 1000) / 1000
  }

  const baselineGpa   = (gpaType === 'weighted' ? exactWeightedGpa : exactUnweightedGpa) ?? 0
  const simGpa        = calcSimulatedGpa(gpaType)
  const delta         = simGpa - baselineGpa
  const hasSimCourses = simCourses.some(sc => sc.average > 0)

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.bg }]} edges={['left', 'right', 'bottom']}>
      <ScrollView
        style={styles.flex}
        contentContainerStyle={[styles.content, { paddingHorizontal: sp.screenPaddingH, paddingBottom: sp.xl8 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {loading && (
          <View style={styles.centerState}>
            <ActivityIndicator color={c.primary} size="large" />
            <Text style={[styles.stateText, { color: c.textMuted, fontSize: ty.fontSizeBase, marginTop: sp.xl }]}>
              Opening GPA calculator…
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
              accessibilityLabel="Retry loading GPA data"
            >
              <Text style={[styles.retryBtnText, { color: '#FFFFFF', fontSize: ty.fontSizeBase }]}>Retry</Text>
            </TouchableOpacity>
          </View>
        )}

        {!loading && error === null && (
          <>
            {/* GPA type toggle */}
            <View style={[styles.toggleRow, { marginBottom: sp.xl2 }]}>
              {(['weighted', 'unweighted'] as GpaType[]).map(t => (
                <TouchableOpacity
                  key={t}
                  onPress={() => setGpaType(t)}
                  style={[
                    styles.toggleBtn,
                    {
                      backgroundColor: gpaType === t ? c.primary : c.surface,
                      borderColor: gpaType === t ? c.primary : c.border,
                      borderRadius: r.sm,
                    },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={t === 'weighted' ? 'Weighted GPA' : 'Unweighted GPA'}
                >
                  <Text style={{ color: gpaType === t ? '#FFFFFF' : c.textSecondary, fontWeight: '600', fontSize: ty.fontSizeSmMd }}>
                    {t === 'weighted' ? 'Weighted' : 'Unweighted'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* GPA cards */}
            <View style={[styles.gpaRow, { marginBottom: sp.xl2 }]}>
              <View style={[styles.gpaCard, { backgroundColor: c.surface, borderColor: c.border, borderRadius: r.lg }]}>
                <Text style={[styles.gpaLabel, { color: c.textMuted }]}>CURRENT {gpaType.toUpperCase()} GPA</Text>
                <Text style={[styles.gpaNum, { color: c.text }]}>{baselineGpa.toFixed(3)}</Text>
                <Text style={[styles.gpaNote, { color: c.textMuted }]}>{courseCount} courses from transcript</Text>
              </View>
              <View
                style={[
                  styles.gpaCard,
                  {
                    backgroundColor: hasSimCourses ? c.primaryDim : c.surface,
                    borderColor: hasSimCourses ? c.primaryGlow : c.border,
                    borderRadius: r.lg,
                  },
                ]}
              >
                <Text style={[styles.gpaLabel, { color: c.textMuted }]}>SIMULATED {gpaType.toUpperCase()} GPA</Text>
                <Text style={[styles.gpaNum, { color: hasSimCourses ? c.primary : c.textMuted }]}>{simGpa.toFixed(3)}</Text>
                {hasSimCourses && (
                  <Text style={[styles.gpaDelta, { color: delta >= 0 ? c.success : c.error }]}>
                    {delta >= 0 ? '+' : ''}{delta.toFixed(3)}
                  </Text>
                )}
              </View>
            </View>

            <Text style={[styles.sub, { color: c.textSecondary, marginBottom: sp.xl2 }]}>
              {gpaType === 'weighted'
                ? 'Official Katy ISD weighted scale: AP/KAP=5.0, Dual=4.5, Regular=4.0'
                : 'Unweighted scale: all courses use Regular scale (A=4.0, B=3.0, C=2.0, F=0.0)'}
            </Text>

            {/* Semester selector */}
            <Text style={[styles.sectionLabel, { color: c.textMuted, marginBottom: sp.md }]}>SIMULATE ADDITIONAL COURSES</Text>
            <View style={[styles.semRow, { marginBottom: sp.xl2 }]}>
              {[{ n: 1, label: '1 Semester (7)' }, { n: 2, label: '1 Year (14)' }, { n: 4, label: '2 Years (28)' }].map(opt => (
                <TouchableOpacity
                  key={opt.n}
                  onPress={() => handleSemesterChange(opt.n)}
                  style={[
                    styles.semBtn,
                    {
                      backgroundColor: semesters === opt.n ? c.primary : c.surface,
                      borderColor: semesters === opt.n ? c.primary : c.border,
                      borderRadius: r.sm,
                    },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={opt.label}
                >
                  <Text style={{ color: semesters === opt.n ? '#FFFFFF' : c.textSecondary, fontWeight: '600', fontSize: ty.fontSizeXs }}>
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {hasSimCourses && (
              <TouchableOpacity onPress={clearAll} style={[styles.clearBtn, { marginBottom: sp.md }]} accessibilityRole="button" accessibilityLabel="Clear all simulated courses">
                <Text style={{ color: c.textMuted, fontSize: ty.fontSizeSm }}>Clear all</Text>
              </TouchableOpacity>
            )}

            {/* Simulated course rows */}
            <View style={{ gap: sp.md }}>
              {simCourses.map((sc, i) => {
                const isFilled = sc.average > 0
                const letter = isFilled ? avgToLetter(sc.average) : '—'
                const pts = isFilled ? gradePoints(sc.average, sc.level, gpaType) : 0
                return (
                  <View
                    key={sc.id}
                    style={[
                      styles.simRow,
                      { backgroundColor: c.surface, borderColor: isFilled ? c.primaryGlow : c.border, borderRadius: r.md },
                    ]}
                  >
                    <Text style={[styles.simName, { color: c.text }]}>New Course {i + 1}</Text>
                    {gpaType === 'weighted' && (
                      <View style={styles.levelChips}>
                        {LEVELS.map(lvl => (
                          <TouchableOpacity
                            key={lvl}
                            onPress={() => updateSimLevel(sc.id, lvl)}
                            style={[
                              styles.levelChip,
                              {
                                backgroundColor: sc.level === lvl ? c.primaryDim : 'transparent',
                                borderColor: sc.level === lvl ? c.primary : c.border,
                                borderRadius: r.sm,
                              },
                            ]}
                            accessibilityRole="button"
                            accessibilityLabel={`Set course level to ${lvl}`}
                          >
                            <Text style={{ fontSize: 10, fontWeight: '600', color: sc.level === lvl ? c.primary : c.textMuted }}>
                              {lvl === 'Dual Credit' ? 'Dual' : lvl}
                            </Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    )}
                    <TextInput
                      value={sc.average > 0 ? String(sc.average) : ''}
                      onChangeText={(t) => updateSimAverage(sc.id, t)}
                      placeholder="Avg %"
                      placeholderTextColor={c.textMuted}
                      keyboardType="number-pad"
                      style={[styles.simInput, { color: c.text, borderColor: isFilled ? c.primary : c.border, borderRadius: r.sm }]}
                      accessibilityLabel={`Grade average for New Course ${i + 1}`}
                    />
                    <View style={{ width: 44, alignItems: 'center', opacity: isFilled ? 1 : 0.35 }}>
                      <Text style={{ fontSize: 16, fontWeight: '800', color: isFilled ? c.primary : c.textMuted }}>{letter}</Text>
                      <Text style={{ fontSize: 9, color: c.textMuted }}>{isFilled ? pts.toFixed(1) : 'pts'}</Text>
                    </View>
                  </View>
                )
              })}
            </View>

            {/* Current classes reference */}
            {currentClasses.length > 0 && (
              <View style={{ marginTop: sp.xl3 }}>
                <Text style={[styles.sectionLabel, { color: c.textMuted, marginBottom: sp.md }]}>YOUR CURRENT CLASSES</Text>
                {currentClasses.map((cl, i) => (
                  <View key={i} style={[styles.refRow, { borderBottomColor: c.border }]}>
                    <Text style={[styles.refName, { color: c.textSecondary }]} numberOfLines={1}>{cl.name}</Text>
                    <Text style={[styles.refValue, { color: c.textSecondary }]}>
                      {cl.average > 0 ? `${cl.average.toFixed(1)}% → ${gradePoints(cl.average, 'Regular', gpaType).toFixed(1)} pts` : 'N/A'}
                    </Text>
                  </View>
                ))}
              </View>
            )}

            <Text style={[styles.footNote, { color: c.textMuted, marginTop: sp.xl2 }]}>
              {gpaType === 'weighted'
                ? 'Set the course type and enter a grade (0–100) to simulate new courses.'
                : 'Enter a grade (0–100) to simulate new courses. Unweighted uses Regular scale for all types.'}
            </Text>
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

  toggleRow: { flexDirection: 'row', gap: 8 },
  toggleBtn: { flex: 1, height: 40, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },

  gpaRow:   { flexDirection: 'row', gap: 12 },
  gpaCard:  { flex: 1, borderWidth: 1, padding: 16 },
  gpaLabel: { fontSize: 10, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 },
  gpaNum:   { fontSize: 30, fontWeight: '800', letterSpacing: -0.5, lineHeight: 34 },
  gpaNote:  { fontSize: 11, marginTop: 6 },
  gpaDelta: { fontSize: 13, fontWeight: '700', marginTop: 4 },

  sub: { fontSize: 12.5, lineHeight: 18 },
  sectionLabel: { fontSize: 11, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.6 },

  semRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  semBtn: { paddingHorizontal: 14, height: 36, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },

  clearBtn: { alignSelf: 'flex-end', minHeight: 32, justifyContent: 'center' },

  simRow: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, padding: 12, gap: 8, minHeight: 52 },
  simName: { flex: 1, fontSize: 12.5, fontWeight: '600', minWidth: 0 },
  levelChips: { flexDirection: 'row', gap: 4 },
  levelChip: { paddingHorizontal: 6, paddingVertical: 4, borderWidth: 1 },
  simInput: { width: 64, height: 36, borderWidth: 1, textAlign: 'right', paddingHorizontal: 8, fontSize: 13 },

  refRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, gap: 8 },
  refName: { fontSize: 12.5, flex: 1, minWidth: 0 },
  refValue: { fontSize: 12.5 },

  footNote: { fontSize: 11, textAlign: 'center', lineHeight: 16 },

  centerState: { alignItems: 'center', paddingVertical: 64 },
  stateText:   { textAlign: 'center', lineHeight: 22 },

  errorBox:    { padding: 16, borderWidth: 1, marginTop: 24 },
  errorText:   { lineHeight: 22 },
  retryBtn:    { alignSelf: 'flex-start', paddingHorizontal: 20, paddingVertical: 10, minHeight: 44 },
  retryBtnText:{ fontWeight: '600' },
})
