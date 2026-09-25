/**
 * 阶段基线实现（无扩展时的完整可用行为）：
 * parse=网关/平台原生全链路取数；translate=跳过；media.*=直通；
 * merge=不合并（逐张发）；transcode=不转换（发原视频）；compose=标准组装；send=发送策略分发。
 *
 * 扩展经 WorkflowExtension.setup(hooks) 注入/替换任一阶段；后注册者胜。
 */
import type { ImageOutcome, VideoOutcome } from '../extensions'
import { Pipeline, type SendInput } from './hooks'
import * as fetcher from '../engine/fetcher'
import * as compose from '../engine/compose'
import * as forward from '../engine/forward'

async function sendDispatch(rt: any, input: SendInput): Promise<void> {
  const { items, session, sender, quoteId } = input
  const config = rt.config || {}
  const forwardAllowed = config.enableForward && (session.platform === 'onebot' || session.platform === 'satori')
  if (forwardAllowed) {
    await forward.sendForward(rt, sender, session, items)
    return
  }
  if (config.sendStrategy === 'split') {
    for (const item of items) await compose.sendSplit(rt, sender, session, item, { quoteId })
    return
  }
  for (const item of items) {
    await compose.sendSingle(rt, sender, session, item, { quoteId })
  }
}

/** 构建带全部基线实现的管道；随后调用各扩展 setup(hooks) 注入/覆盖 */
export function createDefaultPipeline(rt: any): Pipeline {
  const p = new Pipeline(rt)
  p.replace('parse', (input, r) => fetcher.fetchApi(r, input.url, input.type, input.fieldMapping, input.platformConf))
  // 通用链接解析（预留）：基线=未实现（null）——非平台链接不进入解析流程；
  // 后续由宿主/扩展 replace 注入（OG/HTML/LLM，契约见 engine/generic.ts）
  p.replace('parse.generic', async () => null)
  p.replace('translate', async () => null)
  p.replace('media.image', async (input) => ({ kind: 'raw', url: input.url } as ImageOutcome))
  p.replace('media.video', async (input) => ({ kind: 'raw', url: input.videoUrl } as VideoOutcome))
  p.replace('media.merged', async (input) => ({ kind: 'raw', buffer: input.buffer, url: input.refUrl } as ImageOutcome))
  p.replace('merge', async () => null)
  p.replace('transcode', async () => null)
  p.replace('compose', (input, r) => compose.buildUnits(r, input.item))
  p.replace('send', (input, r) => sendDispatch(r, input))
  return p
}
