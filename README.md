# @sns-parse/core

sns-parse 分层架构的**核心契约包**：所有层共享的类型与抽象，不依赖 Koishi / CLI 任一 SDK。

## 内容

| 模块 | 说明 |
|------|------|
| `types` | `ParsedData`、`LinkMatch`、`CustomPlatformConfig` 等数据模型 |
| `logger` | 可注入的 `LoggerLike`（默认静默；宿主注入 Koishi Logger / console） |
| `sender` | 发送层无关 IR `OutboundElement` + `OutboundSender` 契约 |
| `extensions` | `VideoParserExtensions` 扩展契约（NSFW/合并/翻译/GIF） |
| `platform` | `PlatformDefinition` 平台定义契约 |
| `host` | `VideoParserHost` 宿主抽象、`ParserRuntimeLike`、`createHost()` |

## 安装

```bash
npm i @sns-parse/core
```

## 用法

```ts
import { createHost, el, type OutboundSender, type PlatformDefinition } from '@sns-parse/core'
```

## 许可

MIT
