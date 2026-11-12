import assert from 'node:assert/strict'
import test from 'node:test'
import { GLOSSARY } from '../../docs/course/glossary.ts'
import {
  CARDS,
  SECTION_IDS,
  cardAnchor,
  cardMatches,
  carsForStride,
  letterAnchor,
  pinyinCollator,
  queryTokens,
  stageLink,
  termIndex,
  termMatches,
} from '../../docs/course/handbook.ts'
import { STAGES, ZONES } from '../../docs/course/outline.ts'
import { analyzeMemory } from '../../docs/sim/memory.ts'

const LETTER_ORDER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ#'

test('术语索引：每个术语出现一次；汉字按拼音首字母、英文按第一个字母分组，组按字母顺序', () => {
  const index = termIndex()
  const keys = index.flatMap((z) => z.groups.flatMap((g) => g.keys))
  assert.deepEqual([...keys].sort(), Object.keys(GLOSSARY).sort())
  // 区域按大纲顺序，还没登记术语的区域不列
  assert.deepEqual(index.map((z) => z.zone), ZONES.map((z) => z.id).filter((id) => Object.values(GLOSSARY).some((e) => e.zone === id)))
  for (const z of index) {
    const ranks = z.groups.map((g) => LETTER_ORDER.indexOf(g.letter))
    assert.ok(ranks.every((r, i) => r >= 0 && (i === 0 || r > ranks[i - 1])), `${z.zone} 的字母组顺序不对：${z.groups.map((g) => g.letter)}`)
    for (const g of z.groups) for (const key of g.keys) assert.equal(GLOSSARY[key].zone, z.zone)
  }

  const groupOf = {}
  for (const z of index) for (const g of z.groups) for (const key of g.keys) groupOf[key] = g
  const letters = Object.fromEntries(['parallel', 'cu', 'global-index', 'exec-mask', 'out-of-bounds', 'lds', 'react-loop', 'cache-line', 'agent'].map((k) => [k, groupOf[k].letter]))
  assert.deepEqual(letters, {
    parallel: 'B', // 并行
    cu: 'J', // 计算单元
    'global-index': 'Q', // 全局下标
    'exec-mask': 'Z', // 执行掩码（zhí）
    'out-of-bounds': 'Y', // 越界
    lds: 'L',
    'react-loop': 'R', // ReAct 循环
    'cache-line': 'C',
    agent: 'A',
  })

  // 同一个字母里英文写法在前；汉字按拼音：ji（计算单元、寄存器）在 jia（假加速）前，yan（延迟）在 yue（越界）前
  const before = (a, b) => {
    assert.equal(groupOf[a], groupOf[b], `${a} 和 ${b} 不在同一组`)
    assert.ok(groupOf[a].keys.indexOf(a) < groupOf[a].keys.indexOf(b), `${GLOSSARY[a].term} 应该排在 ${GLOSSARY[b].term} 前面`)
  }
  before('cache-line', 'memory-hierarchy')
  before('cu', 'fake-speedup')
  before('register', 'fake-speedup')
  before('latency-hiding', 'out-of-bounds')
})

test('术语索引：按区域分开，字母和汉字开头之外的放在最后的「#」组', () => {
  const glossary = {
    a: { term: '线程', zone: 'novice' },
    b: { term: 'lane', zone: 'novice' },
    c: { term: '2D 网格', zone: 'novice' },
    d: { term: '并行', zone: 'novice' },
    e: { term: 'Barrier', zone: 'novice' },
    f: { term: 'tile', zone: 'forge' },
  }
  assert.deepEqual(termIndex(glossary), [
    {
      zone: 'novice',
      groups: [
        { letter: 'B', keys: ['e', 'd'] },
        { letter: 'L', keys: ['b'] },
        { letter: 'X', keys: ['a'] },
        { letter: '#', keys: ['c'] },
      ],
    },
    { zone: 'forge', groups: [{ letter: 'T', keys: ['f'] }] },
  ])
})

test('没有中文排序数据时直接报错，不排出一份乱序的索引', () => {
  assert.throws(() => pinyinCollator(new Intl.Collator('en')), /中文（拼音）排序数据/)
  assert.doesNotThrow(() => pinyinCollator())
})

