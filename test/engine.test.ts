/**
 * core 引擎纯函数测试（node:assert + tsx 直跑，不经 vitest）。
 * 运行：pnpm test
 */
import assert from 'node:assert/strict'
import { parseApiResponse } from '../src/engine/parser'
import { dedicatedApisFrom } from '../src/engine/gateway'
import { defaultsFromContributions } from '../src/config'
import { platformConfigContributions } from '../src/platform'
import { redactConfig, createConfigEnvelope, parseConfigInput, mergeConfig, MASK } from '../src/engine/config-io'
import { shouldSkipTranslate, langName } from '../src/engine/translate'
import { buildAuthHeaders, getPlatformConfig } from '../src/engine/platform-config'
import { engineConfigContributions } from '../src/engine/config'
import { linkTypeParser } from '../src/utils/url'
import { createDefaultPipeline, runStage, ensurePipeline, collectCapabilities, type WorkflowExtension, collectPlatformDefinitions, loadWorkflowExtensions, loadExtensionContributions } from '../src'

let passed = 0
function check(name: string, fn: () => void): void {
  fn()
  passed++
  console.log(`  ? ${name}`)
}
const pending: Promise<void>[] = []
function checkAsync(name: string, fn: () => Promise<void>): void {
  pending.push((async () => { await fn(); passed++; console.log(`  ? ${name}`) })())
}

/* ---------- 平台定义聚合 ---------- */
const DEFS = [
  // 注意：rules 必须带 g 标志（linkTypeParser 依赖 exec 推进 lastIndex，非全局会死循环）
  { type: 'douyin', label: '抖音', rules: [/douyin\.com/gi], dedicated: { legacy: 'https://api.bugpk.com/api/douyin', next: 'https://api-new.ifphp.com/api/douyin' }, dedicatedFirst: true },
  { type: 'weibo', label: '微博', rules: [/weibo\.com/gi] },
]

console.log('dedicatedApisFrom')
check('由定义聚合双网关专属端点', () => {
  const maps = dedicatedApisFrom(DEFS as any)
  assert.ok(maps.legacy.douyin!.includes('bugpk.com'))
  assert.ok(maps.next.douyin!.includes('api-new.ifphp.com'))
  assert.equal(maps.legacy.weibo, undefined)
})

console.log('defaultsFromContributions + platformConfigContributions')
check('平台开关/专属优先展开为逐键默认值', () => {
  const contribs = platformConfigContributions(DEFS as any)
  const defaults = defaultsFromContributions(contribs)
  assert.deepEqual(defaults.platformEnabled, { douyin: true, weibo: true })
  assert.deepEqual(defaults.platformDedicatedFirst, { douyin: true, weibo: false })
})

/* ---------- 平台配置 ---------- */
const rt: any = {
  config: { apiKey: 'sk-test', platformDedicatedFirst: { weibo: true }, globalFieldMapping: '' },
  customPlatforms: [],
  dedicatedApis: dedicatedApisFrom(DEFS as any),
}

console.log('getPlatformConfig')
check('新网关：apiKey 注入 + dedicated 端点', () => {
  const conf = getPlatformConfig(rt, 'douyin')
  assert.ok(conf.apiUrl!.includes('api-new.ifphp.com'))
  assert.equal(conf.apiKey, 'sk-test')
  assert.equal(conf.authHeaderType, 'X-API-Key')
  // 引擎层只读 config.platformDedicatedFirst（定义缺省在配置层经 defaults 物化）
  assert.equal(conf.dedicatedFirst, false)
})
check('平台级 platformDedicatedFirst 覆盖定义缺省', () => {
  assert.equal(getPlatformConfig(rt, 'weibo').dedicatedFirst, true)
})
check('自定义平台走 customPlatforms', () => {
  const rt2: any = {
    config: {}, customPlatforms: [{ name: 'mine', apiUrl: 'https://x/api', apiKey: 'k', authHeaderType: 'Bearer', customHeaderName: 'X-K', fieldMapping: undefined, proxy: null }],
    dedicatedApis: { legacy: {}, next: {} },
  }
  const conf = getPlatformConfig(rt2, 'custom_mine')
  assert.equal(conf.apiUrl, 'https://x/api')
  assert.equal(conf.dedicatedFirst, true)
})

