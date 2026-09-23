/**
 * X 用户维度查询：时间线（推文/回复/点赞）与关注/粉丝列表。
 *
 * 全部走鉴权 GraphQL（auth_token + ct0，TLS 指纹由 tlsget-rs 提供）。
 * queryId 随 x.com web 版本漂移：默认值取自活跃维护的开源清单
 * （twitter-api-client），并支持调用方整体覆盖（queryIds 参数）。
 */
import type { ParsedData } from '../types'
import { tlsGet } from '../utils/tls-client'
import { mapGraphql, unwrapTweetResult, type GraphqlGetter, type TwitterCreds } from './twitter'

// x.com 网页端公开 bearer（与 twitter.ts 同源固定值）
const WEB_BEARER = 'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA'

export interface TwitterQueryIds {
  UserByScreenName?: string
  UserTweets?: string
  UserTweetsAndReplies?: string
  Likes?: string
  Followers?: string
  Following?: string
}

/** 默认 queryId 清单（漂移时可用 queryIds 参数整体覆盖） */
export const DEFAULT_QUERY_IDS: Required<TwitterQueryIds> = {
  UserByScreenName: 'sLVLhk0bGj3MVFEKTdax1w',
  UserTweets: 'HuTx74BxAnezK1gWvYY7zg',
  UserTweetsAndReplies: 'RIWc55YCNyUJ-U3HHGYkdg',
  Likes: 'nXEl0lfN_XSznVMlprThgQ',
  Followers: 'pd8Tt1qUz1YWrICegqZ8cw',
  Following: 'wjvx62Hye2dGVvnvVco0xA',
}

const TIMELINE_FEATURES: Record<string, boolean> = {
  blue_business_profile_image_shape_enabled: true,
  creator_subscriptions_tweet_preview_api_enabled: true,
  freedom_of_speech_not_reach_fetch_enabled: true,
  graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
  graphql_timeline_v2_bookmark_timeline: true,
  hidden_profile_likes_enabled: true,
  highlights_tweets_tab_ui_enabled: true,
  interactive_text_enabled: true,
  longform_notetweets_consumption_enabled: true,
  longform_notetweets_inline_media_enabled: true,
  longform_notetweets_rich_text_read_enabled: true,
  longform_notetweets_richtext_consumption_enabled: true,
  profile_foundations_tweet_stats_enabled: true,
  profile_foundations_tweet_stats_tweet_frequency: true,
  responsive_web_birdwatch_note_limit_enabled: true,
  responsive_web_edit_tweet_api_enabled: true,
  responsive_web_enhance_cards_enabled: false,
  responsive_web_graphql_exclude_directive_enabled: true,
  responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
  responsive_web_graphql_timeline_navigation_enabled: true,
  responsive_web_media_download_video_enabled: false,
  responsive_web_text_conversations_enabled: false,
  responsive_web_twitter_article_data_v2_enabled: true,
  responsive_web_twitter_article_tweet_consumption_enabled: false,
  responsive_web_twitter_blue_verified_badge_is_enabled: true,
  rweb_lists_timeline_redesign_enabled: true,
  spaces_2022_h2_clipping: true,
  spaces_2022_h2_spaces_communities: true,
  standardized_nudges_misinfo: true,
  subscriptions_verification_info_verified_since_enabled: true,
  tweet_awards_web_tipping_enabled: false,
  tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
  tweetypie_unmention_optimization_enabled: true,
  verified_phone_label_enabled: false,
  vibe_api_enabled: true,
  view_counts_everywhere_api_enabled: true,
}

