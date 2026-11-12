import assert from 'node:assert/strict'
import test from 'node:test'
import { deflateRawSync } from 'node:zlib'
import fixtures from '../../docs/course/lab-rules.fixtures.json' with { type: 'json' }
import { cardRecord, explainCardError } from '../../docs/course/device.ts'
import { CARD_PREFIX, CREDENTIAL_PREFIX, LabCodeError, decodeCard, encodeCode } from '../../docs/course/lab.ts'
import {
  clearedState, currentDevice, emptyState, exportJson, importSave, removeDevice, saveDevice, selectDevice,
} from '../../docs/course/progress.ts'
import { loadState, memoryStorage, saveState } from '../../docs/course/storage.ts'
import { missingErrorParts } from '../../docs/course/useChallenge.ts'

/**
 * 我的 GPU 卡片（L-07）：导入码（HGCARD1.）的解码和检查（和 hello_gpu.codes.check_card 跑同一份共享样例、
 * 同一张报错分类表，见 notebooks/common/tests/test_lab_codes.py），存几张、换当前的、刷新和换设备以后还在。
 */

const AT = 1_762_000_000_000

/** 一张合格的卡片（伪造数据，同 test_lab_codes.py 的 card()），changes 覆盖顶层字段。 */
function card(changes = {}) {
  return {
    v: 1, at: '2026-11-08T10:00:00Z',
    device: { name: 'Fixture GPU', gfx: 'gfx1201', cus: 48, wave: 32, memory_bytes: 2 ** 34 },
    env: { rocm: null, torch: '0.0.0+fixture', triton: null },
    ...changes,
  }
}

/** 不经过检查直接打包（Node 的 zlib，和被测的 CompressionStream 是两套实现）：模拟别处生成或者被改过的码。 */
function pack(prefix, text) {
  return prefix + deflateRawSync(Buffer.from(text, 'utf8')).toString('base64url')
}

async function kindOf(promise) {
  try {
    await promise
  } catch (error) {
    assert.ok(error instanceof LabCodeError, `应该抛 LabCodeError，实际是 ${error}`)
    return error.kind
  }
  return null
}

/** 解码、换成存档里的样子，就是 DeviceCard 导入的那两步。 */
async function recordOf(payload) {
  return cardRecord(await decodeCard(await encodeCode(CARD_PREFIX, payload)))
}

// ── 解码和检查 ────────────────────────────────────────────────────────────

test('共享样例：Python 和 Node 编的 GPU 卡片导入码都能导入，存进去的数和码里的一样', async () => {
  const samples = fixtures.codes.filter((s) => s.code.startsWith(CARD_PREFIX))
  assert.equal(samples.length, 2)
  for (const sample of samples) {
    const { device, env, peak, at } = sample.payload
    const record = cardRecord(await decodeCard(sample.code))
    assert.deepEqual(
      [record.name, record.gfx, record.cus, record.wave, record.memoryBytes, record.env, record.at],
      [device.name, device.gfx, device.cus, device.wave, device.memory_bytes, env, at],
      sample.name,
    )
    // 峰值记下是哪一次导入码带来的
    assert.deepEqual(record.peak, peak ? { ...peak, at } : null, sample.name)
  }
})

test('校验：卡片的数据不对报 data，和 hello_gpu.codes 拒绝的是同一批（test_lab_codes.py）', async () => {
  const bad = [
    { device: { name: 'Fixture GPU', gfx: 'gfx1201', cus: 48, wave: 0, memory_bytes: 1 } },
    { device: { name: 'Fixture GPU', gfx: 'gfx1201', cus: 48, wave: null } },
    { device: { name: 'Fixture GPU', gfx: 'gfx1201', cus: 0, wave: 32, memory_bytes: 1 } },
    { device: { name: ' ', gfx: 'gfx1201', cus: 48, wave: 32, memory_bytes: 1 } },
    { device: { name: 'Fixture GPU', gfx: '1201', cus: 48, wave: 32, memory_bytes: 1 } },
    { peak: { gbps: 610 } },
    { peak: { gbps: 610, tflops: 0 } },
    { env: null },
    { env: { torch: 2.5 } },
    { at: '2026-11-08' },
  ]
  for (const changes of bad) {
    assert.equal(await kindOf(decodeCard(pack(CARD_PREFIX, JSON.stringify(card(changes))))), 'data', JSON.stringify(changes))
  }
  // 不知道 wave 大小、还没测峰值，都是合格的卡片
  const unknown = await recordOf(card({ device: { ...card().device, wave: null }, peak: null }))
  assert.deepEqual([unknown.wave, unknown.peak], [null, null])
})

test('码坏了、贴成通关码：按类报错，每一类都写全「现象 + 原因 + 怎么改」', async () => {
  const good = await encodeCode(CARD_PREFIX, card())
  const credential = fixtures.codes.find((s) => s.code.startsWith(CREDENTIAL_PREFIX)).code
  const cases = [
    [credential, 'credential'],
    [`HGCARD2.${good.slice(CARD_PREFIX.length)}`, 'version'],
    [pack(CARD_PREFIX, JSON.stringify(card({ v: 2 }))), 'version'],
    [good.slice(0, -12), 'format'],
    ['我的显卡', 'format'],
    [pack(CARD_PREFIX, JSON.stringify(fixtures.codes[0].payload)), 'data'], // 卡片前缀装着通关凭证
  ]
  for (const [code, kind] of cases) {
    assert.equal(await kindOf(decodeCard(code)), kind, code.slice(0, 40))
    assert.deepEqual(missingErrorParts(explainCardError(new LabCodeError(kind, '说明'))), [], kind)
  }
  // 复制时混进来的空白不算
  assert.equal((await decodeCard(`  ${good.slice(0, 20)}\n${good.slice(20)}\n`)).device.cus, 48)
})