console.log('buildAuthHeaders')
check('三种鉴权头形态', () => {
  assert.deepEqual(buildAuthHeaders('k', 'Bearer', 'X-API-Key'), { Authorization: 'Bearer k' })
  assert.deepEqual(buildAuthHeaders('k', 'X-API-Key', 'X-API-Key'), { 'X-API-Key': 'k' })
  assert.deepEqual(buildAuthHeaders('k', 'Custom', 'X-My'), { 'X-My': 'k' })
  assert.deepEqual(buildAuthHeaders('', 'Bearer', 'x'), {})
})

/* ---------- 链接识别 ---------- */
console.log('linkTypeParser')
check('命中平台并返回规范化链接', () => {
  const rules = DEFS.flatMap(d => d.rules.map(pattern => ({ pattern, type: d.type })))
  const m = linkTypeParser('看看 https://v.douyin.com/abc123/ 分享', rules)
  assert.ok(m.length > 0)
  assert.equal(m[0].type, 'douyin')
  assert.ok(m[0].url.includes('douyin.com'))
})

/* ---------- 解析器 ---------- */
const raw = {
  code: 200,
  data: {
    type: 'video',
    title: '标题[话题]',
    desc: '标题[话题]',
    author: { name: '作者', id: 42, avatar: 'https://a/x.png' },
    url: 'https://cdn/v.mp4',
    video_backup: [{ url: 'https://cdn/720.mp4', quality: '720p', bit_rate: 800 }, { url: 'https://cdn/1080.mp4', quality: '1080p', bit_rate: 2000 }],
    images: ['//imgcdn/1.jpg'],
    statistics: { digg_count: '1.2万', comment_count: 300 },
    duration: 61,
  },
}

console.log('parseApiResponse')
check('字段规范化：协议补全/计数解析/标题去重/清晰度优选', () => {
  const p = parseApiResponse(raw, 500)
  assert.ok(p.video.includes('1080'))
  assert.deepEqual(p.videos.map(v => v.quality), ['1080p', '720p'])
  assert.equal(p.images[0], 'https://imgcdn/1.jpg')
  assert.equal(p.like, 12000)
  assert.equal(p.comment, 300)
  assert.equal(p.title, '标题')
  assert.equal(p.desc, '')
  assert.equal(p.author, '作者')
  assert.equal(p.uid, '42')
})
check('fieldMapping 覆盖默认取值路径', () => {
  const p = parseApiResponse({ data: { a: { b: '自定义标题' } } }, 500, { title: 'data.a.b' })
  assert.equal(p.title, '自定义标题')
})

/* ---------- 翻译判定 ---------- */
console.log('translate helpers')
check('shouldSkipTranslate：同语系跳过', () => {
  assert.equal(shouldSkipTranslate('zh', 'zh'), true)
  assert.equal(shouldSkipTranslate('zh-CN', 'zh'), true)
  assert.equal(shouldSkipTranslate('fr', 'zh'), false)
  assert.equal(shouldSkipTranslate('zxx', 'zh'), true)
  assert.equal(shouldSkipTranslate(undefined, 'zh'), false)
})
check('langName：常见语种中文名', () => {
  assert.equal(langName('fr'), '法语')
  assert.equal(langName('zh-CN'), '中文')
  assert.equal(langName('xx'), 'xx')
})

/* ---------- 配置信封 ---------- */
console.log('config-io')
check('导出默认脱敏，导入时 MASK 跳过', () => {
  const cfg = { apiKey: 'sk', twitterAuthToken: 't', nested: { password: 'p' }, keep: 1 }
  const red = redactConfig(cfg)
  assert.equal(red.apiKey, MASK)
  assert.equal(red.twitterAuthToken, MASK)
  assert.equal(red.nested.password, MASK)
  assert.equal(red.keep, 1)
  const env = createConfigEnvelope(cfg, { pluginName: 'sns-parse' })
  assert.equal(env.redacted, true)
  const merged = mergeConfig({ apiKey: 'existing' }, parseConfigInput(JSON.stringify(env)).config)
  assert.equal(merged.apiKey, 'existing')
})
check('裸配置对象 JSON 可导入', () => {
  const r = parseConfigInput('{"timeout":123}')
  assert.equal(r.envelope, false)
  assert.equal(r.config.timeout, 123)
})

