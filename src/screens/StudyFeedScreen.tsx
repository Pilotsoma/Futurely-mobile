// StudyFeedScreen — Futurely social feed.
//
// Mirrors web app/feed/page.tsx screen-for-screen, translated to React Native.
//
// Features built (core student social loop):
//   - Paginated ranked feed (global network, load-more on scroll)
//   - Create post (text composer sheet)
//   - Like a post / unlike
//   - View post detail + comments
//   - Like a comment
//   - Add a comment
//   - Delete own post (with confirm prompt)
//   - User profile sheet (stats + follow/unfollow + their posts)
//   - User search (modal)
//
// Features deliberately omitted (DEV/admin/moderation only, per task brief):
//   - Giveaway create/enter/draw (requireAdmin gate server-side)
//   - Pin post (requireAdmin gate server-side)
//   - Tag award / reset (requireAdmin gate server-side)
//   - Coin send (marketplace feature outside feed scope)
//   - ISD network toggle (ISD feed requires school portal — adds complex conditional
//     flow best handled once the school-connection gate is in place)
//   - Ban/mute controls (requireMod gate server-side)
//   - Following-feed tab (scope: global feed only for MVP)
//
// Error handling: every async action surfaces error.message from ApiRequestError.
// Loading: skeleton placeholders for initial load; inline spinners for actions.

import React, {
  useState,
  useCallback,
  useRef,
  useEffect,
} from 'react'
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  StyleSheet,
  Modal,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useTheme } from '../theme/ThemeContext'
import { useAuth } from '../context/AuthContext'
import { ApiRequestError } from '../api/client'
import {
  getFeedPosts,
  getPostDetail,
  createPost,
  deletePost,
  toggleLike,
  addComment,
  toggleCommentLike,
  searchUsers,
  getUserProfile,
  getUserPosts,
  toggleFollow,
  type FeedPost,
  type FeedComment,
  type FeedUser,
  type FeedUserProfile,
} from '../api/feedApi'

// ── Helpers ────────────────────────────────────────────────────────────────────

function timeAgo(dateStr: string): string {
  const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000)
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

function parseHacName(raw: string | null | undefined): string {
  if (!raw) return ''
  const cap = (s: string): string =>
    s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : ''
  if (raw.includes(',')) {
    const [rawLast, rawRest = ''] = raw.split(',')
    const first = cap(rawRest.trim().split(' ')[0] ?? '')
    const last = cap(rawLast.trim())
    return `${first} ${last}`.trim()
  }
  return raw
}

function displayName(user: {
  name: string | null
  hacName?: string | null
}): string {
  if (user.name) return user.name
  if (user.hacName) return parseHacName(user.hacName)
  return 'User'
}

function avatarInitials(user: {
  name: string | null
  hacName?: string | null
}): string {
  const n = displayName(user)
  const parts = n.trim().split(' ')
  if (parts.length >= 2 && parts[0] && parts[parts.length - 1]) {
    return (parts[0][0]! + parts[parts.length - 1][0]!).toUpperCase()
  }
  return n.slice(0, 2).toUpperCase()
}

function extractErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiRequestError) return err.message
  if (err instanceof Error) return err.message
  return fallback
}

// ── Sub-components ─────────────────────────────────────────────────────────────

/** Circular avatar with initials fallback. */
function Avatar({
  user,
  size = 38,
  onPress,
}: {
  user: FeedUser | FeedUserProfile
  size?: number
  onPress?: () => void
}): React.JSX.Element {
  const initText = avatarInitials(user)
  const inner = (
    <View
      style={[
        avatarStyles.circle,
        { width: size, height: size, borderRadius: size / 2 },
      ]}
      accessibilityLabel={`${displayName(user)}'s avatar`}
    >
      <Text
        style={[avatarStyles.initials, { fontSize: size * 0.36 }]}
        allowFontScaling={false}
      >
        {initText}
      </Text>
    </View>
  )

  if (onPress) {
    return (
      <TouchableOpacity
        onPress={onPress}
        hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
        accessibilityRole="button"
        accessibilityLabel={`View ${displayName(user)}'s profile`}
      >
        {inner}
      </TouchableOpacity>
    )
  }
  return inner
}

const avatarStyles = StyleSheet.create({
  circle: {
    backgroundColor: '#2D6A4F',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  initials: {
    color: '#FFFFFF',
    fontWeight: '800',
  },
})

/** User tag badge — rendered inline after the display name. */
function TagBadge({
  tag,
  tagColor,
}: {
  tag: string | null
  tagColor: string | null
}): React.JSX.Element | null {
  if (!tag) return null
  const color = tagColor && tagColor !== 'grey' ? tagColor : '#6B7280'
  return (
    <View
      style={[
        tagBadgeStyles.badge,
        { borderColor: color, backgroundColor: `${color}22` },
      ]}
    >
      <Text style={[tagBadgeStyles.text, { color }]}>{tag}</Text>
    </View>
  )
}

const tagBadgeStyles = StyleSheet.create({
  badge: {
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    alignSelf: 'flex-start',
  },
  text: {
    fontSize: 11,
    fontWeight: '700',
  },
})

/** Skeleton card placeholder for loading state. */
function PostSkeleton(): React.JSX.Element {
  const { theme } = useTheme()
  const c = theme.colors
  return (
    <View
      style={[
        skeletonStyles.card,
        { backgroundColor: c.surface, borderColor: c.border },
      ]}
    >
      <View style={skeletonStyles.header}>
        <View
          style={[
            skeletonStyles.avatarSkeleton,
            { backgroundColor: c.surface2 },
          ]}
        />
        <View style={skeletonStyles.headerText}>
          <View
            style={[skeletonStyles.lineLong, { backgroundColor: c.surface2 }]}
          />
          <View
            style={[skeletonStyles.lineShort, { backgroundColor: c.surface2 }]}
          />
        </View>
      </View>
      <View
        style={[skeletonStyles.bodyLine1, { backgroundColor: c.surface2 }]}
      />
      <View
        style={[skeletonStyles.bodyLine2, { backgroundColor: c.surface2 }]}
      />
    </View>
  )
}

const skeletonStyles = StyleSheet.create({
  card: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 16,
    marginBottom: 12,
  },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 12, gap: 10 },
  avatarSkeleton: { width: 38, height: 38, borderRadius: 19 },
  headerText: { flex: 1, gap: 6 },
  lineLong: { height: 12, borderRadius: 6, width: '55%' },
  lineShort: { height: 10, borderRadius: 5, width: '30%' },
  bodyLine1: { height: 12, borderRadius: 6, marginBottom: 8 },
  bodyLine2: { height: 12, borderRadius: 6, width: '80%' },
})

