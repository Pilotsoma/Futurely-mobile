import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import { Feather } from '@expo/vector-icons'

import * as collegesApi from '../api/collegesApi'
import * as gradesApi from '../api/gradesApi'
import * as studentsApi from '../api/studentsApi'
import { ApiRequestError } from '../api/client'
import { Screen } from '../components/ui/Screen'
import { LoadingSkeleton } from '../components/ui/LoadingSkeleton'
import type {
  CollegeInsights,
  CollegeListItem,
  CollegeSearchResult,
} from '../types/colleges'
import type { GpaSummary } from '../types/grades'
import type { StudentMe } from '../types/student'
import {
  colors,
  elevation,
  fonts,
  radii,
  spacing,
} from '../theme/tokens'

type InsightState =
  | { status: 'loading' }
  | { status: 'error'; message: string; retryable: boolean }
  | { status: 'success'; data: CollegeInsights }

type ActionCategory =
  | 'test'
  | 'gpa'
  | 'essay'
  | 'extracurricular'
  | 'strategy'

type ActionPriority = 'high' | 'medium' | 'low'

interface NormalizedActionStep {
  step: string
  category: ActionCategory
  priority: ActionPriority
}

const CATEGORY_COLORS: Record<ActionCategory, string> = {
  test: '#4F8CFF',
  gpa: '#10B981',
  essay: '#A78BFA',
  extracurricular: '#F97316',
  strategy: '#00BCD4',
}

const PRIORITY_COLORS: Record<ActionPriority, string> = {
  high: '#FF6467',
  medium: '#F59E0B',
  low: '#71829B',
}

const PRIORITY_LABELS: Record<ActionPriority, string> = {
  high: 'High',
  medium: 'Med',
  low: 'Low',
}

function scoreColor(score: number): string {
  if (score >= 75) return '#22C55E'
  if (score >= 50) return '#F59E0B'
  if (score >= 25) return '#F97316'
  return '#FF6467'
}

