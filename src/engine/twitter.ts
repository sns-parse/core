import type { AxiosInstance } from 'axios'
import type { ParsedData, VideoQuality } from '../types'
import { tlsGet } from '../utils/tls-client'

/** GraphQL GET 器：可注入（生产用 tlsGet，测试用 mock） */
export type GraphqlGetter = (url: string, opts: { headers?: Record<string, string>; cookies?: Record<string, string>; timeout?: number }) => Promise<{ status: number; data: any }>

/**
 * X / Twitter 原生解析器。
 *
 * - 公开推文：走 syndication API（cdn.syndication.twimg.com），无需登录，Node 友好。
 * - 需登录推文（syndication 返回 tombstone）：若提供 {authToken, ct0}，回退到
 *   GraphQL TweetResultByRestId（仅用 auth_token + ct0 两个 cookie，最小化）。
 *
 * ⚠️ 重要限制：X 的 GraphQL 端点受 Cloudflare TLS 指纹校验保护。纯 Node/axios 的
 * TLS 握手(JA3/JA4)与 Chrome 不同，会被 CF 直接 403（cookie 到不了应用层）。
 * 因此登录态回退由 tlsget-rs（wreq/BoringSSL，Chrome 指纹）完成；未安装该
 * 可选依赖时会返回明确错误。
 */

const SYNDICATION_URL = 'https://cdn.syndication.twimg.com/tweet-result'

// X 网页端公开 bearer（抓包固定值，非密钥）
const WEB_BEARER = 'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA'
// TweetResultByRestId 的 queryId（随 web 版本变动，可被覆盖）
const TWEET_RESULT_QUERY_ID = 'GZsN2Pc4knAoit6pXa4HSA'
const GRAPHQL_FEATURES = {
  creator_subscriptions_tweet_preview_api_enabled: true,
  communities_web_enable_tweet_community_results_fetch: true,
  view_counts_everywhere_api_enabled: true,
  longform_notetweets_consumption_enabled: true,
  responsive_web_twitter_article_tweet_consumption_enabled: true,
  responsive_web_edit_tweet_api_enabled: true,
  graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
  standardized_nudges_misinfo: true,
  tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
  longform_notetweets_rich_text_read_enabled: true,
  responsive_web_graphql_timeline_navigation_enabled: true,
}

export interface TwitterCreds {
  authToken: string
  ct0: string
}

/* ===================== X GraphQL 公共件（用户维度查询与树共用） ===================== */

export interface TwitterQueryIds {
  UserByScreenName?: string
  UserTweets?: string
  UserTweetsAndReplies?: string
  Likes?: string
  Followers?: string
  Following?: string
  TweetDetail?: string
}

/** 默认 queryId 清单（随 x.com web 版本漂移；调用方可整体覆盖） */
export const DEFAULT_QUERY_IDS: Required<TwitterQueryIds> = {
  UserByScreenName: 'sLVLhk0bGj3MVFEKTdax1w',
  UserTweets: 'HuTx74BxAnezK1gWvYY7zg',
  UserTweetsAndReplies: 'RIWc55YCNyUJ-U3HHGYkdg',
  Likes: 'nXEl0lfN_XSznVMlprThgQ',
  Followers: 'pd8Tt1qUz1YWrICegqZ8cw',
  Following: 'wjvx62Hye2dGVvnvVco0xA',
  TweetDetail: 'zXaXQgfyR4GxE21uwYQSyA',
}

