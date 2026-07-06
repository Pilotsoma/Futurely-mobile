// Feed API — wraps /api/feed/* and /api/feed/users/* endpoints.
//
// Endpoint shapes confirmed from backend/src/routes/feed.ts:
//
//   GET  /api/feed/posts?page=&limit=&network=global|isd
//     200: { data: { posts: FeedPost[], total, page, pageSize, hasMore } }
//
//   POST /api/feed/posts
//     body: { body: string, network?: 'global' | 'isd' }
//     200:  { data: FeedPost }
//
//   GET  /api/feed/posts/following?page=&limit=
//     200: { data: { posts: FeedPost[], total, page, pageSize, hasMore } }
//
//   GET  /api/feed/posts/:id
//     200: { data: FeedPost & { comments: FeedComment[] } }
//
//   POST /api/feed/posts/:id/comments
//     body: { body: string }
//     200:  { data: FeedComment }
//
//   POST /api/feed/posts/:id/like
//     200:  { data: { liked: boolean, count: number } }
//
//   POST /api/feed/posts/:id/comments/:commentId/like
//     200:  { data: { liked: boolean, count: number } }
//
//   DELETE /api/feed/posts/:id
//     200:  { data: { deleted: boolean } }
//
//   GET  /api/feed/users/search?q=
//     200: { data: FeedUser[] }
//
//   GET  /api/feed/users/:id/profile
//     200: { data: FeedUserProfile }
//
//   GET  /api/feed/users/:id/posts?page=&limit=
//     200: { data: { posts: FeedPost[], total, page, pageSize, hasMore } }
//
//   POST /api/feed/users/:id/follow
//     200:  { data: { following: boolean } }
//
// Auth: all endpoints require a valid Bearer token (requireAuth middleware).

import { apiGet, apiPost, apiDelete } from './client'

// ── Types ──────────────────────────────────────────────────────────────────────

/** Minimal user shape returned as part of posts and comments. */
export interface FeedUser {
  id: number
  name: string | null
  hacName?: string | null
  tag: string | null
  tagColor: string | null
  nameColor: string | null
  avatarEffect: string | null
  badge: string | null
  avatarUrl: string | null
}

/** A single comment on a post. */
export interface FeedComment {
  id: number
  body: string
  postId: number
  userId: number
  createdAt: string
  user: FeedUser
  likedByMe: boolean
  _count: { likes: number }
}

/** A feed post, as returned from list and detail endpoints. */
export interface FeedPost {
  id: number
  body: string
  userId: number
  network: string
  createdAt: string
  pinnedUntil: string | null
  type: string | null
  user: FeedUser
  likedByMe: boolean
  _count: {
    likes: number
    comments: number
  }
  /** Only present on detail endpoint. */
  comments?: FeedComment[]
}

/** Paginated list response shape. */
export interface FeedPageResult {
  posts: FeedPost[]
  total: number
  page: number
  pageSize: number
  hasMore: boolean
}

/** Extended user profile from /users/:id/profile. */
export interface FeedUserProfile {
  id: number
  name: string | null
  hacName?: string | null
  tag: string | null
  tagColor: string | null
  nameColor: string | null
  avatarEffect: string | null
  badge: string | null
  avatarUrl: string | null
  role: string
  chatBanned: boolean
  chatMutedUntil: string | null
  isFollowing: boolean
  totalLikes: number
  _count: {
    followers: number
    following: number
    posts: number
  }
}

// ── API calls ─────────────────────────────────────────────────────────────────

/**
 * GET /feed/posts — ranked global (or ISD) social feed, paginated.
 * Posts from the last 24h plus any currently-pinned posts are included.
 */
export function getFeedPosts(
  token: string,
  page = 1,
  network: 'global' | 'isd' = 'global',
): Promise<FeedPageResult> {
  return apiGet<FeedPageResult>(
    `/feed/posts?page=${page}&limit=20&network=${network}`,
    token,
  )
}

/**
 * GET /feed/posts/following — posts from followed users, newest first.
 */
export function getFollowingPosts(
  token: string,
  page = 1,
): Promise<FeedPageResult> {
  return apiGet<FeedPageResult>(
    `/feed/posts/following?page=${page}&limit=20`,
    token,
  )
}

/**
 * GET /feed/posts/:id — single post detail including comments.
 */
export function getPostDetail(
  postId: number,
  token: string,
): Promise<FeedPost & { comments: FeedComment[] }> {
  return apiGet<FeedPost & { comments: FeedComment[] }>(
    `/feed/posts/${postId}`,
    token,
  )
}

/**
 * POST /feed/posts — create a plain text post.
 * body must be non-empty; network defaults to 'global'.
 */
export function createPost(
  body: string,
  token: string,
  network: 'global' | 'isd' = 'global',
): Promise<FeedPost> {
  return apiPost<FeedPost>('/feed/posts', { body, network }, token)
}

/**
 * DELETE /feed/posts/:id — delete a post (only own posts for regular users).
 */
export function deletePost(
  postId: number,
  token: string,
): Promise<{ deleted: boolean }> {
  return apiDelete<{ deleted: boolean }>(`/feed/posts/${postId}`, undefined, token)
}

/**
 * POST /feed/posts/:id/like — toggle like on a post.
 * Returns the new liked state and updated count.
 */
export function toggleLike(
  postId: number,
  token: string,
): Promise<{ liked: boolean; count: number }> {
  return apiPost<{ liked: boolean; count: number }>(
    `/feed/posts/${postId}/like`,
    {},
    token,
  )
}

/**
 * POST /feed/posts/:id/comments — add a comment to a post.
 */
export function addComment(
  postId: number,
  body: string,
  token: string,
): Promise<FeedComment> {
  return apiPost<FeedComment>(`/feed/posts/${postId}/comments`, { body }, token)
}

/**
 * POST /feed/posts/:id/comments/:commentId/like — toggle like on a comment.
 * Returns the new liked state and updated count.
 */
export function toggleCommentLike(
  postId: number,
  commentId: number,
  token: string,
): Promise<{ liked: boolean; count: number }> {
  return apiPost<{ liked: boolean; count: number }>(
    `/feed/posts/${postId}/comments/${commentId}/like`,
    {},
    token,
  )
}

/**
 * GET /feed/users/search?q= — search users by name or tag.
 * Returns up to 20 results. Returns empty array if q is empty.
 */
export function searchUsers(
  q: string,
  token: string,
): Promise<FeedUser[]> {
  return apiGet<FeedUser[]>(`/feed/users/search?q=${encodeURIComponent(q)}`, token)
}

/**
 * GET /feed/users/:id/profile — full user profile with follow/counts/totalLikes.
 */
export function getUserProfile(
  userId: number,
  token: string,
): Promise<FeedUserProfile> {
  return apiGet<FeedUserProfile>(`/feed/users/${userId}/profile`, token)
}

/**
 * GET /feed/users/:id/posts — posts by a specific user, newest first.
 */
export function getUserPosts(
  userId: number,
  token: string,
  page = 1,
): Promise<FeedPageResult> {
  return apiGet<FeedPageResult>(
    `/feed/users/${userId}/posts?page=${page}&limit=20`,
    token,
  )
}

/**
 * POST /feed/users/:id/follow — toggle follow/unfollow for a user.
 * Returns whether the current user is now following.
 */
export function toggleFollow(
  targetUserId: number,
  token: string,
): Promise<{ following: boolean }> {
  return apiPost<{ following: boolean }>(
    `/feed/users/${targetUserId}/follow`,
    {},
    token,
  )
}
