import React, { useCallback, useMemo, useState } from 'react'
import { Pressable, SectionList, StyleSheet, Text, View } from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import { Feather } from '@expo/vector-icons'
import * as assignmentsApi from '../api/assignmentsApi'
import { ApiRequestError } from '../api/client'
import { Screen } from '../components/ui/Screen'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { LoadingSkeleton } from '../components/ui/LoadingSkeleton'
import { ErrorRetryBlock } from '../components/ui/ErrorRetryBlock'
import { EmptyState } from '../components/ui/EmptyState'
import type { Assignment } from '../types/assignments'
import { colors, fonts, radii, spacing, typography } from '../theme/tokens'

type Group = 'Overdue' | 'Today' | 'Tomorrow' | 'This Week' | 'Later' | 'Completed'

const GROUP_ORDER: Group[] = ['Overdue', 'Today', 'Tomorrow', 'This Week', 'Later', 'Completed']

// Mirrors web's GROUP_META (app/(app)/planner/page.tsx) — only Overdue/Today get a
// distinct urgency color, everything else reads as neutral.
const GROUP_META: Partial<Record<Group, { color: string; bg: string }>> = {
  Overdue: { color: colors.error, bg: 'rgba(239,68,68,0.12)' },
  Today: { color: colors.warning, bg: 'rgba(245,158,11,0.12)' },
}

