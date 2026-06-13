import React, { useMemo } from 'react'
import {
  FlatList,
  StyleSheet,
  View,
} from 'react-native'
import { useRoute } from '@react-navigation/native'
import type { RouteProp } from '@react-navigation/native'
import { Ionicons } from '@expo/vector-icons'
import Text from '../components/ui/Text'
import ScreenHeader from '../components/ui/ScreenHeader'
import { colors } from '../constants/colors'
import type { GradePortalParamList } from '../navigation/GradePortalNavigator'
import type { AssignmentDetail, CourseWithGrade } from '../api/gradesApi'

// Module-level cache populated by GradeViewerScreen before navigation
export const coursesCache: React.MutableRefObject<CourseWithGrade[]> = { current: [] }

type RouteType = RouteProp<GradePortalParamList, 'CourseDetail'>

// ── Score formatting helpers ───────────────────────────────────────────────────

/**
 * Format an assignment score. Prefer numeric over letter.
 * Examples:
 *   score=92, totalPoints=100  → "92 / 100  (92.0%)"
 *   score=null, percentage="A" → "A"
 *   score=null, percentage=""  → "—"
 */
function formatScore(a: AssignmentDetail): string {
  if (a.score !== null && a.totalPoints !== null && a.totalPoints > 0) {
    const pct = (a.score / a.totalPoints) * 100
    return `${a.score} / ${a.totalPoints}  (${pct.toFixed(1)}%)`
  }
  if (a.score !== null) {
    return `${a.score} pts`
  }
  if (a.percentage && a.percentage !== '' && a.percentage !== '--') {
    return a.percentage
  }
  return '—'
}

/**
 * Determine color for a score.
 */
function scoreColor(a: AssignmentDetail): string {
  let pct: number | null = null

  if (a.score !== null && a.totalPoints !== null && a.totalPoints > 0) {
    pct = (a.score / a.totalPoints) * 100
  } else if (a.percentage && a.percentage !== '--') {
    const parsed = parseFloat(a.percentage)
    if (!isNaN(parsed)) pct = parsed
  }

  if (pct === null) return colors.textMuted
  if (pct >= 90) return colors.success
  if (pct >= 80) return colors.info
  if (pct >= 70) return colors.warning
  if (pct >= 60) return colors.orange
  return colors.error
}

/**
 * Format a due date string to something readable.
 */
function formatDueDate(raw: string): string {
  if (!raw || raw === '--' || raw === '') return ''
  try {
    const d = new Date(raw)
    if (isNaN(d.getTime())) return raw
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  } catch {
    return raw
  }
}

// ── Assignment Row ──────────────────────────────────────────────────────────────

function AssignmentRow({ item }: { item: AssignmentDetail }): React.JSX.Element {
  const scoreStr = formatScore(item)
  const color = scoreColor(item)
  const due = formatDueDate(item.dateDue)

  return (
    <View style={styles.assignmentRow}>
      <View style={styles.assignmentLeft}>
        <Text variant="body" style={styles.assignmentName} numberOfLines={2}>
          {item.name || 'Unnamed Assignment'}
        </Text>
        <View style={styles.assignmentMeta}>
          {item.category ? (
            <View style={styles.categoryChip}>
              <Text style={styles.categoryText}>{item.category}</Text>
            </View>
          ) : null}
          {due ? (
            <Text variant="caption" color={colors.textMuted}>
              Due {due}
            </Text>
          ) : null}
        </View>
      </View>
      <View style={styles.assignmentRight}>
        <Text style={[styles.scoreText, { color }]}>
          {scoreStr}
        </Text>
      </View>
    </View>
  )
}

function Separator(): React.JSX.Element {
  return <View style={styles.separator} />
}

// ── Category Summary ────────────────────────────────────────────────────────────

interface CategorySummary {
  name: string
  count: number
  average: number | null
}

function buildCategorySummaries(assignments: AssignmentDetail[]): CategorySummary[] {
  const map = new Map<string, { scores: number[]; totals: number[] }>()

  for (const a of assignments) {
    const cat = a.category || 'Uncategorized'
    if (!map.has(cat)) map.set(cat, { scores: [], totals: [] })
    const entry = map.get(cat)!
    if (a.score !== null && a.totalPoints !== null && a.totalPoints > 0) {
      entry.scores.push(a.score)
      entry.totals.push(a.totalPoints)
    }
  }

  const summaries: CategorySummary[] = []
  for (const [name, data] of map.entries()) {
    const count = assignments.filter(a => (a.category || 'Uncategorized') === name).length
    const totalScore = data.scores.reduce((s, v) => s + v, 0)
    const totalPossible = data.totals.reduce((s, v) => s + v, 0)
    const average = totalPossible > 0 ? Math.round((totalScore / totalPossible) * 1000) / 10 : null
    summaries.push({ name, count, average })
  }

  return summaries.sort((a, b) => a.name.localeCompare(b.name))
}

// ── Screen ─────────────────────────────────────────────────────────────────────

