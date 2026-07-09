import { api } from './client'
import type {
  CreateCommentRequest,
  CreatePostRequest,
  FeedComment,
  FeedPage,
  FeedPost,
  FeedPostDetail,
  FeedUserProfile,
  FeedUserSummary,
  ListFeedParams,
} from '../types/feed'

export async function listPosts(params: ListFeedParams = {}): Promise<FeedPage> {
  const query: Record<string, string | number> = {}
  if (params.page !== undefined) query.page = params.page
  if (params.limit !== undefined) query.limit = params.limit
  if (params.network) query.network = params.network
  return api.get('/feed/posts', query)
}

export async function listFollowingPosts(params: Pick<ListFeedParams, 'page' | 'limit'> = {}): Promise<FeedPage> {
  const query: Record<string, string | number> = {}
  if (params.page !== undefined) query.page = params.page
  if (params.limit !== undefined) query.limit = params.limit
  return api.get('/feed/posts/following', query)
}

export async function createPost(payload: CreatePostRequest): Promise<FeedPost> {
  return api.post('/feed/posts', payload)
}

export async function getPost(id: number): Promise<FeedPostDetail> {
  return api.get(`/feed/posts/${id}`)
}

export async function createComment(postId: number, payload: CreateCommentRequest): Promise<FeedComment> {
  return api.post(`/feed/posts/${postId}/comments`, payload)
}

export async function toggleLike(postId: number): Promise<{ liked: boolean; count: number }> {
  return api.post(`/feed/posts/${postId}/like`)
}

export async function toggleCommentLike(
  postId: number,
  commentId: number,
): Promise<{ liked: boolean; count: number }> {
  return api.post(`/feed/posts/${postId}/comments/${commentId}/like`)
}

export async function deletePost(id: number): Promise<{ deleted: true }> {
  return api.delete(`/feed/posts/${id}`)
}

export async function getUserProfile(userId: number): Promise<FeedUserProfile> {
  return api.get(`/feed/users/${userId}/profile`)
}

export async function searchUsers(query: string): Promise<FeedUserSummary[]> {
  if (!query.trim()) return []
  return api.get('/feed/users/search', { q: query })
}

export async function toggleFollow(userId: number): Promise<{ following: boolean }> {
  return api.post(`/feed/users/${userId}/follow`)
}
