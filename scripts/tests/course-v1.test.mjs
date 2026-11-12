import assert from 'node:assert/strict'
import test from 'node:test'
import { appendices, chapters } from '../../docs/.vitepress/outline.mjs'
import { isPublished, STAGES } from '../../docs/course/outline.ts'
import { chapterOfPage, legacyByStage, noticeStagesOf, V1_CHAPTERS, V1_GROUPS } from '../../docs/course/v1.ts'
import { checkV1Map, loadCourseData } from '../course/course-data-check.mjs'

const data = loadCourseData()
const { outline, v1Map } = data

function hasError(errors, text) {
  return errors.some((e) => e.includes(text))
}

/** 改 v1-map.json 的一章，别的照抄（顺序不变）；ids 写成 undefined 时删掉这一章。 */
function mapWith(path, ids) {
  return Object.fromEntries(Object.entries(v1Map).flatMap(([p, v]) => (p !== path ? [[p, v]] : ids === undefined ? [] : [[p, ids]])))
}

const check = (map) => checkV1Map(map, { outline })

// ── 旧版目录和映射数据 ────────────────────────────────────────────────────

test('旧版章节按旧版目录的顺序：先 5 篇正文的各章，再附录（附录数组里的空位跳过）', () => {
  const want = [...chapters.map((c) => c.path), ...appendices.filter(Boolean).map((a) => a.path)]
  assert.deepEqual(V1_CHAPTERS.map((c) => c.path), want)
  assert.deepEqual(V1_GROUPS.map((g) => g.id), ['part0', 'part1', 'part2', 'part3', 'part4', 'appendix'])
  // 附录的标题「附录 A · ……」拆成编号和标题。
  assert.deepEqual(V1_CHAPTERS.filter((c) => c.path.startsWith('/appendix/')).map((c) => c.label), ['附录 A', '附录 B', '附录 C', '附录 D'])
  assert.ok(V1_CHAPTERS.every((c) => !c.title.startsWith('附录')))
})

test('仓库里的 v1-map.json 通过检查：覆盖旧版全部章节，每章至少对应一关', () => {
  assert.deepEqual(check(v1Map), [])
})

test('v1-map 检查：少一章、多出不是旧版章节的地址、顺序和旧版目录不一致，都会报错', () => {
  assert.equal(hasError(check(mapWith('/part1-profiling/chapter7/', undefined)), 'v1-map.json 缺少旧版第 7 章「读懂 Roofline 图」（/part1-profiling/chapter7/）'), true)
  assert.equal(hasError(check(mapWith('/appendix/programming-models/', undefined)), '缺少旧版附录 D「HIP 与 Triton 的编程范式」'), true)
  // 篇首页不是章；地址少了结尾的斜杠也对不上。
  assert.equal(hasError(check({ ...v1Map, '/part2-kernels/': ['forge-softmax'] }), 'v1-map.json 的 /part2-kernels/：不是旧版的章节'), true)
  assert.equal(hasError(check({ ...v1Map, '/part0-intro/chapter2': ['novice-wavefront'] }), 'v1-map.json 的 /part0-intro/chapter2：不是旧版的章节'), true)

  const [first, second, ...rest] = Object.entries(v1Map)
  const swapped = check(Object.fromEntries([second, first, ...rest]))
  assert.equal(hasError(swapped, `要按旧版目录的顺序写（先第 0 章起的正文各章，再附录）：${second[0]} 排错了位置`), true)
})

test('v1-map 检查：每章至少一关，关卡要在大纲里、不重复、按大纲顺序', () => {
  const ch9 = (ids) => check(mapWith('/part2-kernels/chapter9/', ids))
  assert.equal(hasError(ch9([]), 'v1-map.json 的 /part2-kernels/chapter9/：要列出新版里对应的关卡，至少一关'), true)
  assert.equal(hasError(ch9('novice-reduction'), '至少一关'), true)
  assert.equal(hasError(ch9(['novice-reduction', 'novice-tree']), '关卡「novice-tree」不在 outline.json 里'), true)
  assert.equal(hasError(ch9(['novice-reduction', 'novice-reduction']), '关卡「novice-reduction」写了两次'), true)
  assert.equal(hasError(ch9(['forge-reduction-practice', 'novice-reduction']), '关卡按大纲顺序排，「novice-reduction」排错了位置'), true)
  assert.deepEqual(ch9(['novice-reduction']), [])
  assert.deepEqual(check([]), ['v1-map.json 要写成「旧章节路径 → 新版关卡 id 列表」的对象'])
})

// ── 世界地图的「先看旧版」 ─────────────────────────────────────────────────

test('先看旧版：一关对应好几章时取旧版目录里最靠前的一章，和 v1-map.json 里写的先后无关；目录里没有的地址不算', () => {
  const map = { '/b/': ['s2', 's3'], '/a/': ['s1', 's2'], '/z/': ['s4'] }
  assert.deepEqual(legacyByStage(map, ['/a/', '/b/']), { s1: '/a/', s2: '/a/', s3: '/b/' })
  assert.equal(legacyByStage(map, ['/b/', '/a/']).s2, '/b/')
})

// ── 旧版页面顶部的提示 ─────────────────────────────────────────────────────

test('旧版页面属于哪一章：章里的补充页面跟着所在的章，篇首页和别的页面不属于任何一章', () => {
  assert.equal(chapterOfPage('part0-intro/chapter3/index.md'), '/part0-intro/chapter3/')
  assert.equal(chapterOfPage('part0-intro/chapter3/experiments.md'), '/part0-intro/chapter3/')
  assert.equal(chapterOfPage('part3-agent/chapter17/optimization-report.md'), '/part3-agent/chapter17/')
  assert.equal(chapterOfPage('appendix/programming-models/index.md'), '/appendix/programming-models/')
  for (const page of ['part2-kernels/index.md', 'index.md', 'curriculum/index.md', 'v1/index.md', 'novice/assign-threads/index.md']) {
    assert.equal(chapterOfPage(page), null, page)
  }
  // 地址按目录比，第 1 章不会把第 10 章的页面认走。
  assert.equal(chapterOfPage('p/chapter10/index.md', ['/p/chapter1/', '/p/chapter10/']), '/p/chapter10/')
})

test('旧版页面顶部只提示已经上线的关卡，按这一章写的顺序', () => {
  const live = STAGES.filter(isPublished)
  const soon = STAGES.filter((s) => !isPublished(s))
  assert.ok(live.length >= 2 && soon.length >= 1, '大纲里要同时有上线和建设中的关卡')
  const map = { '/p/chapter1/': [live[1].id, soon[0].id, live[0].id] }
  assert.deepEqual(noticeStagesOf('p/chapter1/extra.md', map).map((s) => s.id), [live[1].id, live[0].id])
  assert.deepEqual(noticeStagesOf('p/index.md', map), [])
  assert.deepEqual(noticeStagesOf('p/chapter2/index.md', { '/p/chapter2/': [soon[0].id] }), [])
})
