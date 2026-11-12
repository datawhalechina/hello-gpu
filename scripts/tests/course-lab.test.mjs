import assert from 'node:assert/strict'
import test from 'node:test'
import { deflateRawSync } from 'node:zlib'
import fixtures from '../../docs/course/lab-rules.fixtures.json' with { type: 'json' }
import outline from '../../docs/course/outline.json' with { type: 'json' }
import {
  CARD_PREFIX, CREDENTIAL_PREFIX, LabCodeError, checkStageStars, codeFromHash, decodeCode, decodeCredential, encodeCode,
  evaluateStars, explainLabError, hideCredentialCodes, judgeStars, labTarget, metricLabel, metricUnit, notebookPath,
} from '../../docs/course/lab.ts'
import { CLOUD_PLATFORMS, platformLink, stepParts } from '../../docs/course/labPlatforms.ts'
import { exerciseById } from '../../docs/course/outline.ts'
import { memoryStorage } from '../../docs/course/storage.ts'
import { missingErrorParts } from '../../docs/course/useChallenge.ts'

/**
 * 实验室的网页端（L-02）：通关码的解码和校验、星级规则求值、导入以后发星发徽章。
 * 解码和求值跑 Python（hello_gpu.codes / hello_gpu.stars）同一份共享样例 docs/course/lab-rules.fixtures.json，
 * 报错的分类和 notebooks/common/tests/test_lab_codes.py 一一对应。
 */

/** 07 第 9 节的示例规则，第 3 颗标了「打败 torch」。 */
const RULES = [
  { text: '多种形状都通过校验', rule: { checksAll: true } },
  { text: '达到你这张卡实测峰值带宽的 60%', rule: { ratio: ['gbps', 'peak_gbps'], gte: 0.6 } },
  { text: '比同一张卡上的 torch 快', rule: { ratio: ['torch_ms', 'median_ms'], gte: 1.0 }, badge: 'beat-torch' },
]
const FAST = { median_ms: 0.123, gbps: 366, peak_gbps: 610, torch_ms: 0.15 }

/** 一份合格的凭证（伪造数据，同 test_lab_codes.py 的 credential()），changes 覆盖顶层字段。 */
function credential(changes = {}) {
  return {
    v: 1, stage: 'forge-softmax', route: 'hip', at: '2026-11-08T10:00:00Z',
    device: { name: 'Fixture GPU', gfx: 'gfx9999', cus: 10 },
    env: { rocm: null, torch: '0.0.0+fixture', triton: null },
    checks: { passed: 5, total: 5 },
    metrics: { median_ms: 0.123, torch_ms: 0.15 },
    ...changes,
  }
}

/** 不经过检查直接打包（Node 的 zlib，和被测的 CompressionStream 是两套实现）：模拟别处生成或者被改过的码。 */
function pack(prefix, text) {
  return prefix + deflateRawSync(Buffer.from(text, 'utf8')).toString('base64url')
}

/** 解码出错时返回错误的分类；没出错返回 null。 */
async function kindOf(promise) {
  try {
    await promise
  } catch (error) {
    assert.ok(error instanceof LabCodeError, `应该抛 LabCodeError，实际是 ${error}`)
    return error.kind
  }
  return null
}

/** 共享样例里这一关的通关码。 */
const FIXTURE_CODE = (stage) => fixtures.codes.find((s) => s.payload.stage === stage).code
/** 共享样例里的 GPU 卡片导入码（HGCARD1.）。 */
const CARD_CODE = fixtures.codes.find((s) => !('stage' in s.payload)).code
const LAB_ITEMS = new Map([...outline.stages, ...outline.exercises.flatMap((g) => g.items)].filter((s) => s.lab).map((s) => [s.id, s.lab]))

// ── 共享样例（和 Python 的结果必须一致）─────────────────────────────────────

test('共享样例：星级求值和 hello_gpu.stars 的结果一致，凭证里缺数、数不合格只算没拿到', () => {
  for (const c of fixtures.cases) {
    const rules = 'stage' in c ? LAB_ITEMS.get(c.stage)?.stars : c.stars
    assert.ok(rules, `outline.json 里的 ${c.stage} 没有 lab.stars`)
    assert.deepEqual(evaluateStars(rules, c.credential), c.earned, c.name)
  }
})

