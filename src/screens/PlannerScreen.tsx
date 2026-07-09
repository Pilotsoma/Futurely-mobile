import React, { useCallback, useMemo, useState } from 'react'
import { SectionList, StyleSheet, Text, View } from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
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
import { colors, spacing, typography } from '../theme/tokens'

type Group = 'Overdue' | 'Today' | 'Tomorrow' | 'This Week' | 'Later' | 'Completed'

const GROUP_ORDER: Group[] = ['Overdue', 'Today', 'Tomorrow', 'This Week', 'Later', 'Completed']

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

  const sections = useMemo(() => {
    const grouped = new Map<Group, Assignment[]>(GROUP_ORDER.map((g) => [g, []]))
    for (const assignment of assignments) grouped.get(groupFor(assignment))?.push(assignment)
    return GROUP_ORDER.map((group) => ({ title: group, data: grouped.get(group) ?? [] })).filter(
      (s) => s.data.length > 0,
    )
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

      {sections.length === 0 ? (
        <EmptyState icon="check-circle" title="Nothing due" message="You're all caught up." />
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={styles.listContent}
          onEndReached={() => void loadMore()}
          onEndReachedThreshold={0.4}
          renderSectionHeader={({ section }) => <Text style={styles.sectionTitle}>{section.title}</Text>}
          renderItem={({ item }) => (
            <Card style={styles.assignmentCard}>
              <View style={styles.assignmentInfo}>
                <Text style={[styles.assignmentTitle, item.completed && styles.completedText]}>{item.title}</Text>
                <Text style={styles.assignmentSubject}>{item.subject || 'General'}</Text>
              </View>
              <View style={styles.assignmentActions}>
                <Button
                  label={item.completed ? 'Undo' : 'Done'}
                  onPress={() => void handleToggleComplete(item)}
                  variant="secondary"
                  style={styles.actionButton}
                />
                <Button
                  label="Delete"
                  onPress={() => void handleDelete(item)}
                  variant="destructive"
                  style={styles.actionButton}
                />
              </View>
            </Card>
          )}
        />
      )}
    </Screen>
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
  listContent: { gap: spacing.sm, paddingBottom: spacing.xl },
  sectionTitle: { ...typography.label, color: colors.textSecondary, marginTop: spacing.md, marginBottom: spacing.sm },
  assignmentCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  assignmentInfo: { flex: 1, gap: spacing.xs, marginRight: spacing.sm },
  assignmentTitle: { ...typography.h3, color: colors.text },
  completedText: { textDecorationLine: 'line-through', color: colors.textMuted },
  assignmentSubject: { ...typography.caption, color: colors.textSecondary },
  assignmentActions: { flexDirection: 'row', gap: spacing.xs },
  actionButton: { paddingHorizontal: spacing.sm, height: 36 },
})
