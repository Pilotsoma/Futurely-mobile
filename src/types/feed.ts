export interface FeedUserSummary {
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

export interface FeedPost {
  id: number
  userId: number
  body: string
  network: string
  isdCode?: string | null
  type?: string | null
  pinnedUntil: string | null
  createdAt: string
  user: FeedUserSummary
  likedByMe: boolean
  enteredByMe?: boolean
  _count: { likes: number; comments: number; giveawayEntries?: number }
}

export interface FeedComment {
  id: number
  postId: number
  userId: number
  body: string
  createdAt: string
  user: FeedUserSummary
  likedByMe?: boolean
  _count?: { likes: number }
}

export interface FeedPostDetail extends FeedPost {
  comments: FeedComment[]
}

export interface FeedPage {
  posts: FeedPost[]
  total: number
  page: number
  pageSize: number
  hasMore: boolean
}

export interface FeedUserProfile {
  id: number
  name: string | null
  hacName: string | null
  tag: string | null
  tagColor: string | null
  nameColor: string | null
  avatarEffect: string | null
  badge: string | null
  avatarUrl: string | null
  role: string
  allTags: Array<{ tag: string; tagColor: string }>
  totalLikes: number
  isFollowing: boolean
  _count: { followers: number; following: number; posts: number }
}

export interface ListFeedParams {
  page?: number
  limit?: number
  network?: 'global' | 'isd'
}

export interface CreatePostRequest {
  body: string
  network?: 'isd' | 'global'
}

export interface CreateCommentRequest {
  body: string
}