test('共享样例：写错的规则两边都报错', () => {
  const ok = { checks: { passed: 1, total: 1 }, metrics: { median_ms: 1 } }
  for (const c of fixtures.invalid) assert.throws(() => evaluateStars(c.stars, ok), Error, c.name)
})

test('共享样例：Python 和 Node 编的码，网页都能解开、内容一样；网页编的码也能解回来', async () => {
  for (const sample of fixtures.codes) {
    const { prefix, payload } = await decodeCode(sample.code)
    assert.equal(prefix, 'stage' in sample.payload ? CREDENTIAL_PREFIX : CARD_PREFIX, sample.name)
    assert.deepEqual(payload, sample.payload, sample.name)
    // 压缩出来的字节可以和别的实现不同，解回来的内容必须相同
    assert.deepEqual(await decodeCode(await encodeCode(prefix, payload)), { prefix, payload }, sample.name)
    if (prefix === CREDENTIAL_PREFIX) assert.deepEqual(await decodeCredential(sample.code, payload.stage), payload, sample.name)
  }
})

test('大纲里写了 lab 的关卡和副本：都要真卡，规则满足网页的要求，共享样例里有这一关', () => {
  const covered = new Set(fixtures.cases.filter((c) => 'stage' in c).map((c) => c.stage))
  for (const [id, lab] of LAB_ITEMS) {
    assert.ok(labTarget(id), `${id} 写了 lab，但它不是真卡关卡（gpu: true）或真卡副本（env: gpu）`)
    assert.doesNotThrow(() => checkStageStars(lab?.stars), `${id} 的 lab.stars`)
    assert.ok(covered.has(id), `${id} 写了 lab.stars，lab-rules.fixtures.json 里还没有这一关的样例`)
  }
})

// ── 解码和校验 ────────────────────────────────────────────────────────────

test('解码：码是 URL 安全的，复制时混进来的空白和换行不算', async () => {
  const code = await encodeCode(CREDENTIAL_PREFIX, credential())
  assert.match(code, /^HGPU1\.[A-Za-z0-9_-]+$/)
  const pasted = `  ${code.slice(0, 30)}\n${code.slice(30)}\n`
  assert.deepEqual(await decodeCredential(pasted, 'forge-softmax'), credential())
})

test('校验：版本不对、不是本关的、数据异常，各自报一类（同 test_lab_codes.py）', async () => {
  const bad = [
    [{ v: 2 }, 'version'],
    [{ v: true }, 'version'],
    [{ v: '1' }, 'version'],
    [{ stage: 'forge-norm' }, 'stage'],
    [{ stage: 'Forge Softmax' }, 'data'],
    [{ route: 'cuda' }, 'data'],
    [{ at: '2026-11-08 10:00:00' }, 'data'],
    [{ at: '2026-13-08T10:00:00Z' }, 'data'],
    [{ at: '2026-02-29T10:00:00Z' }, 'data'],
    [{ device: { name: 'Fixture GPU', gfx: '9999', cus: 10 } }, 'data'],
    [{ device: { name: 'Fixture GPU', gfx: 'gfx9999', cus: 0 } }, 'data'],
    [{ env: { rocm: 10 } }, 'data'],
    [{ checks: { passed: 6, total: 5 } }, 'data'],
    [{ checks: { passed: 0, total: 0 } }, 'data'],
    [{ checks: { passed: 1.5, total: 2 } }, 'data'],
    [{ metrics: { median_ms: 0 } }, 'data'],
    [{ metrics: { median_ms: -0.1 } }, 'data'],
    [{ metrics: { median_ms: '0.1' } }, 'data'],
    [{ metrics: { median_ms: true } }, 'data'],
    [{ metrics: { median_ms: null } }, 'data'],
    [{ metrics: { Median: 0.1 } }, 'data'],
    [{ metrics: [0.1] }, 'data'],
  ]
  for (const [changes, kind] of bad) {
    const code = pack(CREDENTIAL_PREFIX, JSON.stringify(credential(changes)))
    assert.equal(await kindOf(decodeCredential(code, 'forge-softmax')), kind, JSON.stringify(changes))
  }
  // 闰年的 2 月 29 日是合法的时间
  const leap = pack(CREDENTIAL_PREFIX, JSON.stringify(credential({ at: '2028-02-29T23:59:59Z' })))
  assert.equal(await kindOf(decodeCredential(leap, 'forge-softmax')), null)
  // 不是本关的：错误里带着凭证写的是哪一关
  const other = await decodeCredential(FIXTURE_CODE('forge-roofline'), 'forge-softmax').catch((error) => error)
  assert.equal(other.kind, 'stage')
  assert.equal(other.found, 'forge-roofline')
})

