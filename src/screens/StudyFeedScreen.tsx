import React, { useCallback, useState } from 'react'
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import { Feather } from '@expo/vector-icons'
import * as feedApi from '../api/feedApi'
import { ApiRequestError } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { Screen } from '../components/ui/Screen'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { LoadingSkeleton } from '../components/ui/LoadingSkeleton'
import { EmptyState } from '../components/ui/EmptyState'
import type { FeedComment, FeedPost, FeedUserProfile, FeedUserSummary } from '../types/feed'
import { colors, fonts, spacing, typography } from '../theme/tokens'

type Tab = 'all' | 'following'

// A single self-contained screen rather than a nested stack: post detail
// (comments) and user profile expand inline in place, since this is a
// secondary feature relative to the academic core — see melodic-wobbling-pillow.md.
export default function StudyFeedScreen(): React.JSX.Element {
  const { user } = useAuth()
  const [tab, setTab] = useState<Tab>('all')
  const [posts, setPosts] = useState<FeedPost[]>([])
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [composeText, setComposeText] = useState('')
  const [posting, setPosting] = useState(false)

  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<FeedUserSummary[]>([])

  const [expandedPostId, setExpandedPostId] = useState<number | null>(null)
  const [comments, setComments] = useState<FeedComment[]>([])
  const [commentText, setCommentText] = useState('')

  const [expandedProfile, setExpandedProfile] = useState<FeedUserProfile | null>(null)

  const load = useCallback(
    async (targetTab: Tab) => {
      setError(null)
      try {
        const result =
          targetTab === 'all' ? await feedApi.listPosts({ page: 1 }) : await feedApi.listFollowingPosts({ page: 1 })
        setPosts(result.posts)
        setPage(1)
        setHasMore(result.hasMore)
      } catch (err) {
        setError(err instanceof ApiRequestError ? err.message : 'Could not load the feed.')
      } finally {
        setLoading(false)
      }
    },
    [],
  )

  useFocusEffect(
    useCallback(() => {
      setLoading(true)
      void load(tab)
    }, [load, tab]),
  )

  async function loadMore(): Promise<void> {
    if (!hasMore) return
    const nextPage = page + 1
    try {
      const result =
        tab === 'all' ? await feedApi.listPosts({ page: nextPage }) : await feedApi.listFollowingPosts({ page: nextPage })
      setPosts((prev) => [...prev, ...result.posts])
      setPage(nextPage)
      setHasMore(result.hasMore)
    } catch {
      // Silent — pagination failures shouldn't blank the already-loaded feed.
    }
  }

  async function handlePost(): Promise<void> {
    if (!composeText.trim()) return
    setPosting(true)
    try {
      const created = await feedApi.createPost({ body: composeText.trim() })
      setPosts((prev) => [created, ...prev])
      setComposeText('')
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not create your post.')
    } finally {
      setPosting(false)
    }
  }

  async function handleToggleLike(post: FeedPost): Promise<void> {
    const wasLiked = post.likedByMe
    setPosts((prev) =>
      prev.map((p) =>
        p.id === post.id
          ? { ...p, likedByMe: !wasLiked, _count: { ...p._count, likes: p._count.likes + (wasLiked ? -1 : 1) } }
          : p,
      ),
    )
    try {
      await feedApi.toggleLike(post.id)
    } catch {
      // Roll back on failure.
      setPosts((prev) =>
        prev.map((p) =>
          p.id === post.id
            ? { ...p, likedByMe: wasLiked, _count: { ...p._count, likes: p._count.likes + (wasLiked ? 1 : -1) } }
            : p,
        ),
      )
    }
  }

  async function handleExpandComments(post: FeedPost): Promise<void> {
    if (expandedPostId === post.id) {
      setExpandedPostId(null)
      return
    }
    setExpandedPostId(post.id)
    try {
      const detail = await feedApi.getPost(post.id)
      setComments(detail.comments)
    } catch {
      setComments([])
    }
  }

  async function handleAddComment(postId: number): Promise<void> {
    if (!commentText.trim()) return
    try {
      const created = await feedApi.createComment(postId, { body: commentText.trim() })
      setComments((prev) => [...prev, created])
      setCommentText('')
      setPosts((prev) =>
        prev.map((p) => (p.id === postId ? { ...p, _count: { ...p._count, comments: p._count.comments + 1 } } : p)),
      )
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not add your comment.')
    }
  }

  async function handleDeletePost(post: FeedPost): Promise<void> {
    const previous = posts
    setPosts((prev) => prev.filter((p) => p.id !== post.id))
    try {
      await feedApi.deletePost(post.id)
    } catch (err) {
      setPosts(previous)
      setError(err instanceof ApiRequestError ? err.message : 'Could not delete your post.')
    }
  }

  async function handleToggleCommentLike(postId: number, comment: FeedComment): Promise<void> {
    const wasLiked = comment.likedByMe ?? false
    setComments((prev) =>
      prev.map((c) =>
        c.id === comment.id
          ? { ...c, likedByMe: !wasLiked, _count: { likes: (c._count?.likes ?? 0) + (wasLiked ? -1 : 1) } }
          : c,
      ),
    )
    try {
      await feedApi.toggleCommentLike(postId, comment.id)
    } catch {
      setComments((prev) =>
        prev.map((c) =>
          c.id === comment.id
            ? { ...c, likedByMe: wasLiked, _count: { likes: (c._count?.likes ?? 0) + (wasLiked ? 1 : -1) } }
            : c,
        ),
      )
    }
  }

  async function handleSearch(query: string): Promise<void> {
    setSearchQuery(query)
    if (!query.trim()) {
      setSearchResults([])
      return
    }
    try {
      setSearchResults(await feedApi.searchUsers(query))
    } catch {
      setSearchResults([])
    }
  }

  async function handleShowProfile(userId: number): Promise<void> {
    try {
      setExpandedProfile(await feedApi.getUserProfile(userId))
    } catch {
      setExpandedProfile(null)
    }
  }

  async function handleToggleFollow(): Promise<void> {
    if (!expandedProfile) return
    const wasFollowing = expandedProfile.isFollowing
    setExpandedProfile({ ...expandedProfile, isFollowing: !wasFollowing })
    try {
      await feedApi.toggleFollow(expandedProfile.id)
    } catch {
      setExpandedProfile((prev) => (prev ? { ...prev, isFollowing: wasFollowing } : prev))
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
      <Text style={styles.title}>Study Feed</Text>
      <View style={styles.tabRow}>
        <Button label="All" variant={tab === 'all' ? 'primary' : 'secondary'} onPress={() => setTab('all')} style={styles.tabButton} />
        <Button
          label="Following"
          variant={tab === 'following' ? 'primary' : 'secondary'}
          onPress={() => setTab('following')}
          style={styles.tabButton}
        />
      </View>

      <Input label="Find people" value={searchQuery} onChangeText={(v) => void handleSearch(v)} placeholder="Search by name" />

      {searchResults.length > 0 ? (
        <Card style={styles.searchResults}>
          {searchResults.map((u) => (
            <Button
              key={u.id}
              label={u.name ?? u.hacName ?? 'Student'}
              variant="secondary"
              onPress={() => void handleShowProfile(u.id)}
            />
          ))}
        </Card>
      ) : null}

      {expandedProfile ? (
        <Card style={styles.profileCard}>
          <Text style={styles.profileName}>{expandedProfile.name ?? 'Student'}</Text>
          <Text style={styles.profileStats}>
            {expandedProfile._count.followers} followers · {expandedProfile._count.following} following ·{' '}
            {expandedProfile.totalLikes} likes
          </Text>
          <Button
            label={expandedProfile.isFollowing ? 'Unfollow' : 'Follow'}
            variant={expandedProfile.isFollowing ? 'secondary' : 'primary'}
            onPress={() => void handleToggleFollow()}
          />
        </Card>
      ) : null}

      <Card style={styles.composeCard}>
        <Input value={composeText} onChangeText={setComposeText} placeholder="Share something with the study feed..." multiline />
        <Button label="Post" onPress={() => void handlePost()} loading={posting} />
      </Card>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {posts.length === 0 ? (
        <EmptyState icon="message-circle" title="No posts yet" message="Be the first to share something." />
      ) : (
        <FlatList
          data={posts}
          keyExtractor={(p) => String(p.id)}
          contentContainerStyle={styles.listContent}
          onEndReached={() => void loadMore()}
          onEndReachedThreshold={0.4}
          renderItem={({ item }) => {
            const authorName = item.user.name ?? item.user.hacName ?? 'Student'
            return (
              <Card style={styles.postCard}>
                <View style={styles.postHeaderRow}>
                  <Pressable
                    style={styles.authorRow}
                    onPress={() => void handleShowProfile(item.userId)}
                    accessibilityRole="button"
                    accessibilityLabel={authorName}
                  >
                    <View style={styles.avatar}>
                      <Text style={styles.avatarText}>{authorName.charAt(0).toUpperCase()}</Text>
                    </View>
                    <Text style={styles.authorName}>{authorName}</Text>
                  </Pressable>
                  {user?.id === item.userId ? (
                    <Pressable
                      onPress={() => void handleDeletePost(item)}
                      hitSlop={8}
                      accessibilityRole="button"
                      accessibilityLabel="Delete post"
                    >
                      <Feather name="trash-2" size={16} color={colors.textMuted} />
                    </Pressable>
                  ) : null}
                </View>
                <Text style={styles.postBody}>{item.body}</Text>
                <View style={styles.postActions}>
                  <Pressable style={styles.actionRow} onPress={() => void handleToggleLike(item)}>
                    <Feather name="heart" size={15} color={item.likedByMe ? colors.error : colors.textMuted} />
                    <Text style={styles.actionText}>{item._count.likes}</Text>
                  </Pressable>
                  <Pressable style={styles.actionRow} onPress={() => void handleExpandComments(item)}>
                    <Feather name="message-circle" size={15} color={colors.textMuted} />
                    <Text style={styles.actionText}>{item._count.comments}</Text>
                  </Pressable>
                </View>

                {expandedPostId === item.id ? (
                  <View style={styles.commentsSection}>
                    {comments.map((c) => (
                      <View key={c.id} style={styles.commentRow}>
                        <Text style={styles.commentAuthor}>{c.user.name ?? 'Student'}</Text>
                        <Text style={styles.commentBody}>{c.body}</Text>
                        <Pressable
                          style={styles.actionRow}
                          onPress={() => void handleToggleCommentLike(item.id, c)}
                        >
                          <Feather
                            name="heart"
                            size={13}
                            color={c.likedByMe ? colors.error : colors.textMuted}
                          />
                          <Text style={styles.actionText}>{c._count?.likes ?? 0}</Text>
                        </Pressable>
                      </View>
                    ))}
                    <Input value={commentText} onChangeText={setCommentText} placeholder="Add a comment..." />
                    <Button label="Reply" onPress={() => void handleAddComment(item.id)} variant="secondary" />
                  </View>
                ) : null}
              </Card>
            )
          }}
        />
      )}
    </Screen>
  )
}

const styles = StyleSheet.create({
  title: { ...typography.h1, color: colors.text, marginBottom: spacing.md },
  tabRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm },
  tabButton: { flex: 1 },
  searchResults: { gap: spacing.xs, marginTop: spacing.sm },
  profileCard: { gap: spacing.xs, marginTop: spacing.sm, alignItems: 'center' },
  profileName: { ...typography.h3, color: colors.text },
  profileStats: { ...typography.caption, color: colors.textSecondary },
  composeCard: { gap: spacing.sm, marginVertical: spacing.md },
  error: { ...typography.caption, color: colors.error, marginBottom: spacing.sm },
  listContent: { gap: spacing.md, paddingBottom: spacing.xl },
  postCard: { gap: spacing.sm },
  postHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  authorRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flex: 1 },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: '#FFFFFF', fontFamily: fonts.bold, fontWeight: '700', fontSize: 13 },
  authorName: { ...typography.h3, fontSize: 13.5, color: colors.text },
  postBody: { ...typography.body, color: colors.text },
  postActions: { flexDirection: 'row', gap: spacing.lg },
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  actionText: { ...typography.caption, color: colors.textMuted },
  commentsSection: { gap: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm },
  commentRow: { gap: spacing.xs },
  commentAuthor: { ...typography.label, color: colors.textSecondary },
  commentBody: { ...typography.body, color: colors.text },
})
