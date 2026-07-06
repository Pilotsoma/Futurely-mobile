// PlannerScreen — full Futurely planner for mobile.
//
// Mirrors app/(app)/planner/page.tsx layout and logic:
//   - Assignments grouped into: Overdue / Today / Tomorrow / This Week / Later / Completed
//   - Completed assignments collapsed behind a toggle, shown dimmed
//   - Canvas-synced assignments show a "Canvas" badge; cannot be deleted (matches web)
//   - Manual assignments can be deleted (optimistic remove, restore on failure)
//   - Completion toggled optimistically — reverts on server error
//   - New manual assignments created via a bottom sheet modal (title + subject + due date)
//   - All three states: loading (skeleton), error (with retry), empty (with CTA)

import React, {
  useState,
  useCallback,
  useRef,
  useEffect,
} from 'react'
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Modal,
  TextInput,
  Platform,
  KeyboardAvoidingView,
  FlatList,
  type ListRenderItemInfo,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useTheme } from '../theme/ThemeContext'
import { useAuth } from '../context/AuthContext'
import {
  listAssignments,
  createAssignment,
  setAssignmentComplete,
  deleteAssignment,
  type Assignment,
} from '../api/assignmentsApi'
import { ApiRequestError } from '../api/client'

// ── Types ──────────────────────────────────────────────────────────────────────

type GroupKey = 'Overdue' | 'Today' | 'Tomorrow' | 'This Week' | 'Later' | 'Completed'

interface Group {
  key: GroupKey
  items: Assignment[]
}

// Items fed to FlatList — either a group header or an assignment row.
type ListItem =
  | { kind: 'header'; group: Group }
  | { kind: 'assignment'; assignment: Assignment; groupKey: GroupKey }
  | { kind: 'completedToggle'; count: number }
  | { kind: 'empty' }
  | { kind: 'allCaughtUp' }

// ── Grouping logic (mirrors web's groupAssignments exactly) ────────────────────

function groupAssignments(items: Assignment[]): Group[] {
  const now = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const tomorrowStart = new Date(todayStart.getTime() + 86_400_000)
  const weekEnd = new Date(todayStart.getTime() + 7 * 86_400_000)

  const buckets: Record<GroupKey, Assignment[]> = {
    Overdue: [],
    Today: [],
    Tomorrow: [],
    'This Week': [],
    Later: [],
    Completed: [],
  }

  for (const item of items) {
    if (item.completed) {
      buckets.Completed.push(item)
      continue
    }
    const due = new Date(item.dueDate)
    if (due < todayStart) {
      buckets.Overdue.push(item)
    } else if (due < tomorrowStart) {
      buckets.Today.push(item)
    } else if (due < new Date(tomorrowStart.getTime() + 86_400_000)) {
      buckets.Tomorrow.push(item)
    } else if (due < weekEnd) {
      buckets['This Week'].push(item)
    } else {
      buckets.Later.push(item)
    }
  }

  const ORDER: GroupKey[] = ['Overdue', 'Today', 'Tomorrow', 'This Week', 'Later', 'Completed']
  return ORDER.filter(k => buckets[k].length > 0).map(k => ({ key: k, items: buckets[k] }))
}

// ── Formatting helpers ─────────────────────────────────────────────────────────

function formatDueDate(assignment: Assignment): string {
  const date = new Date(assignment.dueDate)
  const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  if (assignment.dueTime) return `${dateStr} at ${assignment.dueTime}`
  return dateStr
}

function extractErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiRequestError) return err.message
  if (err instanceof Error) return err.message
  return fallback
}

// ── Date picker helpers ────────────────────────────────────────────────────────

// Returns YYYY-MM-DD from a Date object.
function toIsoDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function parseIsoDate(s: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null
  const [y, mo, d] = s.split('-').map(Number)
  const date = new Date(y, mo - 1, d)
  // Verify the parsed parts match (catches invalid dates like 2024-02-30)
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) {
    return null
  }
  return date
}

// ── Group color metadata (mirrors web's GROUP_META) ───────────────────────────