// ── Post Card ─────────────────────────────────────────────────────────────────

interface PostCardProps {
  post: FeedPost
  currentUserId: number
  onLike: (postId: number) => void
  onOpenComments: (postId: number) => void
  onOpenProfile: (userId: number) => void
  onDelete: (postId: number) => void
}

function PostCard({
  post,
  currentUserId,
  onLike,
  onOpenComments,
  onOpenProfile,
  onDelete,
}: PostCardProps): React.JSX.Element {
  const { theme } = useTheme()
  const c = theme.colors

  const isOwn = post.userId === currentUserId
  const isPinned = !!post.pinnedUntil && new Date(post.pinnedUntil) > new Date()
  const uName = displayName(post.user)

  return (
    <View
      style={[
        postCardStyles.card,
        { backgroundColor: c.surface, borderColor: c.border },
        isPinned && { borderColor: c.primary },
      ]}
    >
      {isPinned && (
        <View style={postCardStyles.pinnedBanner}>
          <Text style={[postCardStyles.pinnedText, { color: c.primary }]}>
            PINNED
          </Text>
        </View>
      )}

      {/* Header row */}
      <View style={postCardStyles.header}>
        <Avatar user={post.user} onPress={() => onOpenProfile(post.userId)} />

        <View style={postCardStyles.headerMeta}>
          <View style={postCardStyles.nameRow}>
            <TouchableOpacity
              onPress={() => onOpenProfile(post.userId)}
              hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
              accessibilityRole="button"
              accessibilityLabel={`View ${uName}'s profile`}
            >
              <Text
                style={[
                  postCardStyles.authorName,
                  { color: post.user.nameColor && post.user.nameColor !== 'rainbow' && post.user.nameColor !== 'curse'
                      ? post.user.nameColor
                      : c.text },
                ]}
                numberOfLines={1}
              >
                {uName}
              </Text>
            </TouchableOpacity>
            {post.user.tag !== null && (
              <TagBadge tag={post.user.tag} tagColor={post.user.tagColor} />
            )}
          </View>
          <Text style={[postCardStyles.timestamp, { color: c.textMuted }]}>
            {timeAgo(post.createdAt)}
          </Text>
        </View>

        {isOwn && (
          <TouchableOpacity
            style={postCardStyles.deleteBtn}
            onPress={() => onDelete(post.id)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel="Delete post"
          >
            <Text style={[postCardStyles.deleteBtnText, { color: c.textMuted }]}>
              ✕
            </Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Body */}
      <Text
        style={[postCardStyles.body, { color: c.text }]}
        selectable
      >
        {post.body}
      </Text>

      {/* Actions */}
      <View
        style={[postCardStyles.actions, { borderTopColor: c.border }]}
      >
        <TouchableOpacity
          style={postCardStyles.actionBtn}
          onPress={() => onLike(post.id)}
          accessibilityRole="button"
          accessibilityLabel={
            post.likedByMe
              ? `Unlike post — ${post._count.likes} likes`
              : `Like post — ${post._count.likes} likes`
          }
        >
          <Text
            style={[
              postCardStyles.actionIcon,
              { color: post.likedByMe ? c.error : c.textSecondary },
            ]}
          >
            {post.likedByMe ? '♥' : '♡'}
          </Text>
          <Text style={[postCardStyles.actionCount, { color: c.textSecondary }]}>
            {post._count.likes}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={postCardStyles.actionBtn}
          onPress={() => onOpenComments(post.id)}
          accessibilityRole="button"
          accessibilityLabel={`View comments — ${post._count.comments} comments`}
        >
          <Text style={[postCardStyles.actionIcon, { color: c.textSecondary }]}>
            💬
          </Text>
          <Text style={[postCardStyles.actionCount, { color: c.textSecondary }]}>
            {post._count.comments}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  )
}

const postCardStyles = StyleSheet.create({
  card: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 16,
    marginBottom: 12,
  },
  pinnedBanner: {
    marginBottom: 8,
  },
  pinnedText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginBottom: 12,
  },
  headerMeta: {
    flex: 1,
    gap: 3,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  authorName: {
    fontSize: 14,
    fontWeight: '700',
  },
  timestamp: {
    fontSize: 12,
  },
  deleteBtn: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteBtnText: {
    fontSize: 16,
  },
  body: {
    fontSize: 14,
    lineHeight: 22,
    marginBottom: 14,
  },
  actions: {
    flexDirection: 'row',
    gap: 4,
    borderTopWidth: 1,
    paddingTop: 12,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    minHeight: 44,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  actionIcon: {
    fontSize: 16,
  },
  actionCount: {
    fontSize: 13,
    fontWeight: '500',
  },
})

// ── Post Detail Modal ─────────────────────────────────────────────────────────

interface PostDetailModalProps {
  postId: number
  currentUserId: number
  token: string
  onClose: () => void
  onOpenProfile: (userId: number) => void
}

function PostDetailModal({
  postId,
  currentUserId,
  token,
  onClose,
  onOpenProfile,
}: PostDetailModalProps): React.JSX.Element {
  const { theme } = useTheme()
  const c = theme.colors
  const s = theme.spacing

  const [post, setPost] = useState<(FeedPost & { comments: FeedComment[] }) | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [newComment, setNewComment] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [commentError, setCommentError] = useState<string | null>(null)
  const [likingCommentId, setLikingCommentId] = useState<number | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    setError(null)
    getPostDetail(postId, token)
      .then(data => {
        setPost(data)
        setLoading(false)
      })
      .catch((err: unknown) => {
        setError(extractErrorMessage(err, 'Could not load post.'))
        setLoading(false)
      })
  }, [postId, token])

  useEffect(() => {
    load()
  }, [load])

  const handleLikePost = useCallback(() => {
    if (!post) return
    toggleLike(post.id, token)
      .then(result => {
        setPost(prev =>
          prev
            ? {
                ...prev,
                likedByMe: result.liked,
                _count: { ...prev._count, likes: result.count },
              }
            : prev,
        )
      })
      .catch(() => {/* silent — optimistic not applied */})
  }, [post, token])

  const handleLikeComment = useCallback((commentId: number) => {
    if (!post || likingCommentId !== null) return
    setLikingCommentId(commentId)
    toggleCommentLike(post.id, commentId, token)
      .then(result => {
        setPost(prev =>
          prev
            ? {
                ...prev,
                comments: (prev.comments ?? []).map(c =>
                  c.id === commentId
                    ? { ...c, likedByMe: result.liked, _count: { likes: result.count } }
                    : c,
                ),
              }
            : prev,
        )
      })
      .catch(() => {/* silent */})
      .finally(() => setLikingCommentId(null))
  }, [post, token, likingCommentId])

  const handleAddComment = useCallback(() => {
    if (!post || submitting || !newComment.trim()) return
    setSubmitting(true)
    setCommentError(null)
    addComment(post.id, newComment.trim(), token)
      .then(comment => {
        setPost(prev =>
          prev
            ? {
                ...prev,
                comments: [...(prev.comments ?? []), comment],
                _count: { ...prev._count, comments: prev._count.comments + 1 },
              }
            : prev,
        )
        setNewComment('')
      })
      .catch((err: unknown) => {
        setCommentError(extractErrorMessage(err, 'Could not post comment.'))
      })
      .finally(() => setSubmitting(false))
  }, [post, newComment, token, submitting])

  return (
    <Modal
      visible
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
      accessibilityViewIsModal
    >
      <SafeAreaView
        style={{ flex: 1, backgroundColor: c.bg }}
        edges={['top', 'left', 'right', 'bottom']}
      >
        {/* Header */}
        <View
          style={[
            detailStyles.header,
            { borderBottomColor: c.border, paddingHorizontal: s.screenPaddingH },
          ]}
        >
          <Text style={[detailStyles.headerTitle, { color: c.text }]}>Post</Text>
          <TouchableOpacity
            onPress={onClose}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={detailStyles.closeBtn}
            accessibilityRole="button"
            accessibilityLabel="Close"
          >
            <Text style={[detailStyles.closeBtnText, { color: c.textMuted }]}>✕</Text>
          </TouchableOpacity>
        </View>

        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={0}
        >
          {loading ? (
            <View style={detailStyles.centered}>
              <ActivityIndicator color={c.primary} />
            </View>
          ) : error !== null ? (
            <View style={detailStyles.centered}>
              <Text style={[detailStyles.errorText, { color: c.error }]}>{error}</Text>
              <TouchableOpacity
                style={[detailStyles.retryBtn, { borderColor: c.border, minHeight: 44 }]}
                onPress={load}
                accessibilityRole="button"
              >
                <Text style={[detailStyles.retryBtnText, { color: c.text }]}>Retry</Text>
              </TouchableOpacity>
            </View>
          ) : post === null ? null : (
            <ScrollView
              style={{ flex: 1 }}
              contentContainerStyle={{ paddingHorizontal: s.screenPaddingH, paddingTop: 16, paddingBottom: 24 }}
              keyboardShouldPersistTaps="handled"
            >
              {/* Post body section */}
              <View style={detailStyles.postSection}>
                <View style={detailStyles.postHeader}>
                  <Avatar
                    user={post.user}
                    size={36}
                    onPress={() => { onClose(); onOpenProfile(post.user.id) }}
                  />
                  <View style={{ flex: 1 }}>
                    <TouchableOpacity
                      onPress={() => { onClose(); onOpenProfile(post.user.id) }}
                      hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
                      accessibilityRole="button"
                    >
                      <Text style={[detailStyles.postAuthor, { color: c.text }]}>
                        {displayName(post.user)}
                      </Text>
                    </TouchableOpacity>
                    <Text style={[detailStyles.postTimestamp, { color: c.textMuted }]}>
                      {timeAgo(post.createdAt)}
                    </Text>
                  </View>
                </View>

                <Text style={[detailStyles.postBody, { color: c.text }]} selectable>
                  {post.body}
                </Text>

                {/* Like button */}
                <TouchableOpacity
                  style={detailStyles.likeRow}
                  onPress={handleLikePost}
                  accessibilityRole="button"
                  accessibilityLabel={post.likedByMe ? 'Unlike' : 'Like'}
                >
                  <Text
                    style={[
                      detailStyles.likeIcon,
                      { color: post.likedByMe ? c.error : c.textSecondary },
                    ]}
                  >
                    {post.likedByMe ? '♥' : '♡'}
                  </Text>
                  <Text style={[detailStyles.likeCount, { color: c.textSecondary }]}>
                    {post._count.likes}
                  </Text>
                </TouchableOpacity>
              </View>

              {/* Comments section */}
              <Text style={[detailStyles.commentsHeading, { color: c.textSecondary }]}>
                {(post.comments ?? []).length === 0
                  ? 'No comments yet'
                  : `${(post.comments ?? []).length} comment${(post.comments ?? []).length === 1 ? '' : 's'}`}
              </Text>

              {(post.comments ?? []).map(comment => (
                <View
                  key={comment.id}
                  style={[detailStyles.commentRow, { borderBottomColor: c.border }]}
                >
                  <Avatar
                    user={comment.user}
                    size={30}
                    onPress={() => { onClose(); onOpenProfile(comment.user.id) }}
                  />
                  <View style={{ flex: 1, gap: 2 }}>
                    <View style={detailStyles.commentMeta}>
                      <TouchableOpacity
                        onPress={() => { onClose(); onOpenProfile(comment.user.id) }}
                        hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
                        accessibilityRole="button"
                      >
                        <Text style={[detailStyles.commentAuthor, { color: c.text }]}>
                          {displayName(comment.user)}
                        </Text>
                      </TouchableOpacity>
                      <Text style={[detailStyles.commentTime, { color: c.textMuted }]}>
                        {timeAgo(comment.createdAt)}
                      </Text>
                    </View>
                    <Text style={[detailStyles.commentBody, { color: c.text }]}>
                      {comment.body}
                    </Text>
                    <TouchableOpacity
                      style={detailStyles.commentLikeBtn}
                      onPress={() => handleLikeComment(comment.id)}
                      disabled={likingCommentId === comment.id}
                      accessibilityRole="button"
                      accessibilityLabel={
                        comment.likedByMe
                          ? `Unlike comment — ${comment._count.likes} likes`
                          : `Like comment — ${comment._count.likes} likes`
                      }
                    >
                      <Text
                        style={[
                          detailStyles.commentLikeIcon,
                          { color: comment.likedByMe ? c.error : c.textMuted },
                        ]}
                      >
                        {comment.likedByMe ? '♥' : '♡'}
                      </Text>
                      <Text style={[detailStyles.commentLikeCount, { color: c.textMuted }]}>
                        {comment._count.likes}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ))}

              {/* Add comment */}
              <View style={[detailStyles.addCommentRow, { borderTopColor: c.border, marginTop: 12 }]}>
                <TextInput
                  style={[
                    detailStyles.commentInput,
                    {
                      backgroundColor: c.surface,
                      borderColor: commentError ? c.error : c.border,
                      color: c.text,
                    },
                  ]}
                  placeholder="Add a comment…"
                  placeholderTextColor={c.textMuted}
                  value={newComment}
                  onChangeText={text => {
                    setNewComment(text)
                    if (commentError) setCommentError(null)
                  }}
                  multiline
                  maxLength={500}
                  returnKeyType="send"
                  onSubmitEditing={handleAddComment}
                  blurOnSubmit
                  accessibilityLabel="Comment text"
                />
                <TouchableOpacity
                  style={[
                    detailStyles.sendBtn,
                    {
                      backgroundColor: c.primary,
                      minWidth: 44,
                      minHeight: 44,
                      opacity: submitting || !newComment.trim() ? 0.4 : 1,
                    },
                  ]}
                  onPress={handleAddComment}
                  disabled={submitting || !newComment.trim()}
                  accessibilityRole="button"
                  accessibilityLabel="Post comment"
                >
                  {submitting ? (
                    <ActivityIndicator color="#FFFFFF" size="small" />
                  ) : (
                    <Text style={detailStyles.sendBtnText}>Send</Text>
                  )}
                </TouchableOpacity>
              </View>
              {commentError !== null && (
                <Text style={[detailStyles.commentErrorText, { color: c.error }]}>
                  {commentError}
                </Text>
              )}
            </ScrollView>
          )}
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  )
}

