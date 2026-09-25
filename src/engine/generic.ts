/**
 * 通用链接解析（预留，暂不实现）：对未命中任何平台声明的链接的基础解析能力。
 *
 * 设计：
 * - 经 'parse.generic' 工作流阶段调度（见 workflow/hooks.ts）；
 * - 基线实现 = 未实现（返回 null）——链路保持现状：非平台链接不进入解析流程；
 * - 后续实现可由宿主或扩展 replace('parse.generic') 注入
 *   （OG 元信息抽取 / 页面结构化 / LLM 归纳，source 字段标注来源）；
 * - LLM 接口仅预留契约：engineConfigContributions() 的「通用链接解析（预留）」组
 *   提供 baseUrl/model/apiKey 配置位，暂无消费方，开关默认关闭。
 */

export interface GenericLinkInput {
  url: string
}

export interface GenericLinkResult {
  title?: string
  desc?: string
  images: string[]
  /** 解析来源：og=OG 元信息 / html=页面结构化 / llm=模型归纳 */
  source?: 'og' | 'html' | 'llm'
}

/** LLM 增强预留接口（字段与「通用链接解析（预留）」配置组一一对应） */
export interface LlmOptions {
  baseUrl?: string
  apiKey?: string
  model?: string
}

/** 通用解析器实现契约（replace('parse.generic') 的注入形态） */
export interface GenericLinkParser {
  parse(input: GenericLinkInput, rt: any): Promise<GenericLinkResult | null>
}