/* ---------- 引擎配置声明 ---------- */
console.log('engineConfigContributions')
check('组序与组名稳定（koishi UI 按「发送策略」后插入动态声明）', () => {
  assert.deepEqual(engineConfigContributions().map(c => c.group), [
    '消息格式', '媒体发送', '音乐语音（需 silk 和 ffmpeg）', 'GIF 转换', '性能与限制', '发送策略',
    '网络与请求', '发送与重试', '缓存与临时文件', 'API 与平台', '界面文本',
  ])
})
check('默认值表含引擎关键键', () => {
  const d = defaultsFromContributions(engineConfigContributions())
  assert.equal(d.sendStrategy, 'single')
  assert.equal(d.singleSendMaxImages, 10)
  assert.equal(d.timeout, 180000)
  assert.equal(d.videoSendTimeout, 180000)
  assert.equal(d.proxy.enabled, false)
  assert.equal(d.proxy.protocol, 'http')
  assert.equal(d.retryTimes, 3)
  assert.equal(d.enableDeduplication, true)
  assert.equal(d.cacheTTL, 600)
  assert.equal(d.maxDescLength, 200)
  assert.equal(d.maxConcurrent, 3)
  assert.equal(d.tweetTranslateLang, 'zh')
  assert.equal(d.tweetTranslateEnabled, true)
  assert.equal(d.primaryApiUrl, 'https://api.bugpk.com/api/short_videos')
  assert.ok(Array.isArray(d.customApis) && d.customApis.length === 0)
  assert.ok(typeof d.unifiedMessageFormat === 'string' && d.unifiedMessageFormat.includes('${标题}'))
  assert.ok(d.unifiedMessageFormat.includes('${正文}'))
  assert.ok(typeof d.globalFieldMapping === 'string' && d.globalFieldMapping.includes('"music_url"'))
})
check('密钥字段带 secret role（config-io 脱敏同源）', () => {
  const secrets = engineConfigContributions().flatMap(c => c.fields).filter(f => f.role === 'secret').map(f => f.key)
  assert.deepEqual(secrets.sort(), ['apiKey', 'twitterAuthToken', 'twitterCt0'])
})

/* ---------- workflow pipeline ---------- */
console.log('workflow pipeline')
checkAsync('baseline: no ext = translate null / merge null / transcode null / media passthrough', async () => {
  const rt: any = { config: {} }
  rt.pipeline = createDefaultPipeline(rt)
  assert.equal(await runStage(rt, 'translate', { text: 'x', target: 'zh' }), null)
  assert.equal(await runStage(rt, 'merge', { urls: ['a', 'b'] }), null)
  assert.equal(await runStage(rt, 'transcode', { url: 'u', durationSec: 1, opts: { maxWidth: 480, fps: 15, maxDurationSec: 15 } }), null)
  assert.deepEqual(await runStage(rt, 'media.image', { platform: 'x', url: 'https://i/1.jpg', kind: 'image' }), { kind: 'raw', url: 'https://i/1.jpg' })
  assert.deepEqual(await runStage(rt, 'media.video', { platform: 'x', videoUrl: 'https://v', coverUrl: '', meta: { requesterId: 'u' } }), { kind: 'raw', url: 'https://v' })
})
checkAsync('before/after transform IO; replace wins (last registered)', async () => {
  const rt: any = { config: {} }
  const p = createDefaultPipeline(rt)
  rt.pipeline = p
  const seen: string[] = []
  p.before('translate', (input) => { seen.push('before'); return { ...input, text: input.text + '-B' } })
  p.after('translate', (output) => { seen.push('after'); return { text: (output?.text || '') + '-A', provider: 'x' } })
  p.replace('translate', (input) => ({ text: input.text + '-R1', provider: 'r1' }))
  p.replace('translate', (input) => ({ text: input.text + '-R2', provider: 'r2' }))
  const out = await runStage(rt, 'translate', { text: 'T', target: 'zh' })
  assert.deepEqual(seen, ['before', 'after'])
  assert.equal(out.text, 'T-B-R2-A')
  assert.equal(out.provider, 'x')
})
checkAsync('ensurePipeline auto-attaches default pipeline to bare rt', async () => {
  const bare: any = { config: {} }
  const p1 = ensurePipeline(bare)
  const p2 = ensurePipeline(bare)
  assert.equal(p1, p2)
  assert.equal(await runStage(bare, 'merge', { urls: ['x'] }), null)
})
check('collectCapabilities aggregates extension capability bits', () => {
  const exts: WorkflowExtension[] = [
    { name: 'a', setup() {}, capability: () => ({ ferret: true, moderation: null }) },
    { name: 'b', setup() {}, capability: () => ({ ferret: false, moderation: 'yidun' }) },
    { name: 'c', setup() {} },
  ]
  assert.deepEqual(collectCapabilities(exts, {} as any), { ferret: true, moderation: 'yidun' })
  assert.deepEqual(collectCapabilities(undefined, {} as any), { ferret: false, moderation: null })
})