const detailStyles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  headerTitle: { fontSize: 16, fontWeight: '700' },
  closeBtn: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  closeBtnText: { fontSize: 16 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  errorText: { fontSize: 14, textAlign: 'center', marginBottom: 16 },
  retryBtn: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  retryBtnText: { fontSize: 14, fontWeight: '600' },
  postSection: { marginBottom: 20 },
  postHeader: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', marginBottom: 10 },
  postAuthor: { fontSize: 14, fontWeight: '700' },
  postTimestamp: { fontSize: 12, marginTop: 2 },
  postBody: { fontSize: 14, lineHeight: 22, marginBottom: 12 },
  likeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    minHeight: 44,
    alignSelf: 'flex-start',
  },
  likeIcon: { fontSize: 18 },
  likeCount: { fontSize: 13, fontWeight: '500' },
  commentsHeading: { fontSize: 12, fontWeight: '600', marginBottom: 12, textTransform: 'uppercase', letterSpacing: 0.4 },
  commentRow: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  commentMeta: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  commentAuthor: { fontSize: 13, fontWeight: '700' },
  commentTime: { fontSize: 11 },
  commentBody: { fontSize: 14, lineHeight: 20 },
  commentLikeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minHeight: 32,
    alignSelf: 'flex-start',
  },
  commentLikeIcon: { fontSize: 14 },
  commentLikeCount: { fontSize: 12 },
  addCommentRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    paddingTop: 12,
    borderTopWidth: 1,
  },
  commentInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    maxHeight: 100,
  },
  sendBtn: {
    borderRadius: 8,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 1,
  },
  sendBtnText: { color: '#FFFFFF', fontSize: 13, fontWeight: '600' },
  commentErrorText: { fontSize: 12, marginTop: 6 },
})

