// DashboardScreen — full Futurely dashboard for authenticated students.
//
// Data sources (all fetched in parallel on mount):
//   - studentsApi.getMe()       → user profile, courses, assignments, stats
//   - gradesApi.getGpa()        → live portal GPA (weighted / unweighted)
//   - marketplaceApi.claimDailyCoins() → auto-claim; popup shown if claimed === true
//
// Three states:
//   Loading  — skeleton placeholders (branded)
//   Error    — ApiRequestError.message + retry button
//   Success  — full dashboard content
//
// Quick Access navigates to sibling drawer screens via navigation.navigate().
// Re-sync calls syncProfile() (works for both HAC and PowerSchool).

import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import {
  ActivityIndicator,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import type { DrawerNavigationProp } from '@react-navigation/drawer'
import { useNavigation } from '@react-navigation/native'

import { useAuth } from '../context/AuthContext'
import { useTheme } from '../theme/ThemeContext'
import { getMe, type StudentMe } from '../api/studentsApi'
import { getGpa, syncProfile, type GpaResponse } from '../api/gradesApi'
import { claimDailyCoins, type DailyCoinsResponse } from '../api/marketplaceApi'
import { ApiRequestError } from '../api/client'
import type { MainDrawerParamList } from '../navigation/MainNavigator'

// ── Types ──────────────────────────────────────────────────────────────────────

type NavProp = DrawerNavigationProp<MainDrawerParamList>

interface DashboardData {
  me: StudentMe
  gpa: GpaResponse | null
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function extractErrorMessage(err: unknown): string {
  if (err instanceof ApiRequestError) return err.message
  if (err instanceof Error) return err.message
  return 'Something went wrong. Please try again.'
}

function getFirstName(name: string | null): string {
  if (!name) return 'Student'
  const cap = (s: string): string =>
    s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : ''
  if (name.includes(',')) {
    const rest = name.split(',')[1]?.trim() ?? ''
    return cap(rest.split(' ')[0] ?? '') || 'Student'
  }
  return cap(name.split(' ')[0] ?? '') || 'Student'
}

function getGreeting(): string {
  const h = new Date().getHours()
  if (h < 12) return 'morning'
  if (h < 17) return 'afternoon'
  return 'evening'
}

function formatTodayDate(): string {
  return new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })
}

function isToday(dateStr: string): boolean {
  const today = new Date()
  const d = new Date(dateStr)
  return (
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate()
  )
}

function computeGpaBonusPct(ugpa: number | null, wgpa: number | null): number {
  const fromU = (g: number): number =>
    Math.max(0, Math.min(50, ((g - 2.0) / 2.0) * 50))
  const fromW = (g: number): number =>
    Math.max(0, Math.min(50, ((g - 2.5) / 2.5) * 50))
  if (ugpa === null && wgpa === null) return 0
  if (ugpa !== null && wgpa !== null) return (fromU(ugpa) + fromW(wgpa)) / 2
  if (ugpa !== null) return fromU(ugpa)
  return fromW(wgpa as number)
}

// ── Skeleton placeholder ───────────────────────────────────────────────────────

interface SkeletonBoxProps {
  width?: string | number
  height: number
  borderRadius?: number
  bg: string
}

