/**
 * 已安装碎片包（平台 @sns-parse/platform-* / 扩展 @sns-parse/ext-*）的动态发现。
 *
 * - 平台：先聚合包（@sns-parse/platforms 的 definitions[]），再逐个候选粒度包，
 *   按 type 去重合并（粒度包覆盖聚合条目）；宿主可传自己的 require 锚点
 *   （koishi/CLI 包路径），pnpm strict 下也能发现宿主直依赖。
 * - 扩展：loadWorkflowExtensions() 返回 WorkflowExtension[]（含 setup 钩子），
 *   未安装的自动缺席（能力/配置贡献同时缺席，不报错）。
 */
import { createRequire } from 'node:module'
import type { PlatformDefinition } from './platform'
import type { ConfigContribution } from './config'
import type { WorkflowExtension } from './extensions'

type NodeRequire = ReturnType<typeof createRequire>

const fallbackRequire: NodeRequire = createRequire(typeof __filename !== 'undefined' ? __filename : process.cwd() + '/')

function req(anchor?: NodeRequire): NodeRequire {
  return anchor || fallbackRequire
}

const PLATFORM_TYPES = [
  'bilibili', 'douyin', 'kuaishou', 'xiaohongshu', 'weibo', 'xigua', 'youtube',
  'tiktok', 'acfun', 'zhihu', 'weishi', 'huya', 'haokan', 'meipai', 'twitter',
  'instagram', 'doubao', 'doubao_image', 'jimeng', 'oasis', 'wechat_channel',
  'lishi', 'quanmin', 'pipigx', 'pipixia', 'zuiyou', 'toutiao',
]

/** 收集已加载平台的定义（聚合包 + 粒度包并集；粒度包覆盖聚合条目） */
export function collectPlatformDefinitions(anchor?: NodeRequire): PlatformDefinition[] {
  const nodeRequire = req(anchor)
  const byType = new Map<string, PlatformDefinition>()
  // 1) 聚合包（若安装）：一次拿全声明
  try {
    const agg = nodeRequire('@sns-parse/platforms')
    const defs: PlatformDefinition[] = agg?.definitions || agg?.default?.definitions || []
    for (const d of defs) {
      if (d && d.type && !byType.has(d.type)) byType.set(d.type, d)
    }
  } catch {
    // 未装聚合包 → 只看粒度包
  }
  // 2) 粒度包（可覆盖聚合条目）
  for (const type of PLATFORM_TYPES) {
    try {
      const mod = nodeRequire(`@sns-parse/platform-${type}`)
      const def: PlatformDefinition | undefined = mod.default || mod[type]
      if (def && def.type) byType.set(def.type, def)
    } catch {
      // 未装该平台 → 缺席
    }
  }
  return [...byType.values()]
}

/** 已加载平台的链接规则（按平台声明） */
export function collectPlatformLinkRules(anchor?: NodeRequire): { pattern: RegExp; type: string }[] {
  return collectPlatformDefinitions(anchor).flatMap(d => d.rules.map(pattern => ({ pattern, type: d.type })))
}

interface ExtensionSpec {
  name: string
  /** 模块导出的工厂名（返回 WorkflowExtension） */
  extensionKey: string
  /** 兼容旧式独立配置贡献导出名（可选） */
  contributionKey?: string
}

const EXTENSION_SPECS: ExtensionSpec[] = [
  { name: 'ext-nsfw', extensionKey: 'nsfwExtension', contributionKey: 'nsfwConfigContribution' },
  { name: 'ext-merge', extensionKey: 'mergeExtension' },
  { name: 'ext-translate', extensionKey: 'translateExtension' },
  { name: 'ext-gif', extensionKey: 'gifExtension' },
]

/** 探测并实例化全部已安装扩展（WorkflowExtension[]；含 setup 钩子） */
export function loadWorkflowExtensions(anchor?: NodeRequire): WorkflowExtension[] {
  const nodeRequire = req(anchor)
  const out: WorkflowExtension[] = []
  for (const spec of EXTENSION_SPECS) {
    try {
      const mod = nodeRequire(`@sns-parse/${spec.name}`)
      const factory = mod?.[spec.extensionKey]
      if (typeof factory !== 'function') continue
      const ext = factory() as WorkflowExtension
      if (!ext || typeof ext.setup !== 'function') continue
      if (!ext.configContribution && spec.contributionKey && mod[spec.contributionKey]) {
        ext.configContribution = mod[spec.contributionKey] as ConfigContribution
      }
      out.push(ext)
    } catch {
      // 未安装的扩展 → 缺席（能力与配置贡献同时缺席）
    }
  }
  return out
}

/** 已安装扩展的配置贡献（settings 动态渲染用） */
export function loadExtensionContributions(anchor?: NodeRequire): ConfigContribution[] {
  return loadWorkflowExtensions(anchor)
    .map(e => e.configContribution)
    .filter((c): c is ConfigContribution => !!c)
}

/** 兼容旧名（已废弃：请用 loadWorkflowExtensions） */
export function loadExtensionImplementations(anchor?: NodeRequire): WorkflowExtension[] {
  return loadWorkflowExtensions(anchor)
}