// ── User Profile Modal ────────────────────────────────────────────────────────

interface UserProfileModalProps {
  userId: number
  currentUserId: number
  token: string
  onClose: () => void
  onViewPost: (postId: number) => void
}

function UserProfileModal({
  userId,
  currentUserId,
  token,
  onClose,
  onViewPost,
}: UserProfileModalProps): React.JSX.Element {
  const { theme } = useTheme()
  const c = theme.colors
  const s = theme.spacing

  const [profile, setProfile] = useState<FeedUserProfile | null>(null)
  const [loadingProfile, setLoadingProfile] = useState(true)
  const [profileError, setProfileError] = useState<string | null>(null)
  const [posts, setPosts] = useState<FeedPost[]>([])
  const [loadingPosts, setLoadingPosts] = useState(true)
  const [followBusy, setFollowBusy] = useState(false)

  const loadProfile = useCallback(() => {
    setLoadingProfile(true)
    setProfileError(null)
    getUserProfile(userId, token)
      .then(data => {
        setProfile(data)
        setLoadingProfile(false)
      })
      .catch((err: unknown) => {
        setProfileError(extractErrorMessage(err, 'Could not load profile.'))
        setLoadingProfile(false)
      })
  }, [userId, token])

  useEffect(() => {
    loadProfile()
    setLoadingPosts(true)
    getUserPosts(userId, token)
      .then(data => { setPosts(data.posts); setLoadingPosts(false) })
      .catch(() => setLoadingPosts(false))
  }, [userId, token, loadProfile])

  const handleFollow = useCallback(() => {
    if (!profile || followBusy) return
    setFollowBusy(true)
    toggleFollow(userId, token)
      .then(result => {
        setProfile(prev =>
          prev
            ? {
                ...prev,
                isFollowing: result.following,
                _count: {
                  ...prev._count,
                  followers: result.following
                    ? prev._count.followers + 1
                    : Math.max(0, prev._count.followers - 1),
                },
              }
            : prev,
        )
      })
      .catch(() => {/* silent */})
      .finally(() => setFollowBusy(false))
  }, [profile, userId, token, followBusy])

  const uName = profile ? displayName(profile) : 'Profile'

  return (
    <Modal
      visible
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
      accessibilityViewIsModal
    >
      <SafeAreaView
        style={{ flex: 1, backgroundColor: c.bg }}
        edges={['top', 'left', 'right', 'bottom']}
      >
        <View
          style={[
            profileStyles.header,
            { borderBottomColor: c.border, paddingHorizontal: s.screenPaddingH },
          ]}
        >
          <Text style={[profileStyles.headerTitle, { color: c.text }]}>{uName}</Text>
          <TouchableOpacity
            onPress={onClose}
            style={profileStyles.closeBtn}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel="Close profile"
          >
            <Text style={[profileStyles.closeBtnText, { color: c.textMuted }]}>✕</Text>
          </TouchableOpacity>
        </View>

        {loadingProfile ? (
          <View style={profileStyles.centered}>
            <ActivityIndicator color={c.primary} />
          </View>
        ) : profileError !== null ? (
          <View style={profileStyles.centered}>
            <Text style={[profileStyles.errorText, { color: c.error }]}>{profileError}</Text>
            <TouchableOpacity
              style={[profileStyles.retryBtn, { borderColor: c.border, minHeight: 44 }]}
              onPress={loadProfile}
              accessibilityRole="button"
            >
              <Text style={[profileStyles.retryBtnText, { color: c.text }]}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : profile === null ? null : (
          <ScrollView
            contentContainerStyle={{
              paddingHorizontal: s.screenPaddingH,
              paddingTop: 20,
              paddingBottom: 32,
            }}
          >
            {/* Avatar + name */}
            <View style={profileStyles.topSection}>
              <Avatar user={profile} size={56} />
              <View style={{ flex: 1 }}>
                <Text style={[profileStyles.name, { color: c.text }]}>
                  {uName}
                </Text>
                {profile.tag !== null && (
                  <TagBadge tag={profile.tag} tagColor={profile.tagColor} />
                )}
              </View>
            </View>

            {/* Stats row */}
            <View style={profileStyles.statsRow}>
              {[
                { label: 'Followers', value: profile._count.followers },
                { label: 'Following', value: profile._count.following },
                { label: 'Posts', value: profile._count.posts },
                { label: 'Likes', value: profile.totalLikes },
              ].map(stat => (
                <View key={stat.label} style={profileStyles.statItem}>
                  <Text style={[profileStyles.statValue, { color: c.text }]}>
                    {stat.value}
                  </Text>
                  <Text style={[profileStyles.statLabel, { color: c.textMuted }]}>
                    {stat.label}
                  </Text>
                </View>
              ))}
            </View>

            {/* Follow button — only for other users */}
            {userId !== currentUserId && (
              <TouchableOpacity
                style={[
                  profileStyles.followBtn,
                  {
                    backgroundColor: profile.isFollowing ? c.surface2 : c.primary,
                    borderColor: profile.isFollowing ? c.border : c.primary,
                    minHeight: 44,
                    opacity: followBusy ? 0.6 : 1,
                  },
                ]}
                onPress={handleFollow}
                disabled={followBusy}
                accessibilityRole="button"
                accessibilityLabel={profile.isFollowing ? 'Unfollow' : 'Follow'}
                accessibilityState={{ selected: profile.isFollowing }}
              >
                {followBusy ? (
                  <ActivityIndicator color={profile.isFollowing ? c.text : '#FFFFFF'} size="small" />
                ) : (
                  <Text
                    style={[
                      profileStyles.followBtnText,
                      { color: profile.isFollowing ? c.text : '#FFFFFF' },
                    ]}
                  >
                    {profile.isFollowing ? 'Following' : 'Follow'}
                  </Text>
                )}
              </TouchableOpacity>
            )}

            {/* Their posts */}
            <Text style={[profileStyles.postsHeading, { color: c.textSecondary, borderBottomColor: c.border }]}>
              Posts
            </Text>

            {loadingPosts ? (
              <ActivityIndicator color={c.primary} style={{ marginTop: 16 }} />
            ) : posts.length === 0 ? (
              <Text style={[profileStyles.emptyText, { color: c.textMuted }]}>
                No posts yet.
              </Text>
            ) : (
              posts.map(post => (
                <TouchableOpacity
                  key={post.id}
                  style={[profileStyles.miniPost, { backgroundColor: c.surface, borderColor: c.border }]}
                  onPress={() => { onClose(); onViewPost(post.id) }}
                  accessibilityRole="button"
                  accessibilityLabel={`View post from ${timeAgo(post.createdAt)}`}
                >
                  <Text
                    style={[profileStyles.miniPostBody, { color: c.text }]}
                    numberOfLines={3}
                  >
                    {post.body}
                  </Text>
                  <View style={profileStyles.miniPostMeta}>
                    <Text style={[profileStyles.miniPostTime, { color: c.textMuted }]}>
                      {timeAgo(post.createdAt)}
                    </Text>
                    <Text style={[profileStyles.miniPostLikes, { color: c.textSecondary }]}>
                      {post.likedByMe ? '♥' : '♡'} {post._count.likes}
                    </Text>
                  </View>
                  <Text style={[profileStyles.miniPostCta, { color: c.primary }]}>
                    View full post & comments →
                  </Text>
                </TouchableOpacity>
              ))
            )}
          </ScrollView>
        )}
      </SafeAreaView>
    </Modal>
  )
}

const profileStyles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  headerTitle: { fontSize: 16, fontWeight: '700', flex: 1 },
  closeBtn: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  closeBtnText: { fontSize: 16 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  errorText: { fontSize: 14, textAlign: 'center', marginBottom: 16 },
  retryBtn: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  retryBtnText: { fontSize: 14, fontWeight: '600' },
  topSection: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 20 },
  name: { fontSize: 18, fontWeight: '700', marginBottom: 4 },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: 16,
    marginBottom: 16,
  },
  statItem: { alignItems: 'center', gap: 2 },
  statValue: { fontSize: 20, fontWeight: '800' },
  statLabel: {
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  followBtn: {
    borderWidth: 1,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
    paddingHorizontal: 16,
  },
  followBtnText: { fontSize: 14, fontWeight: '600' },
  postsHeading: {
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    paddingBottom: 12,
    borderBottomWidth: 1,
    marginBottom: 12,
  },
  emptyText: { fontSize: 14, marginTop: 8 },
  miniPost: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    marginBottom: 10,
  },
  miniPostBody: { fontSize: 14, lineHeight: 20, marginBottom: 8 },
  miniPostMeta: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  miniPostTime: { fontSize: 12 },
  miniPostLikes: { fontSize: 12 },
  miniPostCta: { fontSize: 12, fontWeight: '600' },
})

