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
import { linkTypeParser } from '../src/utils/url'

let passed = 0
function check(name: string, fn: () => void): void {
  fn()
  passed++
  console.log(`  ✓ ${name}`)
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

console.log(`\n全部通过：${passed} 项`)