function SkeletonBox({ width = '100%', height, borderRadius = 8, bg }: SkeletonBoxProps): React.JSX.Element {
  return (
    <View
      style={[
        styles.skeletonBox,
        {
          width: width as number,
          height,
          borderRadius,
          backgroundColor: bg,
        },
      ]}
      accessible={false}
    />
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function DashboardScreen(): React.JSX.Element {
  const { accessToken, user } = useAuth()
  const { theme } = useTheme()
  const navigation = useNavigation<NavProp>()

  const c = theme.colors
  const s = theme.spacing
  const r = theme.radius

  // ── State ────────────────────────────────────────────────────────────────────

  const [data, setData]                   = useState<DashboardData | null>(null)
  const [loadError, setLoadError]         = useState<string | null>(null)
  const [isLoading, setIsLoading]         = useState(true)

  // Re-sync state
  const [isSyncing, setIsSyncing]         = useState(false)
  const [syncError, setSyncError]         = useState<string | null>(null)
  const [syncSuccess, setSyncSuccess]     = useState(false)

  // Daily coin popup
  const [coinPopup, setCoinPopup]         = useState<DailyCoinsResponse | null>(null)
  const [showCoinPopup, setShowCoinPopup] = useState(false)

  // GPA privacy toggle
  const [hideGpa, setHideGpa]             = useState(false)

  // Track whether the coin claim already ran this mount
  const coinClaimFired = useRef(false)

  // ── Load data ────────────────────────────────────────────────────────────────

  const loadDashboard = useCallback(async (token: string): Promise<void> => {
    setLoadError(null)
    setIsLoading(true)
    try {
      const [me, gpa] = await Promise.all([
        getMe(token),
        getGpa(token).catch((): null => null), // GPA may not exist for non-portal users
      ])
      setData({ me, gpa })
    } catch (err: unknown) {
      setLoadError(extractErrorMessage(err))
    } finally {
      setIsLoading(false)
    }
  }, [])

  // Claim daily coins on first mount — non-blocking, fire-and-forget on error.
  const claimCoins = useCallback(async (token: string): Promise<void> => {
    if (coinClaimFired.current) return
    coinClaimFired.current = true
    try {
      const result = await claimDailyCoins(token)
      if (result.claimed) {
        setCoinPopup(result)
        setShowCoinPopup(true)
      }
    } catch {
      // Non-fatal — coins claim is a nice-to-have side effect.
    }
  }, [])

  useEffect(() => {
    if (!accessToken) return
    void loadDashboard(accessToken)
    void claimCoins(accessToken)
  }, [accessToken, loadDashboard, claimCoins])

  // ── Re-sync ──────────────────────────────────────────────────────────────────

  const handleResync = useCallback(async (): Promise<void> => {
    if (!accessToken) return
    setSyncError(null)
    setSyncSuccess(false)
    setIsSyncing(true)
    try {
      await syncProfile(accessToken)
      // Refresh dashboard data after successful sync
      const [me, gpa] = await Promise.all([
        getMe(accessToken),
        getGpa(accessToken).catch((): null => null),
      ])
      setData({ me, gpa })
      setSyncSuccess(true)
      // Auto-clear success message after 3s
      setTimeout(() => setSyncSuccess(false), 3000)
    } catch (err: unknown) {
      setSyncError(extractErrorMessage(err))
    } finally {
      setIsSyncing(false)
    }
  }, [accessToken])

  // ── Derived values ───────────────────────────────────────────────────────────

  const effectiveUGpa =
    data?.gpa?.unweightedGpa ?? data?.me.profile?.unweightedGpa ?? null
  const effectiveWGpa =
    data?.gpa?.weightedGpa ?? data?.me.profile?.weightedGpa ?? null

  const gpaBonusPct = computeGpaBonusPct(effectiveUGpa, effectiveWGpa)

  const firstName = getFirstName(data?.me.name ?? user?.name ?? null)

  const dueToday = (data?.me.assignments ?? []).filter(
    a => !a.completed && isToday(a.dueDate),
  )

  const stats = data?.me.stats

  // ── Render helpers ───────────────────────────────────────────────────────────

  function renderLoadingSkeleton(): React.JSX.Element {
    const skBg = c.surface2
    return (
      <ScrollView
        style={[styles.scroll, { backgroundColor: c.bg }]}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingHorizontal: s.screenPaddingH },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* Header skeleton */}
        <View style={styles.headerRow}>
          <View style={{ gap: 8 }}>
            <SkeletonBox width={120} height={14} bg={skBg} />
            <SkeletonBox width={180} height={32} borderRadius={6} bg={skBg} />
          </View>
          <SkeletonBox width={110} height={30} borderRadius={15} bg={skBg} />
        </View>

        {/* Top row: GPA + Due Today */}
        <View style={styles.topRow}>
          <SkeletonBox height={120} borderRadius={r.lg} bg={skBg} />
          <View style={{ height: 12 }} />
          <SkeletonBox height={120} borderRadius={r.lg} bg={skBg} />
        </View>

        {/* Stat row */}
        <View style={styles.statRow}>
          <SkeletonBox height={80} borderRadius={r.lg} bg={skBg} />
          <View style={{ height: 8 }} />
          <SkeletonBox height={80} borderRadius={r.lg} bg={skBg} />
          <View style={{ height: 8 }} />
          <SkeletonBox height={80} borderRadius={r.lg} bg={skBg} />
        </View>

        {/* Quick access */}
        <SkeletonBox height={14} width={100} bg={skBg} />
        <View style={{ height: 12 }} />
        <SkeletonBox height={64} borderRadius={r.lg} bg={skBg} />
        <View style={{ height: 8 }} />
        <SkeletonBox height={64} borderRadius={r.lg} bg={skBg} />
        <View style={{ height: 8 }} />
        <SkeletonBox height={64} borderRadius={r.lg} bg={skBg} />
        <View style={{ height: 8 }} />
        <SkeletonBox height={64} borderRadius={r.lg} bg={skBg} />
      </ScrollView>
    )
  }

  function renderError(): React.JSX.Element {
    return (
      <SafeAreaView
        style={[styles.centerFill, { backgroundColor: c.bg }]}
        edges={['top', 'left', 'right', 'bottom']}
      >
        <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border, marginHorizontal: s.screenPaddingH }]}>
          <Text style={[styles.errorTitle, { color: c.error }]}>
            Couldn&apos;t load dashboard
          </Text>
          <Text style={[styles.errorMsg, { color: c.textSecondary }]}>
            {loadError}
          </Text>
          <TouchableOpacity
            style={[styles.primaryBtn, { backgroundColor: c.primary, minHeight: s.touchTarget }]}
            onPress={() => { if (accessToken) void loadDashboard(accessToken) }}
            accessibilityRole="button"
            accessibilityLabel="Retry loading dashboard"
          >
            <Text style={styles.primaryBtnText}>Try again</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    )
  }

  function renderGpaCard(): React.JSX.Element {
    const hasGpa = effectiveUGpa !== null || effectiveWGpa !== null
    return (
      <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border, flex: 1 }]}>
        {/* Label row */}
        <View style={styles.cardLabelRow}>
          <Text style={[styles.cardLabel, { color: c.textMuted }]}>GPA</Text>
          <TouchableOpacity
            onPress={() => setHideGpa(v => !v)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel={hideGpa ? 'Show GPA' : 'Hide GPA'}
            style={styles.hideGpaBtn}
          >
            <Text style={[styles.hideGpaBtnText, { color: c.textMuted }]}>
              {hideGpa ? 'Show' : 'Hide'}
            </Text>
          </TouchableOpacity>
        </View>

        {hasGpa ? (
          <View style={styles.gpaRow}>
            <View style={styles.gpaBlock}>
              <Text
                style={[
                  styles.gpaNum,
                  { color: c.text },
                  hideGpa && styles.blurred,
                ]}
                accessible={!hideGpa}
              >
                {effectiveUGpa !== null ? effectiveUGpa.toFixed(3) : '—'}
              </Text>
              <Text style={[styles.gpaTag, { color: c.textSecondary }]}>
                Unweighted
              </Text>
            </View>
            <View style={[styles.gpaDivider, { backgroundColor: c.border }]} />
            <View style={styles.gpaBlock}>
              <Text
                style={[
                  styles.gpaNum,
                  { color: c.primary },
                  hideGpa && styles.blurred,
                ]}
                accessible={!hideGpa}
              >
                {effectiveWGpa !== null ? effectiveWGpa.toFixed(3) : '—'}
              </Text>
              <Text style={[styles.gpaTag, { color: c.textSecondary }]}>
                Weighted
              </Text>
            </View>
          </View>
        ) : (
          <Text style={[styles.emptyCardMsg, { color: c.textMuted }]}>
            Connect your school portal to see your GPA.
          </Text>
        )}
      </View>
    )
  }

  function renderDueTodayCard(): React.JSX.Element {
    return (
      <TouchableOpacity
        style={[styles.card, { backgroundColor: c.surface, borderColor: c.border, flex: 1 }]}
        onPress={() => navigation.navigate('Planner')}
        accessibilityRole="button"
        accessibilityLabel={`Due Today, ${dueToday.length} item${dueToday.length !== 1 ? 's' : ''}`}
        activeOpacity={0.75}
      >
        <View style={styles.cardLabelRow}>
          <Text style={[styles.cardLabel, { color: c.textMuted }]}>Due Today</Text>
          {dueToday.length > 0 && (
            <View style={[styles.countPill, { backgroundColor: c.error }]}>
              <Text style={styles.countPillText}>{dueToday.length}</Text>
            </View>
          )}
        </View>

        {dueToday.length === 0 ? (
          <Text style={[styles.allClearMsg, { color: c.success }]}>
            All clear for today
          </Text>
        ) : (
          dueToday.slice(0, 3).map(a => (
            <View key={a.id} style={styles.dueRow}>
              <View style={[styles.dueDot, { backgroundColor: c.primary }]} />
              <View style={styles.dueTextCol}>
                <Text
                  style={[styles.dueTitle, { color: c.text }]}
                  numberOfLines={1}
                >
                  {a.title}
                </Text>
                <Text
                  style={[styles.dueSub, { color: c.textSecondary }]}
                  numberOfLines={1}
                >
                  {a.subject}
                </Text>
              </View>
            </View>
          ))
        )}
      </TouchableOpacity>
    )
  }

  function renderStatCard(
    value: number,
    label: string,
    dest: keyof MainDrawerParamList,
  ): React.JSX.Element {
    return (
      <TouchableOpacity
        key={label}
        style={[styles.statCard, { backgroundColor: c.surface, borderColor: c.border }]}
        onPress={() => navigation.navigate(dest)}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${value}`}
        activeOpacity={0.75}
      >
        <Text style={[styles.statNum, { color: c.text }]}>{value}</Text>
        <Text style={[styles.statLabel, { color: c.textSecondary }]} numberOfLines={1}>
          {label}
        </Text>
      </TouchableOpacity>
    )
  }

  const QUICK_LINKS: Array<{
    label: string
    emoji: string
    dest: keyof MainDrawerParamList
    iconBg: string
  }> = [
    { label: 'Grade Portal', emoji: '📊', dest: 'Grades',  iconBg: `${c.success}1A` },
    { label: 'AI Chat',      emoji: '🤖', dest: 'AIChat',  iconBg: `${c.purple}1F` },
    { label: 'Planner',      emoji: '📅', dest: 'Planner', iconBg: `${c.warning}1A` },
    { label: 'Colleges',     emoji: '🎓', dest: 'Colleges', iconBg: `${c.primary}1F` },
  ]

  function renderContent(): React.JSX.Element {
    if (!data) return <View />
    const { me } = data
    return (
      <ScrollView
        style={[styles.scroll, { backgroundColor: c.bg }]}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingHorizontal: s.screenPaddingH },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Header ── */}
        <View style={styles.headerRow}>
          <View>
            <Text style={[styles.greeting, { color: c.textSecondary }]}>
              Good {getGreeting()},
            </Text>
            <Text style={[styles.userName, { color: c.text }]}>
              {firstName}
            </Text>
          </View>
          <View style={[styles.dateChip, { backgroundColor: c.primaryDim, borderColor: c.primaryGlow }]}>
            <Text style={[styles.dateChipText, { color: c.primary }]}>
              {formatTodayDate()}
            </Text>
          </View>
        </View>

        {/* ── Sync success / error feedback ── */}
        {syncSuccess && (
          <View style={[styles.syncFeedback, { backgroundColor: `${c.success}1A`, borderColor: `${c.success}4D` }]}>
            <Text style={[styles.syncFeedbackText, { color: c.success }]}>
              Synced successfully
            </Text>
          </View>
        )}
        {syncError !== null && (
          <View style={[styles.syncFeedback, { backgroundColor: `${c.error}1A`, borderColor: `${c.error}4D` }]}>
            <Text style={[styles.syncFeedbackText, { color: c.error }]}>
              {syncError}
            </Text>
          </View>
        )}

        {/* ── GPA + Due Today row ── */}
        <View style={styles.topRow}>
          {renderGpaCard()}
          {renderDueTodayCard()}
        </View>

        {/* ── Stat cards row ── */}
        <View style={styles.statRow}>
          {renderStatCard(me.stats.totalCourses, 'Courses', 'Grades')}
          {renderStatCard(me.stats.assignmentsDueThisWeek, 'Due This Week', 'Planner')}
          {renderStatCard(me.stats.pendingAssignments, 'Pending', 'Planner')}
        </View>

        {/* ── Re-sync button ── */}
        <TouchableOpacity
          style={[
            styles.resyncBtn,
            {
              backgroundColor: c.surface,
              borderColor: isSyncing ? c.primary : c.border,
              minHeight: s.touchTarget,
              opacity: isSyncing ? 0.65 : 1,
            },
          ]}
          onPress={() => { void handleResync() }}
          disabled={isSyncing}
          accessibilityRole="button"
          accessibilityLabel="Re-sync school portal data"
          accessibilityState={{ busy: isSyncing }}
          activeOpacity={0.75}
        >
          {isSyncing ? (
            <View style={styles.resyncRow}>
              <ActivityIndicator color={c.primary} size="small" />
              <Text style={[styles.resyncLabel, { color: c.primary }]}>
                Syncing… this may take a moment
              </Text>
            </View>
          ) : (
            <View style={styles.resyncRow}>
              <Text style={[styles.resyncIcon, { color: c.textMuted }]}>↻</Text>
              <Text style={[styles.resyncLabel, { color: c.textSecondary }]}>
                Re-sync school data
              </Text>
              <Text style={[styles.resyncHint, { color: c.textMuted }]}>
                HAC · PowerSchool
              </Text>
            </View>
          )}
        </TouchableOpacity>

        {/* ── Quick Access ── */}
        <View style={styles.quickSection}>
          <Text style={[styles.sectionHeading, { color: c.textMuted }]}>
            Quick Access
          </Text>
          <View style={styles.quickGrid}>
            {QUICK_LINKS.map(link => (
              <TouchableOpacity
                key={link.dest}
                style={[
                  styles.quickCard,
                  {
                    backgroundColor: c.surface,
                    borderColor: c.border,
                  },
                ]}
                onPress={() => navigation.navigate(link.dest)}
                accessibilityRole="button"
                accessibilityLabel={`Navigate to ${link.label}`}
                activeOpacity={0.75}
              >
                <View style={[styles.quickIconWrap, { backgroundColor: link.iconBg }]}>
                  <Text style={styles.quickEmoji}>{link.emoji}</Text>
                </View>
                <Text
                  style={[styles.quickLabel, { color: c.text }]}
                  numberOfLines={1}
                >
                  {link.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* ── Ask AI prompt note ── */}
        <TouchableOpacity
          style={[
            styles.aiBar,
            {
              backgroundColor: c.surface,
              borderColor: c.border,
              minHeight: s.touchTarget,
            },
          ]}
          onPress={() => navigation.navigate('AIChat')}
          accessibilityRole="button"
          accessibilityLabel="Open AI Chat"
          activeOpacity={0.75}
        >
          <Text style={[styles.aiBarText, { color: c.textMuted }]}>
            Ask Futurely AI anything…
          </Text>
          <View style={[styles.aiArrow, { backgroundColor: c.primaryDim }]}>
            <Text style={[styles.aiArrowText, { color: c.primary }]}>→</Text>
          </View>
        </TouchableOpacity>

        {/* Bottom spacing for drawer gesture zone */}
        <View style={{ height: s.xl3 }} />
      </ScrollView>
    )
  }

  // ── Daily coins popup ─────────────────────────────────────────────────────────

  function renderCoinPopup(): React.JSX.Element | null {
    if (!coinPopup) return null
    return (
      <Modal
        visible={showCoinPopup}
        transparent
        animationType="fade"
        onRequestClose={() => setShowCoinPopup(false)}
        accessibilityViewIsModal
      >
        <View style={styles.popupBackdrop}>
          <View
            style={[
              styles.popupCard,
              { backgroundColor: c.surface, borderColor: c.border },
            ]}
          >
            <TouchableOpacity
              onPress={() => setShowCoinPopup(false)}
              style={styles.popupCloseBtn}
              accessibilityRole="button"
              accessibilityLabel="Close popup"
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={[styles.popupCloseText, { color: c.textMuted }]}>✕</Text>
            </TouchableOpacity>

            <Text style={styles.popupEmoji}>🪙</Text>

            <Text style={[styles.popupTitle, { color: c.text }]}>
              Daily Coins Claimed!
            </Text>

            <Text style={[styles.popupBody, { color: c.textSecondary }]}>
              You earned{' '}
              <Text style={[styles.popupHighlight, { color: c.warning }]}>
                {coinPopup.coins} coins
              </Text>{' '}
              today.
            </Text>

            {coinPopup.coinBonus > 0 && (
              <View
                style={[
                  styles.bonusBox,
                  {
                    backgroundColor: `${c.accentBlue}15`,
                    borderColor: `${c.accentBlue}40`,
                  },
                ]}
              >
                <Text style={[styles.bonusLabel, { color: c.textMuted }]}>
                  YOUR GPA BONUS
                </Text>
                <Text style={[styles.bonusValue, { color: c.accentBlue }]}>
                  +{gpaBonusPct.toFixed(1)}% daily boost
                </Text>
                <Text style={[styles.bonusHint, { color: c.textMuted }]}>
                  Applied to your daily coins · perfect GPA = +50%
                </Text>
              </View>
            )}

            <TouchableOpacity
              style={[
                styles.primaryBtn,
                { backgroundColor: c.primary, minHeight: s.touchTarget, marginTop: s.xl },
              ]}
              onPress={() => setShowCoinPopup(false)}
              accessibilityRole="button"
              accessibilityLabel="Dismiss"
            >
              <Text style={styles.primaryBtnText}>Got it!</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    )
  }

  // ── Top-level render ──────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <SafeAreaView
        style={[styles.fill, { backgroundColor: c.bg }]}
        edges={['top', 'left', 'right']}
      >
        {renderLoadingSkeleton()}
      </SafeAreaView>
    )
  }

  if (loadError !== null) {
    return renderError()
  }

  return (
    <SafeAreaView
      style={[styles.fill, { backgroundColor: c.bg }]}
      edges={Platform.OS === 'ios' ? [] : ['top', 'left', 'right']}
    >
      {renderContent()}
      {renderCoinPopup()}
    </SafeAreaView>
  )
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  fill:        { flex: 1 },
  centerFill:  { flex: 1, alignItems: 'center', justifyContent: 'center' },

  scroll:        { flex: 1 },
  scrollContent: { flexGrow: 1, paddingTop: 20, paddingBottom: 8 },

  // Header
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 24,
    flexWrap: 'wrap',
    gap: 12,
  },
  greeting: {
    fontSize: 15,
    marginBottom: 2,
  },
  userName: {
    fontSize: 32,
    fontWeight: '800',
    letterSpacing: -0.5,
    lineHeight: 38,
  },
  dateChip: {
    borderRadius: 20,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 6,
    alignSelf: 'flex-start',
    marginTop: 6,
  },
  dateChipText: {
    fontSize: 12,
    fontWeight: '600',
  },

  // Sync feedback
  syncFeedback: {
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 16,
  },
  syncFeedbackText: {
    fontSize: 13,
    fontWeight: '500',
  },

  // Cards: GPA + Due Today stacked in a column (mobile width)
  topRow: {
    gap: 12,
    marginBottom: 12,
  },
  card: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 16,
  },
  cardLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  cardLabel: {
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  hideGpaBtn: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  hideGpaBtnText: {
    fontSize: 12,
    fontWeight: '500',
  },

  // GPA display
  gpaRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  gpaBlock: {
    flex: 1,
    alignItems: 'center',
  },
  gpaNum: {
    fontSize: 42,
    fontWeight: '800',
    letterSpacing: -1.5,
    lineHeight: 46,
  },
  gpaTag: {
    fontSize: 12,
    marginTop: 4,
  },
  gpaDivider: {
    width: 1,
    height: 52,
    marginHorizontal: 8,
  },
  blurred: {
    // RN doesn't support CSS blur — use opacity as a privacy stand-in
    opacity: 0.07,
  },
  emptyCardMsg: {
    fontSize: 14,
    lineHeight: 20,
    fontStyle: 'italic',
  },

  // Due Today
  countPill: {
    borderRadius: 100,
    paddingHorizontal: 9,
    paddingVertical: 3,
  },
  countPillText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  allClearMsg: {
    fontSize: 15,
    fontStyle: 'italic',
  },
  dueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 10,
  },
  dueDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    flexShrink: 0,
  },
  dueTextCol: {
    flex: 1,
    minWidth: 0,
  },
  dueTitle: {
    fontSize: 14,
    fontWeight: '500',
  },
  dueSub: {
    fontSize: 12,
    marginTop: 2,
  },

  // Stat cards
  statRow: {
    gap: 10,
    marginBottom: 16,
  },
  statCard: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 64,
  },
  statNum: {
    fontSize: 32,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  statLabel: {
    fontSize: 13,
    flex: 1,
    textAlign: 'right',
    marginLeft: 12,
  },

  // Re-sync button
  resyncBtn: {
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginBottom: 24,
  },
  resyncRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  resyncIcon: {
    fontSize: 18,
    width: 20,
    textAlign: 'center',
  },
  resyncLabel: {
    fontSize: 14,
    fontWeight: '500',
    flex: 1,
  },
  resyncHint: {
    fontSize: 11,
    fontWeight: '500',
  },

  // Quick Access
  quickSection: {
    marginBottom: 20,
  },
  sectionHeading: {
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 12,
  },
  quickGrid: {
    gap: 10,
  },
  quickCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
    minHeight: 64,
  },
  quickIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  quickEmoji: {
    fontSize: 20,
  },
  quickLabel: {
    fontSize: 14,
    fontWeight: '700',
    flex: 1,
  },

  // AI bar
  aiBar: {
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  aiBarText: {
    fontSize: 14,
    flex: 1,
  },
  aiArrow: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  aiArrowText: {
    fontSize: 16,
    fontWeight: '700',
  },

  // Skeleton
  skeletonBox: {
    opacity: 0.5,
  },

  // Error state
  errorTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 8,
  },
  errorMsg: {
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 20,
  },

  // Buttons
  primaryBtn: {
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  primaryBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },

  // Coin popup / modal
  popupBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  popupCard: {
    width: '100%',
    maxWidth: 380,
    borderRadius: 16,
    borderWidth: 1,
    padding: 28,
    position: 'relative',
  },
  popupCloseBtn: {
    position: 'absolute',
    top: 12,
    right: 12,
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  popupCloseText: {
    fontSize: 16,
  },
  popupEmoji: {
    fontSize: 48,
    textAlign: 'center',
    marginBottom: 16,
  },
  popupTitle: {
    fontSize: 20,
    fontWeight: '800',
    textAlign: 'center',
    letterSpacing: -0.5,
    marginBottom: 10,
  },
  popupBody: {
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 16,
  },
  popupHighlight: {
    fontWeight: '700',
  },
  bonusBox: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 16,
    alignItems: 'center',
    marginBottom: 4,
  },
  bonusLabel: {
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.7,
    marginBottom: 6,
  },
  bonusValue: {
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 4,
  },
  bonusHint: {
    fontSize: 12,
    textAlign: 'center',
  },
})
