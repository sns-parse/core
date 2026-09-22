import { defineConfig, type ConfigContribution } from './config'

/**
 * 平台定义契约：每个平台的自描述单元，是「每平台一个包」的基础。
 *
 * 一个 PlatformDefinition 应自包含该平台的全部静态信息（链接规则、专属 API、
 * 提示等）；动态解析逻辑（normalize/parseNative）在后续阶段以可选钩子加入。
 */
export interface PlatformDefinition {
  /** 平台类型标识（与 config.platformEnabled 的键一致） */
  type: string
  /** 链接识别规则（全局标志由聚合层统一处理） */
  rules: RegExp[]
  /** 平台专属 API（双网关；缺省走主 API） */
  dedicated?: {
    /** 旧网关 api.bugpk.com（无需 Key） */
    legacy?: string
    /** 新网关 api-new.ifphp.com（需 Key） */
    next?: string
  }
  /** 是否默认优先专属 API（可被 config.platformDedicatedFirst 覆盖） */
  dedicatedFirst?: boolean
  /** 中文名（用于配置项描述与界面展示） */
  label?: string
  /** 解析失败时的平台特定引导提示 */
  hints?: string[]
}

/**
 * 由平台定义聚合出「平台相关配置」（平台开关 / 专属 API 优先）。
 * koishi / cli 兼容层据此动态生成配置，无需硬编码平台列表。
 */
export function platformConfigContributions(defs: PlatformDefinition[]): ConfigContribution[] {
  return [
    defineConfig({
      group: '平台开关',
      fields: [
        {
          key: 'platformEnabled', type: 'object', description: '各平台解析开关',
          fields: defs.map(d => ({ key: d.type, type: 'boolean' as const, default: true, description: d.label || d.type })),
        },
      ],
    }),
    defineConfig({
      group: 'API 与平台',
      description: '优先使用专属 API',
      fields: [
        {
          key: 'platformDedicatedFirst', type: 'object', description: '优先使用专属 API',
          fields: defs.map(d => ({ key: d.type, type: 'boolean' as const, default: d.dedicatedFirst ?? false, description: d.label || d.type })),
        },
      ],
    }),
  ]
}