test('码坏了、不是通关码：按类报错，贴成 GPU 卡片导入码单独说明', async () => {
  const good = await encodeCode(CREDENTIAL_PREFIX, credential())
  const json = JSON.stringify(credential())
  const cases = [
    ['HGX1.abc', 'format'],
    ['hello', 'format'],
    [CREDENTIAL_PREFIX, 'format'],
    [`HGPU2.${good.slice(CREDENTIAL_PREFIX.length)}`, 'version'],
    [good.slice(0, -12), 'format'],
    [`${good.slice(0, 20)}+${good.slice(21)}`, 'format'],
    [pack(CREDENTIAL_PREFIX, '[1, 2]'), 'format'],
    [pack(CREDENTIAL_PREFIX, json.replace('0.123', 'NaN')), 'format'],
    [pack(CREDENTIAL_PREFIX, `\ufeff${json}`), 'format'],
    [pack(CREDENTIAL_PREFIX, json.replace('0.123', '1e999')), 'data'],
    [pack(CREDENTIAL_PREFIX, JSON.stringify(credential({ note: 'x'.repeat(70_000) }))), 'format'],
    [pack(CREDENTIAL_PREFIX, JSON.stringify({ v: 1, at: '2026-11-08T10:00:00Z', device: credential().device })), 'data'],
    [CARD_CODE, 'card'],
  ]
  for (const [code, kind] of cases) assert.equal(await kindOf(decodeCredential(code, 'forge-softmax')), kind, code.slice(0, 40))
})

test('凭证里自带的结论不看：多出来的字段解得开，星级只按本关规则算', async () => {
  const claimed = credential({
    metrics: { median_ms: 0.2, gbps: 365.9, peak_gbps: 610, torch_ms: 0.15 },
    stars: [true, true, true], earned: [true, true, true], passed: true,
  })
  const decoded = await decodeCredential(await encodeCode(CREDENTIAL_PREFIX, claimed), 'forge-softmax')
  assert.deepEqual(evaluateStars(RULES, decoded), [true, false, false])
})

test('本关的规则还要满足网页的要求：1 到 3 颗星，★1 是 checksAll，badge 只能写 beat-torch', () => {
  assert.doesNotThrow(() => checkStageStars(RULES))
  assert.doesNotThrow(() => checkStageStars(RULES.slice(0, 1)))
  const bad = [
    ['一颗星都没有', []],
    ['四颗星', [...RULES, RULES[1]]],
    ['★1 不是多种形状都通过校验', [RULES[1], RULES[0]]],
    ['不认识的徽章', [RULES[0], { ...RULES[1], badge: 'speed-demon' }]],
    ['规则写错', [RULES[0], { text: '带宽', rule: { ratio: ['gbps'], gte: 0.6 } }]],
  ]
  for (const [name, stars] of bad) assert.throws(() => checkStageStars(stars), Error, name)
})

test('判定理由：写出来的比值和判定对得上（4.18 ÷ 1.9 略小于 2.2，不能写成 2.2）', () => {
  const credentialWith = (metrics) => ({ checks: { passed: 1, total: 1 }, metrics })
  const rule = [{ text: '快 2.2 倍', rule: { ratio: ['naive_ms', 'median_ms'], gte: 2.2 } }]
  const shown = (v) => Number(/=\s*([0-9.]+)/.exec(v.detail)?.[1])
  const [near] = judgeStars(rule, credentialWith({ median_ms: 1.9, naive_ms: 4.18 }))
  assert.equal(near.earned, false)
  assert.ok(shown(near) < 2.2, near.detail)
  const [exact] = judgeStars(rule, credentialWith({ median_ms: 1, naive_ms: 2.2 }))
  assert.equal(exact.earned, true)
  assert.ok(shown(exact) >= 2.2, exact.detail)
})

