// CollegesScreen — college list with search, ML-based likelihood scoring, saved-list management,
// and an on-demand "Path to admission" section per card.
//
// Data sources:
//   - Search typeahead: GET /colleges/catalog?q=...  (getCollegeCatalog)
//   - Admission probability: POST /colleges/predict   (predictCollegeProbability)
//   - Path to admission: POST /colleges/path          (predictCollegePath) — ON-DEMAND ONLY
//   - Saved list CRUD: GET/POST/DELETE /colleges       (listColleges / addCollege / removeCollege)
//
// The saved list stores college names (CollegeListItem); catalog IDs are resolved
// per-item via getCollegeCatalog(name, 5) with a case-insensitive exact match.
// If no catalog match is found, "No prediction available" is shown — no crash.
//
// IMPORTANT: predictCollegePath is NOT auto-fetched. It is triggered only when the
// user explicitly taps "Show path to admission" on a card. The endpoint calls the
// model server twice + the Anthropic API and has a 10 req/min rate limit — eager
// loading would blow through this limit with more than a couple of saved colleges.

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
import { listColleges, addCollege, removeCollege, type CollegeListItem } from '../api/collegesApi'
import { getMe, type StudentMe } from '../api/studentsApi'
import { getGpa, type GpaResponse } from '../api/gradesApi'
import {
  getCollegeCatalog,
  predictCollegeProbability,
  predictCollegePath,
  type CatalogCollege,
  type PredictTier,
  type PredictResponse,
  type CollegePathResponse,
} from '../api/collegeCatalogApi'

// Enable LayoutAnimation on Android
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true)
}

// ── Tier helpers ───────────────────────────────────────────────────────────────

function tierColor(tier: PredictTier): string {
  if (tier === 'Safety') return '#22C55E'
  if (tier === 'Target') return '#F59E0B'
  return '#EF4444'
}

// ── Per-college prediction cache ───────────────────────────────────────────────

interface PredictState {
  status: 'loading' | 'ok' | 'error'
  data: PredictResponse | null
  /** Server error message to show inline (403 COPPA, 503 model down, etc.) */
  message: string | null
}

// ── Per-college path state ─────────────────────────────────────────────────────

