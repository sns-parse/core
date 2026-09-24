/**
 * 工作流阶段钩子管道（core 内建完整工作流，扩展经钩子注入/修改）。
 *
 * 每阶段结构：{ before[], impl, after[] }
 * - before：前置，可改输入（返回新输入；返回 undefined 表示不变）
 * - after：后置，可改输出（返回新输出；返回 undefined 表示不变）
 * - replace：整体替换该阶段实现（后注册者胜）
 *
 * 基线实现见 workflow/default.ts（无扩展时全链路可跑：
 * 不合并逐张发 / GIF 退化发视频 / 不翻译 / 媒体直通）。
 */
import type { ParsedData } from '../types'
import type { ImageOutcome, VideoOutcome, TranslateResult, GifOptions, MediaKind, VideoMeta } from '../extensions'
import type { ProcessedItem, MessageUnit } from '../engine/compose'
import type { OutboundSender, SessionLike } from '../sender'

export type StageName =
  | 'parse'
  | 'translate'
  | 'media.image'
  | 'media.video'
  | 'media.merged'
  | 'merge'
  | 'transcode'
  | 'compose'
  | 'send'

export interface ParseInput {
  url: string
  type: string
  fieldMapping?: Record<string, string>
  platformConf?: any
}

export interface TranslateInput {
  text: string
  target: string
  sourceLang?: string
}

export interface MediaImageInput {
  platform: string
  url: string
  kind: MediaKind
}

export interface MediaVideoInput {
  platform: string
  videoUrl: string
  coverUrl: string
  meta: VideoMeta
}

export interface MediaMergedInput {
  platform: string
  buffer: Buffer
  refUrl: string
}

export interface MergeInput {
  urls: string[]
}

export type MergeResult = { buffer: Buffer; layout?: any } | null

export interface TranscodeInput {
  url: string
  durationSec: number
  opts: GifOptions
}

export interface ComposeInput {
  item: ProcessedItem
}

export interface SendInput {
  items: ProcessedItem[]
  session: SessionLike
  sender: OutboundSender
  quoteId?: string
}

export interface StageIO {
  parse: { input: ParseInput; output: ParsedData }
  translate: { input: TranslateInput; output: TranslateResult | null }
  'media.image': { input: MediaImageInput; output: ImageOutcome }
  'media.video': { input: MediaVideoInput; output: VideoOutcome }
  'media.merged': { input: MediaMergedInput; output: ImageOutcome | null }
  merge: { input: MergeInput; output: MergeResult }
  transcode: { input: TranscodeInput; output: Buffer | null }
  compose: { input: ComposeInput; output: MessageUnit[] }
  send: { input: SendInput; output: void }
}

export type StageImpl<S extends StageName = StageName> = (
  input: StageIO[S]['input'],
  rt: any,
) => StageIO[S]['output'] | Promise<StageIO[S]['output']>

export type BeforeHandler<S extends StageName = StageName> = (
  input: StageIO[S]['input'],
  rt: any,
) => StageIO[S]['input'] | void | Promise<StageIO[S]['input'] | void>

export type AfterHandler<S extends StageName = StageName> = (
  output: StageIO[S]['output'],
  input: StageIO[S]['input'],
  rt: any,
) => StageIO[S]['output'] | void | Promise<StageIO[S]['output'] | void>

/** 扩展注入面：before/after 可插入，replace 可整体替换（后注册者胜） */
export interface WorkflowHooks {
  before<S extends StageName>(stage: S, h: BeforeHandler<S>): void
  after<S extends StageName>(stage: S, h: AfterHandler<S>): void
  replace<S extends StageName>(stage: S, h: StageImpl<S>): void
}

export class Pipeline implements WorkflowHooks {
  private impls = new Map<StageName, StageImpl<any>>()
  private befores = new Map<StageName, BeforeHandler<any>[]>()
  private afters = new Map<StageName, AfterHandler<any>[]>()

  constructor(public rt: any) {}

  before<S extends StageName>(stage: S, h: BeforeHandler<S>): void {
    const list = this.befores.get(stage) || []
    list.push(h as BeforeHandler<any>)
    this.befores.set(stage, list)
  }

  after<S extends StageName>(stage: S, h: AfterHandler<S>): void {
    const list = this.afters.get(stage) || []
    list.push(h as AfterHandler<any>)
    this.afters.set(stage, list)
  }

  replace<S extends StageName>(stage: S, h: StageImpl<S>): void {
    this.impls.set(stage, h as StageImpl<any>)
  }

  async run<S extends StageName>(stage: S, input: StageIO[S]['input']): Promise<StageIO[S]['output']> {
    let cur: any = input
    for (const h of this.befores.get(stage) || []) {
      const r = await h(cur, this.rt)
      if (r !== undefined) cur = r
    }
    const impl = this.impls.get(stage)
    if (!impl) throw new Error(`workflow: 阶段缺少实现: ${stage}`)
    let out: any = await impl(cur, this.rt)
    for (const h of this.afters.get(stage) || []) {
      const r = await h(out, cur, this.rt)
      if (r !== undefined) out = r
    }
    return out
  }
}

/** 取（或懒挂）runtime 的管道；裸 rt 对象也能工作（自动挂默认管道）。 */
export function ensurePipeline(rt: any): Pipeline {
  if (rt && rt.pipeline instanceof Pipeline) return rt.pipeline
  const { createDefaultPipeline } = require('./default') as typeof import('./default')
  const p = createDefaultPipeline(rt)
  if (rt) rt.pipeline = p
  return p
}

export function runStage<S extends StageName>(
  rt: any,
  stage: S,
  input: StageIO[S]['input'],
): Promise<StageIO[S]['output']> {
  return ensurePipeline(rt).run(stage, input)
}
