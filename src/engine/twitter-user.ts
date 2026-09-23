/**
 * X 用户维度查询：时间线（推文/回复/点赞）与关注/粉丝列表。
 *
 * 全部走鉴权 GraphQL（auth_token + ct0，TLS 指纹由 tlsget-rs 提供）。
 * queryId 与特性集等公共件见 ./twitter（DEFAULT_QUERY_IDS 可被调用方覆盖）。
 */
import type { ParsedData } from '../types'
import { tlsGet } from '../utils/tls-client'
import {
  mapGraphql, categorizeTweetResult, walkTimelineResults, twitterGraphql,
  DEFAULT_QUERY_IDS, TIMELINE_FEATURES,
  type GraphqlGetter, type TwitterCreds, type TwitterQueryIds,
} from './twitter'

export { categorizeTweetResult, DEFAULT_QUERY_IDS, TIMELINE_FEATURES }
export type { TwitterQueryIds }

/* ===================== 用户 ID 解析 ===================== */

export interface TwitterUserInfo {
  userId: string
  name: string
  screenName: string
  description: string
  followers: number
  friends: number
}

export async function resolveTwitterUser(
  screenName: string,
  creds: TwitterCreds,
  get: GraphqlGetter = tlsGet,
  queryIds: TwitterQueryIds = {},
): Promise<TwitterUserInfo> {
  const ids = { ...DEFAULT_QUERY_IDS, ...queryIds }
  const variables = {
    screen_name: screenName.replace(/^@/, ''),
    withSafetyModeUserFields: true,
    withSuperFollowsUserFields: true,
  }
  const data = await twitterGraphql('UserByScreenName', ids.UserByScreenName, variables, creds, get)
  const user = data?.data?.user?.result
  if (!user || user.__typename === 'UserUnavailable') {
    throw new Error(`用户 @${screenName} 不可访问（不存在、被封或需登录）`)
  }
  const legacy = user.legacy || user.core || {}
  return {
    userId: String(user.rest_id ?? legacy.id_str ?? ''),
    name: String(legacy.name ?? ''),
    screenName: String(legacy.screen_name ?? screenName.replace(/^@/, '')),
    description: String(user.profile_bio?.description ?? legacy.description ?? ''),
    followers: Number(legacy.followers_count ?? 0) || 0,
    friends: Number(legacy.friends_count ?? 0) || 0,
  }
}

/* ===================== 时间线 ===================== */

export type TimelineTab = 'tweets' | 'replies' | 'likes'

export interface TimelineEntry {
  id: string
  tweet: ParsedData
  /** 文字/视频/图片/转推/回复 中的若干类 */
  kinds: ('text' | 'video' | 'image' | 'retweet' | 'reply')[]
  isRetweet: boolean
  isReply: boolean
  replyToId?: string
  url: string
}

/** 兼容别名：timeline instructions → 推文结果 + 底部游标 */
export function parseTimeline(instructions: any[]): { results: any[]; bottomCursor?: string } {
  return walkTimelineResults(instructions)
}

/** 用户时间线（tab：tweets=推文/转推；replies=含回复；likes=当前登录用户的点赞） */
export async function fetchUserTimeline(opts: {
  screenName?: string
  userId?: string
  tab?: TimelineTab
  limit?: number
  creds: TwitterCreds
  get?: GraphqlGetter
  queryIds?: TwitterQueryIds
}): Promise<TimelineEntry[]> {
  const tab: TimelineTab = opts.tab || 'tweets'
  const limit = Math.max(1, Math.min(200, opts.limit ?? 20))
  const get = opts.get || tlsGet
  const ids = { ...DEFAULT_QUERY_IDS, ...opts.queryIds }

  let userId = opts.userId
  if (!userId) {
    const u = await resolveTwitterUser(opts.screenName!, opts.creds, get, opts.queryIds)
    userId = u.userId
  }

  const [opName, queryId] = tab === 'likes'
    ? (['Likes', ids.Likes] as const)
    : tab === 'replies'
      ? (['UserTweetsAndReplies', ids.UserTweetsAndReplies] as const)
      : (['UserTweets', ids.UserTweets] as const)

  const out: TimelineEntry[] = []
  const seen = new Set<string>()
  let cursor: string | undefined
  let pages = 0
  while (out.length < limit && pages < 20) {
    pages++
    const variables: Record<string, any> = {
      userId,
      count: 20,
      includePromotedContent: false,
      withQuickPromoteEligibilityTweetQuery: false,
      withVoice: true,
      withV2Timeline: true,
    }
    if (cursor) variables.cursor = cursor
    const data = await twitterGraphql(opName, queryId, variables, opts.creds, get)
    const instructions = (() => {
      const user = data?.data?.user?.result
      return (user?.timeline_v2?.timeline || user?.timeline?.timeline)?.instructions || []
    })()
    const { results, bottomCursor } = walkTimelineResults(instructions)
    for (const r of results) {
      const cat = categorizeTweetResult(r)
      if (!cat.id || seen.has(cat.id)) continue
      seen.add(cat.id)
      const kinds: TimelineEntry['kinds'] = []
      if (cat.isRetweet) kinds.push('retweet')
      if (cat.isReply) kinds.push('reply')
      if (cat.hasVideo) kinds.push('video')
      else if (cat.hasImage) kinds.push('image')
      else if (!cat.isRetweet) kinds.push('text')
      out.push({
        id: cat.id,
        tweet: mapGraphql(cat.inner),
        kinds,
        isRetweet: cat.isRetweet,
        isReply: cat.isReply,
        replyToId: cat.replyToId,
        url: `https://x.com/i/web/status/${cat.id}`,
      })
      if (out.length >= limit) break
    }
    if (!bottomCursor || !results.length) break
    cursor = bottomCursor
  }
  return out
}