// ── Compose Post Sheet ────────────────────────────────────────────────────────

interface ComposeSheetProps {
  token: string
  onClose: () => void
  onPosted: (post: FeedPost) => void
}

function ComposeSheet({
  token,
  onClose,
  onPosted,
}: ComposeSheetProps): React.JSX.Element {
  const { theme } = useTheme()
  const c = theme.colors
  const s = theme.spacing

  const [body, setBody] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handlePost = useCallback(() => {
    if (!body.trim() || submitting) return
    setSubmitting(true)
    setError(null)
    createPost(body.trim(), token)
      .then(post => {
        setBody('')
        onPosted(post)
        onClose()
      })
      .catch((err: unknown) => {
        setError(extractErrorMessage(err, 'Could not create post. Please try again.'))
      })
      .finally(() => setSubmitting(false))
  }, [body, token, onPosted, onClose, submitting])

  return (
    <Modal
      visible
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
      accessibilityViewIsModal
    >
      <SafeAreaView
        style={{ flex: 1, backgroundColor: c.bg }}
        edges={['top', 'left', 'right', 'bottom']}
      >
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          {/* Header */}
          <View
            style={[
              composeStyles.header,
              { borderBottomColor: c.border, paddingHorizontal: s.screenPaddingH },
            ]}
          >
            <TouchableOpacity
              onPress={onClose}
              style={composeStyles.cancelBtn}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityRole="button"
              accessibilityLabel="Cancel"
            >
              <Text style={[composeStyles.cancelText, { color: c.textMuted }]}>
                Cancel
              </Text>
            </TouchableOpacity>
            <Text style={[composeStyles.headerTitle, { color: c.text }]}>New Post</Text>
            <TouchableOpacity
              style={[
                composeStyles.postBtn,
                {
                  backgroundColor: c.primary,
                  minWidth: 64,
                  minHeight: 36,
                  opacity: submitting || !body.trim() ? 0.4 : 1,
                },
              ]}
              onPress={handlePost}
              disabled={submitting || !body.trim()}
              accessibilityRole="button"
              accessibilityLabel="Post"
            >
              {submitting ? (
                <ActivityIndicator color="#FFFFFF" size="small" />
              ) : (
                <Text style={composeStyles.postBtnText}>Post</Text>
              )}
            </TouchableOpacity>
          </View>

          {/* Input area */}
          <View
            style={[composeStyles.inputArea, { paddingHorizontal: s.screenPaddingH }]}
          >
            <TextInput
              style={[
                composeStyles.input,
                { color: c.text },
                error !== null && { borderColor: c.error },
              ]}
              placeholder="What's on your mind?"
              placeholderTextColor={c.textMuted}
              value={body}
              onChangeText={text => {
                setBody(text)
                if (error) setError(null)
              }}
              multiline
              autoFocus
              maxLength={1000}
              textAlignVertical="top"
              accessibilityLabel="Post content"
            />
            <Text style={[composeStyles.charCount, { color: c.textMuted }]}>
              {body.length}/1000
            </Text>
            {error !== null && (
              <Text style={[composeStyles.errorText, { color: c.error }]}>{error}</Text>
            )}
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  )
}