function fitColor(label: string | null, score: number | null): string {
  if (score !== null) return scoreColor(score)

  const lower = label?.toLowerCase() ?? ''
  if (lower.includes('safety')) return '#22C55E'
  if (lower.includes('target') || lower.includes('match')) return '#4F8CFF'
  if (lower.includes('reach')) return '#FF6467'
  return colors.textMuted
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function normalizeCategory(value: unknown): ActionCategory {
  const category = typeof value === 'string' ? value.toLowerCase() : ''
  if (
    category === 'test' ||
    category === 'gpa' ||
    category === 'essay' ||
    category === 'extracurricular' ||
    category === 'strategy'
  ) {
    return category
  }
  return 'strategy'
}

function normalizePriority(value: unknown): ActionPriority {
  const priority = typeof value === 'string' ? value.toLowerCase() : ''
  if (priority === 'high' || priority === 'medium' || priority === 'low') {
    return priority
  }
  return 'medium'
}

function normalizeActionSteps(data: CollegeInsights): NormalizedActionStep[] {
  const raw = (data as unknown as { actionableSteps?: unknown }).actionableSteps
  if (!Array.isArray(raw)) return []

  return raw
    .map((item): NormalizedActionStep | null => {
      if (typeof item === 'string') {
        const step = item.trim()
        return step
          ? { step, category: 'strategy', priority: 'medium' }
          : null
      }

      if (!item || typeof item !== 'object') return null

      const object = item as {
        step?: unknown
        text?: unknown
        category?: unknown
        priority?: unknown
      }

      const stepValue =
        typeof object.step === 'string'
          ? object.step
          : typeof object.text === 'string'
            ? object.text
            : ''

      const step = stepValue.trim()
      if (!step) return null

      return {
        step,
        category: normalizeCategory(object.category),
        priority: normalizePriority(object.priority),
      }
    })
    .filter((item): item is NormalizedActionStep => item !== null)
}

function formatGeneratedTime(value: string): string {
  const generatedAt = new Date(value)
  if (Number.isNaN(generatedAt.getTime())) return 'recently'

  const difference = Date.now() - generatedAt.getTime()
  const hours = Math.floor(difference / (1000 * 60 * 60))

  if (hours < 1) return 'just now'
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

function collegeLocation(item: {
  city: string | null
  state: string | null
}): string {
  return [item.city, item.state].filter(Boolean).join(', ')
}

export default function CollegesScreen(): React.JSX.Element {
  const [saved, setSaved] = useState<CollegeListItem[]>([])
  const [student, setStudent] = useState<StudentMe | null>(null)
  const [gpa, setGpa] = useState<GpaSummary | null>(null)

  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [query, setQuery] = useState('')
  const [searchResults, setSearchResults] = useState<CollegeSearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [addingUnitId, setAddingUnitId] = useState<string | null>(null)

  const [removingId, setRemovingId] = useState<number | null>(null)
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [insightStates, setInsightStates] = useState<
    Record<number, InsightState>
  >({})

  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const searchSequenceRef = useRef(0)

  const load = useCallback(async (showRefresh = false) => {
    if (showRefresh) setRefreshing(true)
    setError(null)

    try {
      const [savedResult, studentResult, gpaResult] = await Promise.all([
        collegesApi.listSavedColleges(),
        studentsApi.getMe().catch(() => null),
        gradesApi.getGpa().catch(() => null),
      ])

      setSaved(savedResult)
      setStudent(studentResult)
      setGpa(gpaResult)
    } catch (err) {
      setError(
        err instanceof ApiRequestError
          ? err.message
          : 'Could not load your college list.',
      )
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load]),
  )

  useEffect(() => {
    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    }
  }, [])

  const stats = useMemo(() => {
    const profile = student?.profile

    const portalUnweighted = finiteNumber(gpa?.unweightedGpa)
    const portalWeighted = finiteNumber(gpa?.weightedGpa)

    const unweighted =
      portalUnweighted !== null && portalUnweighted > 0
        ? portalUnweighted
        : finiteNumber(profile?.unweightedGpa)

    const weighted =
      portalWeighted !== null && portalWeighted > 0
        ? portalWeighted
        : finiteNumber(profile?.weightedGpa)

    return {
      unweighted: unweighted ?? 0,
      weighted: weighted ?? 0,
      sat: finiteNumber(profile?.satScore),
      hasAcademicData:
        (unweighted !== null && unweighted > 0) ||
        (weighted !== null && weighted > 0) ||
        finiteNumber(profile?.satScore) !== null,
    }
  }, [gpa, student])

  const addedNames = useMemo(
    () => new Set(saved.map((college) => college.name.toLowerCase())),
    [saved],
  )

  function handleSearchChange(value: string): void {
    setQuery(value)

    if (searchTimerRef.current) clearTimeout(searchTimerRef.current)

    const trimmed = value.trim()
    if (!trimmed) {
      searchSequenceRef.current += 1
      setSearchResults([])
      setSearching(false)
      return
    }

    setSearching(true)
    const sequence = ++searchSequenceRef.current

    searchTimerRef.current = setTimeout(() => {
      void collegesApi
        .searchColleges(trimmed)
        .then((results) => {
          if (searchSequenceRef.current === sequence) {
            setSearchResults(results.slice(0, 8))
          }
        })
        .catch(() => {
          if (searchSequenceRef.current === sequence) {
            setSearchResults([])
          }
        })
        .finally(() => {
          if (searchSequenceRef.current === sequence) {
            setSearching(false)
          }
        })
    }, 300)
  }

  function clearSearch(): void {
    searchSequenceRef.current += 1
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    setQuery('')
    setSearchResults([])
    setSearching(false)
  }

  async function handleAdd(result: CollegeSearchResult): Promise<void> {
    if (addedNames.has(result.name.toLowerCase()) || addingUnitId !== null) return

    setAddingUnitId(result.unitId)
    setError(null)

    try {
      const added = await collegesApi.addCollege({
        name: result.name,
        scorecardUnitId: result.unitId,
      })

      setSaved((current) => [...current, added])
      clearSearch()
    } catch (err) {
      setError(
        err instanceof ApiRequestError
          ? err.message
          : 'Could not add this college.',
      )
    } finally {
      setAddingUnitId(null)
    }
  }

  function requestRemove(item: CollegeListItem): void {
    Alert.alert(
      'Remove college?',
      `${item.name} will be removed from your college list.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => void handleRemove(item),
        },
      ],
    )
  }

  async function handleRemove(item: CollegeListItem): Promise<void> {
    if (removingId !== null) return

    const previous = saved
    setRemovingId(item.id)
    setSaved((current) => current.filter((college) => college.id !== item.id))

    try {
      await collegesApi.removeCollege(item.id)
      if (expandedId === item.id) setExpandedId(null)
      setInsightStates((current) => {
        const next = { ...current }
        delete next[item.id]
        return next
      })
    } catch {
      setSaved(previous)
      setError('Could not remove this college. Please try again.')
    } finally {
      setRemovingId(null)
    }
  }

  async function fetchInsights(item: CollegeListItem): Promise<void> {
    setInsightStates((current) => ({
      ...current,
      [item.id]: { status: 'loading' },
    }))

    try {
      const data = await collegesApi.getCollegeInsights(item.id)
      setInsightStates((current) => ({
        ...current,
        [item.id]: { status: 'success', data },
      }))
    } catch (err) {
      const message =
        err instanceof ApiRequestError
          ? err.message
          : 'AI insights are unavailable right now.'

      setInsightStates((current) => ({
        ...current,
        [item.id]: {
          status: 'error',
          message,
          retryable:
            !(err instanceof ApiRequestError) ||
            err.status === 408 ||
            err.status === 429 ||
            err.status >= 500,
        },
      }))
    }
  }

  function toggleInsights(item: CollegeListItem): void {
    if (expandedId === item.id) {
      setExpandedId(null)
      return
    }

    setExpandedId(item.id)
    if (!insightStates[item.id]) void fetchInsights(item)
  }

  // Deps mirror everything toggleInsights/requestRemove/fetchInsights actually read
  // from closure (expandedId, insightStates, removingId, saved) so the memoized
  // renderItem never captures stale state — it just stays stable across unrelated
  // re-renders (search typing, addingUnitId, etc.) instead of on every keystroke.
  const renderCollegeCard = useCallback(
    ({ item }: { item: CollegeListItem }) => (
      <CollegeCard
        item={item}
        expanded={expandedId === item.id}
        insightState={insightStates[item.id]}
        removing={removingId === item.id}
        onToggle={() => toggleInsights(item)}
        onRemove={() => requestRemove(item)}
        onRetry={() => void fetchInsights(item)}
      />
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [expandedId, insightStates, removingId, saved],
  )

  if (loading) {
    return (
      <Screen edges={['top', 'left', 'right', 'bottom']}>
        <View style={styles.loadingWrap}>
          <LoadingSkeleton rows={5} rowHeight={84} />
        </View>
      </Screen>
    )
  }

  return (
    <Screen edges={['top', 'left', 'right', 'bottom']} padded={false}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <FlatList
          style={styles.flex}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void load(true)}
              tintColor={colors.primary}
              colors={[colors.primary]}
            />
          }
          data={saved}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderCollegeCard}
          ItemSeparatorComponent={() => <View style={styles.collegeCardGap} />}
          ListEmptyComponent={
            <View style={styles.emptyCard}>
              <View style={styles.emptyIcon}>
                <Feather name="bookmark" size={24} color="#A78BFA" />
              </View>
              <Text allowFontScaling={false} style={styles.emptyTitle}>
                No colleges added yet
              </Text>
              <Text style={styles.emptyDescription}>
                Search above and add schools you want to compare. Your
                personalized fit scores will appear here.
              </Text>
            </View>
          }
          ListHeaderComponent={
            <View style={styles.collegeListHeaderWrap}>
          <View style={styles.pageHeader}>
            <View style={styles.pageHeaderIcon}>
              <Feather name="bookmark" size={20} color="#BCA8FF" />
            </View>

            <View style={styles.pageHeaderCopy}>
              <Text allowFontScaling={false} style={styles.eyebrow}>
                COLLEGE PLANNING
              </Text>
              <Text allowFontScaling={false} style={styles.title}>
                College List
              </Text>
              <Text allowFontScaling={false} style={styles.subtitle}>
                Search, compare and build a balanced application strategy.
              </Text>
            </View>
          </View>

          <View style={styles.statsCard}>
            <View style={styles.statsRow}>
              <StatItem
                label="Unweighted GPA"
                value={stats.unweighted.toFixed(3)}
              />
              <View style={styles.statDivider} />
              <StatItem
                label="Weighted GPA"
                value={stats.weighted.toFixed(3)}
              />
            </View>

            <View style={styles.statsHorizontalDivider} />

            <View style={styles.statsRow}>
              <StatItem label="Your SAT" value={stats.sat?.toString() ?? '—'} />
              <View style={styles.statDivider} />
              <StatItem label="Colleges Added" value={String(saved.length)} />
            </View>
          </View>

          {!stats.hasAcademicData ? (
            <View style={styles.noticeCard}>
              <View style={styles.noticeIcon}>
                <Feather name="info" size={16} color="#F9B84C" />
              </View>
              <Text style={styles.noticeText}>
                Add your GPA and SAT score in Settings to receive more accurate
                likelihood scores and AI recommendations.
              </Text>
            </View>
          ) : null}

          <View style={styles.searchSection}>
            <Text allowFontScaling={false} style={styles.sectionEyebrow}>
              FIND COLLEGES
            </Text>
            <Text allowFontScaling={false} style={styles.sectionTitle}>
              Search schools
            </Text>

            <View style={styles.searchBar}>
              <Feather name="search" size={18} color="#7588A5" />
              <TextInput
                value={query}
                onChangeText={handleSearchChange}
                placeholder="Search colleges..."
                placeholderTextColor="#60708A"
                style={styles.searchInput}
                autoCapitalize="words"
                autoCorrect={false}
                returnKeyType="search"
                accessibilityLabel="Search colleges"
              />

              {searching ? (
                <ActivityIndicator size="small" color="#A78BFA" />
              ) : query.length > 0 ? (
                <Pressable
                  onPress={clearSearch}
                  style={({ pressed }) => [
                    styles.clearButton,
                    pressed && styles.pressed,
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel="Clear college search"
                >
                  <Feather name="x" size={16} color="#93A1B8" />
                </Pressable>
              ) : null}
            </View>

            {query.trim().length > 0 && !searching ? (
              <View style={styles.searchResultsCard}>
                {searchResults.length > 0 ? (
                  searchResults.map((result, index) => {
                    const alreadyAdded = addedNames.has(
                      result.name.toLowerCase(),
                    )
                    const resultScore = finiteNumber(result.score)
                    const color =
                      resultScore !== null
                        ? scoreColor(resultScore)
                        : fitColor(result.label, null)

                    return (
                      <View
                        key={result.unitId}
                        style={[
                          styles.searchResultRow,
                          index < searchResults.length - 1 &&
                            styles.searchResultDivider,
                        ]}
                      >
                        <View
                          style={[
                            styles.searchSchoolIcon,
                            { borderColor: `${color}55` },
                          ]}
                        >
                          <Feather name="book-open" size={17} color={color} />
                        </View>

                        <View style={styles.searchResultCopy}>
                          <Text
                            allowFontScaling={false}
                            style={styles.searchResultName}
                            numberOfLines={1}
                          >
                            {result.name}
                          </Text>
                          <Text
                            allowFontScaling={false}
                            style={styles.searchResultMeta}
                            numberOfLines={1}
                          >
                            {collegeLocation(result) || 'College'}
                            {result.admissionRate !== null
                              ? ` · ${Math.round(
                                  result.admissionRate * 100,
                                )}% admit`
                              : ''}
                          </Text>
                        </View>

                        {resultScore !== null ? (
                          <Text
                            allowFontScaling={false}
                            style={[
                              styles.searchResultScore,
                              { color },
                            ]}
                          >
                            {Math.round(resultScore)}
                          </Text>
                        ) : null}

                        <Pressable
                          disabled={alreadyAdded || addingUnitId !== null}
                          onPress={() => void handleAdd(result)}
                          style={({ pressed }) => [
                            styles.addButton,
                            alreadyAdded && styles.addedButton,
                            pressed &&
                              !alreadyAdded &&
                              styles.addButtonPressed,
                          ]}
                          accessibilityRole="button"
                          accessibilityLabel={
                            alreadyAdded
                              ? `${result.name} is already added`
                              : `Add ${result.name}`
                          }
                        >
                          {addingUnitId === result.unitId ? (
                            <ActivityIndicator
                              size="small"
                              color="#FFFFFF"
                            />
                          ) : alreadyAdded ? (
                            <Feather name="check" size={16} color="#78D9B8" />
                          ) : (
                            <Feather name="plus" size={17} color="#FFFFFF" />
                          )}
                        </Pressable>
                      </View>
                    )
                  })
                ) : (
                  <View style={styles.noSearchResults}>
                    <Feather name="search" size={19} color="#718099" />
                    <Text style={styles.noSearchResultsText}>
                      No colleges found for “{query.trim()}”.
                    </Text>
                  </View>
                )}
              </View>
            ) : null}
          </View>

          {error ? (
            <View style={styles.errorCard}>
              <Feather name="alert-circle" size={16} color={colors.error} />
              <Text style={styles.errorText}>{error}</Text>
              <Pressable
                onPress={() => setError(null)}
                style={styles.errorClose}
                accessibilityRole="button"
                accessibilityLabel="Dismiss error"
              >
                <Feather name="x" size={15} color="#AAB7CB" />
              </Pressable>
            </View>
          ) : null}

          <View style={styles.listHeader}>
            <View>
              <Text allowFontScaling={false} style={styles.sectionEyebrow}>
                YOUR COLLEGE LIST
              </Text>
              <Text allowFontScaling={false} style={styles.sectionTitle}>
                Schools you’re tracking
              </Text>
            </View>

            <View style={styles.countBadge}>
              <Text allowFontScaling={false} style={styles.countBadgeText}>
                {saved.length}
              </Text>
            </View>
          </View>
            </View>
          }
        />
      </KeyboardAvoidingView>
    </Screen>
  )
}

interface StatItemProps {
  label: string
  value: string
}

function StatItem({ label, value }: StatItemProps): React.JSX.Element {
  return (
    <View style={styles.statItem}>
      <Text allowFontScaling={false} style={styles.statLabel}>
        {label}
      </Text>
      <Text allowFontScaling={false} style={styles.statValue}>
        {value}
      </Text>
    </View>
  )
}

interface CollegeCardProps {
  item: CollegeListItem
  expanded: boolean
  insightState: InsightState | undefined
  removing: boolean
  onToggle: () => void
  onRemove: () => void
  onRetry: () => void
}

const CollegeCard = React.memo(function CollegeCard({
  item,
  expanded,
  insightState,
  removing,
  onToggle,
  onRemove,
  onRetry,
}: CollegeCardProps): React.JSX.Element {
  const score = finiteNumber(item.score)
  const color = fitColor(item.label, score)
  const location = collegeLocation(item)
  const progressWidth = `${Math.max(0, Math.min(score ?? 0, 100))}%` as const

  return (
    <View
      style={[
        styles.collegeCard,
        expanded && styles.collegeCardExpanded,
      ]}
    >
      <Pressable
        onPress={onToggle}
        style={({ pressed }) => [
          styles.collegeMain,
          pressed && styles.collegeMainPressed,
        ]}
        accessibilityRole="button"
        accessibilityLabel={`${expanded ? 'Collapse' : 'Expand'} AI insights for ${item.name}`}
      >
        <View style={styles.collegeMainContent}>
          <View style={styles.collegeTopRow}>
          <View style={[styles.collegeIcon, { borderColor: `${color}55` }]}>
            <Feather name="map-pin" size={18} color={color} />
          </View>

          <View style={styles.collegeCopy}>
            <Text
              allowFontScaling={false}
              style={styles.collegeName}
              numberOfLines={2}
            >
              {item.name}
            </Text>
            {location ? (
              <Text
                allowFontScaling={false}
                style={styles.collegeLocation}
                numberOfLines={1}
              >
                {location}
              </Text>
            ) : null}
          </View>

          <View style={styles.collegeActions}>
            <Pressable
              disabled={removing}
              onPress={(event) => {
                event.stopPropagation()
                onRemove()
              }}
              style={({ pressed }) => [
                styles.removeIconButton,
                pressed && styles.removeIconButtonPressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel={`Remove ${item.name}`}
            >
              {removing ? (
                <ActivityIndicator size="small" color="#FF8B8E" />
              ) : (
                <Feather name="trash-2" size={15} color="#FF8588" />
              )}
            </Pressable>

            <View style={styles.expandButton}>
              <Feather
                name={expanded ? 'chevron-up' : 'chevron-down'}
                size={17}
                color="#869AB8"
              />
            </View>
          </View>
        </View>

        <View style={styles.fitRow}>
          <View style={styles.fitCopy}>
            <Text allowFontScaling={false} style={styles.fitEyebrow}>
              LIKELIHOOD
            </Text>
            <View style={styles.fitLabelRow}>
              <View style={[styles.fitDot, { backgroundColor: color }]} />
              <Text
                allowFontScaling={false}
                style={[styles.fitLabel, { color }]}
              >
                {item.label ?? (score !== null ? 'College fit' : 'Add GPA & SAT')}
              </Text>
            </View>
          </View>

          <View style={styles.scoreBox}>
            {score !== null ? (
              <>
                <Text
                  allowFontScaling={false}
                  style={[styles.scoreValue, { color }]}
                >
                  {Math.round(score)}
                </Text>
                <Text allowFontScaling={false} style={styles.scoreOutOf}>
                  /100
                </Text>
              </>
            ) : (
              <>
                <Text
                  allowFontScaling={false}
                  style={styles.noScoreValue}
                >
                  —
                </Text>
                <Text allowFontScaling={false} style={styles.scoreOutOf}>
                  no score
                </Text>
              </>
            )}
          </View>
        </View>

        <View style={styles.progressTrack}>
          <View
            style={[
              styles.progressFill,
              { width: progressWidth, backgroundColor: color },
            ]}
          />
        </View>

          {!expanded ? (
            <View style={styles.insightHint}>
              <Feather name="zap" size={13} color="#A994FF" />
              <Text allowFontScaling={false} style={styles.insightHintText}>
                Tap to view personalized AI fit insights
              </Text>
            </View>
          ) : null}
        </View>
      </Pressable>

      {expanded ? (
        <View style={styles.insightsPanel}>
          <View style={styles.insightsDivider} />
          <InsightContent state={insightState} onRetry={onRetry} />
        </View>
      ) : null}
    </View>
  )
})

interface InsightContentProps {
  state: InsightState | undefined
  onRetry: () => void
}

function InsightContent({
  state,
  onRetry,
}: InsightContentProps): React.JSX.Element {
  if (!state || state.status === 'loading') {
    return (
      <View style={styles.insightLoading}>
        <View style={styles.aiLoadingHeader}>
          <View style={styles.aiIcon}>
            <Feather name="zap" size={15} color="#BDAAFF" />
          </View>
          <View style={styles.aiLoadingCopy}>
            <Text style={styles.aiLoadingTitle}>Building your fit analysis</Text>
            <Text style={styles.aiLoadingSubtitle}>
              Reviewing your profile and admissions data...
            </Text>
          </View>
          <ActivityIndicator size="small" color="#A78BFA" />
        </View>

        <LoadingSkeleton rows={3} rowHeight={54} />
      </View>
    )
  }

  if (state.status === 'error') {
    return (
      <View style={styles.insightErrorCard}>
        <View style={styles.insightErrorIcon}>
          <Feather name="alert-triangle" size={18} color="#F9B84C" />
        </View>
        <View style={styles.insightErrorCopy}>
          <Text style={styles.insightErrorTitle}>
            Couldn’t load AI insights
          </Text>
          <Text style={styles.insightErrorMessage}>{state.message}</Text>
        </View>

        {state.retryable ? (
          <Pressable
            onPress={onRetry}
            style={({ pressed }) => [
              styles.retryButton,
              pressed && styles.pressed,
            ]}
          >
            <Feather name="refresh-cw" size={14} color="#C8BAFF" />
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        ) : null}
      </View>
    )
  }

  const { data } = state
  const steps = normalizeActionSteps(data)

  return (
    <View style={styles.insightContent}>
      <View style={styles.aiInsightHeader}>
        <View style={styles.aiIcon}>
          <Feather name="zap" size={15} color="#BDAAFF" />
        </View>
        <View style={styles.aiInsightHeaderCopy}>
          <Text allowFontScaling={false} style={styles.aiInsightEyebrow}>
            MYFUTURELY AI
          </Text>
          <Text allowFontScaling={false} style={styles.aiInsightTitle}>
            Personalized fit analysis
          </Text>
        </View>
      </View>

      <Text style={styles.narrative}>{data.narrativeSummary}</Text>

      {steps.length > 0 ? (
        <View style={styles.actionSection}>
          <Text allowFontScaling={false} style={styles.actionSectionLabel}>
            ACTION STEPS
          </Text>

          <View style={styles.actionList}>
            {steps.map((step, index) => {
              const categoryColor = CATEGORY_COLORS[step.category]
              const priorityColor = PRIORITY_COLORS[step.priority]

              return (
                <View
                  key={`${step.category}-${index}`}
                  style={styles.actionCard}
                >
                  <View style={styles.actionBadges}>
                    <View
                      style={[
                        styles.categoryBadge,
                        {
                          backgroundColor: `${categoryColor}18`,
                          borderColor: `${categoryColor}55`,
                        },
                      ]}
                    >
                      <Text
                        allowFontScaling={false}
                        style={[
                          styles.categoryBadgeText,
                          { color: categoryColor },
                        ]}
                      >
                        {step.category.toUpperCase()}
                      </Text>
                    </View>

                    <View
                      style={[
                        styles.priorityBadge,
                        {
                          backgroundColor: `${priorityColor}14`,
                          borderColor: `${priorityColor}55`,
                        },
                      ]}
                    >
                      <Text
                        allowFontScaling={false}
                        style={[
                          styles.priorityBadgeText,
                          { color: priorityColor },
                        ]}
                      >
                        {PRIORITY_LABELS[step.priority]}
                      </Text>
                    </View>
                  </View>

                  <Text style={styles.actionText}>{step.step}</Text>
                </View>
              )
            })}
          </View>
        </View>
      ) : null}

      <View style={styles.insightMeta}>
        <Feather name="clock" size={12} color="#667A98" />
        <Text allowFontScaling={false} style={styles.insightMetaText}>
          Generated {formatGeneratedTime(data.generatedAt)}
        </Text>
        {data.cached ? (
          <View style={styles.cachedBadge}>
            <Text allowFontScaling={false} style={styles.cachedBadgeText}>
              cached
            </Text>
          </View>
        ) : null}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  loadingWrap: {
    flex: 1,
    paddingTop: spacing.lg,
  },
  scrollContent: {
    paddingHorizontal: spacing.screenPadding,
    paddingTop: spacing.md,
    paddingBottom: spacing.huge,
  },
  // FlatList's ListHeaderComponent renders as a sibling of each list item inside
  // contentContainerStyle, not a nested child — so the 24px inter-section gap that
  // used to come from scrollContent's own `gap` now lives here (between the header's
  // internal blocks) plus a trailing marginBottom (between the header and the first
  // card/empty-state), while ItemSeparatorComponent (collegeCardGap) owns the tighter
  // 13px gap between individual cards.
  collegeListHeaderWrap: {
    gap: spacing.lg,
    marginBottom: spacing.lg,
  },
  pressed: {
    opacity: 0.82,
  },

  pageHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  pageHeaderIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1F1650',
    borderWidth: 1,
    borderColor: 'rgba(167,139,250,0.32)',
  },
  pageHeaderCopy: {
    flex: 1,
    minWidth: 0,
  },
  eyebrow: {
    color: '#7893BC',
    fontFamily: fonts.bold,
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1.2,
  },
  title: {
    marginTop: 2,
    color: colors.text,
    fontFamily: fonts.bold,
    fontSize: 25,
    lineHeight: 30,
    fontWeight: '700',
    letterSpacing: -0.45,
  },
  subtitle: {
    marginTop: 4,
    color: '#8999B1',
    fontFamily: fonts.regular,
    fontSize: 11.5,
    lineHeight: 17,
  },

  statsCard: {
    overflow: 'hidden',
    borderRadius: 20,
    backgroundColor: '#111C2D',
    borderWidth: 1,
    borderColor: '#29425F',
    ...elevation.sm,
  },
  statsRow: {
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'center',
  },
  statItem: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingHorizontal: 8,
  },
  statLabel: {
    color: '#7085A5',
    fontFamily: fonts.bold,
    fontSize: 8.5,
    fontWeight: '700',
    letterSpacing: 0.75,
    textTransform: 'uppercase',
    textAlign: 'center',
  },
  statValue: {
    color: '#F2F5FF',
    fontFamily: fonts.bold,
    fontSize: 20,
    lineHeight: 24,
    fontWeight: '700',
    letterSpacing: -0.4,
  },
  statDivider: {
    width: 1,
    height: 38,
    backgroundColor: '#2B405D',
  },
  statsHorizontalDivider: {
    height: 1,
    backgroundColor: '#263A55',
  },

  noticeCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    padding: 12,
    borderRadius: 15,
    backgroundColor: 'rgba(245,158,11,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(245,158,11,0.24)',
  },
  noticeIcon: {
    width: 30,
    height: 30,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    backgroundColor: 'rgba(245,158,11,0.12)',
  },
  noticeText: {
    flex: 1,
    color: '#A9A18D',
    fontFamily: fonts.regular,
    fontSize: 10.5,
    lineHeight: 15.5,
  },

  searchSection: {
    gap: 9,
  },
  sectionEyebrow: {
    color: '#7893BC',
    fontFamily: fonts.bold,
    fontSize: 8.5,
    fontWeight: '700',
    letterSpacing: 1.15,
  },
  sectionTitle: {
    color: '#F2F5FF',
    fontFamily: fonts.bold,
    fontSize: 18,
    lineHeight: 22,
    fontWeight: '700',
    letterSpacing: -0.25,
  },
  searchBar: {
    minHeight: 50,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 13,
    borderRadius: 15,
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: '#2A3E5B',
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    paddingVertical: 0,
    color: '#F2F5FF',
    fontFamily: fonts.regular,
    fontSize: 13,
  },
  clearButton: {
    width: 30,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    backgroundColor: '#17243A',
  },
  searchResultsCard: {
    overflow: 'hidden',
    borderRadius: 16,
    backgroundColor: '#101A2A',
    borderWidth: 1,
    borderColor: '#273D5A',
    ...elevation.md,
  },
  searchResultRow: {
    minHeight: 67,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  searchResultDivider: {
    borderBottomWidth: 1,
    borderBottomColor: '#22354E',
  },
  searchSchoolIcon: {
    width: 37,
    height: 37,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    backgroundColor: '#14243A',
    borderWidth: 1,
  },
  searchResultCopy: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  searchResultName: {
    color: '#F2F5FF',
    fontFamily: fonts.semiBold,
    fontSize: 11.5,
    lineHeight: 15,
    fontWeight: '600',
  },
  searchResultMeta: {
    color: '#7F90A9',
    fontFamily: fonts.regular,
    fontSize: 9,
    lineHeight: 12,
  },
  searchResultScore: {
    minWidth: 25,
    textAlign: 'right',
    fontFamily: fonts.bold,
    fontSize: 15,
    fontWeight: '700',
  },
  addButton: {
    width: 36,
    height: 36,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    backgroundColor: colors.primary,
  },
  addButtonPressed: {
    opacity: 0.82,
    transform: [{ scale: 0.97 }],
  },
  addedButton: {
    backgroundColor: 'rgba(16,185,129,0.13)',
    borderWidth: 1,
    borderColor: 'rgba(16,185,129,0.32)',
  },
  noSearchResults: {
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 14,
  },
  noSearchResultsText: {
    color: '#8392A8',
    fontFamily: fonts.regular,
    fontSize: 10.5,
  },

  errorCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    padding: 11,
    borderRadius: 14,
    backgroundColor: 'rgba(255,100,103,0.09)',
    borderWidth: 1,
    borderColor: 'rgba(255,100,103,0.26)',
  },
  errorText: {
    flex: 1,
    color: '#F0A5A7',
    fontFamily: fonts.regular,
    fontSize: 10.5,
    lineHeight: 15,
  },
  errorClose: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },

  listHeader: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 12,
  },
  countBadge: {
    minWidth: 35,
    height: 27,
    paddingHorizontal: 9,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
    backgroundColor: '#231151',
    borderWidth: 1,
    borderColor: 'rgba(127,34,254,0.42)',
  },
  countBadgeText: {
    color: '#C8B7FF',
    fontFamily: fonts.bold,
    fontSize: 10.5,
    fontWeight: '700',
  },

  emptyCard: {
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 34,
    borderRadius: 20,
    backgroundColor: '#0E1725',
    borderWidth: 1,
    borderColor: '#253A56',
  },
  emptyIcon: {
    width: 52,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 17,
    backgroundColor: '#211653',
  },
  emptyTitle: {
    marginTop: 13,
    color: '#F2F5FF',
    fontFamily: fonts.bold,
    fontSize: 15,
    fontWeight: '700',
  },
  emptyDescription: {
    maxWidth: 280,
    marginTop: 6,
    color: '#8191A8',
    fontFamily: fonts.regular,
    fontSize: 10.5,
    lineHeight: 15.5,
    textAlign: 'center',
  },

  collegeCardGap: {
    height: 13,
  },
  collegeCard: {
    overflow: 'hidden',
    borderRadius: 20,
    backgroundColor: '#111D30',
    borderWidth: 1,
    borderColor: '#2A4261',
    ...elevation.sm,
  },
  collegeCardExpanded: {
    borderColor: 'rgba(151,119,255,0.48)',
  },
  collegeMain: {
    width: '100%',
  },
  collegeMainContent: {
    paddingHorizontal: 17,
    paddingTop: 16,
    paddingBottom: 15,
  },
  collegeMainPressed: {
    backgroundColor: '#15243A',
  },
  collegeTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  collegeIcon: {
    width: 39,
    height: 39,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 13,
    backgroundColor: '#15243A',
    borderWidth: 1,
  },
  collegeCopy: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  collegeName: {
    color: '#F4F7FF',
    fontFamily: fonts.bold,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '700',
    letterSpacing: -0.15,
  },
  collegeLocation: {
    color: '#7F91AC',
    fontFamily: fonts.regular,
    fontSize: 9.5,
    lineHeight: 13,
  },
  collegeActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  removeIconButton: {
    width: 31,
    height: 31,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    backgroundColor: 'rgba(255,100,103,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,100,103,0.21)',
  },
  removeIconButtonPressed: {
    opacity: 0.8,
    backgroundColor: 'rgba(255,100,103,0.15)',
  },
  expandButton: {
    width: 31,
    height: 31,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    backgroundColor: '#0B1625',
    borderWidth: 1,
    borderColor: '#263D5A',
  },
  fitRow: {
    marginTop: 15,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 12,
  },
  fitCopy: {
    flex: 1,
    minWidth: 0,
    gap: 5,
  },
  fitEyebrow: {
    color: '#677B99',
    fontFamily: fonts.bold,
    fontSize: 8,
    fontWeight: '700',
    letterSpacing: 0.9,
  },
  fitLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  fitDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  fitLabel: {
    flex: 1,
    fontFamily: fonts.semiBold,
    fontSize: 10.5,
    fontWeight: '600',
  },
  scoreBox: {
    minWidth: 53,
    alignItems: 'flex-end',
    paddingRight: 1,
  },
  scoreValue: {
    fontFamily: fonts.bold,
    fontSize: 27,
    lineHeight: 29,
    fontWeight: '700',
    letterSpacing: -0.8,
  },
  noScoreValue: {
    color: '#7385A0',
    fontFamily: fonts.bold,
    fontSize: 25,
    lineHeight: 28,
    fontWeight: '700',
  },
  scoreOutOf: {
    color: '#667995',
    fontFamily: fonts.regular,
    fontSize: 8.5,
    lineHeight: 11,
  },
  progressTrack: {
    height: 6,
    marginTop: 9,
    overflow: 'hidden',
    borderRadius: 99,
    backgroundColor: '#1E3049',
  },
  progressFill: {
    height: '100%',
    borderRadius: 99,
  },
  insightHint: {
    marginTop: 11,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  insightHintText: {
    color: '#8E9DB3',
    fontFamily: fonts.medium,
    fontSize: 9,
    fontWeight: '500',
  },

  insightsPanel: {
    paddingHorizontal: 17,
    paddingBottom: 16,
  },
  insightsDivider: {
    height: 1,
    marginBottom: 14,
    backgroundColor: '#2A3F5B',
  },
  insightLoading: {
    gap: 13,
  },
  aiLoadingHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  aiIcon: {
    width: 34,
    height: 34,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 11,
    backgroundColor: '#24175A',
    borderWidth: 1,
    borderColor: 'rgba(167,139,250,0.34)',
  },
  aiLoadingCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  aiLoadingTitle: {
    color: '#F0F3FC',
    fontFamily: fonts.semiBold,
    fontSize: 11,
    fontWeight: '600',
  },
  aiLoadingSubtitle: {
    color: '#7789A4',
    fontFamily: fonts.regular,
    fontSize: 8.5,
  },

  insightErrorCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    padding: 11,
    borderRadius: 14,
    backgroundColor: 'rgba(245,158,11,0.07)',
    borderWidth: 1,
    borderColor: 'rgba(245,158,11,0.20)',
  },
  insightErrorIcon: {
    width: 34,
    height: 34,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 11,
    backgroundColor: 'rgba(245,158,11,0.10)',
  },
  insightErrorCopy: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  insightErrorTitle: {
    color: '#F3E6C7',
    fontFamily: fonts.semiBold,
    fontSize: 10.5,
    fontWeight: '600',
  },
  insightErrorMessage: {
    color: '#A99A7F',
    fontFamily: fonts.regular,
    fontSize: 8.5,
    lineHeight: 12,
  },
  retryButton: {
    minHeight: 32,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 9,
    borderRadius: 10,
    backgroundColor: '#1D1640',
    borderWidth: 1,
    borderColor: 'rgba(167,139,250,0.28)',
  },
  retryText: {
    color: '#C8BAFF',
    fontFamily: fonts.semiBold,
    fontSize: 9,
    fontWeight: '600',
  },

  insightContent: {
    gap: 14,
  },
  aiInsightHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  aiInsightHeaderCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  aiInsightEyebrow: {
    color: '#9D89E8',
    fontFamily: fonts.bold,
    fontSize: 7.5,
    fontWeight: '700',
    letterSpacing: 0.85,
  },
  aiInsightTitle: {
    color: '#F3F5FD',
    fontFamily: fonts.semiBold,
    fontSize: 11.5,
    fontWeight: '600',
  },
  narrative: {
    color: '#A6B5CB',
    fontFamily: fonts.regular,
    fontSize: 10.5,
    lineHeight: 16.5,
  },
  actionSection: {
    gap: 9,
  },
  actionSectionLabel: {
    color: '#7185A4',
    fontFamily: fonts.bold,
    fontSize: 8,
    fontWeight: '700',
    letterSpacing: 0.95,
  },
  actionList: {
    gap: 8,
  },
  actionCard: {
    gap: 8,
    padding: 11,
    borderRadius: 13,
    backgroundColor: '#172943',
    borderWidth: 1,
    borderColor: '#294665',
  },
  actionBadges: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  categoryBadge: {
    maxWidth: '70%',
    paddingHorizontal: 7,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
  },
  categoryBadgeText: {
    fontFamily: fonts.bold,
    fontSize: 7.5,
    fontWeight: '700',
    letterSpacing: 0.45,
  },
  priorityBadge: {
    paddingHorizontal: 7,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
  },
  priorityBadgeText: {
    fontFamily: fonts.bold,
    fontSize: 7.5,
    fontWeight: '700',
  },
  actionText: {
    color: '#E7EBF5',
    fontFamily: fonts.regular,
    fontSize: 10,
    lineHeight: 15.5,
  },
  insightMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  insightMetaText: {
    color: '#667A98',
    fontFamily: fonts.regular,
    fontSize: 8.5,
  },
  cachedBadge: {
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: '#2C435F',
  },
  cachedBadgeText: {
    color: '#72849E',
    fontFamily: fonts.medium,
    fontSize: 7.5,
    fontWeight: '500',
  },
})