/* ===================== 关注 / 粉丝 ===================== */

export interface TwitterConnectionUser {
  name: string
  screenName: string
  description: string
  followers: number
  verified: boolean
  followedBy: boolean
}

function userOfEntry(itemContent: any): TwitterConnectionUser | null {
  const user = itemContent?.user_results?.result
  if (!user || user.__typename === 'UserUnavailable') return null
  const legacy = user.legacy || {}
  return {
    name: String(legacy.name ?? user.core?.name ?? ''),
    screenName: String(legacy.screen_name ?? user.core?.screen_name ?? ''),
    description: String(user.profile_bio?.description ?? legacy.description ?? ''),
    followers: Number(legacy.followers_count ?? 0) || 0,
    verified: !!user.is_blue_verified || !!legacy.verified,
    followedBy: !!legacy.followed_by,
  }
}

/** 纯函数：从 Followers/Following instructions 抽取用户与底部游标 */
export function parseConnections(instructions: any[]): { users: TwitterConnectionUser[]; bottomCursor?: string } {
  const users: TwitterConnectionUser[] = []
  let bottomCursor: string | undefined
  for (const ins of instructions || []) {
    for (const entry of ins?.entries || []) {
      const content = entry?.content
      if (!content) continue
      if (content.entryType === 'TimelineTimelineCursor' && content.contentType === 'Bottom') {
        bottomCursor = String(content.value || bottomCursor || '')
        continue
      }
      if (content.entryType === 'TimelineTimelineItem' && content.itemContent) {
        const u = userOfEntry(content.itemContent)
        if (u && u.screenName) users.push(u)
      }
    }
  }
  return { users, bottomCursor }
}

/** 关注列表（following）或粉丝列表（followers） */
export async function fetchUserConnections(opts: {
  screenName: string
  type: 'followers' | 'following'
  limit?: number
  creds: TwitterCreds
  get?: GraphqlGetter
  queryIds?: TwitterQueryIds
}): Promise<TwitterConnectionUser[]> {
  const limit = Math.max(1, Math.min(1000, opts.limit ?? 50))
  const get = opts.get || tlsGet
  const ids = { ...DEFAULT_QUERY_IDS, ...opts.queryIds }
  const u = await resolveTwitterUser(opts.screenName, opts.creds, get, opts.queryIds)

  const [opName, queryId] = opts.type === 'following'
    ? (['Following', ids.Following] as const)
    : (['Followers', ids.Followers] as const)

  const out: TwitterConnectionUser[] = []
  const seen = new Set<string>()
  let cursor: string | undefined
  let pages = 0
  while (out.length < limit && pages < 50) {
    pages++
    const variables: Record<string, any> = { userId: u.userId, count: 50, includePromotedContent: false }
    if (cursor) variables.cursor = cursor
    const data = await twitterGraphql(opName, queryId, variables, opts.creds, get)
    const instructions = (() => {
      const user = data?.data?.user?.result
      return (user?.timeline_v2?.timeline || user?.timeline?.timeline)?.instructions || []
    })()
    const { users, bottomCursor } = parseConnections(instructions)
    for (const user of users) {
      if (seen.has(user.screenName)) continue
      seen.add(user.screenName)
      out.push(user)
      if (out.length >= limit) break
    }
    if (!bottomCursor || !users.length) break
    cursor = bottomCursor
  }
  return out
}
