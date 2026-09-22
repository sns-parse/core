/**
 * 已安装碎片包的动态收集（平台 @sns-parse/platform-* 与扩展 @sns-parse/ext-*）。
 *
 * - 可自选安装单个碎片包；安装聚合包（@sns-parse/platforms / extensions）则全部到位
 * - 未安装的碎片自动缺席（链接识别、配置项与能力同时缺席）
 * - koishi 兼容层与 CLI 均经此处收集定义与配置声明
 */
import { createRequire } from 'node:module'
import type { PlatformDefinition } from './platform'
import type { ConfigContribution } from './config'
import type { VideoParserExtensions } from './extensions'

const nodeRequire = createRequire(typeof __filename !== 'undefined' ? __filename : process.cwd() + '/')

const PLATFORM_TYPES = [
  'bilibili', 'douyin', 'kuaishou', 'xiaohongshu', 'weibo', 'xigua', 'youtube',
  'tiktok', 'acfun', 'zhihu', 'weishi', 'huya', 'haokan', 'meipai', 'twitter',
  'instagram', 'doubao', 'doubao_image', 'jimeng', 'oasis', 'wechat_channel',
  'lishi', 'quanmin', 'pipigx', 'pipixia', 'zuiyou', 'toutiao',
]

/** 收集已安装平台的定义（含 label/rules/dedicated） */
export function collectPlatformDefinitions(): PlatformDefinition[] {
  const out: PlatformDefinition[] = []
  for (const type of PLATFORM_TYPES) {
    try {
      const mod = nodeRequire(`@sns-parse/platform-${type}`)
      const def: PlatformDefinition | undefined = mod.default || mod[type]
      if (def && def.type) out.push(def)
    } catch {
      // 未安装该平台包 → 跳过
    }
  }
  return out
}

/** 已安装平台的链接规则（扁平） */
export function collectPlatformLinkRules(): { pattern: RegExp; type: string }[] {
  return collectPlatformDefinitions().flatMap(d => d.rules.map(pattern => ({ pattern, type: d.type })))
}

interface ExtensionSpec {
  name: string
  contributionKey?: string
  extensionKey?: string
}

const EXTENSION_SPECS: ExtensionSpec[] = [
  { name: 'ext-nsfw', contributionKey: 'nsfwConfigContribution', extensionKey: 'nsfwExtension' },
  { name: 'ext-merge', extensionKey: 'mergeExtension' },
  { name: 'ext-translate', extensionKey: 'translateExtension' },
  { name: 'ext-gif', extensionKey: 'gifExtension' },
]

export interface LoadedExtension {
  name: string
  contribution?: ConfigContribution
  extension?: Partial<VideoParserExtensions>
}

/** 探测并加载全部已安装扩展 */
export function loadExtensions(): LoadedExtension[] {
  const out: LoadedExtension[] = []
  for (const spec of EXTENSION_SPECS) {
    try {
      const mod = nodeRequire(`@sns-parse/${spec.name}`)
      out.push({
        name: spec.name,
        contribution: spec.contributionKey ? mod[spec.contributionKey] : undefined,
        extension: spec.extensionKey && typeof mod[spec.extensionKey] === 'function'
          ? mod[spec.extensionKey]()
          : undefined,
      })
    } catch {
      // 未安装该扩展 → 跳过（配置项与能力同时缺席）
    }
  }
  return out
}

export function loadExtensionContributions(): ConfigContribution[] {
  return loadExtensions()
    .map(e => e.contribution)
    .filter((c): c is ConfigContribution => !!c)
}

/** 合并所有已安装扩展的能力片段 */
export function loadExtensionImplementations(): Partial<VideoParserExtensions> {
  return Object.assign({}, ...loadExtensions().map(e => e.extension || {}))
}