const composeStyles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  cancelBtn: { minWidth: 60, minHeight: 44, justifyContent: 'center' },
  cancelText: { fontSize: 15 },
  headerTitle: { fontSize: 16, fontWeight: '700' },
  postBtn: {
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  postBtnText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
  inputArea: { flex: 1, paddingTop: 16 },
  input: {
    flex: 1,
    fontSize: 16,
    lineHeight: 24,
    borderWidth: 0,
  },
  charCount: { fontSize: 12, textAlign: 'right', marginTop: 8 },
  errorText: { fontSize: 13, marginTop: 6 },
})

// ── User Search Modal ─────────────────────────────────────────────────────────

interface SearchModalProps {
  token: string
  onClose: () => void
  onOpenProfile: (userId: number) => void
}

function SearchModal({
  token,
  onClose,
  onOpenProfile,
}: SearchModalProps): React.JSX.Element {
  const { theme } = useTheme()
  const c = theme.colors
  const s = theme.spacing

  const [query, setQuery] = useState('')
  const [results, setResults] = useState<FeedUser[]>([])
  const [searching, setSearching] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const doSearch = useCallback((q: string) => {
    if (!q.trim()) { setResults([]); setSearching(false); return }
    setSearching(true)
    searchUsers(q.trim(), token)
      .then(users => { setResults(users); setSearching(false) })
      .catch(() => setSearching(false))
  }, [token])

  const handleChange = useCallback((text: string) => {
    setQuery(text)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => doSearch(text), 300)
  }, [doSearch])

  return (
    <Modal
      visible
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
      accessibilityViewIsModal
    >
      <SafeAreaView
        style={{ flex: 1, backgroundColor: c.bg }}
        edges={['top', 'left', 'right', 'bottom']}
      >
        {/* Header */}
        <View
          style={[
            searchStyles.header,
            { borderBottomColor: c.border, paddingHorizontal: s.screenPaddingH },
          ]}
        >
          <Text style={[searchStyles.headerTitle, { color: c.text }]}>Search Users</Text>
          <TouchableOpacity
            onPress={onClose}
            style={searchStyles.closeBtn}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel="Close search"
          >
            <Text style={[searchStyles.closeBtnText, { color: c.textMuted }]}>✕</Text>
          </TouchableOpacity>
        </View>

        <View style={[searchStyles.inputRow, { paddingHorizontal: s.screenPaddingH, paddingTop: 12 }]}>
          <TextInput
            style={[
              searchStyles.input,
              {
                backgroundColor: c.surface,
                borderColor: c.border,
                color: c.text,
              },
            ]}
            placeholder="Search by name or tag…"
            placeholderTextColor={c.textMuted}
            value={query}
            onChangeText={handleChange}
            autoFocus
            returnKeyType="search"
            clearButtonMode="while-editing"
            accessibilityLabel="Search query"
          />
        </View>

        {searching ? (
          <View style={searchStyles.centered}>
            <ActivityIndicator color={c.primary} />
          </View>
        ) : results.length === 0 && query.trim() !== '' ? (
          <View style={searchStyles.centered}>
            <Text style={[searchStyles.emptyText, { color: c.textMuted }]}>
              No users found for &quot;{query}&quot;
            </Text>
          </View>
        ) : (
          <FlatList
            data={results}
            keyExtractor={item => String(item.id)}
            contentContainerStyle={{ paddingHorizontal: s.screenPaddingH, paddingTop: 8 }}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={[searchStyles.userRow, { borderBottomColor: c.border }]}
                onPress={() => { onClose(); onOpenProfile(item.id) }}
                accessibilityRole="button"
                accessibilityLabel={`View profile of ${displayName(item)}`}
              >
                <Avatar user={item} size={38} />
                <View style={{ flex: 1 }}>
                  <Text style={[searchStyles.userName, { color: c.text }]}>
                    {displayName(item)}
                  </Text>
                  {item.tag !== null && (
                    <TagBadge tag={item.tag} tagColor={item.tagColor} />
                  )}
                </View>
              </TouchableOpacity>
            )}
            keyboardShouldPersistTaps="handled"
          />
        )}
      </SafeAreaView>
    </Modal>
  )
}