export default function CourseDetailScreen(): React.JSX.Element {
  const route = useRoute<RouteType>()
  const { courseId, courseName } = route.params

  const course = useMemo(
    () => coursesCache.current.find(c => c.id.toString() === courseId) ?? null,
    [courseId]
  )

  const assignments = course?.assignments ?? []
  const categorySummaries = useMemo(() => buildCategorySummaries(assignments), [assignments])

  const courseAvg = course?.grade?.percentage ?? null
  const courseLetter = course?.grade?.letterGrade ?? null

  const Header = useMemo(() => (
    <View>
      {/* Course summary card */}
      <View style={styles.summaryCard}>
        <Text variant="h3" style={styles.summaryCourseName}>{courseName}</Text>
        {course?.teacher ? (
          <Text variant="caption" color={colors.textSecondary}>
            {course.teacher} · Period {course.period}
          </Text>
        ) : null}
        <View style={styles.summaryGradeRow}>
          {courseAvg !== null && (
            <Text style={styles.summaryAvg}>{courseAvg.toFixed(1)}%</Text>
          )}
          {courseLetter !== null && (
            <View style={styles.letterBadge}>
              <Text style={styles.letterBadgeText}>{courseLetter}</Text>
            </View>
          )}
        </View>
      </View>

      {/* Category breakdown */}
      {categorySummaries.length > 0 && (
        <View style={styles.categorySection}>
          <Text variant="label" color={colors.textSecondary} style={styles.sectionLabel}>
            BY CATEGORY
          </Text>
          {categorySummaries.map(cat => (
            <View key={cat.name} style={styles.categoryRow}>
              <Text variant="body" style={{ flex: 1 }}>{cat.name}</Text>
              <Text variant="caption" color={colors.textMuted}>
                {cat.count} assignment{cat.count !== 1 ? 's' : ''}
              </Text>
              {cat.average !== null && (
                <Text style={[styles.catAvg, { color: scoreColor({ score: cat.average, totalPoints: 100, percentage: '', name: '', category: '', dateDue: '' }) }]}>
                  {cat.average.toFixed(1)}%
                </Text>
              )}
            </View>
          ))}
        </View>
      )}

      {/* Assignments header */}
      <View style={styles.assignmentsHeader}>
        <Text variant="label" color={colors.textSecondary}>
          ASSIGNMENTS ({assignments.length})
        </Text>
      </View>
    </View>
  ), [course, courseName, courseAvg, courseLetter, categorySummaries, assignments.length])

  return (
    <View style={styles.screen}>
      <ScreenHeader title={courseName} />

      {assignments.length === 0 ? (
        <View style={styles.emptyState}>
          {Header}
          <View style={styles.emptyContent}>
            <Ionicons name="document-text-outline" size={40} color={colors.textMuted} />
            <Text variant="h3" style={{ marginTop: 12, textAlign: 'center' }}>
              No Assignments Found
            </Text>
            <Text variant="caption" color={colors.textSecondary} style={{ textAlign: 'center', marginTop: 8 }}>
              {course === null
                ? 'Course data could not be loaded. Try refreshing grades.'
                : 'No assignment data was returned for this course from your school portal.'}
            </Text>
          </View>
        </View>
      ) : (
        <FlatList
          data={assignments}
          keyExtractor={(item, index) => `${item.name}-${index}`}
          renderItem={({ item }) => <AssignmentRow item={item} />}
          ItemSeparatorComponent={Separator}
          ListHeaderComponent={Header}
          contentContainerStyle={{ paddingBottom: 40 }}
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  )
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  summaryCard: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  summaryCourseName: {
    marginBottom: 4,
  },
  summaryGradeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 12,
  },
  summaryAvg: {
    fontSize: 32,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  letterBadge: {
    width: 48,
    height: 48,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  letterBadgeText: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.primary,
  },
  categorySection: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  sectionLabel: {
    marginBottom: 8,
    letterSpacing: 0.5,
  },
  categoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    gap: 8,
  },
  catAvg: {
    fontSize: 13,
    fontWeight: '700',
    minWidth: 52,
    textAlign: 'right',
  },
  assignmentsHeader: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 8,
  },
  assignmentRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 20,
    paddingVertical: 14,
    gap: 12,
  },
  assignmentLeft: {
    flex: 1,
  },
  assignmentName: {
    fontSize: 14,
    fontWeight: '500',
    lineHeight: 20,
    marginBottom: 6,
  },
  assignmentMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  categoryChip: {
    backgroundColor: colors.surface,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  categoryText: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  assignmentRight: {
    alignItems: 'flex-end',
    minWidth: 90,
  },
  scoreText: {
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'right',
  },
  separator: {
    height: 1,
    backgroundColor: colors.border,
    marginHorizontal: 20,
  },
  emptyState: {
    flex: 1,
  },
  emptyContent: {
    alignItems: 'center',
    paddingHorizontal: 32,
    paddingTop: 60,
  },
})
