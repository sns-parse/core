/**
 * 扩展契约：core 完整工作流 + 基线行为；扩展经阶段钩子注入/修改。
 *
 * core 不内建任何扩展实现（NSFW/合并/翻译/GIF），也不依赖扩展包；
 * 基线行为保证无扩展时全链路可跑（媒体直通、不合并逐张发、GIF 退化发视频、不翻译）。
 * 扩展导出 WorkflowExtension（含 setup(hooks)），由宿主收集后注入管道。
 */
import type { ConfigContribution } from './config'
import type { ParserRuntimeLike } from './host'
import type { WorkflowHooks } from './workflow/hooks'

export type MediaKind = 'cover' | 'image' | 'avatar' | 'music-cover'

export interface ImageOutcome {
  /** raw=原图 url 或 buffer 直发；scrambled=混淆 buffer+token；link=只发链接文本；drop=丢弃 */
  kind: 'raw' | 'scrambled' | 'link' | 'drop'
  url?: string
  buffer?: Buffer
  token?: string
  /** buffer 直发时的 mime（缺省 image/jpeg） */
  mime?: string
}

export interface VideoOutcome {
  /** raw=直发视频；card=群内容易吞 → 暂存+token，无法直发视频；link=只发卡片+原链接；drop=只发卡片 */
  kind: 'raw' | 'card' | 'link' | 'drop'
  url?: string
  token?: string
}

export interface TranslateResult {
  text: string
  provider: string
}

export interface GifOptions {
  maxWidth: number
  fps: number
  maxDurationSec: number
}

export interface VideoMeta {
  title?: string
  author?: string
  requesterId: string
}

/** 单个扩展片段：能力注册（setup 钩子注入）+ 可选配置贡献/能力位 */
export interface WorkflowExtension {
  name: string
  setup(hooks: WorkflowHooks): void
  configContribution?: ConfigContribution
  capability?(rt: ParserRuntimeLike): { ferret: boolean; moderation: string | null }
}

/** 汇总各扩展能力位（日志用） */
export function collectCapabilities(
  extensions: WorkflowExtension[] | undefined,
  rt: ParserRuntimeLike,
): { ferret: boolean; moderation: string | null } {
  let ferret = false
  let moderation: string | null = null
  for (const e of extensions || []) {
    if (typeof e.capability !== 'function') continue
    try {
      const c = e.capability(rt)
      if (c?.ferret) ferret = true
      if (c?.moderation) moderation = c.moderation
    } catch {
      // 能力位探测失败不影响主链路
    }
  }
  return { ferret, moderation }
}