// ── 存档 ──────────────────────────────────────────────────────────────────

test('导入：新卡存进来并当作当前的卡；导入过的卡再导入，只有更新的导入码才覆盖，峰值不会丢', async () => {
  const s = emptyState(AT)
  const first = await recordOf(card())
  assert.equal(saveDevice(s, first, { at: AT }), 'added')
  assert.deepEqual(currentDevice(s), { ...first, importedAt: AT })

  // 2-4 测过峰值以后的新码：同一张卡，换成新的，带上峰值
  const measured = await recordOf(card({ at: '2026-11-09T10:00:00Z', peak: { gbps: 610, tflops: 40 } }))
  assert.equal(saveDevice(s, measured, { at: AT + 1 }), 'updated')
  assert.equal(s.devices.cards.length, 1)
  assert.deepEqual(currentDevice(s).peak, { gbps: 610, tflops: 40, at: '2026-11-09T10:00:00Z' })

  // 之后在别的环境里重新生成、没带峰值的码：软件版本换成新的，峰值留着
  const later = await recordOf(card({ at: '2026-11-10T10:00:00Z', env: { rocm: '0.0.1-fixture', torch: null, triton: null } }))
  assert.equal(saveDevice(s, later, { at: AT + 2 }), 'updated')
  assert.equal(currentDevice(s).env.rocm, '0.0.1-fixture')
  assert.equal(currentDevice(s).peak.at, '2026-11-09T10:00:00Z')

  // 更旧的码不覆盖；同一串码再贴一次什么都不变
  assert.equal(saveDevice(s, first, { at: AT + 3 }), 'older')
  assert.equal(saveDevice(s, later, { at: AT + 4 }), 'same')
  assert.equal(currentDevice(s).at, '2026-11-10T10:00:00Z')
  assert.equal(currentDevice(s).importedAt, AT + 2)
})

test('导入：存着的卡还没有峰值时，更旧的码带来的峰值补进去，别的不变', async () => {
  const s = emptyState(AT)
  saveDevice(s, await recordOf(card({ at: '2026-11-09T10:00:00Z' })), { at: AT })
  const older = await recordOf(card({ peak: { gbps: 600, tflops: 39 }, env: { rocm: 'old', torch: null, triton: null } }))
  assert.equal(saveDevice(s, older, { at: AT + 1 }), 'updated')
  assert.deepEqual(currentDevice(s).peak, { gbps: 600, tflops: 39, at: '2026-11-08T10:00:00Z' })
  assert.deepEqual([currentDevice(s).at, currentDevice(s).env.rocm], ['2026-11-09T10:00:00Z', null])
})

test('几张卡：换当前的、删卡；删掉当前那张以后回到本书的卡', async () => {
  const s = emptyState(AT)
  const mine = await recordOf(card())
  const cloud = await recordOf(card({ device: { name: 'Fixture Cloud GPU', gfx: 'gfx1100', cus: 96, wave: 32, memory_bytes: 2 ** 35 } }))
  saveDevice(s, mine, { at: AT })
  saveDevice(s, cloud, { at: AT })
  assert.notEqual(mine.id, cloud.id)
  assert.equal(currentDevice(s).id, cloud.id) // 刚导入的就是当前的
  assert.equal(selectDevice(s, mine.id), true)
  assert.equal(currentDevice(s).id, mine.id)
  assert.equal(selectDevice(s, 'no-such-card'), false)
  assert.equal(currentDevice(s).id, mine.id)

  assert.equal(removeDevice(s, cloud.id), true)
  assert.equal(currentDevice(s).id, mine.id) // 删的不是当前那张，当前不变
  assert.equal(removeDevice(s, mine.id), true)
  assert.equal(currentDevice(s), null)
  assert.equal(removeDevice(s, mine.id), false)
})

test('刷新、换设备以后卡片还在；坏掉的卡丢掉，当前那张不在了就回到本书的卡；清空进度时留着', async () => {
  const s = emptyState(AT)
  saveDevice(s, await recordOf(card({ peak: { gbps: 610, tflops: 40 } })), { at: AT })
  const snapshot = JSON.parse(JSON.stringify(s.devices))

  const storage = memoryStorage()
  saveState(storage, s)
  assert.deepEqual(loadState(storage, AT).state.devices, snapshot) // 刷新
  const moved = importSave(exportJson(s, AT), AT) // 存档文件带到另一台设备
  assert.deepEqual(moved.state.devices, snapshot)

  const raw = JSON.parse(exportJson(s, AT))
  const good = raw.state.devices.cards[0]
  raw.state.devices = {
    cards: [
      good,
      { ...good, cus: 40 }, // 同一个 id 只留第一条
      { ...good, id: 'no-cus', cus: 0 },
      { ...good, id: 'bad-gfx', gfx: 'RDNA4' },
      { ...good, id: 'bad-at', at: 'yesterday' },
      { ...good, id: 'soft', wave: 'x', peak: { gbps: 610 }, env: { rocm: 7 } }, // 可有可无的坏了当没有
    ],
    current: 'bad-gfx',
  }
  const cleaned = importSave(JSON.stringify(raw), AT).state.devices
  assert.deepEqual(cleaned.cards.map((c) => c.id), [good.id, 'soft'])
  assert.deepEqual(cleaned.cards[0], good)
  assert.deepEqual([cleaned.cards[1].wave, cleaned.cards[1].peak, cleaned.cards[1].env.rocm], [null, null, null])
  assert.equal(cleaned.current, '')

  assert.deepEqual(clearedState(s, AT + 1).devices, snapshot)
})
