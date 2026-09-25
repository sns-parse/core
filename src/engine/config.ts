/**
 * 引擎层配置声明（中立 DSL）：fetcher/parser/compose/sender/gateway 等引擎
 * 自身读取的配置项，由 core 统一声明；koishi / CLI 兼容层据此生成 Schema 与默认值。
 *
 * 组序即 UI 展示序（koishi 兼容层在「发送策略」后插入扩展与平台的动态声明）。
 */
import { defineConfig, type ConfigContribution } from '../config'

const PROXY_FIELDS = [
  { key: 'enabled', type: 'boolean' as const, default: false, description: '启用代理' },
  {
    key: 'protocol', type: 'union' as const, default: 'http', description: '协议',
    values: [
      { value: 'http', description: 'HTTP' },
      { value: 'https', description: 'HTTPS' },
    ],
  },
  { key: 'host', type: 'string' as const, default: '127.0.0.1', description: '地址' },
  { key: 'port', type: 'number' as const, default: 7890, description: '端口' },
  {
    key: 'auth', type: 'object' as const, description: '认证',
    fields: [
      { key: 'username', type: 'string' as const, default: '', description: '用户名' },
      { key: 'password', type: 'string' as const, default: '', description: '密码' },
    ],
  },
]

const AUTH_HEADER_FIELDS = [
  {
    key: 'authHeaderType', type: 'union' as const, default: 'Bearer', description: '认证头类型',
    values: [
      { value: 'Bearer', description: 'Bearer' },
      { value: 'X-API-Key', description: 'X-API-Key' },
      { value: 'Custom', description: '自定义' },
    ],
  },
  { key: 'customHeaderName', type: 'string' as const, default: 'X-API-Key', description: '自定义头名称' },
]

const FIELD_MAPPING_FIELD = {
  key: 'fieldMapping', type: 'string' as const, role: 'textarea' as const,
  default: '{}', description: '字段映射 JSON',
}

const API_PLATFORM_VALUES = [
  { value: 'bilibili', description: '哔哩哔哩' },
  { value: 'douyin', description: '抖音' },
  { value: 'kuaishou', description: '快手' },
  { value: 'xiaohongshu', description: '小红书' },
  { value: 'weibo', description: '微博' },
  { value: 'xigua', description: '西瓜视频' },
  { value: 'youtube', description: 'YouTube' },
  { value: 'tiktok', description: 'TikTok' },
  { value: 'acfun', description: 'AcFun（A站）' },
  { value: 'zhihu', description: '知乎' },
  { value: 'weishi', description: '微视' },
  { value: 'huya', description: '虎牙' },
  { value: 'haokan', description: '好看视频' },
  { value: 'meipai', description: '美拍' },
  { value: 'twitter', description: 'Twitter/X' },
  { value: 'instagram', description: 'Instagram' },
  { value: 'doubao', description: '豆包' },
  { value: 'doubao_image', description: '豆包图片' },
  { value: 'jimeng', description: '即梦' },
  { value: 'oasis', description: '绿洲' },
  { value: 'wechat_channel', description: '视频号' },
  { value: 'lishi', description: '梨视频' },
  { value: 'quanmin', description: '全民直播' },
  { value: 'pipigx', description: '皮皮搞笑' },
  { value: 'pipixia', description: '皮皮虾' },
  { value: 'zuiyou', description: '最右' },
  { value: 'toutiao', description: '今日头条' },
]

const GLOBAL_FIELD_MAPPING_DEFAULT = [
  '{',
  '  "title": "data.title",',
  '  "desc": "data.description",',
  '  "author": "data.author.name",',
  '  "uid": "data.author.id",',
  '  "avatar": "data.author.avatar",',
  '  "cover": "data.cover_url",',
  '  "video": "data.video_url",',
  '  "video_backup": "data.video_qualities",',
  '  "videos": "data.videos",',
  '  "type": "data.type",',
  '  "like": "data.statistics.likes",',
  '  "comment": "data.statistics.comments",',
  '  "collect": "data.statistics.favorites",',
  '  "share": "data.statistics.shares",',
  '  "play": "data.statistics.plays",',
  '  "duration": "data.duration",',
  '  "publishTime": "data.create_time",',
  '  "music_title": "data.music.title",',
  '  "music_author": "data.music.author",',
  '  "music_cover": "data.music.cover",',
  '  "music_url": "data.music.url"',
  '}',
].join('\n')