interface CollegePathState {
  status: 'idle' | 'loading' | 'ok' | 'error'
  data: CollegePathResponse | null
  /** Server error message to show inline */
  message: string | null
}

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
  const t = theme.typography

  // Saved list state
  const [list, setList]               = useState<CollegeListItem[]>([])
  const [loadingList, setLoadingList] = useState(true)
  const [listError, setListError]     = useState<string | null>(null)

  // Student stats
  const [studentMe, setStudentMe]     = useState<StudentMe | null>(null)
  const [portalGpa, setPortalGpa]     = useState<GpaResponse | null>(null)
  const [statsLoaded, setStatsLoaded] = useState(false)

  // Search
  const [query, setQuery]                   = useState('')
  const [suggestions, setSuggestions]       = useState<CatalogCollege[]>([])
  const [showDropdown, setShowDropdown]     = useState(false)
  const [searchLoading, setSearchLoading]   = useState(false)
  const debounceRef   = useRef<ReturnType<typeof setTimeout> | null>(null)
  const blurTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Per-item state
  const [addingName, setAddingName] = useState<string | null>(null)
  const [removingId, setRemovingId] = useState<number | null>(null)

  // Prediction cache keyed by catalog college id
  const [predictions, setPredictions] = useState<Record<number, PredictState>>({})
  // Catalog id cache for saved list items keyed by CollegeListItem.id
  // -1 = currently resolving, null = no match, number = catalog id
  const [savedCatalogIds, setSavedCatalogIds] = useState<Record<number, number | null>>({})

  // ── Path-to-admission state ────────────────────────────────────────────────
  // expandedPathCatalogId: which catalog id's path section is currently open (null = none)
  const [expandedPathCatalogId, setExpandedPathCatalogId] = useState<number | null>(null)
  // pathCache: fetched results keyed by catalog id — retained after collapse so
  //   re-expanding doesn't refetch
  const [pathCache, setPathCache] = useState<Record<number, CollegePathState>>({})

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
  const studentGPA: number | null = unweightedGpa
  const studentSAT: number | null = statsLoaded ? (studentMe?.profile?.satScore ?? null) : null
  const studentACT: number | null = statsLoaded ? (studentMe?.profile?.actScore ?? null) : null
  const hasStats = statsLoaded && ((studentGPA && studentGPA > 0) || (studentSAT && studentSAT > 0))

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

    // Load stats in parallel — non-fatal
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

  // ── Prediction fetch ──────────────────────────────────────────────────────────

  const fetchPredict = useCallback(async (catalogId: number): Promise<void> => {
    if (!accessToken || !statsLoaded) return
    if (!studentGPA && !studentSAT) return

    // Guard: avoid duplicate fetches
    setPredictions(prev => {
      if (prev[catalogId]) return prev
      return { ...prev, [catalogId]: { status: 'loading', data: null, message: null } }
    })

    const sat = studentSAT ?? 0
    const gpa = studentGPA ?? 0

    // The model needs both SAT and GPA — substituting a floor value for
    // whichever one is missing would skew the probability, not approximate it.
    if (sat <= 0 || gpa <= 0) {
      setPredictions(prev => ({
        ...prev,
        [catalogId]: { status: 'error', data: null, message: 'Add both GPA and SAT in Settings to see a probability' },
      }))
      return
    }

    try {
      const result = await predictCollegeProbability(
        {
          collegeId: catalogId,
          studentSat: sat,
          studentAct: studentACT ?? null,
          studentGpa: gpa,
        },
        accessToken,
      )
      setPredictions(prev => ({
        ...prev,
        [catalogId]: { status: 'ok', data: result, message: null },
      }))
    } catch (err: unknown) {
      const msg = err instanceof ApiRequestError ? err.message : null
      setPredictions(prev => ({
        ...prev,
        [catalogId]: { status: 'error', data: null, message: msg },
      }))
    }
  }, [accessToken, statsLoaded, studentGPA, studentSAT, studentACT])

  // Trigger predictions for dropdown suggestions when stats are ready
  useEffect(() => {
    if (!hasStats) return
    for (const college of suggestions) {
      if (!predictions[college.id]) {
        void fetchPredict(college.id)
      }
    }
  }, [suggestions, hasStats, predictions, fetchPredict])

  // ── Resolve catalog id for saved list items ───────────────────────────────────

  const resolveSavedCatalogId = useCallback(async (item: CollegeListItem): Promise<void> => {
    if (!accessToken) return
    if (savedCatalogIds[item.id] !== undefined) return
    // Sentinel -1 prevents duplicate resolution
    setSavedCatalogIds(prev => ({ ...prev, [item.id]: -1 }))
    try {
      const results = await getCollegeCatalog(item.name, accessToken, 5)
      const match = results.find(
        r => r.name.toLowerCase() === item.name.toLowerCase()
      )
      const catalogId = match?.id ?? null
      setSavedCatalogIds(prev => ({ ...prev, [item.id]: catalogId }))
      if (catalogId !== null && hasStats) {
        void fetchPredict(catalogId)
      }
    } catch {
      setSavedCatalogIds(prev => ({ ...prev, [item.id]: null }))
    }
  }, [accessToken, savedCatalogIds, hasStats, fetchPredict])

  useEffect(() => {
    if (!statsLoaded) return
    for (const item of list) {
      void resolveSavedCatalogId(item)
    }
  }, [list, statsLoaded, resolveSavedCatalogId])

  // Trigger predictions when catalog ids become known
  useEffect(() => {
    if (!hasStats) return
    for (const catalogId of Object.values(savedCatalogIds)) {
      if (catalogId !== null && catalogId > 0 && !predictions[catalogId]) {
        void fetchPredict(catalogId)
      }
    }
  }, [savedCatalogIds, hasStats, predictions, fetchPredict])

  // ── Path-to-admission fetch (on-demand only) ──────────────────────────────────

  const fetchCollegePath = useCallback(async (catalogId: number): Promise<void> => {
    if (!accessToken) return
    const sat = studentSAT ?? 0
    const gpa = studentGPA ?? 0
    if (sat <= 0 || gpa <= 0) return

    // Already fetched (ok or loading) — do not refetch
    const existing = pathCache[catalogId]
    if (existing && (existing.status === 'ok' || existing.status === 'loading')) return

    setPathCache(prev => ({
      ...prev,
      [catalogId]: { status: 'loading', data: null, message: null },
    }))

    try {
      const result = await predictCollegePath(
        {
          collegeId: catalogId,
          studentSat: sat,
          studentAct: studentACT ?? null,
          studentGpa: gpa,
        },
        accessToken,
      )
      setPathCache(prev => ({
        ...prev,
        [catalogId]: { status: 'ok', data: result, message: null },
      }))
    } catch (err: unknown) {
      const msg = extractErrorMessage(err, 'Something went wrong. Please try again.')
      setPathCache(prev => ({
        ...prev,
        [catalogId]: { status: 'error', data: null, message: msg },
      }))
    }
  }, [accessToken, pathCache, studentSAT, studentGPA, studentACT])

  const handleTogglePath = useCallback((catalogId: number): void => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut)
    if (expandedPathCatalogId === catalogId) {
      // Collapse — retain cached result so re-expanding is instant
      setExpandedPathCatalogId(null)
    } else {
      setExpandedPathCatalogId(catalogId)
      void fetchCollegePath(catalogId)
    }
  }, [expandedPathCatalogId, fetchCollegePath])

  // ── Debounced catalog search ──────────────────────────────────────────────────

  const handleQueryChange = useCallback((value: string): void => {
    setQuery(value)
    setShowDropdown(true)

    if (debounceRef.current !== null) clearTimeout(debounceRef.current)

    if (value.trim().length < 2) {
      setSuggestions([])
      setSearchLoading(false)
      return
    }

    setSearchLoading(true)
    debounceRef.current = setTimeout(async () => {
      if (!accessToken) { setSearchLoading(false); return }
      try {
        const results = await getCollegeCatalog(value.trim(), accessToken, 10)
        setSuggestions(results)
      } catch {
        setSuggestions([])
      } finally {
        setSearchLoading(false)
      }
    }, 250)
  }, [accessToken])

  // ── CRUD handlers ─────────────────────────────────────────────────────────────

  const handleAdd = useCallback(async (college: CatalogCollege): Promise<void> => {
    if (!accessToken || addedNames.has(college.name)) return
    setAddingName(college.name)
    try {
      const item = await addCollege(college.name, accessToken)
      setList(prev => [...prev, item])
      setQuery('')
      setSuggestions([])
      setShowDropdown(false)
      // Pre-fill catalog id so prediction doesn't need another lookup
      setSavedCatalogIds(prev => ({ ...prev, [item.id]: college.id }))
      if (hasStats) void fetchPredict(college.id)
    } catch {
      // duplicate or transient error — silent per web behavior
    } finally {
      setAddingName(null)
    }
  }, [accessToken, addedNames, hasStats, fetchPredict])

  const handleRemove = useCallback(async (id: number): Promise<void> => {
    if (!accessToken) return
    setRemovingId(id)
    try {
      await removeCollege(id, accessToken)
      setList(prev => prev.filter(i => i.id !== id))
    } catch (err: unknown) {
      // Inline error is tricky in RN without Alert — surface via brief state
      setListError(extractErrorMessage(err, 'Failed to remove college. Please try again.'))
      setTimeout(() => setListError(null), 4000)
    } finally {
      setRemovingId(null)
    }
  }, [accessToken])

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

  function renderPathSection(catalogId: number): React.JSX.Element | null {
    const pathState = pathCache[catalogId]
    if (!pathState || pathState.status === 'idle') return null

    if (pathState.status === 'loading') {
      return (
        <View style={styles.pathSection}>
          <View style={styles.pathLoadingRow}>
            <ActivityIndicator size="small" color={c.primary} />
            <Text style={[styles.pathLoadingText, { color: c.textMuted }]}>
              Analyzing your path to admission…
            </Text>
          </View>
        </View>
      )
    }

    if (pathState.status === 'error') {
      return (
        <View style={styles.pathSection}>
          <View style={[styles.pathErrorCard, { backgroundColor: 'rgba(239,68,68,0.08)', borderColor: 'rgba(239,68,68,0.2)' }]}>
            <Text style={[styles.pathErrorText, { color: c.error }]}>
              {pathState.message}
            </Text>
          </View>
        </View>
      )
    }

    if (!pathState.data) return null

    const { steps } = pathState.data

    return (
      <View style={styles.pathSection}>
        {/* Section disclaimer */}
        <Text style={[styles.pathDisclaimer, { color: c.textMuted }]}>
          Numeric boosts for model-calculated steps are statistical estimates based on aggregate college data. Non-numeric suggestions are AI-generated and approximate.
        </Text>

        {steps.length === 0 ? (
          <Text style={[styles.pathEmptyText, { color: c.textMuted }]}>
            No specific suggestions available right now.
          </Text>
        ) : (
          steps.map((step, idx) => {
            const isAi = step.source === 'ai_estimate'
            const boostBg    = isAi ? 'rgba(124,58,237,0.15)' : 'rgba(41,121,255,0.15)'
            const boostColor = isAi ? '#A855F7' : '#2979FF'
            const boostBorder = isAi ? 'rgba(124,58,237,0.3)' : 'rgba(41,121,255,0.3)'

            return (
              <View
                key={idx}
                style={[styles.stepCard, { backgroundColor: c.surface2, borderColor: c.border }]}
              >
                {/* Title row: title + AI tag + boost badge */}
                <View style={styles.stepTitleRow}>
                  <View style={styles.stepTitleLeft}>
                    <Text style={[styles.stepTitle, { color: c.text }]} numberOfLines={2}>
                      {step.title}
                    </Text>
                    {isAi && (
                      <View style={styles.aiTagWrap}>
                        <Text style={styles.aiTagText}>AI suggested</Text>
                      </View>
                    )}
                  </View>
                  <View style={[styles.boostBadge, { backgroundColor: boostBg, borderColor: boostBorder }]}>
                    <Text style={[styles.boostBadgeText, { color: boostColor }]}>
                      +{step.percentBoost.toFixed(1)}%
                    </Text>
                  </View>
                </View>
                {/* Description */}
                <Text style={[styles.stepDesc, { color: c.textSecondary }]}>
                  {step.description}
                </Text>
              </View>
            )
          })
        )}
      </View>
    )
  }

  function renderCollegeItem({ item }: { item: CollegeListItem }): React.JSX.Element {
    const rawCatalogId = savedCatalogIds[item.id]
    // -1 = resolving, null = no match, number = resolved
    const resolving    = rawCatalogId === -1
    const catalogId    = resolving ? undefined : rawCatalogId
    const state        = catalogId != null ? predictions[catalogId] : undefined
    const hasResult    = state?.status === 'ok' && state.data != null

    const probability  = hasResult ? state!.data!.probability : null
    const tier         = hasResult ? state!.data!.tier : null
    const color        = tier ? tierColor(tier) : c.textMuted

    const isPathExpanded   = catalogId != null && expandedPathCatalogId === catalogId
    const pathState        = catalogId != null ? pathCache[catalogId] : undefined
    const pathIsLoading    = pathState?.status === 'loading'

    return (
      <View style={[styles.collegeCard, { backgroundColor: c.surface, borderColor: c.border }]}>
        {/* Top row: name + body */}
        <View style={styles.collegeCardRow}>
          <View style={styles.collegeCardBody}>
            <Text style={[styles.collegeName, { color: c.text }]} numberOfLines={2}>
              {item.name}
            </Text>

            {hasStats && (
              <View style={styles.likelihoodSection}>
                {resolving || (rawCatalogId !== undefined && state?.status === 'loading') ? (
                  <Text style={[styles.noDataHint, { color: c.textMuted }]}>Loading…</Text>
                ) : hasResult ? (
                  <>
                    <View style={styles.likelihoodRow}>
                      <Text style={[styles.likelihoodCaption, { color: c.textMuted }]}>
                        ADMISSION PROBABILITY
                      </Text>
                      <Text style={[styles.likelihoodLabel, { color }]}>{tier}</Text>
                    </View>
                    <View style={[styles.barTrack, { backgroundColor: c.surface2 }]}>
                      <View
                        style={[
                          styles.barFill,
                          { width: `${Math.min(100, Math.max(1, probability!))}%`, backgroundColor: color },
                        ]}
                      />
                    </View>
                  </>
                ) : state?.status === 'error' ? (
                  <Text style={[styles.noDataHint, { color: c.textMuted }]}>
                    {state.message ?? 'No prediction available for this college'}
                  </Text>
                ) : rawCatalogId === null ? (
                  <Text style={[styles.noDataHint, { color: c.textMuted }]}>
                    No prediction available for this college
                  </Text>
                ) : null}
              </View>
            )}

            {!hasStats && (
              <Text style={[styles.noDataHint, { color: c.textMuted }]}>
                Add GPA &amp; SAT in Settings to see score
              </Text>
            )}
          </View>

          {/* Probability badge */}
          <View style={styles.scoreBox}>
            {hasResult ? (
              <>
                <Text style={[styles.scoreNum, { color }]}>
                  {Math.round(probability!)}
                </Text>
                <Text style={[styles.scoreOut, { color: c.textMuted }]}>%</Text>
              </>
            ) : (
              <Text style={[styles.scoreNoData, { color: c.textMuted }]}>
                {'No\ndata'}
              </Text>
            )}
          </View>

          {/* Remove button */}
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
        </View>

        {/* "Show path to admission" toggle — only shown once predict has resolved */}
        {hasResult && catalogId != null && (
          <View style={[styles.pathToggleRow, { borderTopColor: c.border }]}>
            <TouchableOpacity
              onPress={() => handleTogglePath(catalogId)}
              disabled={pathIsLoading}
              style={styles.pathToggleBtn}
              accessibilityLabel={isPathExpanded ? 'Hide path to admission' : 'Show path to admission'}
              accessibilityRole="button"
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={[styles.pathToggleBtnText, { color: c.primary }]}>
                {isPathExpanded ? 'Hide path to admission' : 'Show path to admission →'}
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Expanded path section */}
        {isPathExpanded && catalogId != null && renderPathSection(catalogId)}
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
          {/* Statistical disclaimer — always visible */}
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
            <Text style={[styles.searchIcon, { color: c.textMuted }]}>
              {'\u{1F50D}'}
            </Text>
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

          {/* Dropdown */}
          {showDropdown && suggestions.length > 0 && (
            <View style={[styles.dropdown, { backgroundColor: c.surface, borderColor: c.border }]}>
              {suggestions.map((col, idx) => {
                const already  = addedNames.has(col.name)
                const state    = predictions[col.id]
                const isLast   = idx === suggestions.length - 1
                const hasOk    = state?.status === 'ok' && state.data != null
                return (
                  <TouchableOpacity
                    key={col.id}
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
                      <Text style={[styles.dropdownMeta, { color: c.textMuted }]}>
                        Avg GPA {col.avgGpa} · Avg SAT {col.avgSat}
                      </Text>
                    </View>
                    {hasStats && hasOk && (
                      <Text style={[styles.dropdownTier, { color: tierColor(state!.data!.tier) }]}>
                        {state!.data!.tier}
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
                <Text style={styles.emptyEmoji}>{'  '}</Text>
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
  dropdownTier:      { fontSize: 12, fontWeight: '700', minWidth: 44, textAlign: 'right' },
  addedBadge:        { borderWidth: 1, borderRadius: 20, paddingVertical: 2, paddingHorizontal: 8 },
  addedBadgeText:    { fontSize: 11 },
  addBtnText:        { fontSize: 20, fontWeight: '300', paddingHorizontal: 4 },
  listContent:       { paddingBottom: 24, flexGrow: 1 },
  separator:         { height: 10 },

  // College card — now column-direction to accommodate path section below
  collegeCard:       {
    borderWidth: 1,
    borderRadius: 12,
    paddingTop: 16,
    paddingHorizontal: 16,
    paddingBottom: 0,
    gap: 0,
  },
  collegeCardRow:    {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingBottom: 16,
  },
  collegeCardBody:   { flex: 1, minWidth: 0 },
  collegeName:       { fontSize: 15, fontWeight: '700', marginBottom: 2 },
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

  // Path toggle row
  pathToggleRow:     {
    borderTopWidth: 1,
    paddingVertical: 10,
    alignItems: 'flex-start',
  },
  pathToggleBtn:     {
    minHeight: 44,
    justifyContent: 'center',
  },
  pathToggleBtnText: { fontSize: 12, fontWeight: '600' },

  // Path section
  pathSection:       {
    paddingTop: 12,
    paddingBottom: 16,
    borderTopWidth: 1,
    gap: 10,
  },
  pathLoadingRow:    { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4 },
  pathLoadingText:   { fontSize: 13 },
  pathErrorCard:     { borderWidth: 1, borderRadius: 8, padding: 12 },
  pathErrorText:     { fontSize: 13, lineHeight: 18 },
  pathDisclaimer:    { fontSize: 11, fontStyle: 'italic', lineHeight: 16 },
  pathEmptyText:     { fontSize: 13, fontStyle: 'italic' },

  // Step card
  stepCard:          {
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    gap: 6,
  },
  stepTitleRow:      {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 8,
  },
  stepTitleLeft:     { flex: 1, gap: 4 },
  stepTitle:         { fontSize: 13, fontWeight: '700', lineHeight: 18 },
  aiTagWrap:         {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(168,85,247,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(168,85,247,0.3)',
    borderRadius: 20,
    paddingVertical: 2,
    paddingHorizontal: 8,
  },
  aiTagText:         { fontSize: 10, fontWeight: '600', color: '#A855F7' },
  boostBadge:        {
    borderWidth: 1,
    borderRadius: 20,
    paddingVertical: 3,
    paddingHorizontal: 9,
    alignSelf: 'flex-start',
    flexShrink: 0,
  },
  boostBadgeText:    { fontSize: 12, fontWeight: '700' },
  stepDesc:          { fontSize: 12, lineHeight: 17 },

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
  emptyEmoji:        { fontSize: 32, marginBottom: 10 },
  emptyHeading:      { fontSize: 15, fontWeight: '600', marginBottom: 4 },
  emptySub:          { fontSize: 13, textAlign: 'center', lineHeight: 18 },
})