test('测量项的名字和单位：hg.roofline 按点名写的几项按后缀认（_roof_tflops 不能当成 _tflops），拐点和算术强度是 FLOP/字节', () => {
  const shown = (name) => `${metricLabel(name)}（${metricUnit(name)}）`
  assert.equal(shown('add_gbps'), 'add 的有效带宽（GB/s）')
  assert.equal(shown('mm_tflops'), 'mm 的算力（TFLOPS）')
  assert.equal(shown('mm_roof_tflops'), 'mm 的屋顶（TFLOPS）')
  assert.equal(shown('mm_intensity'), 'mm 的算术强度（FLOP/字节）')
  assert.equal(shown('ridge'), '这张卡的拐点（FLOP/字节）')
  assert.equal(shown('add_ms'), 'add 的耗时中位数（ms）')
  // 写明了名字的照旧：冷缓存的带宽、这张卡的峰值不按后缀改写
  assert.equal(metricLabel('cold_gbps'), '冷缓存的有效带宽')
  assert.equal(metricLabel('peak_tflops'), '这张卡的峰值算力（实测）')
  assert.equal(metricLabel('_ms'), '_ms', '只有后缀、没有点名的不改写')
})

test('测量项的名字和单位：hg.trace 按行名写的三项按后缀认（_gpu_ms、_span_ms 不能当成耗时中位数），kernel 数论个', () => {
  const shown = (name) => `${metricLabel(name)}（${metricUnit(name)}）`
  assert.equal(shown('steps_gpu_ms'), 'steps 在 GPU 上忙的时间（ms）')
  assert.equal(shown('mine_small_span_ms'), 'mine_small 从开始到算完（ms）')
  assert.equal(shown('steps_kernels'), 'steps 的 kernel 数（个）')
  assert.equal(shown('naive_ms'), 'naive 的耗时中位数（ms）', '别的 _ms 照旧')
})

test('地址片段：#lab= 后面就是通关码（转义过的也行）；别的片段不管', () => {
  assert.equal(codeFromHash('#lab=HGPU1.abc_-'), 'HGPU1.abc_-')
  assert.equal(codeFromHash(`#lab=${encodeURIComponent('HGPU1.ab cd')}`), 'HGPU1.ab cd')
  assert.equal(codeFromHash('#挑战'), null)
  assert.equal(codeFromHash(''), null)
})

test('观摩回放里的通关码只留前缀（链接里的也是），码后面的字和 GPU 卡片导入码照原样', async () => {
  const code = await encodeCode(CREDENTIAL_PREFIX, credential())
  const card = CARD_CODE
  const text = `通关链接：\nhttps://example.org/forge/softmax/#lab=${code}\n通关码：${code}。\n卡片：${card}`
  assert.equal(hideCredentialCodes(text), `通关链接：\nhttps://example.org/forge/softmax/#lab=HGPU1.…\n通关码：HGPU1.…。\n卡片：${card}`)
})

test('在云平台上打开（L-06）：AUP 的链接是 /hub/git/ 加去掉 https:// 的仓库地址；说明里换好 Notebook 路径，反引号里的是代码', () => {
  const aup = CLOUD_PLATFORMS.find((p) => p.id === 'aup-learning-cloud')
  assert.equal(platformLink(aup.open), 'https://tpe.aupcloud.io/hub/git/github.com/datawhalechina/hello-gpu')

  const path = notebookPath(labTarget('forge-your-gpu'), 'shared')
  assert.deepEqual(stepParts('打开 `hello-gpu/{path}`，从上往下运行。', path), [
    { text: '打开 ', code: false },
    { text: `hello-gpu/${path}`, code: true },
    { text: '，从上往下运行。', code: false },
  ])
  // 路径照原样放进去：$& 这类字符不能被当成替换模式。
  assert.deepEqual(stepParts('`{path}`', 'notebooks/a$&b.ipynb'), [{ text: 'notebooks/a$&b.ipynb', code: true }])
})

test('导入失败的说明：每一类都写全「现象 + 原因 + 怎么改」（03 第 4 节）', () => {
  for (const kind of ['format', 'version', 'stage', 'data', 'card', 'browser']) {
    const text = explainLabError(new LabCodeError(kind, '说明', 'forge-roofline'), 'forge-softmax')
    assert.deepEqual(missingErrorParts(text), [], kind)
  }
})

