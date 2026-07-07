// CollegesScreen — college search (College Scorecard API), saved-list management,
// and on-demand AI-generated admission insights per card.
//
// Data sources:
//   - Search: GET /colleges/search?q=...     (searchColleges) — includes a
//     personalised likelihood score/label computed server-side from the
//     student's own SAT/GPA. Callers never send stats themselves.
//   - Saved list: GET/POST/DELETE /colleges  (listColleges / addCollege / removeCollege)
//     — list items already carry score/label, no separate lookup needed.
//   - Insights: GET /colleges/:id/insights   (getCollegeInsights) — ON-DEMAND ONLY,
//     fetched the first time a card is expanded, then cached for the session.

import React, { useState, useCallback, useEffect, useRef } from 'react'
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  StyleSheet,
  LayoutAnimation,
  Platform,
  UIManager,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useTheme } from '../theme/ThemeContext'
import { useAuth } from '../context/AuthContext'
import { ApiRequestError } from '../api/client'
import {
  listColleges,
  searchColleges,
  addCollege,
  removeCollege,
  getCollegeInsights,
  type CollegeListItem,
  type CollegeSearchResult,
  type CollegeInsights,
} from '../api/collegesApi'
import { getMe, type StudentMe } from '../api/studentsApi'
import { getGpa, type GpaResponse } from '../api/gradesApi'

// Enable LayoutAnimation on Android
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true)
}

// ── Score helpers ──────────────────────────────────────────────────────────────

function scoreColor(score: number): string {
  if (score >= 75) return '#22C55E'
  if (score >= 50) return '#F59E0B'
  if (score >= 25) return '#F97316'
  return '#EF4444'
}

// ── Insights state ─────────────────────────────────────────────────────────────

type InsightState =
  | { status: 'loading' }
  | { status: 'error-404' }
  | { status: 'error-503' }
  | { status: 'success'; data: CollegeInsights }

// ── Utility ────────────────────────────────────────────────────────────────────

function extractErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiRequestError) return err.message
  if (err instanceof Error) return err.message
  return fallback
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function CollegesScreen(): React.JSX.Element {
  const { theme } = useTheme()
  const { accessToken } = useAuth()
  const c = theme.colors
  const s = theme.spacing

  // Saved list state
  const [list, setList]               = useState<CollegeListItem[]>([])
  const [loadingList, setLoadingList] = useState(true)
  const [listError, setListError]     = useState<string | null>(null)

  // Student stats (display only — scoring itself is computed server-side)
  const [studentMe, setStudentMe]     = useState<StudentMe | null>(null)
  const [portalGpa, setPortalGpa]     = useState<GpaResponse | null>(null)
  const [statsLoaded, setStatsLoaded] = useState(false)

  // Search
  const [query, setQuery]                 = useState('')
  const [suggestions, setSuggestions]     = useState<CollegeSearchResult[]>([])
  const [showDropdown, setShowDropdown]   = useState(false)
  const [searchLoading, setSearchLoading] = useState(false)
  const debounceRef  = useRef<ReturnType<typeof setTimeout> | null>(null)
  const blurTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Per-item state
  const [addingName, setAddingName] = useState<string | null>(null)
  const [removingId, setRemovingId] = useState<number | null>(null)

  // ── Insights state (on-demand, expand-to-fetch) ───────────────────────────────
  const [expandedId, setExpandedId]       = useState<number | null>(null)
  const [insightsCache, setInsightsCache] = useState<Record<number, InsightState>>({})

  // ── Derived stats ─────────────────────────────────────────────────────────────

  const unweightedGpa: number | null = statsLoaded
    ? ((portalGpa?.unweightedGpa ?? 0) > 0
        ? portalGpa!.unweightedGpa
        : (studentMe?.profile?.unweightedGpa ?? null))
    : null
  const weightedGpa: number | null = statsLoaded
    ? ((portalGpa?.weightedGpa ?? 0) > 0
        ? portalGpa!.weightedGpa
        : (studentMe?.profile?.weightedGpa ?? null))
    : null
  const studentSAT: number | null = statsLoaded ? (studentMe?.profile?.satScore ?? null) : null
  const hasStats = statsLoaded && ((unweightedGpa && unweightedGpa > 0) || (studentSAT && studentSAT > 0))

  const addedNames = new Set(list.map(l => l.name))

  // ── Load data ────────────────────────────────────────────────────────────────

  const loadAll = useCallback(async (): Promise<void> => {
    if (!accessToken) return
    setLoadingList(true)
    setListError(null)
    try {
      const colleges = await listColleges(accessToken)
      setList(colleges)
    } catch (err: unknown) {
      setListError(extractErrorMessage(err, 'Failed to load your college list.'))
    } finally {
      setLoadingList(false)
    }

    // Load stats in parallel — non-fatal, display only
    void Promise.all([
      getMe(accessToken).catch(() => null),
      getGpa(accessToken).catch(() => null),
    ]).then(([me, gpa]) => {
      setStudentMe(me)
      setPortalGpa(gpa)
      setStatsLoaded(true)
    }).catch(() => {
      setStatsLoaded(true)
    })
  }, [accessToken])

  useEffect(() => {
    void loadAll()
    return () => {
      if (debounceRef.current !== null) clearTimeout(debounceRef.current)
      if (blurTimerRef.current !== null) clearTimeout(blurTimerRef.current)
    }
  }, [loadAll])

  // ── Debounced search ───────────────────────────────────────────────────────────

  const handleQueryChange = useCallback((value: string): void => {
    setQuery(value)
    setShowDropdown(true)

    if (debounceRef.current !== null) clearTimeout(debounceRef.current)

    if (value.trim().length === 0) {
      setSuggestions([])
      setSearchLoading(false)
      return
    }

    setSearchLoading(true)
    debounceRef.current = setTimeout(async () => {
      if (!accessToken) { setSearchLoading(false); return }
      try {
        const results = await searchColleges(value.trim(), accessToken)
        setSuggestions(results.slice(0, 8))
      } catch {
        setSuggestions([])
      } finally {
        setSearchLoading(false)
      }
    }, 300)
  }, [accessToken])

  // ── CRUD handlers ─────────────────────────────────────────────────────────────

  const handleAdd = useCallback(async (college: CollegeSearchResult): Promise<void> => {
    if (!accessToken || addedNames.has(college.name)) return
    setAddingName(college.name)
    try {
      const item = await addCollege(college.name, accessToken, college.unitId)
      setList(prev => [...prev, item])
      setQuery('')
      setSuggestions([])
      setShowDropdown(false)
    } catch {
      // duplicate or transient error — silent per web behavior
    } finally {
      setAddingName(null)
    }
  }, [accessToken, addedNames])

  const handleRemove = useCallback(async (id: number): Promise<void> => {
    if (!accessToken) return
    setRemovingId(id)
    try {
      await removeCollege(id, accessToken)
      setList(prev => prev.filter(i => i.id !== id))
      if (expandedId === id) setExpandedId(null)
      setInsightsCache(prev => {
        const next = { ...prev }
        delete next[id]
        return next
      })
    } catch (err: unknown) {
      setListError(extractErrorMessage(err, 'Failed to remove college. Please try again.'))
      setTimeout(() => setListError(null), 4000)
    } finally {
      setRemovingId(null)
    }
  }, [accessToken, expandedId])

  // ── Insights fetch (on-demand only) ───────────────────────────────────────────

  const fetchInsights = useCallback(async (id: number): Promise<void> => {
    if (!accessToken) return
    setInsightsCache(prev => ({ ...prev, [id]: { status: 'loading' } }))
    try {
      const data = await getCollegeInsights(id, accessToken)
      setInsightsCache(prev => ({ ...prev, [id]: { status: 'success', data } }))
    } catch (err: unknown) {
      const status = err instanceof ApiRequestError ? err.status : undefined
      setInsightsCache(prev => ({ ...prev, [id]: { status: status === 503 ? 'error-503' : 'error-404' } }))
    }
  }, [accessToken])

  const handleToggleInsights = useCallback((id: number): void => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut)
    if (expandedId === id) {
      setExpandedId(null)
      return
    }
    setExpandedId(id)
    if (insightsCache[id] === undefined) void fetchInsights(id)
  }, [expandedId, insightsCache, fetchInsights])

  // ── Render helpers ────────────────────────────────────────────────────────────

  function renderStatsBar(): React.JSX.Element | null {
    if (!statsLoaded) return null
    if (!hasStats) {
      return (
        <View style={[
          styles.warnCard,
          { backgroundColor: 'rgba(245,158,11,0.08)', borderColor: 'rgba(245,158,11,0.25)' },
        ]}>
          <Text style={[styles.warnText, { color: c.textSecondary }]}>
            Add your GPA and SAT score in Settings to see your likelihood scores.
          </Text>
        </View>
      )
    }

    return (
      <View style={[styles.statsRow, { backgroundColor: c.surface, borderColor: c.border }]}>
        <View style={styles.statChip}>
          <Text style={[styles.statLabel, { color: c.textMuted }]}>UW GPA</Text>
          <Text style={[styles.statVal, { color: c.text }]}>
            {unweightedGpa !== null ? unweightedGpa.toFixed(2) : '—'}
          </Text>
        </View>
        <View style={[styles.statDivider, { backgroundColor: c.border }]} />
        <View style={styles.statChip}>
          <Text style={[styles.statLabel, { color: c.textMuted }]}>W GPA</Text>
          <Text style={[styles.statVal, { color: c.text }]}>
            {weightedGpa !== null ? weightedGpa.toFixed(2) : '—'}
          </Text>
        </View>
        <View style={[styles.statDivider, { backgroundColor: c.border }]} />
        <View style={styles.statChip}>
          <Text style={[styles.statLabel, { color: c.textMuted }]}>SAT</Text>
          <Text style={[styles.statVal, { color: c.text }]}>
            {studentSAT ?? '—'}
          </Text>
        </View>
        <View style={[styles.statDivider, { backgroundColor: c.border }]} />
        <View style={styles.statChip}>
          <Text style={[styles.statLabel, { color: c.textMuted }]}>Added</Text>
          <Text style={[styles.statVal, { color: c.text }]}>{list.length}</Text>
        </View>
      </View>
    )
  }

  function renderInsightsSection(id: number): React.JSX.Element | null {
    const insight = insightsCache[id]

    if (insight === undefined || insight.status === 'loading') {
      return (
        <View style={styles.insightsSection}>
          <View style={styles.insightsLoadingRow}>
            <ActivityIndicator size="small" color={c.primary} />
            <Text style={[styles.insightsLoadingText, { color: c.textMuted }]}>
              Generating insights…
            </Text>
          </View>
        </View>
      )
    }

    if (insight.status === 'error-404') {
      return (
        <View style={styles.insightsSection}>
          <Text style={[styles.insightsErrorText, { color: c.textSecondary }]}>
            We don&apos;t have enough admissions data for this college yet.
          </Text>
        </View>
      )
    }

    if (insight.status === 'error-503') {
      return (
        <View style={styles.insightsSection}>
          <Text style={[styles.insightsErrorText, { color: c.textSecondary }]}>
            Insights are temporarily unavailable — try again in a bit.
          </Text>
          <TouchableOpacity
            onPress={() => { void fetchInsights(id) }}
            style={[styles.retryChip, { borderColor: c.border }]}
            accessibilityRole="button"
          >
            <Text style={[styles.retryChipText, { color: c.textSecondary }]}>Try again</Text>
          </TouchableOpacity>
        </View>
      )
    }

    const { narrativeSummary, actionableSteps, generatedAt, cached } = insight.data
    const generatedDate = new Date(generatedAt)
    const diffHours = Math.floor((Date.now() - generatedDate.getTime()) / (1000 * 60 * 60))
    const timeLabel = diffHours < 1 ? 'just now' : diffHours < 24 ? `${diffHours}h ago` : `${Math.floor(diffHours / 24)}d ago`

    return (
      <View style={styles.insightsSection}>
        <Text style={[styles.narrativeText, { color: c.textSecondary }]}>{narrativeSummary}</Text>

        {actionableSteps.length > 0 && (
          <View style={{ marginTop: 14 }}>
            <Text style={[styles.sectionLabel, { color: c.textMuted }]}>ACTION STEPS</Text>
            <View style={{ marginTop: 8, gap: 8 }}>
              {actionableSteps.map((step, idx) => (
                <View key={idx} style={[styles.stepRow, { backgroundColor: c.surface2 }]}>
                  <Text style={styles.stepCategoryBadge}>{step.category}</Text>
                  <Text style={[styles.stepText, { color: c.text }]}>{step.step}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        <View style={styles.insightsMetaRow}>
          <Text style={[styles.insightsMetaText, { color: c.textMuted }]}>Generated {timeLabel}</Text>
          {cached && (
            <View style={[styles.cachedBadge, { borderColor: c.border }]}>
              <Text style={[styles.cachedBadgeText, { color: c.textMuted }]}>cached</Text>
            </View>
          )}
        </View>
      </View>
    )
  }

  function renderCollegeItem({ item }: { item: CollegeListItem }): React.JSX.Element {
    const score = item.score
    const color = score !== null ? scoreColor(score) : c.textMuted
    const isExpanded = expandedId === item.id

    return (
      <View style={[styles.collegeCard, { backgroundColor: c.surface, borderColor: c.border }]}>
        <TouchableOpacity
          onPress={() => handleToggleInsights(item.id)}
          style={styles.collegeCardRow}
          accessibilityLabel={`View admission insights for ${item.name}`}
          accessibilityRole="button"
        >
          <View style={styles.collegeCardBody}>
            <Text style={[styles.collegeName, { color: c.text }]} numberOfLines={2}>
              {item.name}
            </Text>
            {(item.city || item.state) && (
              <Text style={[styles.collegeMeta, { color: c.textMuted }]}>
                {[item.city, item.state].filter(Boolean).join(', ')}
              </Text>
            )}

            {score !== null ? (
              <View style={styles.likelihoodSection}>
                <View style={styles.likelihoodRow}>
                  <Text style={[styles.likelihoodCaption, { color: c.textMuted }]}>LIKELIHOOD</Text>
                  <Text style={[styles.likelihoodLabel, { color }]}>{item.label}</Text>
                </View>
                <View style={[styles.barTrack, { backgroundColor: c.surface2 }]}>
                  <View style={[styles.barFill, { width: `${score}%`, backgroundColor: color }]} />
                </View>
              </View>
            ) : !hasStats ? (
              <Text style={[styles.noDataHint, { color: c.textMuted }]}>
                Add GPA &amp; SAT in Settings to see score
              </Text>
            ) : item.admissionRate === null ? (
              <Text style={[styles.noDataHint, { color: c.textMuted, fontStyle: 'italic' }]}>
                This school doesn&apos;t publish admissions rate data
              </Text>
            ) : null}
          </View>

          <View style={styles.scoreBox}>
            {score !== null ? (
              <>
                <Text style={[styles.scoreNum, { color }]}>{score}</Text>
                <Text style={[styles.scoreOut, { color: c.textMuted }]}>/100</Text>
              </>
            ) : (
              <Text style={[styles.scoreNoData, { color: c.textMuted }]}>{'No\ndata'}</Text>
            )}
          </View>

          <Text style={[styles.chevron, { color: c.textMuted, transform: [{ rotate: isExpanded ? '180deg' : '0deg' }] }]}>
            ⌄
          </Text>

          <TouchableOpacity
            onPress={() => { void handleRemove(item.id) }}
            disabled={removingId === item.id}
            style={[styles.removeBtn, { borderColor: c.border }]}
            accessibilityLabel={`Remove ${item.name}`}
            accessibilityRole="button"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={[styles.removeBtnText, { color: c.textMuted }]}>
              {removingId === item.id ? '…' : '×'}
            </Text>
          </TouchableOpacity>
        </TouchableOpacity>

        {isExpanded && (
          <View style={[styles.insightsDivider, { borderTopColor: c.border }]}>
            {renderInsightsSection(item.id)}
          </View>
        )}
      </View>
    )
  }

  // ── Main render ───────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: c.bg }]} edges={['left', 'right', 'bottom']}>
      <View style={[styles.container, { paddingHorizontal: s.screenPaddingH }]}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={[styles.title, { color: c.text }]}>College List</Text>
          <Text style={[styles.subtitle, { color: c.textSecondary }]}>
            Search and track the colleges you want to get into.
          </Text>
          <Text style={[styles.disclaimer, { color: c.textMuted }]}>
            This is a statistical estimate for planning purposes — not an official admissions prediction.
          </Text>
        </View>

        {/* Stats bar */}
        {renderStatsBar()}

        {/* Transient remove-error message */}
        {listError !== null && !loadingList && (
          <View style={[styles.warnCard, { backgroundColor: 'rgba(239,68,68,0.08)', borderColor: 'rgba(239,68,68,0.25)', marginBottom: 12 }]}>
            <Text style={[styles.warnText, { color: c.error }]}>{listError}</Text>
          </View>
        )}

        {/* Search */}
        <View style={styles.searchContainer}>
          <View style={[styles.searchWrap, { backgroundColor: c.surface, borderColor: c.border }]}>
            <Text style={[styles.searchIcon, { color: c.textMuted }]}>{'\u{1F50D}'}</Text>
            <TextInput
              style={[styles.searchInput, { color: c.text }]}
              placeholder="Search colleges..."
              placeholderTextColor={c.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
              value={query}
              onChangeText={handleQueryChange}
              onFocus={() => setShowDropdown(true)}
              onBlur={() => {
                blurTimerRef.current = setTimeout(() => setShowDropdown(false), 150)
              }}
              accessibilityLabel="Search colleges"
            />
            {searchLoading && (
              <ActivityIndicator size="small" color={c.textMuted} style={{ marginRight: 4 }} />
            )}
            {query.length > 0 && !searchLoading && (
              <TouchableOpacity
                onPress={() => { setQuery(''); setSuggestions([]); setShowDropdown(false) }}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityLabel="Clear search"
                accessibilityRole="button"
              >
                <Text style={[styles.clearBtnText, { color: c.textMuted }]}>×</Text>
              </TouchableOpacity>
            )}
          </View>

          {showDropdown && query.trim().length > 0 && (searchLoading || suggestions.length > 0) && (
            <View style={[styles.dropdown, { backgroundColor: c.surface, borderColor: c.border }]}>
              {searchLoading && suggestions.length === 0 && (
                <Text style={[styles.dropdownSearching, { color: c.textMuted }]}>Searching…</Text>
              )}
              {suggestions.map((col, idx) => {
                const already = addedNames.has(col.name)
                const isLast  = idx === suggestions.length - 1
                return (
                  <TouchableOpacity
                    key={col.unitId}
                    onPress={() => { void handleAdd(col) }}
                    disabled={already || addingName === col.name}
                    style={[
                      styles.dropdownRow,
                      !isLast && { borderBottomWidth: 1, borderBottomColor: c.border },
                      already && { opacity: 0.5 },
                    ]}
                    accessibilityLabel={`Add ${col.name}`}
                    accessibilityRole="button"
                  >
                    <View style={styles.dropdownInfo}>
                      <Text style={[styles.dropdownName, { color: c.text }]} numberOfLines={1}>
                        {col.name}
                      </Text>
                      <Text style={[styles.dropdownMeta, { color: c.textMuted }]} numberOfLines={1}>
                        {[col.city, col.state].filter(Boolean).join(', ') || 'College'}
                      </Text>
                    </View>
                    {col.score !== null && (
                      <Text style={[styles.dropdownScore, { color: scoreColor(col.score) }]}>
                        {col.score}
                      </Text>
                    )}
                    {already ? (
                      <View style={[styles.addedBadge, { borderColor: c.border }]}>
                        <Text style={[styles.addedBadgeText, { color: c.textMuted }]}>Added</Text>
                      </View>
                    ) : (
                      <Text style={[styles.addBtnText, { color: c.primary }]}>
                        {addingName === col.name ? '…' : '+'}
                      </Text>
                    )}
                  </TouchableOpacity>
                )
              })}
            </View>
          )}
        </View>

        {/* College list or loading/error/empty */}
        {loadingList ? (
          <View style={styles.centerContent}>
            <ActivityIndicator color={c.primary} size="large" />
          </View>
        ) : listError !== null && list.length === 0 ? (
          <View style={styles.centerContent}>
            <Text style={[styles.errorText, { color: c.error }]}>{listError}</Text>
            <TouchableOpacity
              onPress={() => { void loadAll() }}
              style={[styles.retryBtn, { backgroundColor: c.primary, minHeight: s.touchTarget }]}
              accessibilityRole="button"
            >
              <Text style={styles.retryBtnText}>Try Again</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <FlatList
            data={list}
            keyExtractor={item => item.id.toString()}
            renderItem={renderCollegeItem}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            ListEmptyComponent={
              <View style={[styles.emptyCard, { backgroundColor: c.surface, borderColor: c.border }]}>
                <Text style={[styles.emptyHeading, { color: c.text }]}>No colleges yet</Text>
                <Text style={[styles.emptySub, { color: c.textSecondary }]}>
                  Search above to add colleges you are interested in.
                </Text>
              </View>
            }
            ItemSeparatorComponent={() => <View style={styles.separator} />}
          />
        )}
      </View>
    </SafeAreaView>
  )
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safeArea:          { flex: 1 },
  container:         { flex: 1 },
  header:            { paddingTop: 16, paddingBottom: 8 },
  title:             { fontSize: 24, fontWeight: '700', marginBottom: 4 },
  subtitle:          { fontSize: 13, lineHeight: 18 },
  disclaimer:        { fontSize: 11, lineHeight: 16, marginTop: 6, fontStyle: 'italic' },
  warnCard:          { borderWidth: 1, borderRadius: 10, padding: 12, marginBottom: 14 },
  warnText:          { fontSize: 13, lineHeight: 18 },
  statsRow:          {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
  },
  statChip:          { flex: 1, alignItems: 'center', gap: 2 },
  statLabel:         { fontSize: 9, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  statVal:           { fontSize: 18, fontWeight: '800', letterSpacing: -0.5 },
  statDivider:       { width: 1, height: 32 },
  searchContainer:   { position: 'relative', marginBottom: 16 },
  searchWrap:        {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    height: 44,
    gap: 8,
  },
  searchIcon:        { fontSize: 14 },
  searchInput:       { flex: 1, fontSize: 14, height: '100%' },
  clearBtnText:      { fontSize: 20, lineHeight: 22 },
  dropdown:          {
    position: 'absolute',
    top: 50,
    left: 0,
    right: 0,
    borderWidth: 1,
    borderRadius: 10,
    overflow: 'hidden',
    zIndex: 100,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 8,
  },
  dropdownSearching: { fontSize: 13, padding: 12 },
  dropdownRow:       {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 11,
    paddingHorizontal: 16,
  },
  dropdownInfo:      { flex: 1 },
  dropdownName:      { fontSize: 13, fontWeight: '600', marginBottom: 2 },
  dropdownMeta:      { fontSize: 11 },
  dropdownScore:     { fontSize: 15, fontWeight: '800', minWidth: 32, textAlign: 'right' },
  addedBadge:        { borderWidth: 1, borderRadius: 20, paddingVertical: 2, paddingHorizontal: 8 },
  addedBadgeText:    { fontSize: 11 },
  addBtnText:        { fontSize: 20, fontWeight: '300', paddingHorizontal: 4 },
  listContent:       { paddingBottom: 24, flexGrow: 1 },
  separator:         { height: 10 },

  collegeCard:       {
    borderWidth: 1,
    borderRadius: 12,
    overflow: 'hidden',
  },
  collegeCardRow:    {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 16,
  },
  collegeCardBody:   { flex: 1, minWidth: 0 },
  collegeName:       { fontSize: 15, fontWeight: '700', marginBottom: 2 },
  collegeMeta:       { fontSize: 12 },
  likelihoodSection: { marginTop: 8 },
  likelihoodRow:     {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 5,
  },
  likelihoodCaption: { fontSize: 10, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  likelihoodLabel:   { fontSize: 12, fontWeight: '700' },
  barTrack:          { height: 6, borderRadius: 99, overflow: 'hidden' },
  barFill:           { height: '100%', borderRadius: 99 },
  noDataHint:        { fontSize: 12, marginTop: 6 },
  scoreBox:          { alignItems: 'center', minWidth: 48 },
  scoreNum:          { fontSize: 26, fontWeight: '800', letterSpacing: -1, lineHeight: 28 },
  scoreOut:          { fontSize: 11, marginTop: 2 },
  scoreNoData:       { fontSize: 11, textAlign: 'center', lineHeight: 15 },
  chevron:           { fontSize: 16, fontWeight: '700', flexShrink: 0 },
  removeBtn:         {
    width: 32,
    height: 32,
    minWidth: 44,
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  removeBtnText:     { fontSize: 18, lineHeight: 20 },

  // Insights section
  insightsDivider:   { borderTopWidth: 1, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 16 },
  insightsSection:   { gap: 4 },
  insightsLoadingRow:  { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4 },
  insightsLoadingText: { fontSize: 13 },
  insightsErrorText:   { fontSize: 13, lineHeight: 18 },
  retryChip:           {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: 6,
    paddingVertical: 5,
    paddingHorizontal: 12,
    marginTop: 8,
  },
  retryChipText:       { fontSize: 12, fontWeight: '500' },
  narrativeText:       { fontSize: 13.5, lineHeight: 20 },
  sectionLabel:        { fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8 },
  stepRow:             { flexDirection: 'row', alignItems: 'flex-start', gap: 8, padding: 10, borderRadius: 8 },
  stepCategoryBadge:   { fontSize: 10, fontWeight: '700', textTransform: 'uppercase', color: '#2979FF', marginTop: 2 },
  stepText:            { flex: 1, fontSize: 13, lineHeight: 18 },
  insightsMetaRow:     { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 14 },
  insightsMetaText:    { fontSize: 11 },
  cachedBadge:         { borderWidth: 1, borderRadius: 4, paddingVertical: 2, paddingHorizontal: 6 },
  cachedBadgeText:     { fontSize: 10 },

  // Empty / error / loading states
  centerContent:     { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 48 },
  errorText:         { fontSize: 14, textAlign: 'center', marginBottom: 16, lineHeight: 20 },
  retryBtn:          {
    borderRadius: 8,
    paddingHorizontal: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  retryBtnText:      { color: '#FFFFFF', fontSize: 15, fontWeight: '600' },
  emptyCard:         {
    borderWidth: 1,
    borderRadius: 12,
    padding: 48,
    alignItems: 'center',
    marginTop: 16,
  },
  emptyHeading:      { fontSize: 15, fontWeight: '600', marginBottom: 4 },
  emptySub:          { fontSize: 13, textAlign: 'center', lineHeight: 18 },
})
