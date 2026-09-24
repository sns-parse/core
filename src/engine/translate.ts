/**
 * 语种决策与展示工具（纯函数，属调度/编排层的共享工具）。
 * 翻译实现（Google gtx + MyMemory）在 @sns-parse/ext-translate；
 * 平台原生翻译（如 X 网页同源 Grok）在对应平台包的 translate 钩子。
 */
import type { TranslateResult } from '../extensions'

export type { TranslateResult }

/** 判断是否需要跳过翻译（目标语种与源语种相同 / 无文本内容） */
export function shouldSkipTranslate(tweetLang: string | undefined, target: string): boolean {
  if (!tweetLang) return false
  const l = tweetLang.toLowerCase()
  if (l === 'zxx' || l === 'und') return l === 'zxx' // zxx=无文本内容；und=未识别可尝试
  const t = target.toLowerCase()
  if (t === 'zh') return l === 'zh' || l.startsWith('zh-')
  if (t === 'zh-tw') return l === 'zh-tw' || l === 'zh-hant' || (l.startsWith('zh') && l !== 'zh-cn')
  if (t === 'en') return l === 'en'
  return l === t
}

/** 语种代码 → 展示名（未知返回原代码） */
const LANG_NAMES: Record<string, string> = {
  fr: '法语', ja: '日语', ko: '韩语', en: '英语', zh: '中文', es: '西班牙语', pt: '葡萄牙语',
  de: '德语', ru: '俄语', ar: '阿拉伯语', it: '意大利语', th: '泰语', vi: '越南语',
  id: '印尼语', tr: '土耳其语', nl: '荷兰语', pl: '波兰语', hi: '印地语', uk: '乌克兰语',
  sv: '瑞典语', no: '挪威语', fi: '芬兰语', da: '丹麦语', cs: '捷克语', ro: '罗马尼亚语',
  hu: '匈牙利语', el: '希腊语', he: '希伯来语', fa: '波斯语', ur: '乌尔都语', ms: '马来语',
  tl: '菲律宾语', ca: '加泰罗尼亚语', bg: '保加利亚语', hr: '克罗地亚语', sr: '塞尔维亚语',
}

export function langName(code?: string): string {
  if (!code) return ''
  const base = code.toLowerCase().split('-')[0]
  if (base === 'und') return ''
  return LANG_NAMES[base] || code
}