/* ---------- registry: 声明并集/粒度覆盖 ---------- */
console.log('registry discovery')
check('platform defs = aggregate union granular (granular overrides)', () => {
  const fakeReq = ((id: string) => {
    if (id === '@sns-parse/platforms') return { definitions: [{ type: 'weibo', rules: [/weibo/gi] }, { type: 'bilibili', rules: [/bili/gi] }] }
    if (id === '@sns-parse/platform-bilibili') return { bilibili: { type: 'bilibili', label: 'granular', rules: [/bili2/gi] } }
    throw new Error('nf: ' + id)
  }) as any
  const defs = collectPlatformDefinitions(fakeReq)
  assert.equal(defs.length, 2)
  assert.equal(defs.find(d => d.type === 'bilibili')!.label, 'granular')
  assert.equal(defs.find(d => d.type === 'weibo')!.type, 'weibo')
})
check('missing packages silently absent (scope = loaded union)', () => {
  const none = ((id: string) => { throw new Error('nf: ' + id) }) as any
  assert.deepEqual(collectPlatformDefinitions(none), [])
  assert.deepEqual(loadWorkflowExtensions(none), [])
  assert.deepEqual(loadExtensionContributions(none), [])
})
check('ext discovery yields WorkflowExtension with setup hook', () => {
  const fakeReq = ((id: string) => {
    if (id === '@sns-parse/ext-merge') return {
      mergeExtension: () => ({
        name: 'ext-merge',
        setup(hooks: any) { hooks.replace('merge', async () => ({ buffer: Buffer.alloc(1) })) },
      }),
    }
    if (id === '@sns-parse/ext-nsfw') return {
      nsfwExtension: () => ({ name: 'ext-nsfw', setup(hooks: any) { hooks.replace('media.image', async (i: any) => ({ kind: 'raw', url: i.url })) } }),
      nsfwConfigContribution: { group: 'nsfw', fields: [] },
    }
    throw new Error('nf: ' + id)
  }) as any
  const exts = loadWorkflowExtensions(fakeReq)
  assert.equal(exts.length, 2)
  assert.equal(exts[0].name, 'ext-nsfw')
  assert.ok(exts[0].configContribution)
  assert.equal(loadExtensionContributions(fakeReq).length, 1)
  // 钩子注入生效：merge 被替换
  const rt: any = { config: {} }
  rt.pipeline = createDefaultPipeline(rt)
  for (const e of exts) e.setup(rt.pipeline)
  return runStage(rt, 'merge', { urls: ['a', 'b'] }).then((m: any) => assert.ok(m.buffer))
})

void Promise.all(pending).then(() => {
  console.log(`\n全部通过：${passed} 项`)
}).catch((e) => {
  console.error(e)
  process.exit(1)
})

