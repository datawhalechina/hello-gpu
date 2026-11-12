import assert from 'node:assert/strict'
import test from 'node:test'
import { emptyState, setPref } from '../../docs/course/progress.ts'
import { DEMO_STORAGE_KEY, memoryStorage, saveState, STORAGE_KEY } from '../../docs/course/storage.ts'
import { LANG_ATTR, prefsHeadScript, ROUTE_ATTR } from '../../docs/course/prefAttrs.ts'

/** 在假的 localStorage / document 上跑一遍 <head> 脚本，返回写到 <html> 上的属性。 */
function runHeadScript(script, storage) {
  const attrs = {}
  const document = { documentElement: { setAttribute: (name, value) => { attrs[name] = value } } }
  new Function('localStorage', 'document', script)(storage, document)
  return attrs
}

function storageWith(key, prefs) {
  const storage = memoryStorage()
  const state = emptyState(0)
  for (const [k, v] of Object.entries(prefs)) setPref(state, k, v, { at: 0 })
  saveState(storage, state, key)
  return storage
}

test('<head> 脚本按存档把写法和路线写到 <html> 上，读的是存档真正的格式', () => {
  const storage = storageWith(STORAGE_KEY, { lang: 'python', route: 'triton' })
  assert.deepEqual(runHeadScript(prefsHeadScript(), storage), { [LANG_ATTR]: 'python', [ROUTE_ATTR]: 'triton' })
})

test('演示页的 <head> 脚本读演示存档，不读正式存档', () => {
  const storage = storageWith(STORAGE_KEY, { lang: 'python', route: 'triton' })
  saveState(storage, emptyState(0), DEMO_STORAGE_KEY)
  assert.deepEqual(runHeadScript(prefsHeadScript(true), storage), { [LANG_ATTR]: 'hip', [ROUTE_ATTR]: 'hip' })
  assert.deepEqual(runHeadScript(prefsHeadScript(false), storage), { [LANG_ATTR]: 'python', [ROUTE_ATTR]: 'triton' })
})

test('没有存档、存档损坏、取值不认识、存储不可用：什么都不写，页面按默认写法显示', () => {
  assert.deepEqual(runHeadScript(prefsHeadScript(), memoryStorage()), {})

  const broken = memoryStorage()
  broken.setItem(STORAGE_KEY, '{not json')
  assert.deepEqual(runHeadScript(prefsHeadScript(), broken), {})

  const odd = memoryStorage()
  odd.setItem(STORAGE_KEY, JSON.stringify({ prefs: { lang: 'rust', route: '<script>' } }))
  assert.deepEqual(runHeadScript(prefsHeadScript(), odd), {})

  const nullSave = memoryStorage()
  nullSave.setItem(STORAGE_KEY, 'null')
  assert.deepEqual(runHeadScript(prefsHeadScript(), nullSave), {})

  const blocked = { getItem() { throw new Error('SecurityError') } }
  assert.deepEqual(runHeadScript(prefsHeadScript(), blocked), {})
})
