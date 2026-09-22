/**
 * 扩展契约：core 不直接依赖 NSFW/合并/翻译/GIF 实现，而是通过可注入的
 * VideoParserExtensions 调用。宿主可整体替换或按需覆盖单项能力。
 *
 * 默认实现由 extensions 包（@sns-parse/extensions）提供；runtime 会合并默认实现，
 * 因此 core 编排层可直接调用，无需判空。
 */
import type { ParserRuntimeLike } from './host'

export type MediaKind = 'cover' | 'image' | 'avatar' | 'music-cover'

export interface ImageOutcome {
  /** raw=原图 url；scrambled=混淆 buffer+token；link=仅链接文字；drop=不发送 */
  kind: 'raw' | 'scrambled' | 'link' | 'drop'
  url?: string
  buffer?: Buffer
  token?: string
}

export interface VideoOutcome {
  /** raw=照发；card=群内纯文字卡片+token（无封面无视频）；link=文字卡片+原链接；drop=仅文字卡片 */
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

/** 扩展能力集合（全部可选；runtime 会与默认实现合并） */
export interface VideoParserExtensions {
  /** 同源切图合并；返回 null 表示不合并 */
  mergeImages?(rt: ParserRuntimeLike, urls: string[]): Promise<{ buffer: Buffer } | null>
  /** 单张出站图片处理（NSFW 策略） */
  processImage?(rt: ParserRuntimeLike, platform: string, url: string, kind: MediaKind): Promise<ImageOutcome>
  /** 出站视频处理（NSFW 策略） */
  processVideo?(rt: ParserRuntimeLike, platform: string, videoUrl: string, coverUrl: string, meta: { title?: string; author?: string; requesterId: string }): Promise<VideoOutcome>
  /** 合并图审核；返回 null 表示回退逐张处理 */
  processMergedImage?(rt: ParserRuntimeLike, platform: string, buffer: Buffer, refUrl: string): Promise<ImageOutcome | null>
  /** 视频转 GIF；失败返回 null 回退原视频 */
  mp4ToGif?(rt: ParserRuntimeLike, url: string, durationSec: number, opts: GifOptions): Promise<Buffer | null>
  /** 文本翻译；失败返回 null */
  translate?(rt: ParserRuntimeLike, text: string, target: string, sourceLang?: string): Promise<TranslateResult | null>
  /** 内容安全能力状态（启动日志） */
  capability?(rt: ParserRuntimeLike): { ferret: boolean; moderation: string | null }
}
