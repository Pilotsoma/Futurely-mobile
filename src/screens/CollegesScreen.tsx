import React, { useCallback, useState } from 'react'
import { FlatList, StyleSheet, Text, View } from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import * as collegesApi from '../api/collegesApi'
import { ApiRequestError } from '../api/client'
import { Screen } from '../components/ui/Screen'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { LoadingSkeleton } from '../components/ui/LoadingSkeleton'
import { EmptyState } from '../components/ui/EmptyState'
import type { CollegeInsights, CollegeListItem, CollegeSearchResult } from '../types/colleges'
import { colors, spacing, typography } from '../theme/tokens'

export default function CollegesScreen(): React.JSX.Element {
  const [saved, setSaved] = useState<CollegeListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [query, setQuery] = useState('')
  const [searchResults, setSearchResults] = useState<CollegeSearchResult[]>([])
  const [searching, setSearching] = useState(false)

  const [insights, setInsights] = useState<Record<number, CollegeInsights>>({})
  const [insightsLoading, setInsightsLoading] = useState<Record<number, boolean>>({})
  const [insightsError, setInsightsError] = useState<Record<number, string>>({})

  const load = useCallback(async () => {
    setError(null)
    try {
      setSaved(await collegesApi.listSavedColleges())
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not load your college list.')
    } finally {
      setLoading(false)
    }
  }, [])

  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load]),
  )

  async function handleSearch(text: string): Promise<void> {
    setQuery(text)
    if (!text.trim()) {
      setSearchResults([])
      return
    }
    setSearching(true)
    try {
      setSearchResults(await collegesApi.searchColleges(text))
    } catch {
      setSearchResults([])
    } finally {
      setSearching(false)
    }
  }

  async function handleAdd(result: CollegeSearchResult): Promise<void> {
    try {
      const added = await collegesApi.addCollege({ name: result.name, scorecardUnitId: result.unitId })
      setSaved((prev) => [...prev, added])
      setQuery('')
      setSearchResults([])
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not add this college.')
    }
  }

  async function handleRemove(id: number): Promise<void> {
    const previous = saved
    setSaved((prev) => prev.filter((c) => c.id !== id))
    try {
      await collegesApi.removeCollege(id)
    } catch {
      setSaved(previous)
    }
  }

  async function handleLoadInsights(item: CollegeListItem): Promise<void> {
    if (insights[item.id]) return
    setInsightsLoading((prev) => ({ ...prev, [item.id]: true }))
    setInsightsError((prev) => ({ ...prev, [item.id]: '' }))
    try {
      const result = await collegesApi.getCollegeInsights(item.id)
      setInsights((prev) => ({ ...prev, [item.id]: result }))
    } catch (err) {
      setInsightsError((prev) => ({
        ...prev,
        [item.id]: err instanceof ApiRequestError ? err.message : 'Insights unavailable right now.',
      }))
    } finally {
      setInsightsLoading((prev) => ({ ...prev, [item.id]: false }))
    }
  }

  if (loading) {
    return (
      <Screen>
        <LoadingSkeleton rows={4} />
      </Screen>
    )
  }

  return (
    <Screen>
      <Text style={styles.title}>Colleges</Text>
      <Input
        label="Search colleges"
        value={query}
        onChangeText={(v) => void handleSearch(v)}
        placeholder="e.g. University of Texas"
      />

      {searching ? <LoadingSkeleton rows={2} /> : null}

      {searchResults.length > 0 ? (
        <Card style={styles.searchResults}>
          {searchResults.map((r) => (
            <View key={r.unitId} style={styles.searchRow}>
              <View style={styles.searchInfo}>
                <Text style={styles.searchName}>{r.name}</Text>
                <Text style={styles.searchMeta}>
                  {r.city ? `${r.city}, ${r.state}` : (r.state ?? '')} ·{' '}
                  {r.admissionRate !== null ? `${Math.round(r.admissionRate * 100)}% admit` : 'No data'}
                </Text>
              </View>
              <Button label="Add" onPress={() => void handleAdd(r)} variant="secondary" style={styles.addButton} />
            </View>
          ))}
        </Card>
      ) : null}

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Text style={styles.sectionTitle}>Your list ({saved.length})</Text>
      {saved.length === 0 ? (
        <EmptyState icon="bookmark" title="No colleges saved" message="Search above to add colleges to your list." />
      ) : (
        <FlatList
          data={saved}
          keyExtractor={(c) => String(c.id)}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => (
            <Card style={styles.collegeCard}>
              <View style={styles.collegeHeader}>
                <View style={styles.collegeInfo}>
                  <Text style={styles.collegeName}>{item.name}</Text>
                  {item.label ? <Text style={styles.collegeLabel}>{item.label}</Text> : null}
                </View>
                <Button
                  label="Remove"
                  onPress={() => void handleRemove(item.id)}
                  variant="destructive"
                  style={styles.removeButton}
                />
              </View>

              {insights[item.id] ? (
                <Text style={styles.insightText}>{insights[item.id].narrativeSummary}</Text>
              ) : insightsError[item.id] ? (
                <Text style={styles.error}>{insightsError[item.id]}</Text>
              ) : (
                <Button
                  label="Get AI insights"
                  onPress={() => void handleLoadInsights(item)}
                  loading={insightsLoading[item.id] === true}
                  variant="secondary"
                />
              )}
            </Card>
          )}
        />
      )}
    </Screen>
  )
}

const styles = StyleSheet.create({
  title: { ...typography.h1, color: colors.text, marginBottom: spacing.sm },
  searchResults: { gap: spacing.sm, marginTop: spacing.sm },
  searchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  searchInfo: { flex: 1, marginRight: spacing.sm },
  searchName: { ...typography.h3, color: colors.text },
  searchMeta: { ...typography.caption, color: colors.textSecondary },
  addButton: { height: 36, paddingHorizontal: spacing.sm },
  error: { ...typography.caption, color: colors.error },
  sectionTitle: { ...typography.h2, color: colors.text, marginTop: spacing.md, marginBottom: spacing.sm },
  listContent: { gap: spacing.md, paddingBottom: spacing.xl },
  collegeCard: { gap: spacing.sm },
  collegeHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  collegeInfo: { flex: 1, gap: spacing.xs, marginRight: spacing.sm },
  collegeName: { ...typography.h3, color: colors.text },
  collegeLabel: { ...typography.caption, color: colors.primary },
  removeButton: { height: 36, paddingHorizontal: spacing.sm },
  insightText: { ...typography.body, color: colors.textSecondary },
})