/** 引擎层配置声明（有序；组名即 UI 分组标题） */
export function engineConfigContributions(): ConfigContribution[] {
  return [
    defineConfig({
      group: '消息格式',
      fields: [
        {
          key: 'unifiedMessageFormat', type: 'string', role: 'textarea',
          default: '标题：${标题}\n作者：${作者}\n简介：${简介}\n正文：${正文}\n翻译（${翻译提供方}，${原文语言}）：${翻译}\n音乐标题：${音乐标题}\n音乐作者：${音乐作者}\n点赞：${点赞数}\n收藏：${收藏数}\n转发：${转发数}\n播放：${播放数}\n评论：${评论数}\n图片数量：${图片数量}',
          description: '消息文字模板，可用变量：${标题} ${作者} ${简介} ${正文}（纯文字作品正文，启用后该类作品不再显示为简介） ${翻译} ${翻译提供方} ${原文语言} ${视频时长} ${点赞数} ${收藏数} ${转发数} ${播放数} ${评论数} ${发布时间} ${图片数量} ${作者ID} ${音乐标题} ${音乐作者}（空行自动隐藏）',
        },
      ],
    }),

    defineConfig({
      group: '媒体发送',
      fields: [
        { key: 'showImageText', type: 'boolean', default: true, description: '发送文字内容' },
        { key: 'showCoverImage', type: 'boolean', default: true, description: '发送封面图片' },
        { key: 'showCoverFile', type: 'boolean', default: true, description: '封面以图片形式发送（关闭则只发链接）' },
        { key: 'showCoverText', type: 'boolean', default: true, description: '封面图前显示文字提示' },
        { key: 'coverText', type: 'string', default: '封面：', description: '封面提示文字' },
        { key: 'showImageFileNew', type: 'boolean', default: true, description: '图片以图片形式发送（关闭则只发链接）' },
        { key: 'showAuthorAvatar', type: 'boolean', default: true, description: '发送作者头像' },
        { key: 'showAuthorAvatarFile', type: 'boolean', default: true, description: '头像以图片形式发送（关闭则只发链接）' },
        { key: 'showAuthorAvatarText', type: 'boolean', default: true, description: '头像前显示文字提示' },
        { key: 'authorAvatarText', type: 'string', default: '作者头像：', description: '头像提示文字' },
        { key: 'showMusicCover', type: 'boolean', default: true, description: '发送音乐封面' },
        { key: 'showVideoFile', type: 'boolean', default: true, description: '视频以视频形式发送（关闭则只发链接）' },
        { key: 'sendLiveMessage', type: 'boolean', default: true, description: '直播作品发文字消息（不发视频）' },
        { key: 'mergeSameOriginImages', type: 'boolean', default: true, description: '同源切图内容识别合并（纯像素内容裁决，不依赖链接/文件名/色调风格）：网格/竖堆/横拼三种布局各自经接缝连续性验证（低频趋势延续+纹理能量可验证性），取证据最强者合并；均不过回退逐张；需 ffmpeg' },
      ],
    }),

    defineConfig({
      group: '音乐语音（需 silk 和 ffmpeg）',
      fields: [
        { key: 'showMusicVoice', type: 'boolean', default: false, description: '音乐链接以语音形式发送' },
        { key: 'showMusicVoiceFile', type: 'boolean', default: true, description: '音乐是否以语音形式发送（关闭则只发送链接）' },
      ],
    }),

    defineConfig({
      group: 'GIF 转换',
      fields: [
        { key: 'gifConvertEnabled', type: 'boolean', default: true, description: '推文动图转 GIF 发送（ffmpeg 随插件自动安装，失败回退原视频）' },
        { key: 'gifMaxWidth', type: 'number', min: 120, max: 1080, step: 1, default: 480, description: 'GIF 宽度 (px)' },
        { key: 'gifFps', type: 'number', min: 5, max: 30, step: 1, default: 15, description: 'GIF 帧率' },
        { key: 'gifMaxDurationSec', type: 'number', min: 1, max: 60, step: 1, default: 15, description: 'GIF 时长上限 (s)' },
      ],
    }),

    defineConfig({
      group: '性能与限制',
      fields: [
        { key: 'maxDescLength', type: 'number', min: 0, step: 1, default: 200, description: '简介长度上限' },
        { key: 'maxConcurrent', type: 'number', min: 1, step: 1, default: 3, description: '解析最大并发数' },
      ],
    }),

    defineConfig({
      group: '发送策略',
      fields: [
        {
          key: 'sendStrategy', type: 'union', default: 'single', description: '发送策略',
          values: [
            { value: 'single', description: '单条整合（默认；图片过多/含视频自动回退合并转发）' },
            { value: 'split', description: '逐条分开发送（旧版行为）' },
          ],
        },
        { key: 'singleSendMaxImages', type: 'number', min: 1, default: 10, description: '单条消息最大图片数（超出回退合并转发）' },
      ],
    }),

    defineConfig({
      group: '网络与请求',
      fields: [
        { key: 'timeout', type: 'number', min: 0, step: 1, default: 180000, description: 'API 请求超时 (ms)' },
        { key: 'videoSendTimeout', type: 'number', min: 0, step: 1, default: 180000, description: '消息发送超时 (ms)' },
        { key: 'userAgent', type: 'string', default: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36', description: 'User-Agent' },
        { key: 'proxy', type: 'object', description: 'HTTP/HTTPS 代理', fields: PROXY_FIELDS },
        {
          key: 'customHeaders', type: 'array', default: [], description: '自定义请求头',
          itemFields: [
            { key: 'name', type: 'string', required: true, description: '头名称' },
            { key: 'value', type: 'string', required: true, description: '头值' },
          ],
        },
      ],
    }),

    defineConfig({
      group: '发送与重试',
      fields: [
        { key: 'ignoreSendError', type: 'boolean', default: true, description: '忽略发送失败' },
        { key: 'retryTimes', type: 'number', min: 0, default: 3, description: '重试次数' },
        { key: 'retryInterval', type: 'number', min: 0, default: 1000, description: '重试间隔 (ms)' },
        { key: 'enableForward', type: 'boolean', default: false, description: '合并转发（OneBot/Satori）' },
      ],
    }),

    defineConfig({
      group: '缓存与临时文件',
      fields: [
        { key: 'deduplicationInterval', type: 'number', min: 0, default: 180, description: '去重间隔 (s)' },
        { key: 'enableDeduplication', type: 'boolean', default: true, description: '启用重复解析检测与提示' },
        { key: 'cacheTTL', type: 'number', min: 0, default: 600, description: '缓存时间 (s)' },
      ],
    }),

    defineConfig({
      group: 'API 与平台',
      fields: [
        { key: 'primaryApiUrl', type: 'string', default: 'https://api.bugpk.com/api/short_videos', hidden: true },
        { key: 'backupApiUrl', type: 'string', default: 'https://api.bugpk.com/api/svparse', hidden: true },
        {
          key: 'customApis', type: 'array', default: [], description: '覆盖内置平台 API',
          itemFields: [
            { key: 'platform', type: 'union', required: true, description: '平台', values: API_PLATFORM_VALUES },
            { key: 'apiUrl', type: 'string', description: 'API 地址' },
            { key: 'apiKey', type: 'string', default: '', description: 'API Key' },
            ...AUTH_HEADER_FIELDS.map(f => ({ ...f })),
            FIELD_MAPPING_FIELD,
          ],
        },
        {
          key: 'customPlatforms', type: 'array', default: [], description: '自定义新平台',
          itemFields: [
            { key: 'name', type: 'string', required: true, description: '平台名称' },
            { key: 'exampleUrl', type: 'string', description: '示例链接' },
            { key: 'keywords', type: 'string', required: true, description: '关键词（逗号分隔）' },
            { key: 'apiUrl', type: 'string', required: true, description: '解析 API' },
            { key: 'apiKey', type: 'string', default: '', description: 'API Key' },
            ...AUTH_HEADER_FIELDS.map(f => ({ ...f })),
            FIELD_MAPPING_FIELD,
            { key: 'proxy', type: 'object', description: '独立代理（覆盖全局代理）', fields: PROXY_FIELDS },
          ],
        },
        {
          key: 'globalFieldMapping', type: 'string', role: 'textarea',
          default: GLOBAL_FIELD_MAPPING_DEFAULT, description: '全局字段映射 JSON',
        },
        { key: 'twitterAuthToken', type: 'string', default: '', role: 'secret', description: 'X 登录态 auth_token（解析需登录推文用，受 Cloudflare 指纹限制可能 403）' },
        { key: 'twitterCt0', type: 'string', default: '', role: 'secret', description: 'X 登录态 ct0（与 auth_token 配对）' },
        { key: 'tweetTranslateEnabled', type: 'boolean', default: true, description: '外语推文自动翻译（配置 X 登录态时用网页同源 Grok 翻译，否则通用翻译；附译文行）' },
        {
          key: 'tweetTranslateLang', type: 'union', default: 'zh', description: '翻译目标语言',
          values: [
            { value: 'zh', description: '简体中文' },
            { value: 'zh-TW', description: '繁體中文' },
            { value: 'en', description: 'English' },
            { value: 'ja', description: '日本語' },
            { value: 'ko', description: '한국어' },
            { value: 'fr', description: 'Français' },
            { value: 'de', description: 'Deutsch' },
            { value: 'ru', description: 'Русский' },
            { value: 'es', description: 'Español' },
            { value: 'pt', description: 'Português' },
          ],
        },
        { key: 'apiKey', type: 'string', default: '', role: 'secret', description: '新网关 API Key（https://api-new.ifphp.com/auth/login 注册获取；留空用旧网关）' },
      ],
    }),

    defineConfig({
      group: '界面文本',
      fields: [
        { key: 'waitingTipText', type: 'string', default: '正在解析视频，请稍候...', description: '等待提示' },
        { key: 'unsupportedPlatformText', type: 'string', default: '不支持该平台链接', description: '不支持提示' },
        { key: 'invalidLinkText', type: 'string', default: '无效的视频链接', description: '无效链接提示' },
        { key: 'parseErrorPrefix', type: 'string', default: '❌ 解析失败：', description: '错误前缀' },
        { key: 'parseErrorItemFormat', type: 'string', default: '【${url}】: ${msg}', description: '错误格式' },
        { key: 'deduplicationTipText', type: 'string', default: '链接 ${url} 在最近 ${interval} 秒内已解析过，已跳过。', description: '重复解析提示，支持变量 ${url} ${interval}' },
      ],
    }),

    defineConfig({
      group: '通用链接解析（预留）',
      fields: [
        { key: 'genericParseEnabled', type: 'boolean', default: false, description: '对未命中平台声明的链接启用通用解析（预留：暂无实现，开启不生效）' },
        { key: 'genericLlmBaseUrl', type: 'string', default: '', description: 'LLM 接口 Base URL（OpenAI 兼容格式；预留字段，暂不消费）' },
        { key: 'genericLlmModel', type: 'string', default: '', description: 'LLM 模型名（预留字段，暂不消费）' },
        { key: 'genericLlmApiKey', type: 'string', default: '', role: 'secret', description: 'LLM API Key（预留字段，暂不消费）' },
      ],
    }),
  ]
}