// ── 导入以后（useLab：挑战状态发星，进度存档发经验值和徽章）─────────────────

/** useLab、挑战状态和进度存档都是模块级的单例：每个用例先 unload()，从一份空存档开始。 */
async function freshLab(stage = 'forge-softmax', stars = RULES) {
  const store = await import('../../docs/course/useProgress.ts')
  const { useLab } = await import('../../docs/course/useLab.ts')
  store.unload()
  return { progress: store.useProgress(), lab: useLab({ stage, stars: () => stars }) }
}

const codeOf = (changes) => encodeCode(CREDENTIAL_PREFIX, credential(changes))

test('导入：每颗星 50 经验值只发一次；第一次导入发「真机验证」，拿到标 beat-torch 的星发「打败 torch」', async () => {
  const { progress, lab } = await freshLab()
  const three = await codeOf({ metrics: FAST })
  const first = await lab.importCode(three)
  assert.deepEqual(first.verdicts.map((v) => v.earned), [true, true, true])
  assert.deepEqual(first.awarded, [0, 1, 2])
  assert.equal(first.xp, 150)
  assert.deepEqual([...first.badges].sort(), ['beat-torch', 'real-machine'])
  assert.equal(progress.stars('forge-softmax'), 3)

  const again = await lab.importCode(three)
  assert.deepEqual([again.awarded, again.xp, again.badges], [[], 0, []])
  assert.equal(progress.state.xp, 150)
})

test('导入：★1 没过就一颗星都不发、不扣任何东西，算一次没过的尝试；「真机验证」照发', async () => {
  const { progress, lab } = await freshLab()
  const result = await lab.importCode(await codeOf({ checks: { passed: 4, total: 5 }, metrics: FAST }))
  assert.equal(result.passed, false)
  assert.deepEqual(result.verdicts.map((v) => v.earned), [false, true, true])
  assert.deepEqual([result.awarded, result.xp, result.badges], [[], 0, ['real-machine']])
  assert.equal(progress.stars('forge-softmax'), 0)
  assert.equal(lab.challenge.record.failures, 1)

  const fixed = await lab.importCode(await codeOf({ metrics: FAST }))
  assert.deepEqual(fixed.awarded, [0, 1, 2])
  assert.deepEqual(fixed.badges, ['beat-torch'])
})

test('导入：挑战里看过答案最多 2 颗星，被封顶的那颗不发，标在它上面的「打败 torch」也不发', async () => {
  const { progress, lab } = await freshLab()
  progress.markAnswerViewed('forge-softmax')
  const result = await lab.importCode(await codeOf({ metrics: FAST }))
  assert.deepEqual(result.awarded, [0, 1])
  assert.deepEqual(result.capped, [2])
  assert.deepEqual(result.badges, ['real-machine'])
  assert.equal(progress.hasBadge('beat-torch'), false)
})

test('导入：另一关的码、坏掉的码什么都不发，错误按类给出；下一次导入成功就清掉', async () => {
  const { progress, lab } = await freshLab()
  assert.equal(await lab.importCode(FIXTURE_CODE('forge-roofline')), null)
  assert.equal(lab.error.value.kind, 'stage')
  assert.equal(await lab.importCode('HGPU1.不是码'), null)
  assert.equal(lab.error.value.kind, 'format')
  assert.equal(progress.state.xp, 0)
  assert.equal(progress.hasBadge('real-machine'), false)
  assert.equal(lab.challenge.record.attempts, 0)

  assert.ok(await lab.importCode(await codeOf({ metrics: FAST })))
  assert.equal(lab.error.value, null)
})

test('导入：真卡副本 ★1 成立就通关，发这道题的经验值，星记在副本里、不当成关卡的星', async () => {
  const id = 'dungeon-spmv'
  const { progress, lab } = await freshLab(id, RULES.slice(0, 2))
  const result = await lab.importCode(await codeOf({ stage: id, metrics: { median_ms: 0.1, gbps: 366, peak_gbps: 610 } }))
  assert.equal(progress.exercise(id).completed, true)
  assert.deepEqual(progress.exercise(id).stars, [0, 1])
  assert.equal(result.xp, exerciseById(id).xp)
  assert.equal(progress.stars(id), 0)
})

