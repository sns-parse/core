/**
 * 双网关配置（上游 issue #12）：
 * - 旧网关 api.bugpk.com：无需 API Key，v1.5.8 及之前的行为
 * - 新网关 api-new.ifphp.com：需 API Key（X-API-Key 头），上游唯一维护入口
 * 选择规则：配置了 apiKey → 新网关；否则 → 旧网关
 *
 * 平台专属端点内联在各 PlatformDefinition（dedicated 字段），此处提供
 * 由定义列表聚合出的映射函数（runtime 构建时计算一次挂在 rt 上）。
 */
import type { PlatformDefinition } from '../platform'

export const NEW_GATEWAY_PRIMARY = 'https://api-new.ifphp.com/api/svparse'
export const LEGACY_GATEWAY_PRIMARY = 'https://api.bugpk.com/api/short_videos'
export const LEGACY_GATEWAY_BACKUP = 'https://api.bugpk.com/api/svparse'

export interface DedicatedApiMaps {
  /** 旧网关平台专属端点（无需 Key） */
  legacy: Record<string, string>
  /** 新网关平台专属端点（需 Key；未覆盖的平台走主 API 兜底） */
  next: Record<string, string>
}

/** 由平台定义列表聚合专属端点映射 */
export function dedicatedApisFrom(defs: PlatformDefinition[]): DedicatedApiMaps {
  const legacy: Record<string, string> = {}
  const next: Record<string, string> = {}
  for (const p of defs) {
    if (p.dedicated?.legacy) legacy[p.type] = p.dedicated.legacy
    if (p.dedicated?.next) next[p.type] = p.dedicated.next
  }
  return { legacy, next }
}
