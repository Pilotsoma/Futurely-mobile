import React, { useCallback, useMemo, useState } from 'react'
import {
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import Text from '../components/ui/Text'
import ScreenHeader from '../components/ui/ScreenHeader'
import Skeleton from '../components/ui/Skeleton'
import { colors } from '../constants/colors'
import { fetchStudentData, type Assignment } from '../api/studentApi'

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1)
}

function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1)
}

function buildCalendarDays(month: Date): (Date | null)[] {
  const first = startOfMonth(month)
  const startDow = first.getDay()
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate()
  const days: (Date | null)[] = []
  for (let i = 0; i < startDow; i++) days.push(null)
  for (let d = 1; d <= daysInMonth; d++) {
    days.push(new Date(month.getFullYear(), month.getMonth(), d))
  }
  return days
}

export default function CalendarScreen(): React.JSX.Element {
  const today = useMemo(() => new Date(), [])
  const [currentMonth, setCurrentMonth] = useState<Date>(startOfMonth(today))
  const [selectedDate, setSelectedDate] = useState<Date | null>(null)
  const [assignments, setAssignments] = useState<Assignment[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useFocusEffect(
    useCallback(() => {
      setIsLoading(true)
      fetchStudentData()
        .then(d => setAssignments(d.assignments))
        .catch(() => null)
        .finally(() => setIsLoading(false))
    }, [])
  )

  const assignmentsByDate = useMemo<Map<string, Assignment[]>>(() => {
    const map = new Map<string, Assignment[]>()
    for (const a of assignments) {
      const k = dateKey(new Date(a.dueDate))
      const arr = map.get(k) ?? []
      arr.push(a)
      map.set(k, arr)
    }
    return map
  }, [assignments])

  const calendarDays = useMemo(() => buildCalendarDays(currentMonth), [currentMonth])

  const selectedAssignments = selectedDate ? (assignmentsByDate.get(dateKey(selectedDate)) ?? []) : []

  const todayKey = dateKey(today)
  const currentMonthIndex = currentMonth.getMonth()

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScreenHeader title="Calendar" />
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Month nav */}
        <View style={styles.monthNav}>
          <TouchableOpacity
            style={styles.navBtn}
            onPress={() => setCurrentMonth(m => addMonths(m, -1))}
            accessibilityLabel="Previous month"
          >
            <Text style={styles.navArrow}>‹</Text>
          </TouchableOpacity>
          <Text variant="h2">
            {MONTH_NAMES[currentMonthIndex]} {currentMonth.getFullYear()}
          </Text>
          <TouchableOpacity
            style={styles.navBtn}
            onPress={() => setCurrentMonth(m => addMonths(m, 1))}
            accessibilityLabel="Next month"
          >
            <Text style={styles.navArrow}>›</Text>
          </TouchableOpacity>
        </View>
        <Text variant="caption" style={styles.attendanceRow}>
          Tardies: 0  |  Excused: 0  |  Unexcused: 0
        </Text>

        {/* Day headers */}
        <View style={styles.gridRow}>
          {DAY_LABELS.map(d => (
            <Text key={d} variant="caption" style={styles.dayLabel}>{d}</Text>
          ))}
        </View>

        {/* Calendar grid */}
        {isLoading ? (
          <Skeleton width="100%" height={200} style={{ borderRadius: 8, marginTop: 8 }} />
        ) : (
          <View style={styles.grid}>
            {calendarDays.map((date, i) => {
              if (!date) return <View key={`empty-${i}`} style={styles.cell} />
              const k = dateKey(date)
              const isToday = k === todayKey
              const isPast = date < today && !isToday
              const dayAssignments = assignmentsByDate.get(k) ?? []
              const hasPending = dayAssignments.some(a => !a.completed)
              const hasCompleted = dayAssignments.some(a => a.completed)
              const isSelected = selectedDate ? dateKey(selectedDate) === k : false

              return (
                <TouchableOpacity
                  key={k}
                  style={[styles.cell, isSelected && styles.cellSelected]}
                  onPress={() => setSelectedDate(date)}
                  activeOpacity={0.7}
                >
                  <View style={isToday ? styles.todayCircle : undefined}>
                    <Text
                      style={[
                        styles.dayNum,
                        isToday && styles.dayNumToday,
                        isPast && styles.dayNumPast,
                      ]}
                    >
                      {date.getDate()}
                    </Text>
                  </View>
                  <View style={styles.dotRow}>
                    {hasPending && <View style={[styles.dot, { backgroundColor: colors.error }]} />}
                    {hasCompleted && <View style={[styles.dot, { backgroundColor: colors.success }]} />}
                  </View>
                </TouchableOpacity>
              )
            })}
          </View>
        )}

        {/* Selected date panel */}
        {selectedDate && (
          <View style={styles.selectedPanel}>
            <Text variant="h3" style={{ marginBottom: 12 }}>
              {selectedDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
            </Text>
            {selectedAssignments.length === 0 ? (
              <Text variant="caption">Nothing due on this date</Text>
            ) : (
              selectedAssignments.map(a => (
                <View key={a.id} style={styles.assignmentRow}>
                  {a.completed && <Text style={styles.checkmark}>✓ </Text>}
                  <View style={{ flex: 1 }}>
                    <Text
                      variant="body"
                      style={a.completed ? styles.strikethrough : undefined}
                    >
                      {a.title}
                    </Text>
                    <Text variant="caption">{a.subject} · {a.estimatedMinutes}m</Text>
                  </View>
                </View>
              ))
            )}
          </View>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  )
}

const CELL_SIZE = 44

const styles = StyleSheet.create({
  scrollContent: { paddingHorizontal: 20, paddingBottom: 40 },
  monthNav: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 16,
  },
  navBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  navArrow: { fontSize: 24, color: colors.textPrimary, fontWeight: '600' },
  attendanceRow: { textAlign: 'center', marginBottom: 12 },
  gridRow: { flexDirection: 'row', justifyContent: 'space-around', marginBottom: 8 },
  dayLabel: { flex: 1, textAlign: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: {
    width: `${100 / 7}%`,
    height: CELL_SIZE + 14,
    alignItems: 'center',
    paddingVertical: 4,
    borderRadius: 6,
  },
  cellSelected: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  todayCircle: {
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  dayNum: { fontSize: 16, color: colors.textPrimary, lineHeight: 30, textAlign: 'center', width: 30 },
  dayNumToday: { color: colors.background, fontWeight: '700' },
  dayNumPast: { opacity: 0.4 },
  dotRow: { flexDirection: 'row', gap: 3, marginTop: 2 },
  dot: { width: 5, height: 5, borderRadius: 2.5 },
  selectedPanel: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    marginTop: 16,
  },
  assignmentRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  checkmark: { color: colors.success, fontWeight: '700' as const, marginRight: 4 },
  strikethrough: { textDecorationLine: 'line-through' as const, color: colors.textMuted },
})