test('观摩完成（L-05）以后导入通关码：照样按规则拿星，★1 成立时换掉观摩标记，完成本关的经验值不重复给', async () => {
  const { progress, lab } = await freshLab()
  progress.markReplayed('forge-softmax')
  progress.completeStage('forge-softmax', { mode: progress.completeModeOf('forge-softmax') }) // 看完观摩再做完检查点
  assert.deepEqual([progress.stage('forge-softmax').watched, progress.state.bySource.watch, progress.stars('forge-softmax')], [true, 100, 0])

  await lab.importCode(await codeOf({ checks: { passed: 4, total: 5 }, metrics: FAST })) // ★1 没过：还是观摩完成
  assert.equal(progress.stage('forge-softmax').watched, true)

  const result = await lab.importCode(await codeOf({ metrics: FAST }))
  assert.deepEqual([result.awarded, result.xp], [[0, 1, 2], 150])
  assert.equal(progress.stage('forge-softmax').watched, false)
  assert.equal(progress.state.xp, 250)
  assert.equal(progress.completeModeOf('forge-softmax'), 'normal')
})

test('刷新页面：上一次导入的成绩从这一关的草稿槽读回来，只显示，不重新发奖励', async () => {
  globalThis.window = { localStorage: memoryStorage(), addEventListener() {}, removeEventListener() {} }
  const store = await import('../../docs/course/useProgress.ts')
  const { useLab } = await import('../../docs/course/useLab.ts')
  store.unload()
  try {
    store.ensureLoaded()
    const three = await codeOf({ metrics: FAST })
    await useLab({ stage: 'forge-softmax', stars: () => RULES }).importCode(`\n${three}\n`)
    const xp = store.useProgress().state.xp

    const again = useLab({ stage: 'forge-softmax', stars: () => RULES })
    let restored = null
    for (let i = 0; i < 200 && !restored; i++) {
      await new Promise((resolve) => setTimeout(resolve, 5))
      restored = again.result.value
    }
    assert.ok(restored, '刷新以后没有读回上一次的成绩')
    assert.equal(restored.restored, true)
    assert.equal(restored.code, three)
    assert.deepEqual(restored.verdicts.map((v) => v.earned), [true, true, true])
    assert.deepEqual([restored.awarded, restored.xp, restored.badges], [[], 0, []])
    assert.equal(store.useProgress().state.xp, xp)
    // 别的关没有这一关的成绩
    assert.equal(useLab({ stage: 'forge-roofline', stars: () => RULES }).result.value, null)
  } finally {
    store.unload()
    delete globalThis.window
  }
})

test('带着通关链接打开页面：挂载后才读回上一次的成绩，也不能顶掉正在导入的码；没导入成功时照常显示上一次的', async () => {
  globalThis.window = { localStorage: memoryStorage(), addEventListener() {}, removeEventListener() {} }
  const store = await import('../../docs/course/useProgress.ts')
  const { useLab } = await import('../../docs/course/useLab.ts')
  store.unload()
  try {
    store.ensureLoaded()
    const three = await codeOf({ metrics: FAST })
    const two = await codeOf({ metrics: { ...FAST, torch_ms: 0.1 } })
    const lab = useLab({ stage: 'forge-softmax', stars: () => RULES })
    const importing = lab.importCode(two)
    // 页面上：挑战状态挂载时才从草稿槽读出上一次导入的码（R-01 在真卡的通关链接上碰到：读回排在导入后面）
    lab.challenge.draft.value = three
    const result = await importing
    assert.ok(result, '正在导入的码被读回的旧成绩顶掉了')
    assert.deepEqual([lab.result.value.code, lab.result.value.restored, lab.busy.value], [two, false, false])
    assert.deepEqual(result.verdicts.map((v) => v.earned), [true, true, false])

    // 接着导入一串坏码：报错，上一次的成绩照常显示
    const again = useLab({ stage: 'forge-softmax', stars: () => RULES })
    const broken = again.importCode('HGPU1.不是码')
    again.challenge.draft.value = three
    assert.equal(await broken, null)
    assert.equal(again.error.value.kind, 'format')
    for (let i = 0; i < 200 && !again.result.value; i++) await new Promise((resolve) => setTimeout(resolve, 5))
    assert.deepEqual([again.result.value?.code, again.result.value?.restored, again.busy.value], [three, true, false])
  } finally {
    store.unload()
    delete globalThis.window
  }
})
