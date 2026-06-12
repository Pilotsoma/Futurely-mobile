import React, { useEffect, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import Text from '../components/ui/Text'
import BranchHeader from '../components/ui/BranchHeader'
import { colors } from '../constants/colors'
import type { GradePortalParamList } from '../navigation/GradePortalNavigator'
import {
  getPortalStatus,
  disconnectPortal,
  type PortalStatus,
} from '../api/portalApi'

type NavProp = NativeStackNavigationProp<GradePortalParamList>

type ParamlessDashboardScreen = 'GradePortalHome' | 'GradeViewer' | 'Transcript' | 'ClassSchedule' | 'ContactTeachers' | 'Simulator' | 'PortalConnect'

interface Tile {
  title: string
  description: string
  icon: React.ComponentProps<typeof Ionicons>['name']
  iconColor: string
  screen?: ParamlessDashboardScreen
  soon?: boolean
}

const TILES: Tile[] = [
  {
    title: 'Report Card',
    description: 'Grades & letter grades',
    icon: 'clipboard-outline',
    iconColor: colors.primary,
    screen: 'GradeViewer',
  },
  {
    title: 'Transcript',
    description: 'Credits & GPA history',
    icon: 'document-text-outline',
    iconColor: colors.info,
    screen: 'Transcript',
  },
  {
    title: 'Class Schedule',
    description: 'Your class periods',
    icon: 'time-outline',
    iconColor: colors.warning,
    screen: 'ClassSchedule',
  },
  {
    title: 'What-If Calculator',
    description: 'Simulate grade changes',
    icon: 'calculator-outline',
    iconColor: colors.success,
    screen: 'Simulator',
  },
  {
    title: 'Contact Teachers',
    description: 'Email your teachers',
    icon: 'mail-outline',
    iconColor: colors.orange,
    screen: 'ContactTeachers',
  },
  {
    title: 'Progress Report',
    description: 'Interim grades',
    icon: 'bar-chart-outline',
    iconColor: '#BC8CFF',
    soon: true,
  },
]

export default function GradePortalDashboard(): React.JSX.Element {
  const navigation = useNavigation<NavProp>()

  const [portalStatus, setPortalStatus] = useState<PortalStatus | null>(null)
  const [statusLoading, setStatusLoading] = useState(true)
  const [statusError, setStatusError] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)

  useEffect(() => {
    loadPortalStatus()
  }, [])

  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => {
      loadPortalStatus()
    })
    return unsubscribe
  }, [navigation])

  const loadPortalStatus = async (): Promise<void> => {
    setStatusLoading(true)
    setStatusError(null)
    try {
      const status = await getPortalStatus()
      setPortalStatus(status)
    } catch (err: unknown) {
      setStatusError(err instanceof Error ? err.message : 'Could not check portal status')
    } finally {
      setStatusLoading(false)
    }
  }

  const handleSync = async (): Promise<void> => {
    setSyncing(true)
    try {
      await loadPortalStatus()
    } finally {
      setSyncing(false)
    }
  }

  const handleDisconnect = (): void => {
    Alert.alert(
      'Disconnect Portal',
      'Are you sure you want to disconnect your school portal? Your grades will no longer sync.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Disconnect',
          style: 'destructive',
          onPress: async () => {
            setDisconnecting(true)
            try {
              await disconnectPortal()
              setPortalStatus(null)
              await loadPortalStatus()
            } catch (err: unknown) {
              Alert.alert('Error', err instanceof Error ? err.message : 'Failed to disconnect')
            } finally {
              setDisconnecting(false)
            }
          },
        },
      ]
    )
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <BranchHeader />
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Portal Status Card ── */}
        {statusLoading ? (
          <View style={[styles.statusCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <ActivityIndicator color={colors.primary} size="small" />
          </View>
        ) : statusError ? (
          <View style={[styles.statusCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text variant="caption" style={{ color: colors.textSecondary }}>
              Could not load portal status. Tap to retry.
            </Text>
            <TouchableOpacity onPress={loadPortalStatus} style={{ marginTop: 8 }}>
              <Text variant="caption" style={{ color: colors.primary }}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : portalStatus?.connected ? (
          <View style={[styles.statusCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={styles.statusCardRow}>
              <View style={[styles.statusDot, { backgroundColor: colors.success }]} />
              <Text variant="h3" style={{ color: colors.success }}>Connected</Text>
              <Text variant="caption" style={{ color: colors.textSecondary, marginLeft: 4 }}>
                · {portalStatus.systemType ?? ''}
              </Text>
            </View>
            <View style={styles.statusCardMeta}>
              <Text variant="caption" style={{ color: colors.textSecondary }} numberOfLines={1}>
                {portalStatus.districtUrl ?? ''}
              </Text>
              <Text variant="caption" style={{ color: colors.textMuted }}>
                {portalStatus.lastSynced
                  ? `Last synced: ${new Date(portalStatus.lastSynced).toLocaleDateString()}`
                  : 'Never synced'}
              </Text>
            </View>
            <View style={styles.statusCardActions}>
              <TouchableOpacity
                style={[styles.statusActionButton, { backgroundColor: colors.primary, borderColor: colors.primary }]}
                onPress={handleSync}
                disabled={syncing}
              >
                {syncing
                  ? <ActivityIndicator color="#000" size="small" />
                  : <Text style={[styles.statusActionText, { color: '#000' }]}>Sync Grades</Text>
                }
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.statusActionButton, { backgroundColor: colors.surface, borderColor: colors.border }]}
                onPress={handleDisconnect}
                disabled={disconnecting}
              >
                {disconnecting
                  ? <ActivityIndicator color={colors.textSecondary} size="small" />
                  : <Text style={[styles.statusActionText, { color: colors.textSecondary }]}>Disconnect</Text>
                }
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <View style={[styles.connectBanner, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Ionicons name="link-outline" size={28} color={colors.textSecondary} />
            <Text style={[styles.connectBannerText, { color: colors.textPrimary }]}>
              Connect your school portal to see live grades
            </Text>
            <TouchableOpacity
              style={[styles.connectBannerButton, { backgroundColor: colors.primary }]}
              onPress={() => navigation.navigate('PortalConnect')}
              accessibilityRole="button"
              accessibilityLabel="Connect School Portal"
            >
              <Text style={styles.connectBannerButtonText}>Connect School Portal</Text>
            </TouchableOpacity>
          </View>
        )}

        <Text variant="heading" style={styles.title}>Grade Portal</Text>
        <View style={styles.grid}>
          {TILES.map(tile => (
            <TouchableOpacity
              key={tile.title}
              style={styles.tile}
              onPress={() => {
                if (tile.soon) {
                  Alert.alert('Coming Soon', 'This feature is coming in Phase 2!')
                } else if (tile.screen) {
                  navigation.navigate(tile.screen)
                }
              }}
              activeOpacity={0.75}
              accessibilityRole="button"
              accessibilityLabel={tile.title}
            >
              <View style={[styles.iconCircle, { backgroundColor: tile.iconColor + '26' }]}>
                <Ionicons name={tile.icon} size={24} color={tile.iconColor} />
              </View>
              <Text variant="h3" style={styles.tileTitle}>{tile.title}</Text>
              <Text variant="caption" style={styles.tileDesc}>{tile.description}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  scrollContent: {
    paddingHorizontal: 20,
    paddingBottom: 40,
  },
  title: { marginBottom: 20 },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  tile: {
    width: '48%',
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
  },
  iconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileTitle: { marginTop: 10 },
  tileDesc: { marginTop: 4 },
  // Portal connection card
  statusCard: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 16,
    marginBottom: 20,
  },
  statusCardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  statusCardMeta: {
    marginTop: 10,
  },
  statusCardActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 14,
  },
  statusActionButton: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
  },
  statusActionText: {
    fontSize: 13,
    fontWeight: '600',
  },
  connectBanner: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 16,
    marginBottom: 20,
    alignItems: 'center',
    gap: 10,
  },
  connectBannerText: {
    textAlign: 'center',
    fontSize: 14,
  },
  connectBannerButton: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
    marginTop: 4,
  },
  connectBannerButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#000',
  },
})