const GROUP_META: Partial<Record<GroupKey, { color: string; bg: string }>> = {
  Overdue: { color: '#EF4444', bg: 'rgba(239,68,68,0.10)' },
  Today:   { color: '#F59E0B', bg: 'rgba(245,158,11,0.10)' },
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function PlannerScreen(): React.JSX.Element {
  const { theme } = useTheme()
  const { accessToken } = useAuth()

  const c = theme.colors
  const s = theme.spacing
  const r = theme.radius
  const t = theme.typography

  // ── Data state ─────────────────────────────────────────────────────────────

  const [items, setItems]       = useState<Assignment[]>([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState<string | null>(null)

  // Set of assignment IDs whose toggle is in flight (optimistic update).
  const [toggling, setToggling]           = useState<Set<number>>(new Set())
  const [toggleError, setToggleError]     = useState<string | null>(null)
  // Ref mirrors state so async callbacks see fresh value without stale closure.
  const togglingRef = useRef<Set<number>>(new Set())

  const [showCompleted, setShowCompleted] = useState(false)

  // ── Form / modal state ─────────────────────────────────────────────────────

  const [showForm, setShowForm]     = useState(false)
  const [formTitle, setFormTitle]   = useState('')
  const [formSubject, setFormSubject] = useState('')
  const [formDueDate, setFormDueDate] = useState('')
  const [formDueTime, setFormDueTime] = useState('')
  const [submitting, setSubmitting]   = useState(false)
  const [formError, setFormError]     = useState<string | null>(null)

  const subjectRef = useRef<TextInput>(null)
  const dueDateRef = useRef<TextInput>(null)
  const dueTimeRef = useRef<TextInput>(null)

  // ── Fetch ──────────────────────────────────────────────────────────────────

  const fetchData = useCallback(async (): Promise<void> => {
    if (!accessToken) return
    setError(null)
    setLoading(true)
    try {
      const result = await listAssignments(accessToken, 'all')
      setItems(result.data)
    } catch (err: unknown) {
      setError(extractErrorMessage(err, 'Failed to load planner. Please try again.'))
    } finally {
      setLoading(false)
    }
  }, [accessToken])

  useEffect(() => { void fetchData() }, [fetchData])

  // ── Toggle completion ──────────────────────────────────────────────────────

  const handleToggle = useCallback(async (id: number, completed: boolean): Promise<void> => {
    if (!accessToken) return
    if (togglingRef.current.has(id)) return // debounce rapid taps

    setToggleError(null)
    togglingRef.current.add(id)
    setToggling(new Set(togglingRef.current))

    // Optimistic update
    setItems(prev =>
      prev.map(item =>
        item.id === id
          ? { ...item, completed, completedAt: completed ? new Date().toISOString() : null }
          : item,
      ),
    )

    try {
      const updated = await setAssignmentComplete(id, completed, accessToken)
      setItems(prev => prev.map(item => (item.id === id ? updated : item)))
    } catch (err: unknown) {
      // Revert
      setItems(prev =>
        prev.map(item =>
          item.id === id
            ? { ...item, completed: !completed, completedAt: !completed ? new Date().toISOString() : null }
            : item,
        ),
      )
      setToggleError(extractErrorMessage(err, 'Failed to save — please try again.'))
    } finally {
      togglingRef.current.delete(id)
      setToggling(new Set(togglingRef.current))
    }
  }, [accessToken])

  // ── Delete ─────────────────────────────────────────────────────────────────

  const handleDelete = useCallback(async (id: number): Promise<void> => {
    if (!accessToken) return
    // Optimistic remove
    const snapshot = items.find(i => i.id === id)
    setItems(prev => prev.filter(item => item.id !== id))
    try {
      await deleteAssignment(id, accessToken)
    } catch {
      // Restore
      if (snapshot) {
        setItems(prev => {
          // Insert back at the same relative position — simplest is append and re-sort;
          // since we have no sort key, just push it back.
          return [...prev, snapshot]
        })
      }
    }
  }, [accessToken, items])

  // ── Create ─────────────────────────────────────────────────────────────────

  const handleCreate = useCallback(async (): Promise<void> => {
    if (!accessToken) return
    const title = formTitle.trim()
    if (!title) { setFormError('Task name is required.'); return }
    if (!formDueDate) { setFormError('Due date is required.'); return }
    if (!parseIsoDate(formDueDate)) {
      setFormError('Enter date as YYYY-MM-DD (e.g. 2025-09-15).')
      return
    }

    setFormError(null)
    setSubmitting(true)
    try {
      const created = await createAssignment(
        {
          title,
          subject: formSubject.trim() || undefined,
          dueDate: formDueDate,
          dueTime: formDueTime.trim() || undefined,
        },
        accessToken,
      )
      setItems(prev => [...prev, created])
      // Reset form
      setFormTitle('')
      setFormSubject('')
      setFormDueDate('')
      setFormDueTime('')
      setShowForm(false)
    } catch (err: unknown) {
      setFormError(extractErrorMessage(err, 'Failed to create task. Please try again.'))
    } finally {
      setSubmitting(false)
    }
  }, [accessToken, formTitle, formSubject, formDueDate, formDueTime])

  const handleCloseForm = useCallback((): void => {
    setShowForm(false)
    setFormTitle('')
    setFormSubject('')
    setFormDueDate('')
    setFormDueTime('')
    setFormError(null)
  }, [])

  // ── Build flat list data ───────────────────────────────────────────────────

  const groups = groupAssignments(items)
  const activeGroups = groups.filter(g => g.key !== 'Completed')
  const completedGroup = groups.find(g => g.key === 'Completed')

  const listData: ListItem[] = []

  if (activeGroups.length === 0 && !completedGroup) {
    listData.push({ kind: 'empty' })
  } else if (activeGroups.length === 0 && completedGroup) {
    listData.push({ kind: 'allCaughtUp' })
  } else {
    for (const group of activeGroups) {
      listData.push({ kind: 'header', group })
      for (const assignment of group.items) {
        listData.push({ kind: 'assignment', assignment, groupKey: group.key })
      }
    }
  }

  if (completedGroup) {
    listData.push({ kind: 'completedToggle', count: completedGroup.items.length })
    if (showCompleted) {
      for (const assignment of completedGroup.items) {
        listData.push({ kind: 'assignment', assignment, groupKey: 'Completed' })
      }
    }
  }

  // ── Render helpers ─────────────────────────────────────────────────────────

  const renderAssignmentCard = useCallback((
    assignment: Assignment,
    groupKey: GroupKey,
  ): React.JSX.Element => {
    const isCanvas = assignment.source === 'CANVAS'
    const isCompleted = assignment.completed
    const isToggling = toggling.has(assignment.id)
    const meta = GROUP_META[groupKey]

    return (
      <View
        style={[
          styles.card,
          {
            backgroundColor: c.surface,
            borderColor: c.border,
            opacity: isCompleted ? 0.6 : 1,
          },
        ]}
      >
        <TouchableOpacity
          style={styles.cardContent}
          onPress={() => { void handleToggle(assignment.id, !assignment.completed) }}
          disabled={isToggling}
          activeOpacity={0.7}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: isCompleted, busy: isToggling }}
          accessibilityLabel={`${assignment.title}. ${isCompleted ? 'Completed' : 'Incomplete'}. Tap to toggle.`}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 0 }}
        >
          {/* Checkbox */}
          <View
            style={[
              styles.checkbox,
              {
                borderColor: isCompleted ? c.primary : c.border,
                backgroundColor: isCompleted ? c.primary : 'transparent',
              },
            ]}
          >
            {isToggling ? (
              <ActivityIndicator size="small" color={isCompleted ? '#FFFFFF' : c.primary} style={styles.checkSpinner} />
            ) : isCompleted ? (
              <Text style={styles.checkmark}>✓</Text>
            ) : null}
          </View>

          {/* Text area */}
          <View style={styles.cardText}>
            <Text
              style={[
                styles.cardTitle,
                {
                  color: isCompleted ? c.textMuted : c.text,
                  textDecorationLine: isCompleted ? 'line-through' : 'none',
                  fontSize: t.fontSizeSmMd,
                  fontWeight: t.weightMedium,
                },
              ]}
              numberOfLines={2}
            >
              {assignment.title}
            </Text>
            <View style={styles.cardMeta}>
              {assignment.subject ? (
                <Text style={[styles.cardMetaText, { color: c.textSecondary, fontSize: t.fontSizeXs }]}>
                  {assignment.subject}
                </Text>
              ) : null}
              {isCanvas ? (
                <View style={[styles.canvasBadge, { backgroundColor: 'rgba(229,57,53,0.12)' }]}>
                  <Text style={[styles.canvasBadgeText, { color: '#E53935' }]}>Canvas</Text>
                </View>
              ) : null}
              <Text style={[styles.cardMetaText, { color: c.textSecondary, fontSize: t.fontSizeXs }]}>
                Due {formatDueDate(assignment)}
              </Text>
            </View>
          </View>
        </TouchableOpacity>

        {/* Delete — only for manual assignments, matching web behavior */}
        {!isCanvas && (
          <TouchableOpacity
            style={[styles.deleteBtn, { minWidth: s.touchTarget, minHeight: s.touchTarget }]}
            onPress={() => { void handleDelete(assignment.id) }}
            accessibilityRole="button"
            accessibilityLabel={`Delete ${assignment.title}`}
            hitSlop={{ top: 8, bottom: 8, left: 4, right: 8 }}
          >
            <Text style={[styles.deleteBtnText, { color: c.textMuted }]}>×</Text>
          </TouchableOpacity>
        )}
        {/* Spacer to maintain alignment when delete button is absent */}
        {isCanvas && <View style={styles.deleteBtnSpacer} />}

        {/* Subtle left accent for Overdue / Today */}
        {meta && !isCompleted && (
          <View
            style={[
              styles.accentBar,
              { backgroundColor: meta.color },
            ]}
          />
        )}
      </View>
    )
  }, [
    c.primary, c.surface, c.border, c.text, c.textMuted, c.textSecondary,
    s.touchTarget,
    t.fontSizeSmMd, t.fontSizeXs, t.weightMedium,
    toggling,
    handleToggle,
    handleDelete,
  ])

  const renderItem = useCallback(({ item }: ListRenderItemInfo<ListItem>): React.JSX.Element | null => {
    switch (item.kind) {
      case 'header': {
        const meta = GROUP_META[item.group.key]
        return (
          <View style={styles.groupHeader}>
            <Text
              style={[
                styles.groupLabel,
                {
                  color: meta?.color ?? c.textSecondary,
                  fontSize: t.fontSizeXs,
                  fontWeight: t.weightBold,
                },
              ]}
            >
              {item.group.key.toUpperCase()}
            </Text>
            <View
              style={[
                styles.groupCount,
                {
                  backgroundColor: meta?.bg ?? c.surface2,
                },
              ]}
            >
              <Text style={[styles.groupCountText, { color: meta?.color ?? c.textSecondary, fontSize: t.fontSizeXs }]}>
                {item.group.items.length}
              </Text>
            </View>
          </View>
        )
      }

      case 'assignment':
        return renderAssignmentCard(item.assignment, item.groupKey)

      case 'completedToggle':
        return (
          <TouchableOpacity
            style={[
              styles.completedToggle,
              {
                borderColor: c.border,
                minHeight: s.touchTarget,
                marginTop: 8,
              },
            ]}
            onPress={() => setShowCompleted(v => !v)}
            accessibilityRole="button"
            accessibilityLabel={
              showCompleted
                ? 'Hide completed assignments'
                : `Show completed assignments (${item.count})`
            }
          >
            <Text
              style={[
                styles.completedToggleChevron,
                {
                  color: c.textSecondary,
                  transform: [{ rotate: showCompleted ? '90deg' : '0deg' }],
                },
              ]}
            >
              ›
            </Text>
            <Text style={[styles.completedToggleText, { color: c.textSecondary, fontSize: t.fontSizeSm }]}>
              {showCompleted
                ? 'Hide completed assignments'
                : `Show completed assignments (${item.count})`}
            </Text>
          </TouchableOpacity>
        )

      case 'empty':
        return (
          <View style={styles.emptyState}>
            <View style={[styles.emptyIcon, { backgroundColor: c.surface2, borderColor: c.border }]}>
              <Text style={[styles.emptyIconText, { color: c.success }]}>✓</Text>
            </View>
            <Text style={[styles.emptyTitle, { color: c.text, fontSize: t.fontSizeXl }]}>
              No tasks yet
            </Text>
            <Text style={[styles.emptySubtitle, { color: c.textSecondary, fontSize: t.fontSizeSm }]}>
              Tap &quot;+ New Task&quot; to add your first assignment.
            </Text>
          </View>
        )

      case 'allCaughtUp':
        return (
          <View style={styles.emptyState}>
            <View style={[styles.caughtUpIcon, { backgroundColor: 'rgba(34,197,94,0.12)', borderColor: 'rgba(34,197,94,0.3)' }]}>
              <Text style={[styles.emptyIconText, { color: '#22C55E' }]}>✓</Text>
            </View>
            <Text style={[styles.emptyTitle, { color: c.text, fontSize: t.fontSizeXl }]}>
              All caught up!
            </Text>
            <Text style={[styles.emptySubtitle, { color: c.textSecondary, fontSize: t.fontSizeSm }]}>
              Every assignment is completed.
            </Text>
          </View>
        )

      default:
        return null
    }
  }, [
    c, s.touchTarget, t,
    showCompleted,
    renderAssignmentCard,
  ])

  const keyExtractor = useCallback((item: ListItem, index: number): string => {
    if (item.kind === 'assignment') return `assignment-${item.assignment.id}`
    if (item.kind === 'header') return `header-${item.group.key}`
    if (item.kind === 'completedToggle') return 'completedToggle'
    if (item.kind === 'empty') return 'empty'
    if (item.kind === 'allCaughtUp') return 'allCaughtUp'
    return String(index)
  }, [])

  // ── Skeleton loading state ─────────────────────────────────────────────────

  if (loading) {
    return (
      <SafeAreaView style={[styles.safeArea, { backgroundColor: c.bg }]} edges={['top', 'left', 'right']}>
        <View style={[styles.header, { paddingHorizontal: s.screenPaddingH }]}>
          <Text style={[styles.pageTitle, { color: c.text, fontSize: t.fontSize3xl, fontWeight: t.weightExtrabold }]}>
            Planner
          </Text>
        </View>
        <ScrollView
          style={styles.flex}
          contentContainerStyle={{ paddingHorizontal: s.screenPaddingH, paddingTop: 8, paddingBottom: 40 }}
          showsVerticalScrollIndicator={false}
        >
          {/* Skeleton group header */}
          <View style={[styles.skeletonGroupLabel, { backgroundColor: c.surface2 }]} />
          {[1, 2, 3].map(i => (
            <View key={i} style={[styles.skeletonCard, { backgroundColor: c.surface, borderColor: c.border }]}>
              <View style={[styles.skeletonCheckbox, { backgroundColor: c.surface2 }]} />
              <View style={styles.skeletonText}>
                <View style={[styles.skeletonLine, { backgroundColor: c.surface2, width: `${60 + i * 10}%` }]} />
                <View style={[styles.skeletonLine, { backgroundColor: c.surface2, width: '40%', marginTop: 6 }]} />
              </View>
            </View>
          ))}
          {/* Second group */}
          <View style={[styles.skeletonGroupLabel, { backgroundColor: c.surface2, marginTop: 24 }]} />
          {[1, 2].map(i => (
            <View key={i} style={[styles.skeletonCard, { backgroundColor: c.surface, borderColor: c.border }]}>
              <View style={[styles.skeletonCheckbox, { backgroundColor: c.surface2 }]} />
              <View style={styles.skeletonText}>
                <View style={[styles.skeletonLine, { backgroundColor: c.surface2, width: `${55 + i * 12}%` }]} />
                <View style={[styles.skeletonLine, { backgroundColor: c.surface2, width: '35%', marginTop: 6 }]} />
              </View>
            </View>
          ))}
        </ScrollView>
      </SafeAreaView>
    )
  }

  // ── Error state ────────────────────────────────────────────────────────────

  if (error !== null) {
    return (
      <SafeAreaView style={[styles.safeArea, { backgroundColor: c.bg }]} edges={['top', 'left', 'right']}>
        <View style={[styles.header, { paddingHorizontal: s.screenPaddingH }]}>
          <Text style={[styles.pageTitle, { color: c.text, fontSize: t.fontSize3xl, fontWeight: t.weightExtrabold }]}>
            Planner
          </Text>
        </View>
        <View style={[styles.errorState, { paddingHorizontal: s.screenPaddingH }]}>
          <Text style={[styles.errorTitle, { color: c.error, fontSize: t.fontSizeLg }]}>
            Couldn&apos;t load planner
          </Text>
          <Text style={[styles.errorMessage, { color: c.textSecondary, fontSize: t.fontSizeSm }]}>
            {error}
          </Text>
          <TouchableOpacity
            style={[
              styles.retryBtn,
              { backgroundColor: c.primary, minHeight: s.touchTarget },
            ]}
            onPress={() => { void fetchData() }}
            accessibilityRole="button"
            accessibilityLabel="Retry loading planner"
          >
            <Text style={[styles.retryBtnText, { fontSize: t.fontSizeBase }]}>Try again</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    )
  }

  // ── Main render ────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: c.bg }]} edges={['top', 'left', 'right']}>
      {/* Page header */}
      <View style={[styles.header, { paddingHorizontal: s.screenPaddingH }]}>
        <Text style={[styles.pageTitle, { color: c.text, fontSize: t.fontSize3xl, fontWeight: t.weightExtrabold }]}>
          Planner
        </Text>
        <TouchableOpacity
          style={[
            styles.newTaskBtn,
            {
              backgroundColor: c.primary,
              minHeight: s.touchTarget,
              borderRadius: r.md,
            },
          ]}
          onPress={() => setShowForm(true)}
          accessibilityRole="button"
          accessibilityLabel="Add new task"
        >
          <Text style={[styles.newTaskBtnText, { fontSize: t.fontSizeSm }]}>+ New Task</Text>
        </TouchableOpacity>
      </View>

      {/* Toggle error inline banner */}
      {toggleError !== null && (
        <View
          style={[
            styles.toggleErrorBanner,
            {
              backgroundColor: 'rgba(239,68,68,0.08)',
              borderColor: 'rgba(239,68,68,0.3)',
              marginHorizontal: s.screenPaddingH,
            },
          ]}
        >
          <Text style={[styles.toggleErrorText, { color: c.error, fontSize: t.fontSizeSm }]}>
            {toggleError}
          </Text>
          <TouchableOpacity
            onPress={() => setToggleError(null)}
            accessibilityRole="button"
            accessibilityLabel="Dismiss error"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={styles.toggleErrorClose}
          >
            <Text style={[{ color: c.error, fontSize: t.fontSizeLg }]}>✕</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Assignment list */}
      <FlatList<ListItem>
        data={listData}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        style={styles.flex}
        contentContainerStyle={{
          paddingHorizontal: s.screenPaddingH,
          paddingTop: 8,
          paddingBottom: 80,
        }}
        showsVerticalScrollIndicator={false}
        removeClippedSubviews={false}
      />

      {/* Create assignment modal */}
      <Modal
        visible={showForm}
        transparent
        animationType="slide"
        onRequestClose={handleCloseForm}
        accessibilityViewIsModal
      >
        <KeyboardAvoidingView
          style={styles.modalBackdrop}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            onPress={handleCloseForm}
            accessibilityLabel="Close form"
          />
          <View
            style={[
              styles.modalSheet,
              {
                backgroundColor: c.surface,
                borderColor: c.border,
              },
            ]}
          >
            {/* Modal header */}
            <View style={[styles.modalHeader, { borderBottomColor: c.border }]}>
              <Text style={[styles.modalTitle, { color: c.text, fontSize: t.fontSizeLg, fontWeight: t.weightBold }]}>
                New Task
              </Text>
              <TouchableOpacity
                onPress={handleCloseForm}
                accessibilityRole="button"
                accessibilityLabel="Cancel"
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                style={{ minWidth: s.touchTarget, minHeight: s.touchTarget, alignItems: 'center', justifyContent: 'center' }}
              >
                <Text style={[{ color: c.textMuted, fontSize: t.fontSizeLg }]}>✕</Text>
              </TouchableOpacity>
            </View>

            <ScrollView
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.modalBody}
            >
              {/* Task name */}
              <Text style={[styles.fieldLabel, { color: c.textSecondary, fontSize: t.fontSizeSm }]}>
                Task name
              </Text>
              <TextInput
                style={[
                  styles.textInput,
                  {
                    backgroundColor: c.bg,
                    borderColor: formError && !formTitle.trim() ? c.error : c.border,
                    color: c.text,
                    fontSize: t.fontSizeBase,
                  },
                ]}
                placeholder="e.g. Math Homework Ch. 7"
                placeholderTextColor={c.textMuted}
                value={formTitle}
                onChangeText={setFormTitle}
                returnKeyType="next"
                onSubmitEditing={() => subjectRef.current?.focus()}
                accessibilityLabel="Task name"
                autoFocus
              />

              {/* Class / subject */}
              <Text style={[styles.fieldLabel, { color: c.textSecondary, fontSize: t.fontSizeSm, marginTop: s.lg }]}>
                Class <Text style={{ color: c.textMuted }}>(optional)</Text>
              </Text>
              <TextInput
                ref={subjectRef}
                style={[
                  styles.textInput,
                  {
                    backgroundColor: c.bg,
                    borderColor: c.border,
                    color: c.text,
                    fontSize: t.fontSizeBase,
                  },
                ]}
                placeholder="e.g. AP Calculus, English"
                placeholderTextColor={c.textMuted}
                value={formSubject}
                onChangeText={setFormSubject}
                returnKeyType="next"
                onSubmitEditing={() => dueDateRef.current?.focus()}
                accessibilityLabel="Class or subject"
              />

              {/* Due date */}
              <Text style={[styles.fieldLabel, { color: c.textSecondary, fontSize: t.fontSizeSm, marginTop: s.lg }]}>
                Due date
              </Text>
              <TextInput
                ref={dueDateRef}
                style={[
                  styles.textInput,
                  {
                    backgroundColor: c.bg,
                    borderColor: formError && !formDueDate ? c.error : c.border,
                    color: c.text,
                    fontSize: t.fontSizeBase,
                  },
                ]}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={c.textMuted}
                value={formDueDate}
                onChangeText={text => setFormDueDate(text.replace(/[^\d-]/g, ''))}
                keyboardType="numbers-and-punctuation"
                maxLength={10}
                returnKeyType="next"
                onSubmitEditing={() => dueTimeRef.current?.focus()}
                accessibilityLabel="Due date in YYYY-MM-DD format"
              />
              <Text style={[styles.fieldHint, { color: c.textMuted, fontSize: t.fontSizeXs }]}>
                Today is {toIsoDate(new Date())}
              </Text>

              {/* Due time */}
              <Text style={[styles.fieldLabel, { color: c.textSecondary, fontSize: t.fontSizeSm, marginTop: s.lg }]}>
                Due time <Text style={{ color: c.textMuted }}>(optional)</Text>
              </Text>
              <TextInput
                ref={dueTimeRef}
                style={[
                  styles.textInput,
                  {
                    backgroundColor: c.bg,
                    borderColor: c.border,
                    color: c.text,
                    fontSize: t.fontSizeBase,
                  },
                ]}
                placeholder="HH:MM (e.g. 23:59)"
                placeholderTextColor={c.textMuted}
                value={formDueTime}
                onChangeText={text => setFormDueTime(text.replace(/[^\d:]/g, ''))}
                keyboardType="numbers-and-punctuation"
                maxLength={5}
                returnKeyType="done"
                onSubmitEditing={() => { void handleCreate() }}
                accessibilityLabel="Due time in HH:MM format"
              />

              {/* Form error */}
              {formError !== null && (
                <Text style={[styles.formErrorText, { color: c.error, fontSize: t.fontSizeSm }]}>
                  {formError}
                </Text>
              )}

              {/* Submit */}
              <TouchableOpacity
                style={[
                  styles.submitBtn,
                  {
                    backgroundColor: c.primary,
                    minHeight: s.touchTarget,
                    borderRadius: r.md,
                    opacity: submitting || !formTitle.trim() || !formDueDate ? 0.5 : 1,
                    marginTop: s.xl2,
                  },
                ]}
                onPress={() => { void handleCreate() }}
                disabled={submitting || !formTitle.trim() || !formDueDate}
                accessibilityRole="button"
                accessibilityLabel="Add task"
              >
                {submitting ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={[styles.submitBtnText, { fontSize: t.fontSizeBase }]}>Add Task</Text>
                )}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  )
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safeArea:    { flex: 1 },
  flex:        { flex: 1 },

  // ── Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 12,
    paddingBottom: 12,
  },
  pageTitle: {
    letterSpacing: -0.5,
  },
  newTaskBtn: {
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  newTaskBtnText: {
    color: '#FFFFFF',
    fontWeight: '600',
  },

  // ── Toggle error banner
  toggleErrorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginBottom: 8,
    gap: 10,
  },
  toggleErrorText: {
    flex: 1,
    lineHeight: 18,
  },
  toggleErrorClose: {
    paddingHorizontal: 4,
  },

  // ── Group header
  groupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
    marginTop: 20,
  },
  groupLabel: {
    letterSpacing: 0.7,
  },
  groupCount: {
    borderRadius: 100,
    paddingVertical: 2,
    paddingHorizontal: 8,
  },
  groupCountText: {
    fontWeight: '700',
  },

  // ── Assignment card
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 10,
    marginBottom: 8,
    overflow: 'hidden',
  },
  cardContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 13,
    paddingLeft: 14,
    paddingRight: 4,
    gap: 12,
    minHeight: 44,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 5,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  checkSpinner: {
    transform: [{ scale: 0.6 }],
  },
  checkmark: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
  },
  cardText: {
    flex: 1,
    minWidth: 0,
  },
  cardTitle: {
    lineHeight: 19,
  },
  cardMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 3,
  },
  cardMetaText: {
    lineHeight: 16,
  },
  canvasBadge: {
    borderRadius: 4,
    paddingVertical: 1,
    paddingHorizontal: 5,
  },
  canvasBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  accentBar: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 3,
  },
  deleteBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  deleteBtnText: {
    fontSize: 20,
    lineHeight: 22,
  },
  deleteBtnSpacer: {
    width: 36,
  },

  // ── Completed toggle
  completedToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 0,
  },
  completedToggleChevron: {
    fontSize: 20,
    fontWeight: '700',
  },
  completedToggleText: {
    fontWeight: '600',
  },

  // ── Empty / all caught up states
  emptyState: {
    alignItems: 'center',
    paddingVertical: 60,
    paddingHorizontal: 20,
  },
  emptyIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  caughtUpIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  emptyIconText: {
    fontSize: 20,
    fontWeight: '700',
  },
  emptyTitle: {
    fontWeight: '700',
    marginBottom: 5,
    textAlign: 'center',
  },
  emptySubtitle: {
    textAlign: 'center',
    lineHeight: 18,
  },

  // ── Error state
  errorState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
    gap: 8,
  },
  errorTitle: {
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 4,
  },
  errorMessage: {
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 16,
    paddingHorizontal: 20,
  },
  retryBtn: {
    borderRadius: 9,
    paddingHorizontal: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  retryBtnText: {
    color: '#FFFFFF',
    fontWeight: '600',
  },

  // ── Skeleton
  skeletonGroupLabel: {
    height: 12,
    width: 80,
    borderRadius: 6,
    marginBottom: 10,
    marginTop: 20,
  },
  skeletonCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 10,
    padding: 14,
    marginBottom: 8,
    gap: 12,
    height: 62,
  },
  skeletonCheckbox: {
    width: 20,
    height: 20,
    borderRadius: 5,
    flexShrink: 0,
  },
  skeletonText: {
    flex: 1,
  },
  skeletonLine: {
    height: 10,
    borderRadius: 5,
  },

  // ── Modal
  modalBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  modalSheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    maxHeight: '85%',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
  },
  modalTitle: {},
  modalBody: {
    padding: 20,
    paddingBottom: 36,
  },
  fieldLabel: {
    fontWeight: '500',
    marginBottom: 6,
  },
  fieldHint: {
    marginTop: 4,
    lineHeight: 16,
  },
  textInput: {
    height: 48,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 14,
  },
  formErrorText: {
    marginTop: 10,
    lineHeight: 18,
  },
  submitBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  submitBtnText: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
})
