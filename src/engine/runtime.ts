/**
 * 运行时装配（本文件在 core 内，平台无关）。
 *
 * 平台定义列表（defs）由宿主按已加载平台插件声明注入：
 * - koishi 兼容层：collectPlatformDefinitions(anchor)（聚合包 + 粒度包并集）
 * - CLI：collectPlatformDefinitions()
 * 工作流阶段基线在 createDefaultPipeline()，扩展经 WorkflowExtension.setup(hooks) 注入/替换。
 * core 不依赖任何扩展包、不含扩展实现。
 */
import axios, { AxiosInstance, AxiosRequestConfig } from 'axios'
import { HttpsProxyAgent } from 'https-proxy-agent'
import type { ParsedData, CustomPlatformConfig } from '../types'
import type { VideoParserHost } from '../host'
import { createHost } from '../host'
import type { WorkflowExtension } from '../extensions'
import type { PlatformDefinition } from '../platform'
import { SimpleLRUCache } from '../utils/cache'
import { parseFieldMapping } from '../utils/field-mapping'
import { buildCustomLinkRules } from './platform-config'
import { dedicatedApisFrom, type DedicatedApiMaps } from './gateway'
import { createDefaultPipeline } from '../workflow/default'
import type { Pipeline } from '../workflow/hooks'

export interface ParserRuntime {
  /** 宿主适配（core 统一入口） */
  host: VideoParserHost
  /** 仅在特化字段：底层运行模块（等同于 host.context） */
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
  /** 平台定义列表（原生解析/原生翻译 fetcher 阶段使用） */
  defs: PlatformDefinition[]
  /** 平台专属 API 映射（由 defs 推导；getPlatformConfig 使用） */
  dedicatedApis: DedicatedApiMaps
  /** 已加载扩展片段（能力位/配置贡献查询用；实现经管道注入） */
  extensions: WorkflowExtension[]
  /** 工作流阶段管道（基线 + 扩展注入） */
  pipeline: Pipeline
}

export interface CreateRuntimeOptions {
  /** 平台定义列表（按用户已加载插件声明；缺省为空，只认自定义平台配置） */
  defs?: PlatformDefinition[]
  /** 扩展片段（setup 钩子注入；后注册者胜） */
  extensions?: WorkflowExtension[]
}

export function createRuntime(source: any, config: any, opts: CreateRuntimeOptions = {}): ParserRuntime {
  const host = createHost(source)
  const ctx = host.context
  const extensions: WorkflowExtension[] = [...(opts.extensions || []), ...((host.extensions as WorkflowExtension[]) || [])]
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

  const pipeline = createDefaultPipeline(null)
  for (const ext of extensions) {
    if (ext && typeof ext.setup === 'function') ext.setup(pipeline)
  }

  const runtime: ParserRuntime = {
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
    defs,
    dedicatedApis,
    extensions,
    pipeline,
  }
  pipeline.rt = runtime
  return runtime
}