/** 时间线类查询的特性集（UserTweets/Likes/Followers/TweetDetail 共用） */
export const TIMELINE_FEATURES: Record<string, boolean> = {
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

/** 鉴权 GraphQL 通用请求（headers/cookie 与 TweetResultByRestId 同源） */
export async function twitterGraphql(
  opName: string,
  queryId: string,
  variables: Record<string, any>,
  creds: TwitterCreds,
  get: GraphqlGetter,
  features: Record<string, boolean> = TIMELINE_FEATURES,
): Promise<any> {
  const url = `https://x.com/i/api/graphql/${queryId}/${opName}` +
    `?variables=${encodeURIComponent(JSON.stringify(variables))}&features=${encodeURIComponent(JSON.stringify(features))}`
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
  const hasImage = media.some((m: any) => m?.type === 'photo')
  const hasVideo = media.some((m: any) => m?.type === 'video' || m?.type === 'animated_gif')
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

/** 纯函数：从 timeline instructions 抽取推文结果与底部游标（Item/Module 均收） */
export function walkTimelineResults(instructions: any[]): { results: any[]; bottomCursor?: string } {
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

/** Grok 翻译特性集（与网页端抓包一致；关键是 grok_show_grok_translated_post 开关） */
const GROK_FEATURES: Record<string, boolean> = {
  creator_subscriptions_tweet_preview_api_enabled: true,
  premium_content_api_read_enabled: false,
  communities_web_enable_tweet_community_results_fetch: true,
  c9s_tweet_anatomy_moderator_badge_enabled: true,
  responsive_web_grok_analyze_button_fetch_trends_enabled: false,
  responsive_web_grok_analyze_post_followups_enabled: true,
  rweb_cashtags_composer_attachment_enabled: true,
  responsive_web_jetfuel_frame: true,
  responsive_web_grok_share_attachment_enabled: true,
  responsive_web_grok_annotations_enabled: true,
  articles_preview_enabled: true,
  responsive_web_edit_tweet_api_enabled: true,
  rweb_conversational_replies_downvote_enabled: false,
  graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
  view_counts_everywhere_api_enabled: true,
  longform_notetweets_consumption_enabled: true,
  responsive_web_twitter_article_tweet_consumption_enabled: true,
  content_disclosure_indicator_enabled: true,
  content_disclosure_ai_generated_indicator_enabled: true,
  responsive_web_grok_show_grok_translated_post: true,
  responsive_web_grok_analysis_button_from_backend: true,
  post_ctas_fetch_enabled: false,
  rweb_cashtags_enabled: true,
  freedom_of_speech_not_reach_fetch_enabled: true,
  standardized_nudges_misinfo: true,
  tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
  longform_notetweets_rich_text_read_enabled: true,
  longform_notetweets_inline_media_enabled: false,
  profile_label_improvements_pcf_label_in_post_enabled: true,
  responsive_web_profile_redirect_enabled: true,
  rweb_tipjar_consumption_enabled: false,
  verified_phone_label_enabled: false,
  responsive_web_grok_image_annotation_enabled: true,
  responsive_web_grok_imagine_annotation_enabled: true,
  responsive_web_grok_community_note_auto_translation_is_enabled: true,
  responsive_web_graphql_timeline_navigation_enabled: true,
}

const GROK_FIELD_TOGGLES = {
  withArticleRichContentState: true,
  withArticlePlainText: false,
  withArticleSummaryText: true,
  withArticleVoiceOver: true,
}

/** 目标语言 → x-twitter-client-language（译文语言由该头驱动） */
function clientLanguage(target: string): string {
  const t = target.toLowerCase()
  if (t === 'zh') return 'zh-cn'
  if (t === 'zh-tw') return 'zh-tw'
  return t
}

export interface GrokTranslation {
  text: string
  sourceLang?: string
}

/**
 * X 原生 Grok 翻译（与网页"翻译推文"同源）。
 * 需登录态；网页抓包实证：grok 特性开关 + client-language 头即可，无需
 * x-client-transaction-id / cf_clearance。任何失败返回 null 由调用方回落通用翻译。
 */
export async function fetchGrokTranslation(url: string, targetLang: string, creds: TwitterCreds, get: GraphqlGetter = tlsGet): Promise<GrokTranslation | null> {
  const id = extractTweetId(url)
  if (!id) return null
  const variables = { tweetId: id, includePromotedContent: true, withBirdwatchNotes: true, withVoice: true, withCommunity: true }
  const gqlUrl = `https://x.com/i/api/graphql/${TWEET_RESULT_QUERY_ID}/TweetResultByRestId` +
    `?variables=${encodeURIComponent(JSON.stringify(variables))}` +
    `&features=${encodeURIComponent(JSON.stringify(GROK_FEATURES))}` +
    `&fieldToggles=${encodeURIComponent(JSON.stringify(GROK_FIELD_TOGGLES))}`
  let res
  try {
    res = await get(gqlUrl, {
      headers: {
        authorization: `Bearer ${WEB_BEARER}`,
        'x-csrf-token': creds.ct0,
        'x-twitter-auth-type': 'OAuth2Session',
        'x-twitter-active-user': 'yes',
        'x-twitter-client-language': clientLanguage(targetLang),
      },
      cookies: { auth_token: creds.authToken, ct0: creds.ct0 },
      timeout: 30000,
    })
  } catch {
    return null
  }
  if (res.status !== 200) return null
  const node = res.data?.data?.tweetResult?.result?.grok_translated_post_with_availability
  if (!node || node.is_available !== true) return null
  const text = node.data?.translation
  if (typeof text !== 'string' || !text.trim()) return null
  return { text: text.trim(), sourceLang: node.data?.source_language ? String(node.data.source_language) : undefined }
}

export function extractTweetId(url: string): string | null {
  const m = /\/status(?:es)?\/(\d+)/.exec(url)
  return m ? m[1] : null
}

function pick(...vals: any[]): any {
  for (const v of vals) if (v !== undefined && v !== null && v !== '') return v
  return ''
}

/** BFS 深取子树中第一个非空的指定键值（X GraphQL 用户结构随版本漂移：legacy ↔ core/avatar） */
function deepPick(node: any, key: string): any {
  const queue = [node]
  while (queue.length) {
    const cur = queue.shift()
    if (!cur || typeof cur !== 'object') continue
    const v = cur[key]
    if (v !== undefined && v !== null && v !== '') return v
    for (const k of Object.keys(cur)) queue.push(cur[k])
  }
  return undefined
}

/** BFS 找子树中最长的 text 字符串（笔记正文位置随版本漂移，取最长以避开截断副本） */
function deepFindLongestText(node: any): string | undefined {
  let best: string | undefined
  const queue = [node]
  while (queue.length) {
    const cur = queue.shift()
    if (!cur || typeof cur !== 'object') continue
    if (typeof cur.text === 'string' && cur.text && (!best || cur.text.length > best.length)) best = cur.text
    for (const k of Object.keys(cur)) queue.push(cur[k])
  }
  return best
}

/** 清理描述中的 t.co 短链（Twitter 自动附加的截断 URL，无实际内容价值）。
 *  注意保留段落换行：仅折叠水平空白，≥3 连续换行压成空行一档。 */
function cleanDesc(text: string): string {
  if (!text) return text
  // 去掉全部 t.co URL（文末自动附加 + 文中内嵌）
  let cleaned = text.replace(/https?:\/\/t\.co\/[A-Za-z0-9]+(?:\?[^\s]*)?/g, '')
  // 仅折叠空格/制表（不动换行）；去掉行首尾空格；连续空行压成一个空行
  cleaned = cleaned.replace(/[^\S\n]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  return cleaned || text
}

function baseParsed(): ParsedData {
  return {
    type: 'video', title: '', desc: '', author: '', uid: '', avatar: '', cover: '',
    video: '', videos: [], images: [], live_photo: [], music: {},
    like: 0, comment: 0, collect: 0, share: 0, play: 0, duration: 0, publishTime: 0,
    author_followers: 0, author_signature: '', admire: 0,
  }
}

/** 归一化变体列表（三种来源的字段名不同：url/src、content_type/type） */
function normalizeVariants(variants: any[]): VideoQuality[] {
  return variants
    .filter((v: any) => v && (v.url || v.src))
    .map((v: any) => ({
      quality: v.bitrate ? `${v.bitrate}bps` : (v.content_type || v.type || 'unknown'),
      url: v.url || v.src,
      bit_rate: Number(v.bitrate || 0),
    }))
    .sort((a: VideoQuality, b: VideoQuality) => (b.bit_rate || 0) - (a.bit_rate || 0))
}

/**
 * 统一媒体提取（新结构优先，旧结构兜底）：
 * - 新：mediaDetails[]（photo/video_info.variants）+ 顶层 video（poster/src variants）
 * - 旧：videoDetails（posterUrl/url variants）+ photos[]
 */
function extractSyndicationMedia(tw: any, p: ParsedData): void {
  // 1) mediaDetails[]：新版标准位置
  if (Array.isArray(tw.mediaDetails)) {
    for (const m of tw.mediaDetails) {
      if (!m) continue
      if (m.type === 'photo') {
        if (m.media_url_https && !p.images.includes(m.media_url_https)) p.images.push(m.media_url_https)
      } else if ((m.type === 'video' || m.type === 'animated_gif') && Array.isArray(m.video_info?.variants)) {
        const vs = normalizeVariants(m.video_info.variants)
        if (vs.length) {
          p.videos.push(...vs)
          const dur = m.video_info.duration_millis ? Math.floor(Number(m.video_info.duration_millis) / 1000) : 0
          if (!p.video) {
            p.video = vs[0].url
            p.cover = String(pick(m.media_url_https, p.cover))
            if (dur) p.duration = dur
            if (m.type === 'animated_gif') p.isGif = true
          } else {
            // 多视频推文：其余视频逐条携带（发送层每条独立发送，封面随行用于展示与单独审核）
            ;(p.extraVideos ||= []).push({ url: vs[0].url, isGif: m.type === 'animated_gif', duration: dur, cover: String(pick(m.media_url_https, '')) })
          }
        }
      }
    }
  }
  // 2) 顶层 video（amplify 等）：poster + variants
  if (!p.video && Array.isArray(tw.video?.variants)) {
    const vs = normalizeVariants(tw.video.variants)
    if (vs.length) {
      p.videos.push(...vs)
      p.video = vs[0].url
      p.cover = String(pick(tw.video.poster, p.cover))
      if (tw.video.durationMs) p.duration = Math.floor(Number(tw.video.durationMs) / 1000)
    }
  }
  // 3) 旧结构兜底：videoDetails + photos
  if (!p.video && Array.isArray(tw.videoDetails?.variants)) {
    const vs = normalizeVariants(tw.videoDetails.variants)
    if (vs.length) {
      p.videos.push(...vs)
      p.video = vs[0].url
      p.cover = String(pick(tw.videoDetails.posterUrl, p.cover))
      if (tw.videoDetails.durationMs) p.duration = Math.floor(Number(tw.videoDetails.durationMs) / 1000)
    }
  }
  if (!p.images.length && Array.isArray(tw.photos)) {
    p.images = tw.photos.map((x: any) => (typeof x === 'string' ? x : x?.url)).filter((u: any) => !!u)
  }
}

/** 把 syndication 响应映射为 ParsedData */
function mapSyndication(tw: any): ParsedData {
  const user = tw.user || {}
  const text = String(pick(tw.note_tweet?.text, tw.text, ''))
  const p = baseParsed()

  extractSyndicationMedia(tw, p)
  if (!p.cover) p.cover = String(pick(p.images[0], ''))
  // 纯文字推文：type=text（无任何媒体但有正文，属合法内容）
  p.type = p.video ? 'video' : (p.images.length ? 'image' : 'text')

  // 标题/简介同源；标题也须基于清理后的文本，否则 t.co 短链会让去重判断失效
  const cleaned = cleanDesc(text)
  p.title = cleaned.slice(0, 100)
  p.desc = cleaned
  p.lang = tw.lang ? String(tw.lang) : undefined
  p.author = String(pick(user.name, user.screen_name, ''))
  p.uid = String(pick(user.screen_name, user.id_str, ''))
  p.avatar = String(pick(user.profile_image_url_https, user.profile_image_url, ''))
  p.like = Number(pick(tw.favorite_count, 0)) || 0
  p.comment = Number(pick(tw.conversation_count, tw.reply_count, 0)) || 0
  p.share = Number(pick(tw.retweet_count, 0)) || 0
  p.play = Number(pick(tw.video?.viewCount, tw.videoDetails?.viewCount, tw.views, 0)) || 0
  p.collect = Number(pick(tw.bookmark_count, 0)) || 0
  if (tw.created_at) { const t = Date.parse(tw.created_at); if (!isNaN(t)) p.publishTime = t }
  p.author_followers = Number(pick(user.followers_count, 0)) || 0
  p.author_signature = String(pick(user.description, ''))
  if (p.title && p.desc && p.desc.startsWith(p.title)) p.title = ''
  return p
}

/** 把 GraphQL TweetResultByRestId 响应映射为 ParsedData */
export function mapGraphql(rawResult: any): ParsedData {
  // NSFW/受限推文会被 TweetWithVisibilityResults 包裹，真实推文在其 .tweet 下
  let result = rawResult
  if (result && result.__typename === 'TweetWithVisibilityResults' && result.tweet) {
    result = result.tweet
  }
  const legacy = result.legacy || {}
  const user = result.core?.user_results?.result
  const ures = user || {}
  // 长推（note tweet）：legacy.full_text 是截断版，全文在 note_tweet 子树（位置随版本漂移，深取最长 text）
  // 用户字段同理：legacy ↔ core/avatar/profile_bio 漂移，深取键值
  const text = String(pick(deepFindLongestText(result.note_tweet), legacy.full_text, ''))
  const p = baseParsed()

  const media = Array.isArray(legacy.entities?.media) ? legacy.entities.media : []
  const photos: string[] = []
  for (const m of media) {
    if (!m) continue
    if (m.type === 'photo') {
      if (m.media_url_https) photos.push(m.media_url_https)
    } else if ((m.type === 'video' || m.type === 'animated_gif') && m.video_info?.variants?.length) {
      const vs = m.video_info.variants
        .filter((v: any) => v && v.url && (v.content_type || '').includes('mp4'))
        .map((v: any) => ({ quality: v.bitrate ? `${v.bitrate}bps` : 'unknown', url: v.url, bit_rate: Number(v.bitrate || 0) }))
        .sort((a: VideoQuality, b: VideoQuality) => (b.bit_rate || 0) - (a.bit_rate || 0))
      if (vs.length) {
        p.videos.push(...vs)
        const dur = m.video_info.duration_millis ? Math.floor(Number(m.video_info.duration_millis) / 1000) : 0
        if (!p.video) {
          p.video = vs[0].url
          p.cover = String(pick(m.media_url_https, p.cover))
          if (dur) p.duration = dur
          if (m.type === 'animated_gif') p.isGif = true
        } else {
          ;(p.extraVideos ||= []).push({ url: vs[0].url, isGif: m.type === 'animated_gif', duration: dur, cover: String(pick(m.media_url_https, '')) })
        }
      }
    }
  }
  p.images = photos
  if (!p.cover) p.cover = String(pick(photos[0], ''))
  // 纯文字推文：type=text
  p.type = p.video ? 'video' : (p.images.length ? 'image' : 'text')

  // 标题/简介同源；标题也须基于清理后的文本，否则 t.co 短链会让去重判断失效
  const cleaned = cleanDesc(text)
  p.title = cleaned.slice(0, 100)
  p.desc = cleaned
  p.lang = legacy.lang ? String(legacy.lang) : undefined
  p.author = String(pick(deepPick(ures, 'name'), ''))
  p.uid = String(pick(deepPick(ures, 'screen_name'), user?.rest_id, ''))
  p.avatar = String(pick(deepPick(ures, 'profile_image_url_https'), deepPick(ures, 'image_url'), ''))
  p.like = Number(pick(legacy.favorite_count, 0)) || 0
  p.comment = Number(pick(legacy.reply_count, 0)) || 0
  p.share = Number(pick(legacy.retweet_count, 0)) || 0
  p.play = Number(pick(result.views?.count, 0)) || 0
  p.collect = Number(pick(legacy.bookmark_count, 0)) || 0
  if (legacy.created_at) { const t = Date.parse(legacy.created_at); if (!isNaN(t)) p.publishTime = t }
  p.author_followers = Number(pick(deepPick(ures, 'followers_count'), 0)) || 0
  p.author_signature = String(pick(deepPick(ures, 'description'), ''))
  if (p.title && p.desc && p.desc.startsWith(p.title)) p.title = ''
  return p
}

/** 解除 TweetWithVisibilityResults 包裹（NSFW/受限推文） */
export function unwrapTweetResult(result: any): any {
  return result && result.__typename === 'TweetWithVisibilityResults' && result.tweet ? result.tweet : result
}

/** 鉴权 GraphQL 原始获取：返回未映射的 tweet result 节点（树构建复用） */
export async function fetchGraphqlRaw(id: string, creds: TwitterCreds, get: GraphqlGetter): Promise<any> {
  const variables = { tweetId: id, includePromotedContent: true, withBirdwatchNotes: true, withVoice: true, withCommunity: true }
  const url = `https://x.com/i/api/graphql/${TWEET_RESULT_QUERY_ID}/TweetResultByRestId` +
    `?variables=${encodeURIComponent(JSON.stringify(variables))}&features=${encodeURIComponent(JSON.stringify(GRAPHQL_FEATURES))}`
  let res
  try {
    res = await get(url, {
      headers: {
        authorization: 'Bearer ' + WEB_BEARER,
        'x-csrf-token': creds.ct0,
        'x-twitter-auth-type': 'OAuth2Session',
        'x-twitter-active-user': 'yes',
        'x-twitter-client-language': 'en',
      },
      cookies: { auth_token: creds.authToken, ct0: creds.ct0 },
      timeout: 30000,
    })
  } catch (e: any) {
    throw new Error(`X GraphQL 请求失败：${e?.message || e}（需登录的推文）`)
  }

  if (res.status === 403 || res.status === 429) {
    throw new Error(
      `X GraphQL 被 Cloudflare 拦截 (HTTP ${res.status})：TLS 指纹校验未通过。` +
      `请确认已安装可选依赖 @char46/tlsget-rs（npm i @char46/tlsget-rs），它提供浏览器级 TLS 指纹。`
    )
  }
  if (res.status !== 200) {
    throw new Error(`X GraphQL 返回 HTTP ${res.status}：${typeof res.data === 'string' ? res.data.slice(0, 120) : JSON.stringify(res.data || {}).slice(0, 120)}`)
  }

  const result = res.data?.data?.tweetResult?.result
  if (!result) throw new Error('X GraphQL 返回无数据')
  if (result.__typename === 'TweetTombstone' || result.__typename === 'TweetUnavailable') {
    const tb = result?.tombstone?.text?.text || result?.tombstone?.text
    throw new Error(`推文不可访问（可能需要登录、已被删除或为非公开内容）${tb ? '：' + tb : ''}`)
  }
  return unwrapTweetResult(result)
}

/** 鉴权 GraphQL：仅用 auth_token + ct0，回退取登录受限推文 */
async function fetchGraphqlTweet(id: string, creds: TwitterCreds, get: GraphqlGetter): Promise<ParsedData> {
  return mapGraphql(await fetchGraphqlRaw(id, creds, get))
}

export async function parseTwitter(url: string, http: AxiosInstance, creds?: TwitterCreds, getGraphql?: GraphqlGetter): Promise<ParsedData> {
  const id = extractTweetId(url)
  if (!id) throw new Error('无法从 X 链接提取推文 ID')

  // 1) 公开 syndication 路径
  const res = await http.get(SYNDICATION_URL, {
    params: { id, token: 'a' },
    timeout: 30000,
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
  })
  const tw = res.data
  if (tw && tw.__typename === 'Tweet' && tw.user) {
    const p = mapSyndication(tw)
    // 长推：syndication 现仅返回 note_tweet 的 id 引用（无 text），tw.text 被
    // display_text_range 截断。有登录态时改走 GraphQL 取全文；失败回退截断结果。
    const noteTruncated = tw.note_tweet && !tw.note_tweet.text
    if (noteTruncated && creds && creds.authToken && creds.ct0) {
      try {
        return await fetchGraphqlTweet(id, creds, getGraphql || tlsGet)
      } catch {
        return p
      }
    }
    return p
  }

  // 2) tombstone（需登录）：回退到鉴权 GraphQL（TLS 指纹模拟）
  if (creds && creds.authToken && creds.ct0) {
    return fetchGraphqlTweet(id, creds, getGraphql || tlsGet)
  }
  const reasonRaw = pick(tw?.tombstone?.text, tw?.tombstone?.name)
  throw new Error(`推文不可访问（可能需要登录、已被删除或为非公开内容）${reasonRaw ? '：' + reasonRaw : ''}`)
}

/* ===================== 推文树：引用链 + 回复链 + 会话回复树 ===================== */

/**
 * 推文树节点：
 * - quoted = 本推引用的推文（递归）
 * - replyTo = 本推回复的目标（向根方向递归）
 * - replies = 本推收到的回复（评论，向下递归；withReplies 时填充）
 */
export interface TweetTree {
  id: string
  tweet: ParsedData
  quoted?: TweetTree
  replyTo?: TweetTree
  replies?: TweetTree[]
}

const TREE_QUOTE_DEPTH = 6
const TREE_REPLY_DEPTH = 12
const TREE_REPLIES_LIMIT = 100

/** 游客态（syndication）取被引用推文 ID：显式字段优先；否则启发式——引用链的
 *  t.co 短链由 X 追加在正文末尾，expanded_url 为推文永久链。 */
export function guestQuoteId(tw: any): string | undefined {
  const q = tw?.quoted_tweet || tw?.quoted_status_result
  if (q) {
    const id = String(pick(q.id_str, q.rest_id, ''))
    if (/^\d+$/.test(id)) return id
  }
  const urls: any[] = Array.isArray(tw?.entities?.urls) ? tw.entities.urls : []
  const rawText: string = String(tw?.text || '')
  const textEnd = rawText.trimEnd()
  for (const u of urls) {
    if (!u?.url || !textEnd.endsWith(u.url)) continue
    const m = /(?:x|twitter)\.com\/[^/]+\/status(?:es)?\/(\d+)/.exec(String(u.expanded_url || ''))
    if (m) return m[1]
  }
  return undefined
}

/** 游客态（syndication）取回复目标推文 ID */
export function guestReplyToId(tw: any): string | undefined {
  const id = pick(tw?.in_reply_to_status_id_str, tw?.in_reply_to_status_id)
  if (typeof id === 'string' && /^\d+$/.test(id)) return id
  if (typeof id === 'number') return String(id)
  return undefined
}

async function fetchSyndicationRaw(tweetId: string, http: AxiosInstance): Promise<any> {
  const res = await http.get(SYNDICATION_URL, {
    params: { id: tweetId, token: 'a' },
    timeout: 30000,
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
  })
  const tw = res.data
  return tw && tw.__typename === 'Tweet' && tw.user ? tw : null
}

export interface FetchTweetTreeOptions {
  /** 拉取会话回复树（TweetDetail；需登录态） */
  withReplies?: boolean
  /** 回复条数上限（默认 100） */
  repliesLimit?: number
  /** queryId 覆盖 */
  queryIds?: TwitterQueryIds
}

/**
 * 纯函数：由会话内的全部 tweet result 装配回复树（挂在 focal 节点下）。
 * 依据 in_reply_to_status_id_str 建父子边；父不在集合内的孤儿回复跳过。
 */
export function assembleReplies(
  focalId: string,
  results: any[],
  limit: number,
  makeNode: (raw: any) => TweetTree,
): TweetTree[] {
  const byId = new Map<string, { node: TweetTree; replyToId?: string }>()
  for (const r of results) {
    const cat = categorizeTweetResult(r)
    if (!cat.id || byId.has(cat.id) || cat.id === focalId) continue
    byId.set(cat.id, { node: makeNode(cat.inner), replyToId: cat.replyToId })
  }
  const childrenOf = new Map<string, TweetTree[]>()
  const roots: TweetTree[] = []
  for (const { node, replyToId } of byId.values()) {
    if (replyToId && byId.has(replyToId)) {
      ;(childrenOf.get(replyToId) || childrenOf.set(replyToId, []).get(replyToId)!).push(node)
    } else if (replyToId === focalId) {
      roots.push(node)
    }
    /* 父不在集合内（祖先线程外）→ 跳过 */
  }
  let budget = limit
  const attach = (nodes: TweetTree[]): TweetTree[] => {
    const out: TweetTree[] = []
    for (const n of nodes) {
      if (budget <= 0) break
      budget--
      n.replies = attach(childrenOf.get(n.id) || [])
      out.push(n)
    }
    return out
  }
  return attach(roots)
}

/**
 * 拉取推文树：引用链（quoted，向下递归）+ 回复链（replyTo，向根递归）
 * + 可选会话回复树（replies，向下递归，TweetDetail 装配）。
 * - 有登录态：GraphQL 单次响应自带嵌套 quoted_status_result；父级逐次拉取
 * - 无登录态：syndication 逐节点拉取（引用 ID 走启发式）；不可达分支静默截断
 */
export async function fetchTweetTree(
  url: string,
  http: AxiosInstance,
  creds?: TwitterCreds,
  getGraphql?: GraphqlGetter,
  opts: FetchTweetTreeOptions = {},
): Promise<TweetTree> {
  const id = extractTweetId(url)
  if (!id) throw new Error('无法从 X 链接提取推文 ID')
  const visited = new Set<string>()

  async function buildGuest(tweetId: string, depth: number): Promise<TweetTree> {
    visited.add(tweetId)
    const tw = await fetchSyndicationRaw(tweetId, http)
    if (!tw) throw new Error(`推文 ${tweetId} 不可访问（可能需要登录或已删除）`)
    const node: TweetTree = { id: tweetId, tweet: mapSyndication(tw) }
    const qid = guestQuoteId(tw)
    if (qid && !visited.has(qid) && depth < TREE_QUOTE_DEPTH) {
      try { node.quoted = await buildGuest(qid, depth + 1) } catch { /* 引用不可达则截断 */ }
    }
    const rid = guestReplyToId(tw)
    if (rid && !visited.has(rid) && depth < TREE_REPLY_DEPTH) {
      try { node.replyTo = await buildGuest(rid, depth + 1) } catch { /* 父推不可达则截断 */ }
    }
    return node
  }

  async function buildFromGraphqlResult(raw: any, depth: number): Promise<TweetTree> {
    raw = unwrapTweetResult(raw)
    const rid0 = String(pick(raw?.rest_id, raw?.legacy?.id_str, ''))
    if (rid0) visited.add(rid0)
    const node: TweetTree = { id: rid0, tweet: mapGraphql(raw) }
    const q = unwrapTweetResult(raw?.quoted_status_result?.result)
    if (q && q.legacy && q.__typename !== 'TweetTombstone' && depth < TREE_QUOTE_DEPTH) {
      const qid = String(pick(q.rest_id, q.legacy?.id_str, ''))
      if (!qid || !visited.has(qid)) node.quoted = await buildFromGraphqlResult(q, depth + 1)
    }
    const rid = raw?.legacy?.in_reply_to_status_id_str
    if (typeof rid === 'string' && /^\d+$/.test(rid) && !visited.has(rid) && depth < TREE_REPLY_DEPTH) {
      try { node.replyTo = await buildGraphqlById(rid, depth + 1) } catch { /* 父推不可达则截断 */ }
    }
    return node
  }

  async function buildGraphqlById(tweetId: string, depth: number): Promise<TweetTree> {
    if (visited.has(tweetId)) throw new Error('引用环')
    const raw = await fetchGraphqlRaw(tweetId, creds!, getGraphql || tlsGet)
    return buildFromGraphqlResult(raw, depth)
  }

  /** 同步构建会话回复节点：嵌套引用链照常递归（无需网络），父链不拉（由会话集合装配） */
  function nodeFromResultSync(raw: any): TweetTree {
    raw = unwrapTweetResult(raw)
    const rid0 = String(pick(raw?.rest_id, raw?.legacy?.id_str, ''))
    if (rid0) visited.add(rid0)
    const node: TweetTree = { id: rid0, tweet: mapGraphql(raw) }
    const q = unwrapTweetResult(raw?.quoted_status_result?.result)
    if (q && q.legacy && q.__typename !== 'TweetTombstone') {
      const qid = String(pick(q.rest_id, q.legacy?.id_str, ''))
      if (!qid || !visited.has(qid)) node.quoted = nodeFromResultSync(q)
    }
    return node
  }

  async function attachConversation(node: TweetTree): Promise<void> {
    if (!node) return
    const qids = { ...DEFAULT_QUERY_IDS, ...opts.queryIds }
    const variables = {
      focalTweetId: node.id,
      with_rux_injections: false,
      rankingMode: 'Relevance',
      includePromotedContent: true,
      withCommunity: true,
      withQuickPromoteEligibilityTweetQuery: false,
      withBirdwatchNotes: true,
      withVoice: true,
    }
    const data = await twitterGraphql('TweetDetail', qids.TweetDetail, variables, creds!, getGraphql || tlsGet)
    const instructions = data?.data?.threaded_conversation_with_injections_v2?.timeline?.instructions
    const { results } = walkTimelineResults(instructions || [])
    node.replies = assembleReplies(node.id, results, opts.repliesLimit ?? TREE_REPLIES_LIMIT, nodeFromResultSync)
  }

  const usedGraphql = !!(creds && creds.authToken && creds.ct0)
  let tree: TweetTree
  if (usedGraphql) {
    try {
      tree = await buildGraphqlById(id, 0)
    } catch {
      /* 登录态失败（如 Cloudflare）回退游客路径 */
      tree = await buildGuest(id, 0)
    }
  } else {
    tree = await buildGuest(id, 0)
  }
  if (opts.withReplies && usedGraphql && tree) {
    try {
      await attachConversation(tree)
    } catch { /* 会话不可达则保留无回复树 */ }
  }
  return tree
}