function formatDueDate(assignment: Assignment): string {
  const date = new Date(assignment.dueDate)
  const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  return assignment.dueTime ? `${dateStr} at ${assignment.dueTime}` : dateStr
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

function groupFor(assignment: Assignment): Group {
  if (assignment.completed) return 'Completed'
  const today = startOfDay(new Date())
  const dueDay = startOfDay(new Date(assignment.dueDate))
  const diffDays = Math.round((dueDay.getTime() - today.getTime()) / 86_400_000)

  if (diffDays < 0) return 'Overdue'
  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Tomorrow'
  if (diffDays <= 7) return 'This Week'
  return 'Later'
}

export default function PlannerScreen(): React.JSX.Element {
  const [assignments, setAssignments] = useState<Assignment[]>([])
  const [cursor, setCursor] = useState<number | null>(null)
  const [hasNextPage, setHasNextPage] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newSubject, setNewSubject] = useState('')
  const [newDueDate, setNewDueDate] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  const loadFirstPage = useCallback(async () => {
    setError(null)
    try {
      const result = await assignmentsApi.listAssignments({ status: 'all', limit: 50 })
      setAssignments(result.data)
      setCursor(result.meta.nextCursor)
      setHasNextPage(result.meta.hasNextPage)
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not load your planner.')
    } finally {
      setLoading(false)
    }
  }, [])

  useFocusEffect(
    useCallback(() => {
      void loadFirstPage()
    }, [loadFirstPage]),
  )

  async function loadMore(): Promise<void> {
    if (!hasNextPage || cursor === null || loadingMore) return
    setLoadingMore(true)
    try {
      const result = await assignmentsApi.listAssignments({ status: 'all', cursor, limit: 50 })
      setAssignments((prev) => [...prev, ...result.data])
      setCursor(result.meta.nextCursor)
      setHasNextPage(result.meta.hasNextPage)
    } catch {
      // Silent — a failed next-page fetch shouldn't blank the already-loaded list.
    } finally {
      setLoadingMore(false)
    }
  }

  async function handleToggleComplete(assignment: Assignment): Promise<void> {
    const nextCompleted = !assignment.completed
    setAssignments((prev) => prev.map((a) => (a.id === assignment.id ? { ...a, completed: nextCompleted } : a)))
    try {
      await assignmentsApi.completeAssignment(assignment.id, nextCompleted)
    } catch {
      setAssignments((prev) =>
        prev.map((a) => (a.id === assignment.id ? { ...a, completed: assignment.completed } : a)),
      )
    }
  }

  async function handleDelete(assignment: Assignment): Promise<void> {
    const previous = assignments
    setAssignments((prev) => prev.filter((a) => a.id !== assignment.id))
    try {
      await assignmentsApi.deleteAssignment(assignment.id)
    } catch {
      setAssignments(previous)
    }
  }

  async function handleCreate(): Promise<void> {
    setCreateError(null)
    if (!newTitle.trim() || !newDueDate.trim()) {
      setCreateError('Enter a title and due date.')
      return
    }
    setCreating(true)
    try {
      const created = await assignmentsApi.createAssignment({
        title: newTitle.trim(),
        subject: newSubject.trim() || undefined,
        dueDate: newDueDate.trim(),
      })
      setAssignments((prev) => [...prev, created])
      setNewTitle('')
      setNewSubject('')
      setNewDueDate('')
      setShowCreate(false)
    } catch (err) {
      setCreateError(err instanceof ApiRequestError ? err.message : 'Could not create task.')
    } finally {
      setCreating(false)
    }
  }

  const [showCompleted, setShowCompleted] = useState(false)

  const { activeSections, completedItems } = useMemo(() => {
    const grouped = new Map<Group, Assignment[]>(GROUP_ORDER.map((g) => [g, []]))
    for (const assignment of assignments) grouped.get(groupFor(assignment))?.push(assignment)
    const active = GROUP_ORDER.filter((g) => g !== 'Completed')
      .map((group) => ({ title: group, data: grouped.get(group) ?? [] }))
      .filter((s) => s.data.length > 0)
    return { activeSections: active, completedItems: grouped.get('Completed') ?? [] }
  }, [assignments])

  if (loading) {
    return (
      <Screen>
        <LoadingSkeleton rows={4} />
      </Screen>
    )
  }

  if (error && assignments.length === 0) {
    return (
      <Screen>
        <ErrorRetryBlock
          message={error}
          onRetry={() => {
            setLoading(true)
            void loadFirstPage()
          }}
        />
      </Screen>
    )
  }

  return (
    <Screen>
      <View style={styles.headerRow}>
        <Text style={styles.title}>Planner</Text>
        <Button
          label={showCreate ? 'Cancel' : '+ New task'}
          onPress={() => setShowCreate((v) => !v)}
          variant="secondary"
        />
      </View>

      {showCreate ? (
        <Card style={styles.createCard}>
          <Input label="Title" value={newTitle} onChangeText={setNewTitle} />
          <Input label="Subject (optional)" value={newSubject} onChangeText={setNewSubject} />
          <Input
            label="Due date (YYYY-MM-DD)"
            value={newDueDate}
            onChangeText={setNewDueDate}
            placeholder="2026-07-15"
          />
          {createError ? <Text style={styles.error}>{createError}</Text> : null}
          <Button label="Create" onPress={() => void handleCreate()} loading={creating} />
        </Card>
      ) : null}

      {activeSections.length === 0 && completedItems.length === 0 ? (
        <EmptyState icon="check-circle" title="Nothing due" message="You're all caught up." />
      ) : (
        <SectionList
          sections={activeSections}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={styles.listContent}
          onEndReached={() => void loadMore()}
          onEndReachedThreshold={0.4}
          renderSectionHeader={({ section }) => {
            const meta = GROUP_META[section.title]
            return (
              <View style={styles.sectionHeaderRow}>
                <Text style={[styles.sectionTitle, meta && { color: meta.color }]}>{section.title}</Text>
                <View style={[styles.countPill, meta && { backgroundColor: meta.bg }]}>
                  <Text style={[styles.countPillText, meta && { color: meta.color }]}>{section.data.length}</Text>
                </View>
              </View>
            )
          }}
          renderItem={({ item }) => (
            <AssignmentRow item={item} onToggle={() => void handleToggleComplete(item)} onDelete={() => void handleDelete(item)} />
          )}
          ListFooterComponent={
            activeSections.length === 0 && completedItems.length > 0 ? (
              <View style={styles.allCaughtUp}>
                <View style={styles.allCaughtUpIcon}>
                  <Feather name="check" size={22} color={colors.success} />
                </View>
                <Text style={styles.allCaughtUpTitle}>All caught up!</Text>
                <Text style={styles.allCaughtUpSubtitle}>Every assignment is completed.</Text>
              </View>
            ) : completedItems.length > 0 ? (
              <View style={styles.completedWrap}>
                <Pressable
                  style={styles.completedToggle}
                  onPress={() => setShowCompleted((v) => !v)}
                  accessibilityRole="button"
                >
                  <Feather
                    name="chevron-right"
                    size={13}
                    color={colors.textSecondary}
                    style={showCompleted ? styles.chevronOpen : undefined}
                  />
                  <Text style={styles.completedToggleText}>
                    {showCompleted ? 'Hide completed assignments' : `Show completed assignments (${completedItems.length})`}
                  </Text>
                </Pressable>
                {showCompleted
                  ? completedItems.map((item) => (
                      <AssignmentRow
                        key={item.id}
                        item={item}
                        onToggle={() => void handleToggleComplete(item)}
                        onDelete={() => void handleDelete(item)}
                      />
                    ))
                  : null}
              </View>
            ) : null
          }
        />
      )}
    </Screen>
  )
}

