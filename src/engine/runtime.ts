/**
 * 运行时构建（自宿主 runtime 下沉，平台无关）。
 *
 * 平台定义列表（defs）由调用方传入：
 * - koishi 兼容层传内置 BUILTIN_PLATFORMS（本地 definitions）
 * - CLI 传 collectPlatformDefinitions()（已安装的 @sns-parse/platform-*）
 * 默认扩展实现同样注入：koishi 传含 NSFW 的完整默认实现，CLI 传 createCoreExtensions()。
 */
import axios, { AxiosInstance, AxiosRequestConfig } from 'axios'
import { HttpsProxyAgent } from 'https-proxy-agent'
import type { ParsedData, CustomPlatformConfig } from '../types'
import type { VideoParserHost } from '../host'
import { createHost } from '../host'
import type { VideoParserExtensions } from '../extensions'
import type { PlatformDefinition } from '../platform'
import { SimpleLRUCache } from '../utils/cache'
import { parseFieldMapping } from '../utils/field-mapping'
import { buildCustomLinkRules } from './platform-config'
import { dedicatedApisFrom, type DedicatedApiMaps } from './gateway'
import { mergeImages } from '../utils/merge'
import { mp4ToGif } from '../utils/gif'
import { translateText } from './translate'

export interface ParserRuntime {
  /** 宿主抽象（core 统一入口） */
  host: VideoParserHost
  /** 过渡期兼容字段：底层上下文（等同于 host.context） */
  ctx: any
  config: any
  http: AxiosInstance
  proxyConfig: any
  cacheTTL: number
  dedupCache: SimpleLRUCache<number>
  urlCacheLocal: SimpleLRUCache<{ data: ParsedData; expire: number }>
  contentDedupCache: SimpleLRUCache<number>
  customPlatforms: CustomPlatformConfig[]
  allRules: { pattern: RegExp; type: string }[]
  /** 平台专属端点映射（由 defs 计算；getPlatformConfig 使用） */
  dedicatedApis: DedicatedApiMaps
  /** 扩展能力（默认实现 + 宿主覆盖） */
  extensions: VideoParserExtensions
}

export interface CreateRuntimeOptions {
  /** 平台定义列表（内置或已安装包收集）；缺省为空（仅自定义平台规则可用） */
  defs?: PlatformDefinition[]
  /** 默认扩展实现（koishi 层含 NSFW；CLI 可用 createCoreExtensions） */
  defaultExtensions?: VideoParserExtensions
}

export function createRuntime(source: any, config: any, opts: CreateRuntimeOptions = {}): ParserRuntime {
  const host = createHost(source)
  const ctx = host.context
  const extensions: VideoParserExtensions = { ...(opts.defaultExtensions || {}), ...(host.extensions || {}) }
  const dedupCache = new SimpleLRUCache<number>(1000, config.deduplicationInterval * 1000)
  const cacheTTL = (config.cacheTTL || 600) * 1000
  const urlCacheLocal = new SimpleLRUCache<{ data: ParsedData; expire: number }>(500, cacheTTL)
  const contentDedupCache = new SimpleLRUCache<number>(1000, config.deduplicationInterval * 1000)

  const proxyConfig = config.proxy || {}
  const customPlatforms: CustomPlatformConfig[] = (config.customPlatforms || []).map((p: any) => ({
    name: p.name,
    apiUrl: p.apiUrl,
    apiKey: p.apiKey || '',
    authHeaderType: p.authHeaderType || 'Bearer',
    customHeaderName: p.customHeaderName || 'X-API-Key',
    fieldMapping: parseFieldMapping(p.fieldMapping),
    proxy: p.proxy || null
  }))

  const defs = opts.defs || []
  const builtinRules = defs.flatMap(d => d.rules.map(pattern => ({ pattern, type: d.type })))
  const customRules = buildCustomLinkRules(config.customPlatforms || [])
  const allRules = [...builtinRules, ...customRules]
  const dedicatedApis = dedicatedApisFrom(defs)

  const axiosConfig: AxiosRequestConfig = {
    timeout: config.timeout,
    headers: {
      'User-Agent': config.userAgent,
      'Referer': 'https://www.baidu.com/',
      'Content-Type': 'application/x-www-form-urlencoded'
    }
  }
  if (proxyConfig.enabled && proxyConfig.host) {
    // axios 内置 proxy 选项对 https 目标存在不做 CONNECT 隧道的经典缺陷，
    // 改用 https-proxy-agent 显式代理（按请求生效，不污染全局 env）
    const proxyUrl = `${proxyConfig.protocol || 'http'}://${proxyConfig.auth?.username ? `${encodeURIComponent(proxyConfig.auth.username)}:${encodeURIComponent(proxyConfig.auth.password || '')}@` : ''}${proxyConfig.host}:${proxyConfig.port || 7890}`
    const agent = new HttpsProxyAgent(proxyUrl)
    axiosConfig.httpAgent = agent
    axiosConfig.httpsAgent = agent
    axiosConfig.proxy = false
  }
  const http: AxiosInstance = axios.create(axiosConfig)

  return {
    host,
    ctx,
    config,
    http,
    proxyConfig,
    cacheTTL,
    dedupCache,
    urlCacheLocal,
    contentDedupCache,
    customPlatforms,
    allRules,
    dedicatedApis,
    extensions,
  }
}

/** core 自带扩展实现（无 NSFW：CLI / 嵌入式宿主用；koishi 层在其上叠加 NSFW） */
export function createCoreExtensions(): VideoParserExtensions {
  return {
    mergeImages,
    mp4ToGif,
    translate: translateText,
  }
}
