/**
 * 构建期环境声明：https-proxy-agent v9 为 ESM-only 包（exports 无 require 条件），
 * node10 模块解析下 TS 无法自动定位类型。运行时由 Node ≥22 的 require(esm) 或
 * 宿主侧安装的兼容版本承载，此处仅提供最小类型面。
 */
declare module 'https-proxy-agent' {
  import type { Agent } from 'http'
  export class HttpsProxyAgent extends Agent {
    constructor(proxy: string | URL, opts?: Record<string, any>)
  }
}