async function gql(opName: string, queryId: string, variables: Record<string, any>, creds: TwitterCreds, get: GraphqlGetter): Promise<any> {
  const url = `https://x.com/i/api/graphql/${queryId}/${opName}` +
    `?variables=${encodeURIComponent(JSON.stringify(variables))}&features=${encodeURIComponent(JSON.stringify(TIMELINE_FEATURES))}`
  let res
  try {
    res = await get(url, {
      headers: {
        authorization: `Bearer ${WEB_BEARER}`,
        'x-csrf-token': creds.ct0,
        'x-twitter-auth-type': 'OAuth2Session',
        'x-twitter-active-user': 'yes',
        'x-twitter-client-language': 'en',
      },
      cookies: { auth_token: creds.authToken, ct0: creds.ct0 },
      timeout: 30000,
    })
  } catch (e: any) {
    throw new Error(`X GraphQL 请求失败：${e?.message || e}`)
  }
  if (res.status === 403 || res.status === 429) {
    throw new Error(
      `X GraphQL 被 Cloudflare 拦截 (HTTP ${res.status})：TLS 指纹校验未通过。` +
      `请确认已安装可选依赖 @char46/tlsget-rs（npm i @char46/tlsget-rs），它提供浏览器级 TLS 指纹。`
    )
  }
  if (res.status !== 200) {
    throw new Error(`X GraphQL ${opName} 返回 HTTP ${res.status}：${typeof res.data === 'string' ? res.data.slice(0, 120) : JSON.stringify(res.data || {}).slice(0, 120)}`)
  }
  return res.data
}

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
  const data = await gql('UserByScreenName', ids.UserByScreenName, variables, creds, get)
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

/** 纯函数：把单条 tweet result 归类（含转推解包） */
export function categorizeTweetResult(result: any): {
  inner: any
  isRetweet: boolean
  isReply: boolean
  hasVideo: boolean
  hasImage: boolean
  isText: boolean
  id: string
  replyToId?: string
} {
  const raw = unwrapTweetResult(result)
  const rtInner = raw?.legacy?.retweeted_status_result?.result
  const inner = rtInner ? unwrapTweetResult(rtInner) : raw
  const legacy = inner?.legacy || {}
  const media: any[] = Array.isArray(legacy.extended_entities?.media) ? legacy.extended_entities.media : []
  const hasImage = media.some((m) => m?.type === 'photo')
  const hasVideo = media.some((m) => m?.type === 'video' || m?.type === 'animated_gif')
  const isRetweet = !!rtInner
  const replyToId = typeof legacy.in_reply_to_status_id_str === 'string' ? legacy.in_reply_to_status_id_str : undefined
  const isReply = !!replyToId
  const isText = !hasImage && !hasVideo && !isRetweet
  return {
    inner,
    isRetweet,
    isReply,
    hasVideo,
    hasImage,
    isText,
    id: String(inner?.rest_id ?? legacy.id_str ?? ''),
    replyToId,
  }
}

/** 纯函数：从 timeline instructions 抽取推文结果与底部游标 */
export function parseTimeline(instructions: any[]): { results: any[]; bottomCursor?: string } {
  const results: any[] = []
  let bottomCursor: string | undefined
  for (const ins of instructions || []) {
    const entries: any[] = ins?.entries || ins?.entry ? [].concat(ins.entry, ins.entries).filter(Boolean) : []
    for (const entry of entries) {
      const content = entry?.content
      if (!content) continue
      if (content.entryType === 'TimelineTimelineCursor' && content.contentType === 'Bottom') {
        bottomCursor = String(content.value || bottomCursor || '')
        continue
      }
      if (content.entryType === 'TimelineTimelineItem' && content.itemContent?.tweet_results?.result) {
        results.push(content.itemContent.tweet_results.result)
        continue
      }
      if (content.entryType === 'TimelineTimelineModule') {
        for (const item of content.items || []) {
          const r = item?.itemContent?.tweet_results?.result
          if (r) results.push(r)
        }
      }
    }
  }
  return { results, bottomCursor }
}

function timelineOf(data: any): any[] {
  const user = data?.data?.user?.result
  const timeline = user?.timeline_v2?.timeline || user?.timeline?.timeline
  return timeline?.instructions || []

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
    const data = await gql(opName, queryId, variables, opts.creds, get)
    const { results, bottomCursor } = parseTimeline(timelineOf(data))
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
    const data = await gql(opName, queryId, variables, opts.creds, get)
    const { users, bottomCursor } = parseConnections(timelineOf(data))
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