interface AssignmentRowProps {
  item: Assignment
  onToggle: () => void
  onDelete: () => void
}

function AssignmentRow({ item, onToggle, onDelete }: AssignmentRowProps): React.JSX.Element {
  return (
    <Card style={[styles.assignmentCard, item.completed && styles.assignmentCardCompleted]}>
      <Pressable
        style={styles.assignmentMain}
        onPress={onToggle}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: item.completed }}
      >
        <View style={[styles.checkbox, item.completed && styles.checkboxChecked]}>
          {item.completed ? <Feather name="check" size={11} color={colors.bg} /> : null}
        </View>
        <View style={styles.assignmentInfo}>
          <Text style={[styles.assignmentTitle, item.completed && styles.completedText]} numberOfLines={1}>
            {item.title}
          </Text>
          <View style={styles.assignmentMetaRow}>
            {item.subject ? <Text style={styles.assignmentSubject}>{item.subject}</Text> : null}
            <Text style={styles.assignmentSubject}>Due {formatDueDate(item)}</Text>
          </View>
        </View>
      </Pressable>
      <Pressable onPress={onDelete} hitSlop={8} style={styles.deleteButton} accessibilityLabel="Delete task">
        <Feather name="x" size={16} color={colors.textMuted} />
      </Pressable>
    </Card>
  )
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  title: { ...typography.h1, color: colors.text },
  createCard: { gap: spacing.sm, marginBottom: spacing.md },
  error: { ...typography.caption, color: colors.error },
  listContent: { paddingBottom: spacing.xl },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  sectionTitle: { ...typography.label, color: colors.textSecondary },
  countPill: {
    backgroundColor: colors.surface2,
    borderRadius: 100,
    paddingHorizontal: spacing.sm,
    minWidth: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countPillText: { ...typography.caption, fontSize: 11, fontFamily: fonts.bold, fontWeight: '700', color: colors.textSecondary },
  assignmentCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
    padding: spacing.ms,
  },
  assignmentCardCompleted: { opacity: 0.6 },
  assignmentMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.ms },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: radii.xs / 2,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  checkboxChecked: { backgroundColor: colors.primary, borderColor: colors.primary },
  assignmentInfo: { flex: 1, gap: 3, marginRight: spacing.sm },
  assignmentTitle: { ...typography.h3, fontSize: 14.5, color: colors.text },
  completedText: { textDecorationLine: 'line-through', color: colors.textMuted },
  assignmentMetaRow: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
  assignmentSubject: { ...typography.caption, color: colors.textSecondary },
  deleteButton: { padding: spacing.xs },
  completedWrap: { marginTop: spacing.xs },
  completedToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.sm,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.ms,
    marginBottom: spacing.sm,
  },
  chevronOpen: { transform: [{ rotate: '90deg' }] },
  completedToggleText: { ...typography.caption, fontFamily: fonts.semiBold, fontWeight: '600', color: colors.textSecondary },
  allCaughtUp: { alignItems: 'center', paddingVertical: spacing.xxl },
  allCaughtUpIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(16,185,129,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(16,185,129,0.3)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.ms,
  },
  allCaughtUpTitle: { ...typography.h3, color: colors.text, marginBottom: spacing.xs },
  allCaughtUpSubtitle: { ...typography.caption, color: colors.textSecondary },
})
