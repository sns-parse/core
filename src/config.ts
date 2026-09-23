/**
 * 中立配置描述 DSL（core 定义，工具无关）。
 *
 * 各扩展包（@sns-parse/ext-*）与各平台包（@sns-parse/platform-*）以
 * ConfigContribution 声明自己需要的配置项；core 聚合为完整清单；
 * koishi 兼容层把清单翻译为 koishi Schema，CLI 兼容层翻译为默认配置/参数。
 *
 * core 与各碎片包都不依赖 koishi。
 */

export type ConfigFieldType = 'string' | 'number' | 'boolean' | 'array' | 'object' | 'union'

export interface ConfigUnionValue {
  value: string
  description?: string
}

/** 一个配置字段的中立描述 */
export interface ConfigField {
  /** 字段键（对象内相对键；顶层为绝对键） */
  key: string
  type: ConfigFieldType
  description?: string
  default?: any
  /** koishi 的 role：多行文本 / 密钥 */
  role?: 'textarea' | 'secret'
  hidden?: boolean
  /** 宿主 Schema 生成时的必填标记（仅 UI 层语义） */
  required?: boolean
  min?: number
  max?: number
  step?: number
  /** type='union' 的可选常量 */
  values?: ConfigUnionValue[]
  /** type='array' 且元素为标量时的元素类型 */
  itemType?: ConfigFieldType
  /** type='array' 且元素为对象时的元素字段 */
  itemFields?: ConfigField[]
  /** type='object' 的子字段 */
  fields?: ConfigField[]
}

/** 一组配置（通常对应 koishi 中的一个分组） */
export interface ConfigContribution {
  /** 分组标题 */
  group: string
  description?: string
  fields: ConfigField[]
}

/** 类型辅助：声明即校验 */
export function defineConfig(contribution: ConfigContribution): ConfigContribution {
  return contribution
}

/**
 * 聚合多组配置声明：同 group 合并字段（后者追加），保持首次出现顺序。
 * 用于 core 汇总所有扩展与平台声明的配置。
 */
export function mergeConfigContributions(lists: ConfigContribution[][]): ConfigContribution[] {
  const out: ConfigContribution[] = []
  const byGroup = new Map<string, ConfigContribution>()
  for (const list of lists) {
    for (const c of list) {
      const existing = byGroup.get(c.group)
      if (existing) existing.fields.push(...c.fields)
      else {
        const copy: ConfigContribution = { ...c, fields: [...c.fields] }
        byGroup.set(c.group, copy)
        out.push(copy)
      }
    }
  }
  return out
}

function applyFieldDefault(target: Record<string, any>, f: ConfigField): void {
  if (f.type === 'object' && f.fields) {
    const obj: Record<string, any> = {}
    for (const sub of f.fields) applyFieldDefault(obj, sub)
    // object 自身 default 与子字段 default 合并（子字段优先）
    target[f.key] = isPlainObject(f.default) ? { ...f.default, ...obj } : obj
    return
  }
  if (f.default !== undefined) target[f.key] = f.default
}

function isPlainObject(v: any): v is Record<string, any> {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

/**
 * 由配置声明提取默认值表（CLI / 无 Schema 宿主用）：
 * 平台开关等 object 字段展开为逐键默认值（如 { douyin: true, ... }）。
 */
export function defaultsFromContributions(contribs: ConfigContribution[]): Record<string, any> {
  const out: Record<string, any> = {}
  for (const c of contribs) {
    for (const f of c.fields) applyFieldDefault(out, f)
  }
  return out
}