const searchStyles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  headerTitle: { fontSize: 16, fontWeight: '700' },
  closeBtn: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  closeBtnText: { fontSize: 16 },
  inputRow: {},
  input: {
    height: 44,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    fontSize: 15,
  },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  emptyText: { fontSize: 14, textAlign: 'center' },
  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    minHeight: 56,
  },
  userName: { fontSize: 14, fontWeight: '600', marginBottom: 4 },
})

// ── Main Screen ───────────────────────────────────────────────────────────────

export default function StudyFeedScreen(): React.JSX.Element {
  const { theme } = useTheme()
  const { accessToken, user } = useAuth()
  const c = theme.colors
  const s = theme.spacing

  // Feed state
  const [posts, setPosts] = useState<FeedPost[]>([])
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(true)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Modal / sheet state
  const [showCompose, setShowCompose] = useState(false)
  const [commentPostId, setCommentPostId] = useState<number | null>(null)
  const [profileUserId, setProfileUserId] = useState<number | null>(null)
  const [showSearch, setShowSearch] = useState(false)

  // When the user views a post from within a profile, we need to also track
  // the detail view on top of an open profile.
  const [detailPostId, setDetailPostId] = useState<number | null>(null)

  const token = accessToken ?? ''
  const currentUserId = user?.id ?? 0

  // ── Load feed ──────────────────────────────────────────────────────────────

  const loadFeed = useCallback((pageNum: number, replace: boolean) => {
    if (pageNum === 1) {
      setLoading(true)
      setError(null)
    } else {
      setLoadingMore(true)
    }
    getFeedPosts(token, pageNum)
      .then(result => {
        setPosts(prev => replace ? result.posts : [...prev, ...result.posts])
        setHasMore(result.hasMore)
        setPage(pageNum)
      })
      .catch((err: unknown) => {
        if (pageNum === 1) {
          setError(extractErrorMessage(err, 'Could not load the feed. Please try again.'))
        }
      })
      .finally(() => {
        setLoading(false)
        setLoadingMore(false)
      })
  }, [token])

  useEffect(() => {
    if (token) {
      loadFeed(1, true)
    }
  }, [token, loadFeed])

  const handleRefresh = useCallback(() => {
    loadFeed(1, true)
  }, [loadFeed])

  const handleLoadMore = useCallback(() => {
    if (!hasMore || loadingMore || loading) return
    loadFeed(page + 1, false)
  }, [hasMore, loadingMore, loading, page, loadFeed])

  // ── Like a post ────────────────────────────────────────────────────────────

  const handleLike = useCallback((postId: number) => {
    // Optimistic update
    setPosts(prev =>
      prev.map(p =>
        p.id === postId
          ? {
              ...p,
              likedByMe: !p.likedByMe,
              _count: {
                ...p._count,
                likes: p.likedByMe
                  ? Math.max(0, p._count.likes - 1)
                  : p._count.likes + 1,
              },
            }
          : p,
      ),
    )

    toggleLike(postId, token).catch(() => {
      // Roll back optimistic update on failure
      setPosts(prev =>
        prev.map(p =>
          p.id === postId
            ? {
                ...p,
                likedByMe: !p.likedByMe,
                _count: {
                  ...p._count,
                  likes: p.likedByMe
                    ? Math.max(0, p._count.likes - 1)
                    : p._count.likes + 1,
                },
              }
            : p,
        ),
      )
    })
  }, [token])

  // ── Delete a post ──────────────────────────────────────────────────────────

  const handleDelete = useCallback((postId: number) => {
    Alert.alert(
      'Delete Post',
      'Are you sure you want to delete this post? This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            deletePost(postId, token)
              .then(() => {
                setPosts(prev => prev.filter(p => p.id !== postId))
              })
              .catch((err: unknown) => {
                Alert.alert(
                  'Delete Failed',
                  extractErrorMessage(err, 'Could not delete the post. Please try again.'),
                )
              })
          },
        },
      ],
    )
  }, [token])

  // ── Compose a post ─────────────────────────────────────────────────────────

  const handlePosted = useCallback((newPost: FeedPost) => {
    setPosts(prev => [newPost, ...prev])
  }, [])

  // ── Open profile + handle "view post from profile" ────────────────────────

  const handleOpenProfile = useCallback((userId: number) => {
    setProfileUserId(userId)
  }, [])

  const handleViewPostFromProfile = useCallback((postId: number) => {
    // Close profile, open detail
    setProfileUserId(null)
    setDetailPostId(postId)
  }, [])

  // ── Render item ────────────────────────────────────────────────────────────

  const renderItem = useCallback(({ item }: { item: FeedPost }) => (
    <PostCard
      post={item}
      currentUserId={currentUserId}
      onLike={handleLike}
      onOpenComments={setCommentPostId}
      onOpenProfile={handleOpenProfile}
      onDelete={handleDelete}
    />
  ), [currentUserId, handleLike, handleOpenProfile, handleDelete])

  const renderFooter = useCallback(() => {
    if (!loadingMore) return null
    return (
      <View style={{ paddingVertical: 16, alignItems: 'center' }}>
        <ActivityIndicator color={c.primary} />
      </View>
    )
  }, [loadingMore, c.primary])

  const renderEmpty = useCallback(() => {
    if (loading) return null
    if (error !== null) return null
    return (
      <View style={[feedStyles.emptyState, { paddingHorizontal: s.screenPaddingH }]}>
        <Text style={[feedStyles.emptyTitle, { color: c.text }]}>No posts yet</Text>
        <Text style={[feedStyles.emptySubtitle, { color: c.textMuted }]}>
          Be the first to share something — tap the compose button below.
        </Text>
      </View>
    )
  }, [loading, error, c.text, c.textMuted, s.screenPaddingH])

  const keyExtractor = useCallback((item: FeedPost) => String(item.id), [])

  // ── Screen ─────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView
      style={[feedStyles.safeArea, { backgroundColor: c.bg }]}
      edges={['top', 'left', 'right']}
    >
      {/* Top bar */}
      <View
        style={[
          feedStyles.topBar,
          {
            borderBottomColor: c.border,
            paddingHorizontal: s.screenPaddingH,
          },
        ]}
      >
        <Text style={[feedStyles.screenTitle, { color: c.text }]}>Study Feed</Text>
        <TouchableOpacity
          style={[feedStyles.searchBtn, { minWidth: 44, minHeight: 44 }]}
          onPress={() => setShowSearch(true)}
          accessibilityRole="button"
          accessibilityLabel="Search users"
        >
          <Text style={[feedStyles.searchIcon, { color: c.textSecondary }]}>
            🔍
          </Text>
        </TouchableOpacity>
      </View>

      {/* Feed list */}
      {loading && posts.length === 0 ? (
        <View style={[feedStyles.skeletonContainer, { paddingHorizontal: s.screenPaddingH }]}>
          {[0, 1, 2].map(i => (
            <PostSkeleton key={i} />
          ))}
        </View>
      ) : error !== null ? (
        <View style={feedStyles.errorContainer}>
          <Text style={[feedStyles.errorTitle, { color: c.error }]}>
            Could not load feed
          </Text>
          <Text style={[feedStyles.errorMessage, { color: c.textSecondary }]}>
            {error}
          </Text>
          <TouchableOpacity
            style={[
              feedStyles.retryBtn,
              { backgroundColor: c.primary, minHeight: 44 },
            ]}
            onPress={handleRefresh}
            accessibilityRole="button"
            accessibilityLabel="Retry"
          >
            <Text style={feedStyles.retryBtnText}>Try again</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={posts}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          contentContainerStyle={[
            feedStyles.listContent,
            { paddingHorizontal: s.screenPaddingH },
          ]}
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.3}
          ListFooterComponent={renderFooter}
          ListEmptyComponent={renderEmpty}
          onRefresh={handleRefresh}
          refreshing={loading && posts.length > 0}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        />
      )}

      {/* Floating compose button */}
      <TouchableOpacity
        style={[feedStyles.fab, { backgroundColor: c.primary }]}
        onPress={() => setShowCompose(true)}
        accessibilityRole="button"
        accessibilityLabel="Create new post"
      >
        <Text style={feedStyles.fabText}>+</Text>
      </TouchableOpacity>

      {/* Modals */}
      {showCompose && (
        <ComposeSheet
          token={token}
          onClose={() => setShowCompose(false)}
          onPosted={handlePosted}
        />
      )}

      {commentPostId !== null && (
        <PostDetailModal
          postId={commentPostId}
          currentUserId={currentUserId}
          token={token}
          onClose={() => setCommentPostId(null)}
          onOpenProfile={handleOpenProfile}
        />
      )}

      {detailPostId !== null && (
        <PostDetailModal
          postId={detailPostId}
          currentUserId={currentUserId}
          token={token}
          onClose={() => setDetailPostId(null)}
          onOpenProfile={handleOpenProfile}
        />
      )}

      {profileUserId !== null && (
        <UserProfileModal
          userId={profileUserId}
          currentUserId={currentUserId}
          token={token}
          onClose={() => setProfileUserId(null)}
          onViewPost={handleViewPostFromProfile}
        />
      )}

      {showSearch && (
        <SearchModal
          token={token}
          onClose={() => setShowSearch(false)}
          onOpenProfile={userId => {
            setShowSearch(false)
            handleOpenProfile(userId)
          }}
        />
      )}
    </SafeAreaView>
  )
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const feedStyles = StyleSheet.create({
  safeArea: { flex: 1 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  screenTitle: {
    fontSize: 22,
    fontWeight: '800',
  },
  searchBtn: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchIcon: { fontSize: 20 },
  listContent: { paddingTop: 12, paddingBottom: 100 },
  skeletonContainer: { paddingTop: 12 },
  errorContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  errorTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 8,
    textAlign: 'center',
  },
  errorMessage: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    marginBottom: 24,
  },
  retryBtn: {
    borderRadius: 9,
    paddingHorizontal: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  retryBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
  emptyState: {
    paddingTop: 60,
    alignItems: 'center',
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 8,
    textAlign: 'center',
  },
  emptySubtitle: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  fab: {
    position: 'absolute',
    bottom: 24,
    right: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
  },
  fabText: {
    color: '#FFFFFF',
    fontSize: 28,
    fontWeight: '300',
    lineHeight: 32,
    marginTop: -2,
  },
})