test('搜索术语：中文名、英文名、定义、比喻里的词都能搜；不分大小写和全半角；几个词要同时出现', () => {
  const found = (q) => Object.keys(GLOSSARY).filter((key) => termMatches(key, queryTokens(q)))
  assert.equal(found('').length, Object.keys(GLOSSARY).length)
  assert.equal(found('   ').length, Object.keys(GLOSSARY).length)
  assert.ok(found('lds').includes('lds'))
  assert.deepEqual(found('LDS'), found('lds'))
  assert.deepEqual(found('ＬＤＳ'), found('lds'))
  assert.ok(found('Effective Bandwidth').includes('bandwidth'))
  // 只在比喻里出现的词
  assert.ok(found('车间').includes('cu'))
  const both = found('线程 车间')
  assert.ok(both.includes('block') && both.includes('cu'))
  assert.ok(!both.includes('thread'), '「线程」只有一半对上，不算')
  assert.deepEqual(found('没有这个词'), [])
})

test('搜索卡片：标题、公式、代码、提醒和用到的术语名都算', () => {
  const found = (q) => CARDS.filter((c) => cardMatches(c, queryTokens(q))).map((c) => c.id)
  for (const card of CARDS.filter((c) => c.terms.includes('block'))) assert.ok(found('线程块').includes(card.id))
  assert.ok(found('__syncthreads').includes('sync'))
  assert.ok(found('syncthreads()').includes('sync'))
  assert.ok(found('GB/s').includes('bandwidth'))
  assert.deepEqual(found('没有这个词'), [])
})

test('速查卡片：用到的术语和讲它的关卡都查得到；页面上的锚点互不重名，也不和术语条目重名', () => {
  for (const card of CARDS) {
    assert.ok(card.stages.length > 0, `${card.id} 没写讲它的关卡`)
    for (const key of card.terms) assert.ok(GLOSSARY[key], `${card.id} 用到的术语 ${key} 不在术语表里`)
    for (const id of card.stages) assert.ok(stageLink(id), `${card.id} 的关卡 ${id} 不在大纲里`)
  }
  const anchors = [
    ...Object.values(SECTION_IDS),
    ...CARDS.map((c) => cardAnchor(c.id)),
    ...termIndex().flatMap((z) => z.groups.map((g) => letterAnchor(z.zone, g.letter))),
  ]
  assert.equal(new Set(anchors).size, anchors.length)
  // 概念卡链到 /handbook/#<key>：同名的锚点会把读者带到别处
  for (const a of anchors) assert.ok(!Object.hasOwn(GLOSSARY, a), `锚点 ${a} 和术语条目重名`)
})

test('讲它的关卡：上线了才给链接，大纲里没有的是 null', () => {
  const status = { 'novice-wavefront': 'draft', 'novice-thread-groups': 'planned' }
  const stages = STAGES.map((s) => (Object.hasOwn(status, s.id) ? { ...s, status: status[s.id] } : s))
  assert.deepEqual(stageLink('novice-wavefront', stages), { id: 'novice-wavefront', code: '1-5', title: '一起行动的小队', href: '/novice/wavefront/' })
  // 还没上线的关卡没有正式页面，不链接
  assert.equal(stageLink('novice-thread-groups', stages).href, '')
  assert.equal(stageLink('no-such-stage'), null)
})

test('一次访存搬几车：和模拟器 L3 的车次（analyzeMemory）一样', () => {
  for (const lanes of [32, 64]) {
    for (const elemBytes of [2, 4]) {
      for (const lineBytes of [32, 64, 128]) {
        for (const stride of [0, 1, 2, 3, 4, 7, 8, 16, 31, 32, 33, 64]) {
          const event = { space: 'global', addrs: Array.from({ length: lanes }, (_, lane) => lane * stride) }
          const [access] = analyzeMemory([event], { elemBytes, lineBytes }).accesses
          assert.equal(
            carsForStride(stride, { lanes, elemBytes, lineBytes }),
            access.transactions,
            `${lanes} 个 lane、元素 ${elemBytes} B、一车 ${lineBytes} B、步长 ${stride}`,
          )
        }
      }
    }
  }
})
